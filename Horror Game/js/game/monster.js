/**
 * Monster - Creates and controls the procedural Wire-Bacteria Stalker Entity.
 * Synthesizes a looming, jointed black branch silhouette, executes dynamic 
 * spasms/crawling movement cycles, stalker tracking path physics with wall collisions,
 * manages player proximity panic levels, and triggers screen-shaking jump scares.
 */

export class Monster {
    constructor(scene, world, player, audio) {
        this.scene = scene;
        this.world = world;
        this.player = player;
        this.audio = audio;

        // Position & Movement physics
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.speed = 1.25; // Slower than player's walk speed at first, speeds up in chase
        this.chaseSpeed = 2.4;
        this.radius = 0.4;

        this.isActive = false;
        this.isStalking = false;
        
        // Spawn/Stalk timers
        this.spawnTimer = 10.0; // Spawns after 10s of quiet ambient humming
        this.panicDist = 14.0; // Distance at which panic heartbeat starts ramping up
        
        // Visual Mesh references
        this.meshGroup = null;
        this.limbs = [];
        
        this.createVisuals();

        // PRE-ALLOCATED VECTORS FOR ZERO-ALLOCATION RENDER LOOP RUNNING
        this.toPlayer = new THREE.Vector3();
        this.camDir = new THREE.Vector3();
    }

    /**
     * Synthesizes the spooky towering spindly Wire/Bacteria creature mesh
     */
    createVisuals() {
        this.meshGroup = new THREE.Group();
        this.meshGroup.visible = false;
        this.scene.add(this.meshGroup);

        // Towering central spine
        const spineGeo = new THREE.CylinderGeometry(0.04, 0.02, 2.4, 6);
        const spineMat = new THREE.MeshStandardMaterial({
            color: 0x050505,
            roughness: 0.95,
            metalness: 0.1
        });
        const spine = new THREE.Mesh(spineGeo, spineMat);
        spine.position.y = 1.2;
        spine.castShadow = true;
        this.meshGroup.add(spine);

        // Create 6 spooky jointed spindly limbs (legs/arms) growing out of the body
        const limbSegments = 3;
        const segmentLength = 0.9;
        const limbMat = new THREE.MeshStandardMaterial({
            color: 0x020202,
            roughness: 0.9,
            metalness: 0.05
        });

        // Procedurally construct branches extending from the spine at various heights
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const height = 0.5 + Math.random() * 1.4;

            const baseJoint = new THREE.Group();
            baseJoint.position.set(Math.cos(angle) * 0.1, height, Math.sin(angle) * 0.1);
            
            // Random limb orientation offsets
            baseJoint.rotation.y = angle;
            baseJoint.rotation.z = 0.5 + Math.random() * 0.5; // Angled down/out

            this.meshGroup.add(baseJoint);

            // Build hierarchical joint segments
            let parentNode = baseJoint;
            const jointsList = [baseJoint];

            for (let s = 0; s < limbSegments; s++) {
                const segmentGeo = new THREE.CylinderGeometry(0.02, 0.015, segmentLength, 5);
                // Shift cylinder origin to top joint hinge
                segmentGeo.translate(0, -segmentLength / 2, 0);

                const segment = new THREE.Mesh(segmentGeo, limbMat);
                segment.castShadow = true;
                parentNode.add(segment);

                // Create next nested joint hinge
                const nextJoint = new THREE.Group();
                nextJoint.position.set(0, -segmentLength, 0);
                segment.add(nextJoint);

                parentNode = nextJoint;
                jointsList.push(nextJoint);
            }

            this.limbs.push({
                joints: jointsList,
                baseAngle: angle,
                heightOffset: height
            });
        }
    }

    /**
     * Active state trigger - Spawns the monster near a corridor wall out of direct sight
     */
    spawn() {
        // Spawn behind player or down a hallway, say 16 to 22 meters away
        const angle = Math.random() * Math.PI * 2;
        const dist = 16.0 + Math.random() * 6.0;

        this.position.set(
            this.player.position.x + Math.cos(angle) * dist,
            0,
            this.player.position.z + Math.sin(angle) * dist
        );

        // Slide out of any wall overlap instantly
        const correction = this.world.checkCollisions(this.position, this.radius);
        this.position.add(correction);

        this.meshGroup.position.copy(this.position);
        
        this.meshGroup.visible = true;
        this.isActive = true;
        this.isStalking = true;
        this.velocity.set(0, 0, 0);

        // Low growl click cue
        this.audio.playAmbientScare();
        console.log("Wire Bacteria Stalker has SPAWNED in the corridors.");
    }

    /**
     * Deactivates and hides the monster (useful on player death or game reset)
     */
    despawn() {
        this.isActive = false;
        this.isStalking = false;
        this.meshGroup.visible = false;
        this.spawnTimer = 25.0 + Math.random() * 20.0; // Reset spawn timer for later
    }

    /**
     * Updates stalking movement, animations, panic curves, and checks jump scare catches
     */
    update(dt, time, isGameOver = false) {
        // 1. Spawning countdown when inactive
        if (!this.isActive) {
            if (!isGameOver) {
                this.spawnTimer -= dt;
                if (this.spawnTimer <= 0.0) {
                    this.spawn();
                }
            }
            return;
        }

        // Calculate distance vectors to player
        this.toPlayer.subVectors(this.player.position, this.position);
        const dist = this.toPlayer.length();

        // 2. STALKER AI CHASE PATHPHYSICS
        if (this.isStalking && !isGameOver) {
            // Speed scaling: chases faster when player is sprinting, or when closer
            const currentSpeed = dist < 7.0 ? this.chaseSpeed : this.speed;
            
            // Move directly towards player in X-Z space
            this.toPlayer.y = 0;
            this.toPlayer.normalize();

            this.velocity.copy(this.toPlayer).multiplyScalar(currentSpeed);

            // Apply movement steps
            this.position.x += this.velocity.x * dt;
            let correction = this.world.checkCollisions(this.position, this.radius);
            this.position.x += correction.x; // slide along walls

            this.position.z += this.velocity.z * dt;
            correction = this.world.checkCollisions(this.position, this.radius);
            this.position.z += correction.z; // slide along walls

            this.meshGroup.position.copy(this.position);

            // Orient monster mesh to look in direction of velocity movement
            if (this.velocity.lengthSq() > 0.001) {
                const angle = Math.atan2(-this.velocity.z, this.velocity.x);
                this.meshGroup.rotation.y = angle + Math.PI / 2; // Offset rotation
            }

            // 3. Spasm crawling organic joint animation
            this.animateLimbs(time, currentSpeed);
        }

        // 4. PANIC & JUMP SCARE CHECKS
        if (!isGameOver) {
            // A. Calculate dynamic panic curve (0.0 to 1.0)
            if (dist < this.panicDist) {
                const panicFactor = 1.0 - (dist / this.panicDist);
                this.audio.setPanicLevel(panicFactor);
                
                // Add CRT screen glitch overlay intensity based on panic
                const glitchOverlay = document.getElementById('glitch-overlay');
                if (glitchOverlay) {
                    glitchOverlay.className = panicFactor > 0.3 ? 'glitching' : '';
                    glitchOverlay.style.background = `rgba(255, 0, 0, ${panicFactor * 0.12})`;
                }
            } else {
                this.audio.setPanicLevel(0.0);
                const glitchOverlay = document.getElementById('glitch-overlay');
                if (glitchOverlay) {
                    glitchOverlay.className = '';
                    glitchOverlay.style.background = 'rgba(0,0,0,0)';
                }
            }

            // B. Jump scare contact trigger
            if (dist < 1.6) {
                this.triggerJumpScare();
            }
        }
    }

    /**
     * Joint swing math to create twitching, staggering crawling segments
     */
    animateLimbs(time, currentSpeed) {
        // Speed up twitches relative to speed
        const cycleSpeed = currentSpeed * 4.5;

        for (let i = 0; i < this.limbs.length; i++) {
            const limb = this.limbs[i];
            
            // Base hip joint
            const hipJoint = limb.joints[0];
            // Sine oscillation offsets per leg to stagger crawl steps
            const stridePhase = time * cycleSpeed + limb.baseAngle;

            // Yaw sway back and forth
            hipJoint.rotation.y = limb.baseAngle + Math.sin(stridePhase) * 0.28;
            
            // Pitch limb up and down
            hipJoint.rotation.z = 0.4 + Math.cos(stridePhase) * 0.35;

            // Knee / elbow joints (nested segments twitch rapidly)
            if (limb.joints.length > 1) {
                const knee = limb.joints[1];
                knee.rotation.z = -0.5 - Math.abs(Math.sin(stridePhase * 1.5)) * 0.8;
            }
            if (limb.joints.length > 2) {
                const ankle = limb.joints[2];
                ankle.rotation.z = 0.3 + Math.sin(stridePhase * 2.0) * 0.4;
            }
        }
    }

    /**
     * Horror Jump Scare Transition
     */
    triggerJumpScare() {
        this.isStalking = false;
        
        // HORRIFYING CAMERA ACTION:
        // Position monster directly in front of player's face, staring straight at them!
        this.camDir.set(0, 0, -1.2);
        this.camDir.applyQuaternion(this.player.camera.quaternion);
        
        this.position.copy(this.player.position).add(this.camDir);
        this.position.y = 0; // lock floor
        this.meshGroup.position.copy(this.position);
        this.meshGroup.rotation.y = this.player.input.yaw + Math.PI; // Face the camera directly
        this.meshGroup.visible = true;

        // Apply crazy spasms on all limbs during jump scare
        for (const limb of this.limbs) {
            for (let j = 0; j < limb.joints.length; j++) {
                limb.joints[j].rotation.set(
                    (Math.random() - 0.5) * 1.5,
                    (Math.random() - 0.5) * 1.5,
                    (Math.random() - 0.5) * 1.5
                );
            }
        }

        // Horrifying screech sound
        this.audio.playMonsterScreech();

        // Dispatch jump scare signal event to main game controller loop
        const event = new CustomEvent('jumpscare_triggered');
        window.dispatchEvent(event);
    }

    /**
     * Resets monster settings when restarting a game
     */
    reset() {
        this.despawn();
        this.spawnTimer = 12.0 + Math.random() * 8.0;
        this.audio.setPanicLevel(0.0);
    }
}
