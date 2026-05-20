import { TextureGenerator } from './textures.js?v=1.0.6';


/**
 * WorldManager - Generates the infinite procedurally-generated Backrooms maze.
 * Utilizes a deterministic hash function to build connected walls, carpet floors,
 * ceiling tiles, and flickering fluorescent ceiling lights in dynamic chunks.
 * Handles automatic chunk loading/unloading based on player proximity.
 * Optimized with a static light pool to eliminate WebGL shader compilation stutter.
 * Generates three distinct architectural zones: Office Rooms, Spooky Corridors, and Column Lobbies.
 */

export class WorldManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        // Size constants
        this.cellSize = 3.2;    // Each cell in the grid is 3.2m x 3.2m
        this.wallHeight = 2.8;   // 2.8m high walls
        this.chunkGridSize = 4; // 4x4 cells per chunk
        this.chunkSize = this.cellSize * this.chunkGridSize; // 12.8m per chunk

        // View distance config - Optimized to 1 to MASSIVELY cut draw calls and active meshes.
        // Loads a 3x3 grid (9 chunks total) instead of a 5x5 grid (25 chunks total).
        // This cuts active rendering and collision overhead by 64% with zero visual difference,
        // because the extremely dense 0.12 fog completely obscures everything beyond 15 meters anyway!
        this.loadRadius = 1;   
        this.unloadRadius = 2; 

        // Dynamic tracking
        this.loadedChunks = new Map(); // Key: "cx,cz" -> Value: Chunk Object
        this.flickeringLights = [];   // Active ceiling lights for flickering calculations
        this.activeBatteries = [];
        this.activeSurvivors = [];

        // Materials setup
        this.texGenerator = new TextureGenerator();
        this.materials = {};
        this.initMaterials();

        // Helper bounding geometries for collisions
        this.collidableWalls = [];

        // Warehouse control variables
        this.warehouseMode = false;
        this.vhsTapeMesh = null;
        this.vhsLight = null;

        // PRE-ALLOCATE AND RE-USE GEOMETRIES TO ELIMINATE WebGL BUFFER UPDATES AND GC STUTTER
        const wallThickness = 0.16;
        this.wallGeoHorizontal = new THREE.BoxGeometry(this.cellSize + wallThickness, this.wallHeight, wallThickness);
        this.wallGeoVertical = new THREE.BoxGeometry(wallThickness, this.wallHeight, this.cellSize + wallThickness);
        this.floorCeilingGeo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize);
        this.fixtureGeo = new THREE.BoxGeometry(1.2, 0.08, 0.4);
        this.panelGeo = new THREE.BoxGeometry(1.0, 0.01, 0.28);
        this.pillarGeo = new THREE.BoxGeometry(0.8, this.wallHeight, 0.8);
        this.crateGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);

        // PRE-ALLOCATED CYLINDER GEOMETRIES FOR BATTERY MESHES TO PREVENT GC STUTTER
        this.batteryBodyGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8);
        this.batteryLabelGeo = new THREE.CylinderGeometry(0.061, 0.061, 0.08, 8);
        this.batteryTipGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8);

        // PRE-ALLOCATE DISPLACEMENT VECTOR TO PREVENT Micro-Stutters from GC allocations in collision updates
        this.displacement = new THREE.Vector3();

        // CREATE A STATIC LIGHT POOL TO ELIMINATE WebGL SHADER RECOMPILATIONS
        // Dynamic additions/removals of light nodes from the scene tree trigger expensive GLSL re-compiles.
        // By pre-allocating a fixed set of lights in the scene once, we eliminate this stutter entirely.
        // Optimized down from 16 to 6 to cut fragment shader loops by 62.5% on all devices.
        this.lightPoolSize = 6;
        this.lightPool = [];
        for (let i = 0; i < this.lightPoolSize; i++) {
            const pLight = new THREE.PointLight(0xfffae3, 0.0, 9.0, 1.4);
            pLight.castShadow = false; // PointLight shadows disabled for dynamic ceiling lights for maximum performance
            this.scene.add(pLight);
            this.lightPool.push({
                light: pLight,
                inUse: false
            });
        }

        // 8 Shared materials for fluorescent ceiling lights to completely eliminate WebGL shader program recompilation stutter
        this.lightPanelFlickerTimers = [0, 0, 0, 0, 0, 0, 0, 0];
        this.lightPanelFlickerStates = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];

        // Active rented lights cache and tracking variables to throttle distance sorting
        this.lastSortPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
        this.rentedLights = [];
        this.rentedNeedsUpdate = true;
    }

    /**
     * Pre-generates the hyper-realistic materials once to conserve GPU memory
     */
    initMaterials() {
        // A. Wallpaper material
        const wallTex = this.texGenerator.getWallTextures();
        this.materials.wall = new THREE.MeshStandardMaterial({
            map: wallTex.diffuse,
            normalMap: wallTex.normal,
            normalScale: new THREE.Vector2(1.0, 1.0),
            roughness: 0.85,
            metalness: 0.05
        });

        // B. Carpet material
        const carpetTex = this.texGenerator.getCarpetTextures();
        this.materials.carpet = new THREE.MeshStandardMaterial({
            map: carpetTex.diffuse,
            normalMap: carpetTex.normal,
            normalScale: new THREE.Vector2(1.2, 1.2),
            roughness: 0.95,
            metalness: 0.0
        });

        // C. Ceiling material
        const ceilingTex = this.texGenerator.getCeilingTextures();
        this.materials.ceiling = new THREE.MeshStandardMaterial({
            map: ceilingTex.diffuse,
            normalMap: ceilingTex.normal,
            normalScale: new THREE.Vector2(0.8, 0.8),
            roughness: 0.9,
            metalness: 0.0
        });

        // D. Emissive Fluorescent Light panel material
        this.materials.lightFixture = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.5
        });

        // Pre-allocate 8 shared light panel materials to prevent any material cloning or dynamic shader compiling on chunk loads!
        this.lightPanelMaterials = [];
        for (let i = 0; i < 8; i++) {
            this.lightPanelMaterials.push(new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: 0xfffae6,
                emissiveIntensity: 1.8,
                roughness: 0.1
            }));
        }

        // E. Warehouse Materials
        const wWallTex = this.texGenerator.getWarehouseWallTextures();
        this.materials.warehouseWall = new THREE.MeshStandardMaterial({
            map: wWallTex.diffuse,
            normalMap: wWallTex.normal,
            normalScale: new THREE.Vector2(1.0, 1.0),
            roughness: 0.75,
            metalness: 0.1
        });

        const wFloorTex = this.texGenerator.getWarehouseFloorTextures();
        this.materials.warehouseFloor = new THREE.MeshStandardMaterial({
            map: wFloorTex.diffuse,
            normalMap: wFloorTex.normal,
            normalScale: new THREE.Vector2(1.0, 1.0),
            roughness: 0.8,
            metalness: 0.05
        });

        const wCeilingTex = this.texGenerator.getWarehouseCeilingTextures();
        this.materials.warehouseCeiling = new THREE.MeshStandardMaterial({
            map: wCeilingTex.diffuse,
            normalMap: wCeilingTex.normal,
            normalScale: new THREE.Vector2(1.2, 1.2),
            roughness: 0.6,
            metalness: 0.4
        });

        const crateTex = this.texGenerator.getCrateTextures();
        this.materials.crate = new THREE.MeshStandardMaterial({
            map: crateTex.diffuse,
            normalMap: crateTex.normal,
            normalScale: new THREE.Vector2(1.0, 1.0),
            roughness: 0.9,
            metalness: 0.0
        });

        // VHS Tape materials
        this.materials.vhsPlastic = new THREE.MeshStandardMaterial({
            color: 0x151515,
            roughness: 0.4,
            metalness: 0.1
        });
        
        this.materials.vhsLabel = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.9
        });

        // Battery materials
        this.materials.batteryShell = new THREE.MeshStandardMaterial({
            color: 0x222222,
            metalness: 0.8,
            roughness: 0.2
        });
        this.materials.batteryAnode = new THREE.MeshStandardMaterial({
            color: 0x00ffcc,
            emissive: 0x00ffcc,
            emissiveIntensity: 3.0,
            roughness: 0.1
        });
        this.materials.batteryLabel = new THREE.MeshStandardMaterial({
            color: 0xd4af37,
            metalness: 0.5,
            roughness: 0.3
        });

        // Hazmat / Survivor / Dead body materials (preserved for structural completeness)
        this.materials.hazmatSuit = new THREE.MeshStandardMaterial({
            color: 0xff6600, // safety orange
            roughness: 0.8,
            metalness: 0.1
        });
        this.materials.hazmatSuitDead = new THREE.MeshStandardMaterial({
            color: 0xb55a30, // distressed, dirty safety orange
            roughness: 0.95,
            metalness: 0.0
        });
        this.materials.hazmatVisor = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.1,
            metalness: 0.9
        });
        this.materials.fleshPale = new THREE.MeshStandardMaterial({
            color: 0xddcbbb,
            roughness: 0.6
        });
    }

    /**
     * Deterministic hash function for infinite procedural repeatability
     */
    hash(x, z) {
        const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453123;
        return h - Math.floor(h);
    }

    /**
     * Core update loop: manages dynamic loading, unloading, and lighting flickering
     */
    update(playerPosition, dt) {
        // 1. Calculate player's current chunk coordinates
        const playerChunkX = Math.floor(playerPosition.x / this.chunkSize);
        const playerChunkZ = Math.floor(playerPosition.z / this.chunkSize);

        // 2. Load chunks in active radius
        for (let cx = playerChunkX - this.loadRadius; cx <= playerChunkX + this.loadRadius; cx++) {
            for (let cz = playerChunkZ - this.loadRadius; cz <= playerChunkZ + this.loadRadius; cz++) {
                const key = `${cx},${cz}`;
                if (!this.loadedChunks.has(key)) {
                    this.loadChunk(cx, cz);
                }
            }
        }

        // 3. Unload distant chunks to save GPU memory and physics overhead
        for (const [key, chunk] of this.loadedChunks.entries()) {
            const dx = Math.abs(chunk.cx - playerChunkX);
            const dz = Math.abs(chunk.cz - playerChunkZ);

            if (dx > this.unloadRadius || dz > this.unloadRadius) {
                this.unloadChunk(key);
            }
        }

        // 4. Update Flickering Fluorescent Ceiling Lights
        this.updateCeilingFlickers(playerPosition, dt);
    }

    /**
     * Generates a 12.8m x 12.8m Backrooms chunk at the given grid coordinates.
     * Selects a zone type deterministically based on coordinates to produce a rich,
     * varied world of rooms, hallways, and lobby column spaces.
     */
    loadChunk(cx, cz) {
        const chunkGroup = new THREE.Group();
        chunkGroup.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
        this.scene.add(chunkGroup);

        const chunkData = {
            cx,
            cz,
            group: chunkGroup,
            walls: [],
            lights: [],
            floor: null,
            ceiling: null
        };

        // A. Generate Carpet Floor / Warehouse Floor Mesh using pre-allocated shared geometry
        const wallThickness = 0.16;

        if (this.warehouseMode) {
            // A. Generate Warehouse Floor Mesh using pre-allocated shared geometry
            const floor = new THREE.Mesh(this.floorCeilingGeo, this.materials.warehouseFloor);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(this.chunkSize / 2, 0, this.chunkSize / 2);
            floor.receiveShadow = true;
            chunkGroup.add(floor);
            chunkData.floor = floor;

            // B. Generate Warehouse Ceiling Mesh using pre-allocated shared geometry
            const ceiling = new THREE.Mesh(this.floorCeilingGeo, this.materials.warehouseCeiling);
            ceiling.rotation.x = Math.PI / 2;
            ceiling.position.set(this.chunkSize / 2, this.wallHeight, this.chunkSize / 2);
            ceiling.receiveShadow = true;
            chunkGroup.add(ceiling);
            chunkData.ceiling = ceiling;

            // Outside bounds check: if outside 2x2, just generate solid enclosing walls to prevent player looking into void
            if (cx < 0 || cx > 1 || cz < 0 || cz > 1) {
                for (let gx = 0; gx < this.chunkGridSize; gx++) {
                    for (let gz = 0; gz < this.chunkGridSize; gz++) {
                        const wall = new THREE.Mesh(this.wallGeoHorizontal, this.materials.warehouseWall);
                        wall.position.set(gx * this.cellSize + this.cellSize/2, this.wallHeight/2, gz * this.cellSize + this.cellSize/2);
                        chunkGroup.add(wall);
                        chunkData.walls.push(wall);
                        
                        const worldWall = {
                            minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                            maxX: cx * this.chunkSize + (gx + 1) * this.cellSize + wallThickness,
                            minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                            maxZ: cz * this.chunkSize + gz * this.cellSize + wallThickness,
                            mesh: wall
                        };
                        this.collidableWalls.push(worldWall);
                        wall.userData.collisionRef = worldWall;
                    }
                }
                this.loadedChunks.set(`${cx},${cz}`, chunkData);
                return;
            }

            // Inside 2x2 warehouse space
            for (let gx = 0; gx < this.chunkGridSize; gx++) {
                for (let gz = 0; gz < this.chunkGridSize; gz++) {
                    const absCellX = cx * this.chunkGridSize + gx;
                    const absCellZ = cz * this.chunkGridSize + gz;

                    // Perimeter walls
                    if (absCellX === 0) {
                        const wall = new THREE.Mesh(this.wallGeoVertical, this.materials.warehouseWall);
                        wall.position.set(0, this.wallHeight / 2, gz * this.cellSize + this.cellSize / 2);
                        wall.castShadow = true;
                        wall.receiveShadow = true;
                        chunkGroup.add(wall);
                        chunkData.walls.push(wall);

                        const worldWall = {
                            minX: cx * this.chunkSize - wallThickness,
                            maxX: cx * this.chunkSize + wallThickness,
                            minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                            maxZ: cz * this.chunkSize + (gz + 1) * this.cellSize + wallThickness,
                            mesh: wall
                        };
                        this.collidableWalls.push(worldWall);
                        wall.userData.collisionRef = worldWall;
                    }
                    if (absCellX === 7) {
                        const wall = new THREE.Mesh(this.wallGeoVertical, this.materials.warehouseWall);
                        wall.position.set(this.chunkSize, this.wallHeight / 2, gz * this.cellSize + this.cellSize / 2);
                        wall.castShadow = true;
                        wall.receiveShadow = true;
                        chunkGroup.add(wall);
                        chunkData.walls.push(wall);

                        const worldWall = {
                            minX: (cx + 1) * this.chunkSize - wallThickness,
                            maxX: (cx + 1) * this.chunkSize + wallThickness,
                            minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                            maxZ: cz * this.chunkSize + (gz + 1) * this.cellSize + wallThickness,
                            mesh: wall
                        };
                        this.collidableWalls.push(worldWall);
                        wall.userData.collisionRef = worldWall;
                    }
                    if (absCellZ === 0) {
                        const wall = new THREE.Mesh(this.wallGeoHorizontal, this.materials.warehouseWall);
                        wall.position.set(gx * this.cellSize + this.cellSize / 2, this.wallHeight / 2, 0);
                        wall.castShadow = true;
                        wall.receiveShadow = true;
                        chunkGroup.add(wall);
                        chunkData.walls.push(wall);

                        const worldWall = {
                            minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                            maxX: cx * this.chunkSize + (gx + 1) * this.cellSize + wallThickness,
                            minZ: cz * this.chunkSize - wallThickness,
                            maxZ: cz * this.chunkSize + wallThickness,
                            mesh: wall
                        };
                        this.collidableWalls.push(worldWall);
                        wall.userData.collisionRef = worldWall;
                    }
                    if (absCellZ === 7) {
                        const wall = new THREE.Mesh(this.wallGeoHorizontal, this.materials.warehouseWall);
                        wall.position.set(gx * this.cellSize + this.cellSize / 2, this.wallHeight / 2, this.chunkSize);
                        wall.castShadow = true;
                        wall.receiveShadow = true;
                        chunkGroup.add(wall);
                        chunkData.walls.push(wall);

                        const worldWall = {
                            minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                            maxX: cx * this.chunkSize + (gx + 1) * this.cellSize + wallThickness,
                            minZ: (cz + 1) * this.chunkSize - wallThickness,
                            maxZ: (cz + 1) * this.chunkSize + wallThickness,
                            mesh: wall
                        };
                        this.collidableWalls.push(worldWall);
                        wall.userData.collisionRef = worldWall;
                    }

                    // Columns inside the warehouse
                    if (absCellX > 0 && absCellX < 7 && absCellZ > 0 && absCellZ < 7) {
                        if ((absCellX === 2 || absCellX === 5) && (absCellZ === 2 || absCellZ === 5)) {
                            const pillar = new THREE.Mesh(this.pillarGeo, this.materials.warehouseWall);
                            pillar.position.set(
                                gx * this.cellSize + this.cellSize / 2,
                                this.wallHeight / 2,
                                gz * this.cellSize + this.cellSize / 2
                            );
                            pillar.castShadow = true;
                            pillar.receiveShadow = true;
                            chunkGroup.add(pillar);
                            chunkData.walls.push(pillar);

                            const pThickness = 0.4;
                            const worldPillar = {
                                minX: cx * this.chunkSize + gx * this.cellSize + this.cellSize / 2 - pThickness,
                                maxX: cx * this.chunkSize + gx * this.cellSize + this.cellSize / 2 + pThickness,
                                minZ: cz * this.chunkSize + gz * this.cellSize + this.cellSize / 2 - pThickness,
                                maxZ: cz * this.chunkSize + gz * this.cellSize + this.cellSize / 2 + pThickness,
                                mesh: pillar
                            };
                            this.collidableWalls.push(worldPillar);
                            pillar.userData.collisionRef = worldPillar;
                        }
                    }

                    // Spawn dim ceiling lights
                    const lightHash = this.hash(absCellX + 15, absCellZ + 22);
                    if (lightHash < 0.2) {
                        this.spawnFluorescentLight(chunkGroup, chunkData, gx, gz, absCellX, absCellZ);
                    }
                }
            }

            // Spawn wood crates inside the warehouse chunks deterministically
            if (cx === 0 && cz === 0) {
                this.spawnCrate(chunkGroup, chunkData, 4.5, 4.5, 0.7, 1.0);
                this.spawnCrate(chunkGroup, chunkData, 4.5, 5.7, 0.7, 1.0);
                this.spawnCrate(chunkGroup, chunkData, 9.0, 3.5, 0.7, 1.1);
            }
            if (cx === 1 && cz === 0) {
                this.spawnCrate(chunkGroup, chunkData, 16.0, 8.0, 0.7, 1.0);
                this.spawnCrate(chunkGroup, chunkData, 21.0, 4.5, 0.7, 1.2);
            }
            if (cx === 0 && cz === 1) {
                this.spawnCrate(chunkGroup, chunkData, 5.0, 18.0, 0.7, 1.0);
                this.spawnCrate(chunkGroup, chunkData, 8.5, 21.0, 0.7, 1.1);
            }
            if (cx === 1 && cz === 1) {
                this.spawnCrate(chunkGroup, chunkData, 20.0, 20.0, 0.7, 1.0);
                this.spawnCrate(chunkGroup, chunkData, 15.0, 16.0, 0.7, 1.2);
            }

            // SPAWN THE GLOWING VHS TAPE IN THE CENTER (chunk 0, 0 at x = 10.0, z = 10.0)
            if (cx === 0 && cz === 0) {
                // Place a base crate at x=10.0, z=10.0
                this.spawnCrate(chunkGroup, chunkData, 10.0, 10.0, 0.7, 1.0);

                // Build the VHS tape group
                const tapeGroup = new THREE.Group();

                // VHS main body
                const bodyGeo = new THREE.BoxGeometry(0.32, 0.04, 0.18);
                const bodyMesh = new THREE.Mesh(bodyGeo, this.materials.vhsPlastic);
                bodyMesh.castShadow = true;
                tapeGroup.add(bodyMesh);

                // Reel label left
                const labelGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.006, 16);
                const labelLeft = new THREE.Mesh(labelGeo, this.materials.vhsLabel);
                labelLeft.position.set(-0.06, 0.02, 0);
                tapeGroup.add(labelLeft);

                // Reel label right
                const labelRight = labelLeft.clone();
                labelRight.position.set(0.06, 0.02, 0);
                tapeGroup.add(labelRight);

                // Place tape on top of the crate
                tapeGroup.position.set(10.0 - chunkGroup.position.x, 1.46, 10.0 - chunkGroup.position.z);
                chunkGroup.add(tapeGroup);

                // Subtle neon blue-purple PointLight glowing from it
                const light = new THREE.PointLight(0x40c4ff, 3.5, 4.0, 1.5);
                light.position.set(10.0 - chunkGroup.position.x, 1.7, 10.0 - chunkGroup.position.z);
                chunkGroup.add(light);

                // Keep references
                this.vhsTapeMesh = tapeGroup;
                this.vhsLight = light;
            }

            this.loadedChunks.set(`${cx},${cz}`, chunkData);
            return;
        }

        // --- Backrooms Generation Mode (standard path) ---
        // A. Generate Carpet Floor Mesh using pre-allocated shared geometry
        const floor = new THREE.Mesh(this.floorCeilingGeo, this.materials.carpet);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(this.chunkSize / 2, 0, this.chunkSize / 2);
        floor.receiveShadow = true;
        chunkGroup.add(floor);
        chunkData.floor = floor;

        // B. Generate Ceiling Mesh using pre-allocated shared geometry
        const ceiling = new THREE.Mesh(this.floorCeilingGeo, this.materials.ceiling);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(this.chunkSize / 2, this.wallHeight, this.chunkSize / 2);
        ceiling.receiveShadow = true;
        chunkGroup.add(ceiling);
        chunkData.ceiling = ceiling;

        // C. Generate Deterministic Architectural Layout

        // Determine architectural zone style for this chunk deterministically
        const chunkHash = this.hash(cx * 31, cz * 17);
        let zoneType = 'OFFICE';
        if (chunkHash < 0.4) {
            zoneType = 'OFFICE';    // 40% Office rooms
        } else if (chunkHash < 0.75) {
            zoneType = 'CORRIDOR';  // 35% Long corridors
        } else {
            zoneType = 'LOBBY';     // 25% Open lobbies with columns
        }

        // Loop through cells in this chunk
        for (let gx = 0; gx < this.chunkGridSize; gx++) {
            for (let gz = 0; gz < this.chunkGridSize; gz++) {
                // Absolute global cell coordinate indexes
                const absCellX = cx * this.chunkGridSize + gx;
                const absCellZ = cz * this.chunkGridSize + gz;

                // 1. LOBBY ZONE GENERATION (Open spaces with supporting columns)
                if (zoneType === 'LOBBY') {
                    const pillarHash = this.hash(absCellX + 41, absCellZ + 29);
                    if (pillarHash < 0.25) {
                        const pillar = new THREE.Mesh(this.pillarGeo, this.materials.wall);
                        pillar.position.set(
                            gx * this.cellSize + this.cellSize / 2,
                            this.wallHeight / 2,
                            gz * this.cellSize + this.cellSize / 2
                        );
                        pillar.castShadow = true;
                        pillar.receiveShadow = true;
                        chunkGroup.add(pillar);
                        chunkData.walls.push(pillar); // Unload automatically as wall group
                        
                        // Register global position for collision checks
                        const pThickness = 0.4;
                        const worldPillar = {
                            minX: cx * this.chunkSize + gx * this.cellSize + this.cellSize / 2 - pThickness,
                            maxX: cx * this.chunkSize + gx * this.cellSize + this.cellSize / 2 + pThickness,
                            minZ: cz * this.chunkSize + gz * this.cellSize + this.cellSize / 2 - pThickness,
                            maxZ: cz * this.chunkSize + gz * this.cellSize + this.cellSize / 2 + pThickness,
                            mesh: pillar
                        };
                        this.collidableWalls.push(worldPillar);
                        pillar.userData.collisionRef = worldPillar;
                    }

                    // Place lights in the open spaces
                    const lightHash = this.hash(absCellX + 12, absCellZ + 37);
                    if (lightHash < 0.15 && pillarHash >= 0.25) {
                        this.spawnFluorescentLight(chunkGroup, chunkData, gx, gz, absCellX, absCellZ);
                    }
                    continue;
                }

                // 2. CORRIDOR ZONE GENERATION (Long eerie pathways running horizontally or vertically)
                if (zoneType === 'CORRIDOR') {
                    const runX = this.hash(cx * 13, cz * 7) < 0.5;

                    if (runX) {
                        // Corridors run horizontal (East-West)
                        if (gz % 2 === 0) {
                            // Occasional gaps connecting north/south paths
                            const pathGap = this.hash(absCellX, absCellZ) < 0.22;
                            if (!pathGap) {
                                const wall = new THREE.Mesh(this.wallGeoHorizontal, this.materials.wall);
                                wall.position.set(
                                    gx * this.cellSize + this.cellSize / 2,
                                    this.wallHeight / 2,
                                    gz * this.cellSize
                                );
                                wall.castShadow = true;
                                wall.receiveShadow = true;
                                chunkGroup.add(wall);
                                chunkData.walls.push(wall);
                                
                                const worldWall = {
                                    minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                                    maxX: cx * this.chunkSize + (gx + 1) * this.cellSize + wallThickness,
                                    minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                                    maxZ: cz * this.chunkSize + gz * this.cellSize + wallThickness,
                                    mesh: wall
                                };
                                this.collidableWalls.push(worldWall);
                                wall.userData.collisionRef = worldWall;
                            }
                        }

                        // Block occasional horizontal corridors to form a winding maze
                        if (gz % 2 !== 0) {
                            const blockCorridor = this.hash(absCellX, absCellZ + 50) < 0.25;
                            if (blockCorridor) {
                                const wall = new THREE.Mesh(this.wallGeoVertical, this.materials.wall);
                                wall.position.set(
                                    gx * this.cellSize,
                                    this.wallHeight / 2,
                                    gz * this.cellSize + this.cellSize / 2
                                );
                                wall.castShadow = true;
                                wall.receiveShadow = true;
                                chunkGroup.add(wall);
                                chunkData.walls.push(wall);

                                const worldWall = {
                                    minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                                    maxX: cx * this.chunkSize + gx * this.cellSize + wallThickness,
                                    minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                                    maxZ: cz * this.chunkSize + (gz + 1) * this.cellSize + wallThickness,
                                    mesh: wall
                                };
                                this.collidableWalls.push(worldWall);
                                wall.userData.collisionRef = worldWall;
                            }
                        }

                        // Light fixtures along corridors
                        if (gz % 2 !== 0) {
                            const lightHash = this.hash(absCellX + 12, absCellZ + 37);
                            if (lightHash < 0.15) {
                                this.spawnFluorescentLight(chunkGroup, chunkData, gx, gz, absCellX, absCellZ);
                            }
                        }

                    } else {
                        // Corridors run vertical (North-South)
                        if (gx % 2 === 0) {
                            const pathGap = this.hash(absCellX, absCellZ) < 0.22;
                            if (!pathGap) {
                                const wall = new THREE.Mesh(this.wallGeoVertical, this.materials.wall);
                                wall.position.set(
                                    gx * this.cellSize,
                                    this.wallHeight / 2,
                                    gz * this.cellSize + this.cellSize / 2
                                );
                                wall.castShadow = true;
                                wall.receiveShadow = true;
                                chunkGroup.add(wall);
                                chunkData.walls.push(wall);

                                const worldWall = {
                                    minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                                    maxX: cx * this.chunkSize + gx * this.cellSize + wallThickness,
                                    minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                                    maxZ: cz * this.chunkSize + (gz + 1) * this.cellSize + wallThickness,
                                    mesh: wall
                                };
                                this.collidableWalls.push(worldWall);
                                wall.userData.collisionRef = worldWall;
                            }
                        }

                        if (gx % 2 !== 0) {
                            const blockCorridor = this.hash(absCellX + 50, absCellZ) < 0.25;
                            if (blockCorridor) {
                                const wall = new THREE.Mesh(this.wallGeoHorizontal, this.materials.wall);
                                wall.position.set(
                                    gx * this.cellSize + this.cellSize / 2,
                                    this.wallHeight / 2,
                                    gz * this.cellSize
                                );
                                wall.castShadow = true;
                                wall.receiveShadow = true;
                                chunkGroup.add(wall);
                                chunkData.walls.push(wall);
                                
                                const worldWall = {
                                    minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                                    maxX: cx * this.chunkSize + (gx + 1) * this.cellSize + wallThickness,
                                    minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                                    maxZ: cz * this.chunkSize + gz * this.cellSize + wallThickness,
                                    mesh: wall
                                };
                                this.collidableWalls.push(worldWall);
                                wall.userData.collisionRef = worldWall;
                            }
                        }

                        // Light fixtures along corridors
                        if (gx % 2 !== 0) {
                            const lightHash = this.hash(absCellX + 12, absCellZ + 37);
                            if (lightHash < 0.15) {
                                this.spawnFluorescentLight(chunkGroup, chunkData, gx, gz, absCellX, absCellZ);
                            }
                        }
                    }
                    continue;
                }

                // 3. OFFICE ZONE GENERATION (Structured connected rooms with doorways)
                const wallNorthHash = this.hash(absCellX, absCellZ);
                const hasDoorwayNorth = this.hash(absCellX + 7, absCellZ) < 0.35; // 35% doorway chance
                
                if (wallNorthHash < 0.48 && !hasDoorwayNorth) {
                    const wall = new THREE.Mesh(this.wallGeoHorizontal, this.materials.wall);
                    wall.position.set(
                        gx * this.cellSize + this.cellSize / 2,
                        this.wallHeight / 2,
                        gz * this.cellSize
                    );
                    wall.castShadow = true;
                    wall.receiveShadow = true;
                    chunkGroup.add(wall);
                    chunkData.walls.push(wall);
                    
                    const worldWall = {
                        minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                        maxX: cx * this.chunkSize + (gx + 1) * this.cellSize + wallThickness,
                        minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                        maxZ: cz * this.chunkSize + gz * this.cellSize + wallThickness,
                        mesh: wall
                    };
                    this.collidableWalls.push(worldWall);
                    wall.userData.collisionRef = worldWall;
                }

                const wallWestHash = this.hash(absCellX, absCellZ + 50);
                const hasDoorwayWest = this.hash(absCellX + 9, absCellZ + 13) < 0.35;

                if (wallWestHash < 0.48 && !hasDoorwayWest) {
                    const wall = new THREE.Mesh(this.wallGeoVertical, this.materials.wall);
                    wall.position.set(
                        gx * this.cellSize,
                        this.wallHeight / 2,
                        gz * this.cellSize + this.cellSize / 2
                    );
                    wall.castShadow = true;
                    wall.receiveShadow = true;
                    chunkGroup.add(wall);
                    chunkData.walls.push(wall);

                    const worldWall = {
                        minX: cx * this.chunkSize + gx * this.cellSize - wallThickness,
                        maxX: cx * this.chunkSize + gx * this.cellSize + wallThickness,
                        minZ: cz * this.chunkSize + gz * this.cellSize - wallThickness,
                        maxZ: cz * this.chunkSize + (gz + 1) * this.cellSize + wallThickness,
                        mesh: wall
                    };
                    this.collidableWalls.push(worldWall);
                    wall.userData.collisionRef = worldWall;
                }

                // Place a fluorescent light fixture deterministically in empty rooms
                const lightHash = this.hash(absCellX + 12, absCellZ + 37);
                if (lightHash < 0.12 && (wallNorthHash >= 0.48 || wallWestHash >= 0.48)) {
                    this.spawnFluorescentLight(chunkGroup, chunkData, gx, gz, absCellX, absCellZ);
                }
            }
        }

        // Add chunk data to map
        this.loadedChunks.set(`${cx},${cz}`, chunkData);

        // Spawn procedural elements (batteries only - survivors & dead bodies removed as requested)
        if (!this.warehouseMode) {
            // Determine zoneType deterministically for spawning checks
            const zoneTypeHash = this.hash(cx * 31, cz * 17);
            let zoneType = 'OFFICE';
            if (zoneTypeHash < 0.4) {
                zoneType = 'OFFICE';
            } else if (zoneTypeHash < 0.75) {
                zoneType = 'CORRIDOR';
            } else {
                zoneType = 'LOBBY';
            }

            // 1. Spawning Batteries in open spaces (spread out deterministically, 2% chance per open cell)
            for (let gx = 0; gx < this.chunkGridSize; gx++) {
                for (let gz = 0; gz < this.chunkGridSize; gz++) {
                    if (this.isCellOpen(cx, cz, gx, gz, zoneType)) {
                        const absCellX = cx * this.chunkGridSize + gx;
                        const absCellZ = cz * this.chunkGridSize + gz;
                        
                        const localX = gx * this.cellSize + this.cellSize / 2;
                        const localZ = gz * this.cellSize + this.cellSize / 2;

                        const itemHash = this.hash(absCellX + 107, absCellZ + 149);

                        if (itemHash < 0.02) {
                            // Spawn Battery (2% chance)
                            this.createBatteryMesh(chunkGroup, chunkData, localX, localZ);
                        }
                    }
                }
            }
        }
    }

    /**
     * Checks if a grid cell is open (has no pillar/wall blocking its center)
     */
    isCellOpen(cx, cz, gx, gz, zoneType) {
        const absCellX = cx * this.chunkGridSize + gx;
        const absCellZ = cz * this.chunkGridSize + gz;

        if (zoneType === 'LOBBY') {
            const pillarHash = this.hash(absCellX + 41, absCellZ + 29);
            return pillarHash >= 0.25;
        } else if (zoneType === 'CORRIDOR') {
            const runX = this.hash(cx * 13, cz * 7) < 0.5;
            if (runX) {
                if (gz % 2 === 0) return false;
                const blockCorridor = this.hash(absCellX, absCellZ + 50) < 0.25;
                return !blockCorridor;
            } else {
                if (gx % 2 === 0) return false;
                const blockCorridor = this.hash(absCellX + 50, absCellZ) < 0.25;
                return !blockCorridor;
            }
        } else {
            return true;
        }
    }

    /**
     * Generates a 2D battery pickup mesh programmatically
     */
    createBatteryMesh(chunkGroup, chunkData, localX, localZ) {
        const batteryGroup = new THREE.Group();
        
        // Battery body
        const bodyMesh = new THREE.Mesh(this.batteryBodyGeo, this.materials.batteryShell);
        bodyMesh.castShadow = true;
        batteryGroup.add(bodyMesh);

        // Gold strip/label
        const labelMesh = new THREE.Mesh(this.batteryLabelGeo, this.materials.batteryLabel);
        labelMesh.position.y = 0.02;
        batteryGroup.add(labelMesh);

        // Emissive anode tip
        const tipMesh = new THREE.Mesh(this.batteryTipGeo, this.materials.batteryAnode);
        tipMesh.position.y = 0.125;
        batteryGroup.add(tipMesh);

        // Place slightly above floor level
        batteryGroup.position.set(localX, 0.11, localZ);
        chunkGroup.add(batteryGroup);

        // Add a tiny glowing blue PointLight
        const batteryLight = new THREE.PointLight(0x00ffcc, 1.2, 1.8, 1.5);
        batteryLight.position.set(0, 0.15, 0);
        batteryGroup.add(batteryLight);

        const worldPos = new THREE.Vector3(
            chunkGroup.position.x + localX,
            0.11,
            chunkGroup.position.z + localZ
        );

        const batteryObj = {
            mesh: batteryGroup,
            worldPosition: worldPos,
            chunkKey: `${chunkData.cx},${chunkData.cz}`
        };

        if (!chunkData.batteries) chunkData.batteries = [];
        chunkData.batteries.push(batteryObj);
        this.activeBatteries.push(batteryObj);
    }

    /**
     * Generates a 3D slumped corpse wearing a research hazmat suit (unspawned, preserved for structural completeness)
     */
    createDeadBodyMesh(chunkGroup, chunkData, localX, localZ, wallAngle = 0) {
        const bodyGroup = new THREE.Group();
        
        // Torso/Chest
        const torsoGeo = new THREE.BoxGeometry(0.3, 0.45, 0.25);
        const torso = new THREE.Mesh(torsoGeo, this.materials.hazmatSuitDead);
        torso.position.y = 0.22;
        torso.castShadow = true;
        bodyGroup.add(torso);

        // Head/Helmet
        const headGeo = new THREE.SphereGeometry(0.14, 12, 12);
        const head = new THREE.Mesh(headGeo, this.materials.hazmatSuitDead);
        head.position.set(0, 0.5, 0.05);
        head.castShadow = true;
        bodyGroup.add(head);

        // Visor
        const visorGeo = new THREE.BoxGeometry(0.16, 0.08, 0.08);
        const visor = new THREE.Mesh(visorGeo, this.materials.hazmatVisor);
        visor.position.set(0, 0.52, 0.16);
        bodyGroup.add(visor);

        // Left Arm (slumped)
        const armGeo = new THREE.BoxGeometry(0.12, 0.35, 0.12);
        const leftArm = new THREE.Mesh(armGeo, this.materials.hazmatSuitDead);
        leftArm.position.set(-0.21, 0.2, 0.1);
        leftArm.rotation.set(-0.5, 0, 0.4);
        leftArm.castShadow = true;
        bodyGroup.add(leftArm);

        // Right Arm (slumped)
        const rightArm = new THREE.Mesh(armGeo, this.materials.hazmatSuitDead);
        rightArm.position.set(0.21, 0.15, 0.15);
        rightArm.rotation.set(-0.8, -0.3, -0.4);
        rightArm.castShadow = true;
        bodyGroup.add(rightArm);

        // Left Leg (splayed)
        const legGeo = new THREE.BoxGeometry(0.14, 0.45, 0.14);
        const leftLeg = new THREE.Mesh(legGeo, this.materials.hazmatSuitDead);
        leftLeg.position.set(-0.12, 0.1, 0.3);
        leftLeg.rotation.set(1.1, 0.2, 0.1);
        leftLeg.castShadow = true;
        bodyGroup.add(leftLeg);

        // Right Leg (splayed/bent)
        const rightLeg = new THREE.Mesh(legGeo, this.materials.hazmatSuitDead);
        rightLeg.position.set(0.12, 0.08, 0.25);
        rightLeg.rotation.set(0.9, -0.4, -0.1);
        rightLeg.castShadow = true;
        bodyGroup.add(rightLeg);

        bodyGroup.position.set(localX, 0.05, localZ);
        bodyGroup.rotation.y = wallAngle + Math.PI;
        bodyGroup.rotation.x = -0.15;
        
        chunkGroup.add(bodyGroup);
    }

    /**
     * Generates a 3D explorer survivor wearing a hazmat suit (unspawned, preserved for structural completeness)
     */
    createSurvivorMesh(chunkGroup, chunkData, localX, localZ) {
        const survivorGroup = new THREE.Group();
        
        // Torso/Chest
        const torsoGeo = new THREE.BoxGeometry(0.35, 0.6, 0.26);
        const torso = new THREE.Mesh(torsoGeo, this.materials.hazmatSuit);
        torso.position.y = 0.8;
        torso.castShadow = true;
        survivorGroup.add(torso);

        // Head
        const headGeo = new THREE.SphereGeometry(0.16, 12, 12);
        const head = new THREE.Mesh(headGeo, this.materials.hazmatSuit);
        head.position.set(0, 1.2, 0.02);
        head.castShadow = true;
        survivorGroup.add(head);

        // Visor
        const visorGeo = new THREE.BoxGeometry(0.18, 0.1, 0.08);
        const visor = new THREE.Mesh(visorGeo, this.materials.hazmatVisor);
        visor.position.set(0, 1.22, 0.14);
        survivorGroup.add(visor);

        // Left Arm
        const armGroupLeft = new THREE.Group();
        armGroupLeft.position.set(-0.24, 1.0, 0);
        const armGeo = new THREE.BoxGeometry(0.12, 0.5, 0.12);
        const leftArm = new THREE.Mesh(armGeo, this.materials.hazmatSuit);
        leftArm.position.y = -0.2;
        leftArm.castShadow = true;
        armGroupLeft.add(leftArm);
        survivorGroup.add(armGroupLeft);

        // Right Arm
        const armGroupRight = new THREE.Group();
        armGroupRight.position.set(0.24, 1.0, 0);
        const rightArm = new THREE.Mesh(armGeo, this.materials.hazmatSuit);
        rightArm.position.y = -0.2;
        rightArm.castShadow = true;
        armGroupRight.add(rightArm);
        survivorGroup.add(armGroupRight);

        // Left Leg
        const legGroupLeft = new THREE.Group();
        legGroupLeft.position.set(-0.12, 0.5, 0);
        const legGeo = new THREE.BoxGeometry(0.14, 0.55, 0.14);
        const leftLeg = new THREE.Mesh(legGeo, this.materials.hazmatSuit);
        leftLeg.position.y = -0.25;
        leftLeg.castShadow = true;
        legGroupLeft.add(leftLeg);
        survivorGroup.add(legGroupLeft);

        // Right Leg
        const legGroupRight = new THREE.Group();
        legGroupRight.position.set(0.12, 0.5, 0);
        const rightLeg = new THREE.Mesh(legGeo, this.materials.hazmatSuit);
        rightLeg.position.y = -0.25;
        rightLeg.castShadow = true;
        legGroupRight.add(rightLeg);
        survivorGroup.add(legGroupRight);

        survivorGroup.position.set(localX, 0.05, localZ);
        chunkGroup.add(survivorGroup);

        const worldPos = new THREE.Vector3(
            chunkGroup.position.x + localX,
            0.05,
            chunkGroup.position.z + localZ
        );

        const survivorObj = {
            mesh: survivorGroup,
            leftArm: armGroupLeft,
            rightArm: armGroupRight,
            leftLeg: legGroupLeft,
            rightLeg: legGroupRight,
            worldPosition: worldPos,
            state: 'IDLE',
            animTime: 0.0,
            chunkKey: `${chunkData.cx},${chunkData.cz}`,
            shakeTimer: 0.0
        };

        if (!chunkData.survivors) chunkData.survivors = [];
        chunkData.survivors.push(survivorObj);
        this.activeSurvivors.push(survivorObj);
    }

    /**
     * Spawns a physical fluorescent ceiling light fixture and registers its world coordinates.
     * Ceiling lights do not get local PointLights; instead, the static light pool dynamically rents
     * lights to the closest fixtures to completely avoid WebGL shader recompilations on chunk load.
     */
    spawnFluorescentLight(chunkGroup, chunkData, gx, gz, absX, absZ) {
        // Physical fixture box using pre-allocated shared geometry
        const fixture = new THREE.Mesh(this.fixtureGeo, this.materials.lightFixture);
        fixture.position.set(
            gx * this.cellSize + this.cellSize / 2,
            this.wallHeight - 0.04,
            gz * this.cellSize + this.cellSize / 2
        );
        chunkGroup.add(fixture);

        // Compute deterministic material index for this light from the shared pool
        const materialIdx = Math.abs(absX + absZ * 17) % 8;

        // Glowing center panel using pre-allocated shared geometry and shared pool material
        const panel = new THREE.Mesh(this.panelGeo, this.lightPanelMaterials[materialIdx]);
        panel.position.set(0, -0.041, 0);
        fixture.add(panel);

        // Calculate absolute world position of this light fixture (light is offset -0.1 on Y relative to fixture)
        const cx = chunkData.cx;
        const cz = chunkData.cz;
        const worldPos = new THREE.Vector3(
            cx * this.chunkSize + gx * this.cellSize + this.cellSize / 2,
            this.wallHeight - 0.14,
            cz * this.chunkSize + gz * this.cellSize + this.cellSize / 2
        );

        const lightObj = {
            meshPanel: panel,
            worldPosition: worldPos,
            absCellX: absX,
            absCellZ: absZ,
            materialIdx: materialIdx,
            baseIntensity: 0.75,
            flickerTimer: 0.0,
            flickerState: 1.0 // 0.0 (off) to 1.0 (on)
        };

        chunkData.lights.push(lightObj);
        this.flickeringLights.push(lightObj);
        this.rentedNeedsUpdate = true;
    }

    /**
     * Unloads chunk from scene and cleans up references to free up memory
     */
    unloadChunk(key) {
        const chunk = this.loadedChunks.get(key);
        if (!chunk) return;

        // Remove walls from collision array
        for (const wall of chunk.walls) {
            const collisionRef = wall.userData.collisionRef;
            if (collisionRef) {
                const idx = this.collidableWalls.indexOf(collisionRef);
                if (idx > -1) this.collidableWalls.splice(idx, 1);
            }
        }

        // Remove lights from flickering array
        let lightsChanged = false;
        for (const light of chunk.lights) {
            const idx = this.flickeringLights.indexOf(light);
            if (idx > -1) {
                this.flickeringLights.splice(idx, 1);
                lightsChanged = true;
            }
        }
        if (lightsChanged) {
            this.rentedNeedsUpdate = true;
        }

        // Remove active batteries spawned in this chunk
        if (chunk.batteries) {
            for (const battery of chunk.batteries) {
                const idx = this.activeBatteries.indexOf(battery);
                if (idx > -1) this.activeBatteries.splice(idx, 1);
                if (battery.mesh && battery.mesh.parent) {
                    battery.mesh.parent.remove(battery.mesh);
                }
            }
        }

        // Remove active survivors spawned in this chunk
        if (chunk.survivors) {
            for (const survivor of chunk.survivors) {
                const idx = this.activeSurvivors.indexOf(survivor);
                if (idx > -1) this.activeSurvivors.splice(idx, 1);
                if (survivor.mesh && survivor.mesh.parent) {
                    survivor.mesh.parent.remove(survivor.mesh);
                }
            }
        }

        // Remove chunk group from parent scene
        this.scene.remove(chunk.group);
        this.loadedChunks.delete(key);
    }

    /**
     * Updates independent fluorescent light flickering and binds nearby fixtures to static pool lights
     */
    updateCeilingFlickers(playerPos, dt) {
        // 1. Update the 8 shared light materials' flicker states
        for (let i = 0; i < 8; i++) {
            // Let i = 2 and i = 5 be unstable flickerers (25% of materials)
            if (i === 2 || i === 5) {
                this.lightPanelFlickerTimers[i] -= dt;
                if (this.lightPanelFlickerTimers[i] <= 0.0) {
                    this.lightPanelFlickerTimers[i] = 0.04 + Math.random() * 0.4;
                    if (Math.random() < 0.22) {
                        this.lightPanelFlickerStates[i] = Math.random() < 0.5 ? 0.0 : 0.15 + Math.random() * 0.3;
                    } else {
                        this.lightPanelFlickerStates[i] = 1.0;
                    }
                }
            } else {
                this.lightPanelFlickerStates[i] = 1.0;
            }

            // Apply emissive intensity directly to the shared material - all panels update instantly!
            this.lightPanelMaterials[i].emissiveIntensity = 1.8 * this.lightPanelFlickerStates[i];
        }

        // 2. Rent static pool lights to the closest lights within active range
        const distSqToLast = playerPos.distanceToSquared(this.lastSortPosition);
        if (this.rentedNeedsUpdate || distSqToLast > 0.04) {
            this.lastSortPosition.copy(playerPos);
            this.rentedNeedsUpdate = false;

            // Sort flickering lights directly by distance to player (avoids redundant frame sorting)
            this.flickeringLights.sort((a, b) => {
                const dxA = a.worldPosition.x - playerPos.x;
                const dzA = a.worldPosition.z - playerPos.z;
                const distSqA = dxA * dxA + dzA * dzA;

                const dxB = b.worldPosition.x - playerPos.x;
                const dzB = b.worldPosition.z - playerPos.z;
                const distSqB = dxB * dxB + dzB * dzB;

                return distSqA - distSqB;
            });

            // Re-populate active rented lights (closest lightPoolSize lights within 22 meters)
            this.rentedLights = [];
            const lightsToAssign = Math.min(this.flickeringLights.length, this.lightPoolSize);
            for (let i = 0; i < lightsToAssign; i++) {
                const lightObj = this.flickeringLights[i];
                
                const dx = lightObj.worldPosition.x - playerPos.x;
                const dz = lightObj.worldPosition.z - playerPos.z;
                const distSq = dx * dx + dz * dz;
                if (distSq >= 484.0) break; // since sorted, all subsequent lights are also too far!

                this.rentedLights.push(lightObj);
            }
        }

        // 3. Reset all static pool lights to zero intensity
        for (const poolItem of this.lightPool) {
            poolItem.light.intensity = 0.0;
            poolItem.inUse = false;
        }

        // 4. Update the active pool lights' position and intensity every frame
        for (let i = 0; i < this.rentedLights.length; i++) {
            const lightObj = this.rentedLights[i];
            const poolItem = this.lightPool[i];
            
            poolItem.light.position.copy(lightObj.worldPosition);
            
            // Renting light intensity based on the shared material flicker state
            const flickerState = this.lightPanelFlickerStates[lightObj.materialIdx];
            poolItem.light.intensity = lightObj.baseIntensity * flickerState;
            poolItem.inUse = true;
        }
    }

    /**
     * Checks if player coordinate position overlaps with a wall bounding box.
     * Returns a displacement vector to push the player out.
     * Uses in-place pre-allocated displacement vector to avoid Garbage Collection allocations.
     */
    checkCollisions(pos, radius = 0.35) {
        this.displacement.set(0, 0, 0);
        const pad = radius + 0.1; // Broad-phase bounding box padding

        for (const wall of this.collidableWalls) {
            // AABB vs Circle collision check in X-Z space
            // Broad-phase spatial check: skip walls that are obviously too far away immediately
            if (pos.x < wall.minX - pad || pos.x > wall.maxX + pad ||
                pos.z < wall.minZ - pad || pos.z > wall.maxZ + pad) {
                continue;
            }

            // 1. Find closest point on wall AABB to player
            const closestX = Math.max(wall.minX, Math.min(pos.x, wall.maxX));
            const closestZ = Math.max(wall.minZ, Math.min(pos.z, wall.maxZ));

            // 2. Distance from closest point to player circle center
            const dx = pos.x - closestX;
            const dz = pos.z - closestZ;
            
            // Calculate distance squared to bypass expensive Math.sqrt calls unless there's an active overlap
            const distSq = dx * dx + dz * dz;
            const radiusSq = radius * radius;

            // 3. Push out if overlapping
            if (distSq < radiusSq && distSq > 0.000001) {
                const dist = Math.sqrt(distSq);
                const overlap = radius - dist;
                // Direction of push
                const px = dx / dist;
                const pz = dz / dist;

                this.displacement.x += px * overlap;
                this.displacement.z += pz * overlap;
            }
        }

        return this.displacement;
    }

    /**
     * Spawns a physical collidable wooden shipping crate at the designated coordinates.
     */
    spawnCrate(chunkGroup, chunkData, x, z, y = 0.7, scale = 1.0) {
        const crate = new THREE.Mesh(this.crateGeo, this.materials.crate);
        crate.position.set(x - chunkGroup.position.x, y, z - chunkGroup.position.z);
        crate.scale.set(scale, scale, scale);
        crate.castShadow = true;
        crate.receiveShadow = true;
        chunkGroup.add(crate);
        chunkData.walls.push(crate); // unloads automatically with the chunk

        // Register global bounding box for player collisions
        const halfSize = 0.7 * scale;
        const worldCrate = {
            minX: x - halfSize,
            maxX: x + halfSize,
            minZ: z - halfSize,
            maxZ: z + halfSize,
            mesh: crate
        };
        this.collidableWalls.push(worldCrate);
        crate.userData.collisionRef = worldCrate;
    }

    /**
     * Cleans up all resources when resetting the game
     */
    reset() {
        for (const key of this.loadedChunks.keys()) {
            this.unloadChunk(key);
        }
        this.loadedChunks.clear();
        this.flickeringLights = [];
        this.collidableWalls = [];
        this.vhsTapeMesh = null;
        this.vhsLight = null;
        this.activeBatteries = [];
        this.activeSurvivors = [];
        this.rentedLights = [];
        this.rentedNeedsUpdate = true;
        if (this.lastSortPosition) {
            this.lastSortPosition.set(Infinity, Infinity, Infinity);
        }

        if (this.lightPool) {
            for (const poolItem of this.lightPool) {
                poolItem.light.intensity = 0.0;
                poolItem.inUse = false;
            }
        }
    }
}
