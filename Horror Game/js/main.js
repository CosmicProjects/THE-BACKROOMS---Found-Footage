import { RendererEngine } from './engine/renderer.js?v=1.0.7';
import { InputManager } from './engine/input.js?v=1.0.7';
import { AudioEngine } from './game/audio.js?v=1.0.7';
import { WorldManager } from './game/world.js?v=1.0.7';
import { Player } from './game/player.js?v=1.0.7';
import { Flashlight } from './game/flashlight.js?v=1.0.7';
import { Monster } from './game/monster.js?v=1.0.7';
import { GameSettings } from './game/settings.js?v=1.0.7';

/**
 * GameController - Main orchestrator of the Backrooms Horror Game.
 * Bootstraps engines, drives the requestAnimationFrame loop, coordinates state transitions,
 * updates camcorder HUD overlays, and draws pixelated found-footage analog static grain.
 * Extended to support noclip falling intro animations, camera shakes, and sound syncs.
 */
class GameController {
    constructor() {
        this.state = 'MENU'; // States: MENU, INTRO_WAREHOUSE, INTRO_FALLING, INTRO_GETTING_UP, PLAYING, JUMPSCARE, GAMEOVER
        this.isPaused = false;
        this.isTransitioningToFall = false;

        this.settings = new GameSettings();

        // Core engines
        this.rendererEngine = null;
        this.inputManager = null;
        this.audioEngine = null;
        
        // Game systems
        this.world = null;
        this.player = null;
        this.flashlight = null;
        this.monster = null;

        // Loop variables
        this.clock = new THREE.Clock();
        this.totalTime = 0.0;
        this.playtimeElapsed = 0.0;

        // Cinematic camera shake parameters
        this.landingShakeIntensity = 0.0;
        this.landingShakeTimer = 0.0;

        // Initialize HUD date with a nostalgic found-footage vintage stamp
        this.initHUDDate();

        // Bind buttons
        this.bindUI();

        // Listen for custom horror event triggers
        window.addEventListener('jumpscare_triggered', () => this.handleJumpScare());
        window.addEventListener('scary_talking_triggered', () => {
            if (this.flashlight && this.flashlight.isOn) {
                this.flashlight.triggerScaryFlicker(3.0); // Trigger a spooky 3.0s flashlight flicker!
            }
        });

        // Cinematic drifting camera properties for main menu background
        this.menuCamPos = new THREE.Vector3(2.0, 1.62, 2.0);
        this.menuCamYaw = Math.PI; // start facing +Z
        this.menuCamTargetYaw = Math.PI;
        this.menuCamSpeed = 0.45; // slow cinematic glide
        this.menuCamTurnTimer = 0.0;
        this.menuCamDirection = new THREE.Vector3(0, 0, 1);

        // PRE-ALLOCATED MENU CINEMATIC CAMERA VECTORS TO PREVENT GC STUTTER
        this.menuCamMovement = new THREE.Vector3();
        this.menuCamTestPos = new THREE.Vector3();
        this.menuCamTestDir = new THREE.Vector3();

        // Initialize immediately to render the animated 3D background behind the main menu!
        this.init();
    }

    /**
     * Bootstraps all game sub-systems once the user starts or restarts
     */
    init() {
        // 1. Core Engines
        this.rendererEngine = new RendererEngine();
        this.inputManager = new InputManager(this.rendererEngine.container);
        this.audioEngine = new AudioEngine();

        // 2. Game Systems
        this.world = new WorldManager(this.rendererEngine.scene, this.rendererEngine.camera);
        this.player = new Player(this.rendererEngine.camera, this.world, this.inputManager, this.audioEngine);
        this.flashlight = new Flashlight(this.rendererEngine.scene, this.rendererEngine.camera, this.audioEngine);
        this.monster = new Monster(this.rendererEngine.scene, this.world, this.player, this.audioEngine);

        // Connect input callbacks
        this.inputManager.onToggleFlashlight = () => this.flashlight.toggle();
        this.inputManager.onPauseRequest = () => this.togglePause();
        this.inputManager.baseMouseSensitivity = this.settings.get('mouseSensitivity');

        this.settings.applyTo(this);
        this.applyReduceEffectsClass();
        this.syncAllSettingsUI();
        this.bindSettingsControls();

        // Start requestAnimationFrame loop
        this.clock.getDelta(); // Clear initial delta tick
        this.animate();
    }

    /**
     * Binds HTML start/restart buttons, pause overlay, and settings controls
     */
    bindUI() {
        const startBtn = document.getElementById('start-btn');
        const restartBtn = document.getElementById('restart-btn');
        const menuSettingsBtn = document.getElementById('menu-settings-btn');
        const pauseResumeBtn = document.getElementById('pause-resume-btn');
        const pauseSettingsBtn = document.getElementById('pause-settings-btn');
        const pauseQuitBtn = document.getElementById('pause-quit-btn');

        startBtn.addEventListener('click', () => {
            if (!this.rendererEngine) {
                this.init();
            }
            this.audioEngine.init();
            document.getElementById('menu-screen').classList.add('hidden');
            this.beginNewRun();
        });

        restartBtn.addEventListener('click', () => {
            this.resetGame();
            document.getElementById('game-over-screen').classList.add('hidden');
            this.beginNewRun();
        });

        menuSettingsBtn.addEventListener('click', () => {
            document.getElementById('settings-panel').classList.toggle('hidden');
        });

        pauseResumeBtn.addEventListener('click', () => this.resumeFromPause());
        pauseSettingsBtn.addEventListener('click', () => {
            document.getElementById('pause-settings-panel').classList.toggle('hidden');
        });
        pauseQuitBtn.addEventListener('click', () => this.quitToMainMenu());
    }

    isGameplayState() {
        return this.state === 'PLAYING' ||
            this.state === 'INTRO_WAREHOUSE' ||
            this.state === 'INTRO_FALLING' ||
            this.state === 'INTRO_GETTING_UP';
    }

    beginNewRun() {
        this.isPaused = false;
        this.hidePauseScreen();
        this.audioEngine.init();
        this.settings.applyTo(this);

        if (this.settings.get('skipIntro')) {
            this.startBackroomsGameplay();
        } else {
            this.startWarehouseIntro();
        }
    }

    startWarehouseIntro() {
        this.world.reset();
        this.world.warehouseMode = true;
        this.player.reset();
        this.player.position.set(1.6, 0.0, 1.6);

        this.flashlight.isOn = true;
        this.flashlight.battery = 100.0;
        this.flashlight.updatePosImmediately();

        this.inputManager.lock();
        this.inputManager.yaw = Math.PI;
        this.inputManager.targetYaw = Math.PI;
        this.inputManager.pitch = 0.0;
        this.inputManager.targetPitch = 0.0;
        this.inputManager.disableMouseLook = false;

        this.playtimeElapsed = 0.0;
        this.state = 'INTRO_WAREHOUSE';
    }

    startBackroomsGameplay() {
        this.world.reset();
        this.world.warehouseMode = false;
        this.player.reset();
        this.monster.reset();

        this.flashlight.isOn = true;
        this.flashlight.battery = 100.0;
        this.flashlight.updatePosImmediately();

        this.inputManager.reset();
        this.inputManager.disableMouseLook = false;
        this.inputManager.lock();

        this.playtimeElapsed = 0.0;
        this.isTransitioningToFall = false;
        this.landingShakeIntensity = 0.0;
        this.landingShakeTimer = 0.0;
        this.state = 'PLAYING';
    }

    togglePause() {
        if (this.isPaused) {
            this.resumeFromPause();
        } else if (this.isGameplayState()) {
            this.pauseGame();
        }
    }

    pauseGame() {
        if (!this.isGameplayState() || this.isPaused) return;

        this.isPaused = true;
        this.inputManager.unlock();
        document.getElementById('pause-screen').classList.remove('hidden');
        document.getElementById('pause-settings-panel').classList.add('hidden');
    }

    resumeFromPause() {
        if (!this.isPaused) return;

        this.isPaused = false;
        this.hidePauseScreen();

        if (this.isGameplayState()) {
            this.inputManager.lock();
        }
    }

    hidePauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) {
            pauseScreen.classList.add('hidden');
        }
        const pauseSettings = document.getElementById('pause-settings-panel');
        if (pauseSettings) {
            pauseSettings.classList.add('hidden');
        }
    }

    quitToMainMenu() {
        this.isPaused = false;
        this.hidePauseScreen();
        this.inputManager.unlock();
        this.inputManager.reset();
        this.state = 'MENU';
        document.getElementById('menu-screen').classList.remove('hidden');
        document.getElementById('settings-panel').classList.add('hidden');
    }

    applyReduceEffectsClass() {
        document.body.classList.toggle('reduce-effects', this.settings.get('reduceEffects'));
    }

    bindSettingsControls() {
        this.bindSettingsPanel('', 'setting');
        this.bindSettingsPanel('pause-', 'pause-setting');
    }

    bindSettingsPanel(prefix, idPrefix) {
        const volume = document.getElementById(`${idPrefix}-volume`);
        const sensitivity = document.getElementById(`${idPrefix}-sensitivity`);
        const reduceEffects = document.getElementById(`${idPrefix}-reduce-effects`);
        const skipIntro = document.getElementById(`${idPrefix}-skip-intro`);

        if (!volume) return;

        volume.addEventListener('input', () => {
            const val = Number(volume.value) / 100;
            this.settings.set('masterVolume', val);
            this.settings.applyTo(this);
            this.syncAllSettingsUI();
        });

        sensitivity.addEventListener('input', () => {
            const pct = Number(sensitivity.value) / 100;
            this.settings.set('mouseSensitivity', this.inputManager.baseMouseSensitivity * pct);
            this.settings.applyTo(this);
            this.syncAllSettingsUI();
        });

        reduceEffects.addEventListener('change', () => {
            this.settings.set('reduceEffects', reduceEffects.checked);
            this.applyReduceEffectsClass();
            this.syncAllSettingsUI();
        });

        skipIntro.addEventListener('change', () => {
            this.settings.set('skipIntro', skipIntro.checked);
            this.syncAllSettingsUI();
        });
    }

    syncAllSettingsUI() {
        this.syncSettingsPanel('', 'setting');
        this.syncSettingsPanel('pause-', 'pause-setting');
    }

    syncSettingsPanel(prefix, idPrefix) {
        const volume = document.getElementById(`${idPrefix}-volume`);
        const volumeVal = document.getElementById(`${idPrefix}-volume-val`);
        const sensitivity = document.getElementById(`${idPrefix}-sensitivity`);
        const sensitivityVal = document.getElementById(`${idPrefix}-sensitivity-val`);
        const reduceEffects = document.getElementById(`${idPrefix}-reduce-effects`);
        const skipIntro = document.getElementById(`${idPrefix}-skip-intro`);

        if (!volume) return;

        const volPct = Math.round(this.settings.get('masterVolume') * 100);
        volume.value = String(volPct);
        if (volumeVal) volumeVal.innerText = `${volPct}%`;

        const sensPct = Math.round(
            (this.settings.get('mouseSensitivity') / this.inputManager.baseMouseSensitivity) * 100
        );
        sensitivity.value = String(Math.max(25, Math.min(200, sensPct)));
        if (sensitivityVal) sensitivityVal.innerText = `${sensPct}%`;

        reduceEffects.checked = this.settings.get('reduceEffects');
        skipIntro.checked = this.settings.get('skipIntro');
    }

    getEffectsMultiplier() {
        return this.settings.getEffectsMultiplier();
    }

    scalePanic(level) {
        return level * this.getEffectsMultiplier();
    }

    /**
     * Resets player, world, battery levels, and monster parameters
     */
    resetGame() {
        this.playtimeElapsed = 0.0;
        this.player.reset();
        this.flashlight.resetLights(); // Recharge battery, clear positions
        this.flashlight.isOn = true;
        this.flashlight.battery = 100.0;
        this.flashlight.updatePosImmediately();
        this.world.reset();
        this.monster.reset();
        if (this.inputManager) {
            this.inputManager.disableMouseLook = false;
        }

        // Reset shake
        this.landingShakeIntensity = 0.0;
        this.landingShakeTimer = 0.0;

        // Ensure panic state glitch visuals clear
        this.audioEngine.setPanicLevel(0.0);
        const glitchOverlay = document.getElementById('glitch-overlay');
        if (glitchOverlay) {
            glitchOverlay.className = '';
            glitchOverlay.style.background = 'rgba(0,0,0,0)';
        }
    }

    /**
     * Pre-formats vintage dates for retro viewfinder HUD realism
     */
    initHUDDate() {
        const dateElement = document.getElementById('vhs-date');
        // Backrooms Kane Pixels lore usually places footage around 1991 - 1996
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const randomMonth = months[Math.floor(Math.random() * months.length)];
        const randomDay = 1 + Math.floor(Math.random() * 28);
        const randomYear = 1991 + Math.floor(Math.random() * 6); // 1991 to 1996

        dateElement.innerText = `${randomMonth} ${randomDay.toString().padStart(2, '0')} ${randomYear}`;
    }

    /**
     * JUMPSCARE TRIGGER EVENT HANDLER
     */
    handleJumpScare() {
        this.state = 'JUMPSCARE';
        
        // Disable player movements instantly
        this.inputManager.unlock();
        this.inputManager.reset();

        // Transition to signal lost gameover screen after 1.4 seconds of terror
        setTimeout(() => {
            this.state = 'GAMEOVER';
            this.monster.despawn();
            
            // Show signal lost overlay screen
            document.getElementById('game-over-screen').classList.remove('hidden');
        }, 1400);
    }

    /**
     * Central requestAnimationFrame loop runner
     */
    animate() {
        requestAnimationFrame(() => this.animate());

        // 1. Calculate Delta Time (clamped to prevent frame teleports on page suspension)
        let dt = this.clock.getDelta();
        if (dt > 0.1) dt = 0.1;

        this.totalTime += dt;

        // 3. State-aware Updates
        let currentPanic = 0.0;
        const effectsMult = this.getEffectsMultiplier();

        if (this.monster) {
            this.monster.effectsMultiplier = effectsMult;
        }

        if (this.isPaused) {
            if (this.rendererEngine) {
                this.rendererEngine.render(this.totalTime, 0.0);
            }
            return;
        }

        if (this.state === 'PLAYING') {
            this.playtimeElapsed += dt;
            this.updateHUD();

            // 1. Head controls, mouse look, and player bobRoll tilt update (using YXZ rotation order)
            // We pass the actual frame delta time 'dt' to achieve true frame-rate independent smooth rotation.
            this.inputManager.updateCameraRotation(this.rendererEngine.camera, this.player.bobRoll, dt);

            // 2. Update Player movement and bob cycles using the fresh, synchronized camera orientation
            this.player.update(dt);

            // Dynamic chunk loadings
            this.world.update(this.player.position, dt);

            // Volumetric flashlight sways
            this.flashlight.update(dt, this.player.isSprinting);

            // Stalker bacteria movements
            this.monster.update(dt, this.totalTime, false);
            currentPanic = this.monster.isActive ? this.scalePanic(this.monster.audio.panicLevel) : 0.0;

            // 2. Flashlight battery collection collision check
            for (let i = this.world.activeBatteries.length - 1; i >= 0; i--) {
                const battery = this.world.activeBatteries[i];
                const dx = this.player.position.x - battery.worldPosition.x;
                const dz = this.player.position.z - battery.worldPosition.z;
                const distSq = dx * dx + dz * dz;
                if (distSq < 0.64) { // 0.8m distance squared = 0.64
                    // Replenish flashlight by 35%
                    this.flashlight.battery = Math.min(100.0, this.flashlight.battery + 35.0);
                    this.audioEngine.playFlashlightClick();

                    // Remove mesh
                    if (battery.mesh && battery.mesh.parent) {
                        battery.mesh.parent.remove(battery.mesh);
                    }

                    // Purge from active lists
                    this.world.activeBatteries.splice(i, 1);
                }
            }

        } else if (this.state === 'MENU') {
            this.world.warehouseMode = false; // ensure Backrooms chunks load
            
            // Keep flashlight ON for dynamic light and shadows, battery full
            this.flashlight.isOn = true;
            this.flashlight.battery = 100.0;
            
            if (this.pausedState) {
                // When paused, hold the camera at the player's position and add natural handheld breathing sway
                const time = this.totalTime;
                const swayX = Math.sin(time * 0.3) * 0.12;
                const swayY = Math.sin(time * 1.2) * 0.025;
                const swayZ = Math.cos(time * 0.2) * 0.12;

                this.rendererEngine.camera.position.set(
                    this.player.position.x + swayX,
                    this.player.eyeHeight + swayY,
                    this.player.position.z + swayZ
                );

                this.rendererEngine.camera.rotation.order = 'YXZ';
                this.rendererEngine.camera.rotation.y = this.inputManager.yaw + Math.sin(time * 0.25) * 0.06;
                this.rendererEngine.camera.rotation.x = this.inputManager.pitch + Math.sin(time * 0.5) * 0.03;
                this.rendererEngine.camera.rotation.z = Math.cos(time * 0.35) * 0.012;

                // Load chunks around the player
                this.world.update(this.player.position, dt);
            } else {
                // Drifting cinematic camera for initial main menu loading
                // 1. Move camera forward in the current heading direction
                this.menuCamMovement.copy(this.menuCamDirection).multiplyScalar(this.menuCamSpeed * dt);
                this.menuCamPos.add(this.menuCamMovement);
                
                // 2. Resolve wall collisions using the world collision helper
                const displacement = this.world.checkCollisions(this.menuCamPos, 0.45);
                if (displacement.lengthSq() > 0.0001) {
                    this.menuCamPos.add(displacement);
                    
                    // Trigger a smooth turn
                    if (this.menuCamTurnTimer <= 0.0) {
                        this.menuCamTurnTimer = 1.2; // turn cooldown to prevent rapid double spins in tight corners
                        
                        // Select a new heading: try 90-degree left, 90-degree right, or 180-degree turn back
                        const possibleYaws = [
                            this.menuCamTargetYaw + Math.PI / 2,
                            this.menuCamTargetYaw - Math.PI / 2,
                            this.menuCamTargetYaw + Math.PI
                        ];
                        
                        let bestYaw = possibleYaws[0];
                        // Select the first direction that does not immediately hit a wall
                        for (const yaw of possibleYaws) {
                            const dirX = -Math.sin(yaw);
                            const dirZ = -Math.cos(yaw);
                            
                            this.menuCamTestDir.set(dirX, 0, dirZ).normalize();
                            this.menuCamTestPos.copy(this.menuCamPos).addScaledVector(this.menuCamTestDir, 1.5);
                            
                            const testDisp = this.world.checkCollisions(this.menuCamTestPos, 0.3);
                            if (testDisp.lengthSq() < 0.0001) {
                                bestYaw = yaw;
                                break;
                            }
                        }
                        
                        this.menuCamTargetYaw = bestYaw;
                        this.menuCamDirection.set(-Math.sin(bestYaw), 0, -Math.cos(bestYaw)).normalize();
                    }
                }
                
                if (this.menuCamTurnTimer > 0.0) {
                    this.menuCamTurnTimer -= dt;
                }
                
                // Smoothly interpolate current yaw towards target yaw
                const diff = this.menuCamTargetYaw - this.menuCamYaw;
                this.menuCamYaw += Math.atan2(Math.sin(diff), Math.cos(diff)) * dt * 2.0;
                
                // Overlay organic handheld breathing sways
                const time = this.totalTime;
                const swayX = Math.sin(time * 0.3) * 0.12;
                const swayY = Math.sin(time * 1.2) * 0.025;
                const swayZ = Math.cos(time * 0.2) * 0.12;
                
                this.rendererEngine.camera.position.set(
                    this.menuCamPos.x + swayX,
                    1.62 + swayY,
                    this.menuCamPos.z + swayZ
                );
                
                this.rendererEngine.camera.rotation.order = 'YXZ';
                this.rendererEngine.camera.rotation.y = this.menuCamYaw + Math.sin(time * 0.25) * 0.06;
                this.rendererEngine.camera.rotation.x = Math.sin(time * 0.5) * 0.03;
                this.rendererEngine.camera.rotation.z = Math.cos(time * 0.35) * 0.012;
                
                // Load chunks around the gliding camera position
                this.world.update(this.rendererEngine.camera.position, dt);
            }
            
            // Align flashlight directly with camera perspective
            this.flashlight.update(dt, false);

        } else if (this.state === 'INTRO_WAREHOUSE') {
            this.playtimeElapsed += dt;
            this.updateHUD();

            // Disable manual mouse looking during the automated cutscene
            if (this.inputManager) {
                this.inputManager.disableMouseLook = true;
            }

            const t = this.playtimeElapsed;

            let targetX = 1.6;
            let targetZ = 1.6;
            let isWalking = false;
            let speed = 1.35;

            // Scripted cinematic timeline (perfectly centered collision-free route)
            if (t < 1.8) {
                // 1. Stand still, pan look left & up to establish atmosphere
                isWalking = false;
                const ratio = t / 1.8;
                this.inputManager.targetYaw = Math.PI + 0.4 * ratio;
                this.inputManager.targetPitch = 0.12 * ratio;
            } else if (t < 5.2) {
                // 2. Walk forward down the clear left corridor (z = 1.6 -> 10.0) along x = 1.6
                isWalking = true;
                const ratio = (t - 1.8) / 3.4;
                targetX = 1.6;
                targetZ = 1.6 + (10.0 - 1.6) * ratio;
                speed = 1.76;

                // Walk forward down the corridor while returning view to the centerline
                this.inputManager.targetYaw = Math.PI + 0.4 - 0.4 * ratio; 
                this.inputManager.targetPitch = 0.12 - 0.12 * ratio;
            } else if (t < 6.8) {
                // 3. Stop at (1.6, 10.0), hear hum, and spot the blue VHS tape glow at (10.0, 10.0)
                isWalking = false;
                targetX = 1.6;
                targetZ = 10.0;
                this.player.position.set(1.6, 0.0, 10.0);

                const ratio = (t - 5.2) / 1.6; // turn head quickly over remaining stop time (1.6s)
                const clampedRatio = Math.max(0.0, Math.min(1.0, ratio));
                
                // Direction to tape from current position
                const dx = 10.0 - 1.6;
                const dz = 10.0 - 10.0;
                
                const startYawVal = Math.PI;
                const targetYawVal = 1.5 * Math.PI; // smooth 90-deg right turn
                
                const targetPitchVal = Math.atan2(1.46 - 1.62, dx); // slightly down, looking at the tape
                const startPitchVal = 0.0;

                this.inputManager.targetYaw = startYawVal + (targetYawVal - startYawVal) * clampedRatio;
                this.inputManager.targetPitch = startPitchVal + (targetPitchVal - startPitchVal) * clampedRatio;
            } else if (t < 10.5) {
                // 4. Walk horizontally towards the tape along z = 10.0 (x = 1.6 -> 8.8)
                isWalking = true;
                const ratio = (t - 6.8) / 3.7;
                targetX = 1.6 + (8.8 - 1.6) * ratio;
                targetZ = 10.0;
                speed = 1.62;

                // Keep camera dynamically locked onto the tape at (10, 10)
                const dx = 10.0 - this.player.position.x;
                const dz = 10.0 - this.player.position.z;
                const dist2D = Math.sqrt(dx * dx + dz * dz);
                
                const rawYaw = Math.atan2(-dx, -dz);
                const diff = rawYaw - this.inputManager.yaw;
                this.inputManager.targetYaw = this.inputManager.yaw + Math.atan2(Math.sin(diff), Math.cos(diff));
                this.inputManager.targetPitch = Math.atan2(1.46 - 1.62, dist2D);
            } else {
                // 5. Arrive in front of the tape at (8.8, 10.0), stand still, inspect closely, then noclip
                isWalking = false;
                targetX = 8.8;
                targetZ = 10.0;
                this.player.position.set(8.8, 0.0, 10.0);

                const ratio = Math.min(1.0, (t - 10.5) / 1.2);
                
                const dx = 10.0 - 8.8;
                const dz = 10.0 - 10.0;
                
                // Keep target yaw wrapped smoothly
                const rawYaw = Math.atan2(-dx, -dz);
                const diff = rawYaw - this.inputManager.yaw;
                const baseYaw = this.inputManager.yaw + Math.atan2(Math.sin(diff), Math.cos(diff));
                const basePitch = Math.atan2(1.46 - 1.62, dx);
                
                this.inputManager.targetYaw = baseYaw;
                this.inputManager.targetPitch = basePitch + (-0.55 - basePitch) * ratio; // Bend camera down to look closely

                if (t >= 11.7 && !this.isTransitioningToFall) {
                    this.isTransitioningToFall = true;

                    // Trigger chaotic glitch overlay
                    const glitchOverlay = document.getElementById('glitch-overlay');
                    if (glitchOverlay) {
                        glitchOverlay.classList.add('glitching');
                        glitchOverlay.style.background = 'rgba(255, 255, 255, 0.2)';
                    }

                    // Play terrifying distorted noclip sound
                    this.audioEngine.playMonsterScreech();

                    // Flicker flashlight violently to black
                    this.flashlight.triggerScaryFlicker(0.6);

                    // Sudden noclip plunge transition after 600ms glitch duration
                    setTimeout(() => {
                        this.world.warehouseMode = false;
                        this.world.reset();

                        this.player.startFallingIntro();
                        this.audioEngine.startFallingWind();
                        this.audioEngine.playPlayerScream();

                        this.flashlight.isOn = false;
                        this.flashlight.battery = 100.0;
                        this.flashlight.updatePosImmediately();

                        const go = document.getElementById('glitch-overlay');
                        if (go) {
                            go.className = '';
                            go.style.background = 'rgba(0,0,0,0)';
                        }

                        // Unlock mouse look and restore player controls for falling intro phase!
                        if (this.inputManager) {
                            this.inputManager.disableMouseLook = false;
                        }
                        this.isTransitioningToFall = false;
                        this.state = 'INTRO_FALLING';
                    }, 600);
                }
            }

            // 1. Update looking rotation smoothly using the calculated targets
            this.inputManager.updateCameraRotation(this.rendererEngine.camera, this.player.bobRoll, dt);

            // 2. Drive the automated player position, bobbing cycles, and footstep triggers
            this.player.updateWarehouseCutscene(dt, targetX, targetZ, isWalking, speed);

            // 3. Dynamic chunk loading for the warehouse chunks
            this.world.update(this.player.position, dt);

            // 4. Update volumetric flashlight position
            this.flashlight.update(dt, this.player.isSprinting);

            // 5. Spin and bob the glowing VHS videotape mesh
            if (this.world.vhsTapeMesh) {
                this.world.vhsTapeMesh.rotation.y += dt * 1.5;
                this.world.vhsTapeMesh.position.y = 1.46 + Math.sin(this.totalTime * 3.0) * 0.05; // bobbing
            }

            // 6. Check interaction distance to the VHS tape
            const dx = this.player.position.x - 10.0;
            const dz = this.player.position.z - 10.0;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist < 1.35 && !this.isTransitioningToFall) {
                this.isTransitioningToFall = true;
                
                // Trigger chaotic glitch overlay
                const glitchOverlay = document.getElementById('glitch-overlay');
                if (glitchOverlay) {
                    glitchOverlay.classList.add('glitching');
                    glitchOverlay.style.background = 'rgba(255, 255, 255, 0.2)';
                }

                // Play terrifying distorted noclip sound
                this.audioEngine.playMonsterScreech();

                // Flicker flashlight violently to black
                this.flashlight.triggerScaryFlicker(0.6);

                // Sudden noclip plunge transition after 600ms glitch duration
                setTimeout(() => {
                    this.world.warehouseMode = false;
                    this.world.reset();
                    
                    this.player.startFallingIntro();
                    this.audioEngine.startFallingWind();
                    this.audioEngine.playPlayerScream();
                    
                    this.flashlight.isOn = false;
                    
                    // Unlock mouse look and restore player controls for falling intro phase!
                    if (this.inputManager) {
                        this.inputManager.disableMouseLook = false;
                    }
                    
                    this.state = 'INTRO_FALLING';
                    this.isTransitioningToFall = false;

                    if (glitchOverlay) {
                        glitchOverlay.className = '';
                        glitchOverlay.style.background = 'rgba(0,0,0,0)';
                    }
                }, 600);
            }

        } else if (this.state === 'INTRO_FALLING') {
            this.playtimeElapsed += dt;
            this.updateHUD();

            // 1. Update looking rotation independently of movement
            this.inputManager.updateCameraRotation(this.rendererEngine.camera, this.player.bobRoll, dt);

            // 2. Drive falling physics and check landing impact
            const hitGround = this.player.updateFalling(dt);

            // 3. Flicker and pop flashlight ON as player gets closer to ceiling
            if (this.player.position.y < 7.5 && !this.flashlight.isOn && this.player.position.y > 0.0) {
                this.flashlight.isOn = true;
                this.flashlight.triggerScaryFlicker(1.8);
            }

            // 4. Load chunks below/around player
            this.world.update(this.player.position, dt);

            // 5. Sway flashlight trailing behind looking perspective
            this.flashlight.update(dt, false);

            // 6. Handle landing
            if (hitGround) {
                // Synthesize impact thump, carpet compress crunches, metallic echoes, gasps
                this.audioEngine.playLandingImpact();
                this.audioEngine.stopFallingWind();
                this.audioEngine.playPlayerLandingSpeech();

                // Trigger violent, decaying visual camera shake
                this.landingShakeIntensity = 0.55 * effectsMult;
                this.landingShakeTimer = 1.2;

                // Flashlight electrical spark flicker
                if (this.flashlight.isOn) {
                    this.flashlight.triggerScaryFlicker(1.5);
                }

                // Transition to getting up animation!
                this.state = 'INTRO_GETTING_UP';
            }

        } else if (this.state === 'INTRO_GETTING_UP') {
            this.playtimeElapsed += dt;
            this.updateHUD();

            // 1. Sluggish dampened mouse look to mimic bodily shock
            this.inputManager.updateCameraRotation(this.rendererEngine.camera, this.player.bobRoll, dt * 0.3);

            // 2. Drive the procedural standing interpolation animation
            const standComplete = this.player.updateGettingUp(dt);

            // 3. Load surrounding Backrooms chunks
            this.world.update(this.player.position, dt);

            // 4. Update trailing flashlight perspective
            this.flashlight.update(dt, false);

            if (standComplete) {
                if (this.inputManager) {
                    this.inputManager.disableMouseLook = false;
                }
                this.state = 'PLAYING';
            }

        } else if (this.state === 'JUMPSCARE') {
            // Shake camera violently during jumpscare face-time
            const shakeIntensity = 0.08 * effectsMult;
            this.rendererEngine.camera.position.x += (Math.random() - 0.5) * shakeIntensity;
            this.rendererEngine.camera.position.y += (Math.random() - 0.5) * shakeIntensity;
            this.rendererEngine.camera.position.z += (Math.random() - 0.5) * shakeIntensity;

            // Flashlight flickers rapidly to black
            this.flashlight.spotLight.intensity = Math.random() < 0.25 ? 0.0 : this.flashlight.maxIntensity * 0.4;
            this.flashlight.volumeCone.visible = Math.random() > 0.25;

            // Spasm monster limbs
            this.monster.update(dt, this.totalTime, true);
            currentPanic = this.scalePanic(1.0);
        }

        // Apply dynamic camera shake decayer on landing impacts (overlayed on top of player tracking)
        if (this.landingShakeTimer > 0.0) {
            this.landingShakeTimer -= dt;
            const shake = this.landingShakeIntensity * (this.landingShakeTimer / 1.2);
            
            this.rendererEngine.camera.position.x += (Math.random() - 0.5) * shake;
            this.rendererEngine.camera.position.y += (Math.random() - 0.5) * shake;
            this.rendererEngine.camera.position.z += (Math.random() - 0.5) * shake;
        }

        // 4. Double-pass Render Game Scene
        if (this.rendererEngine) {
            this.rendererEngine.render(this.totalTime, currentPanic);
        }
    }

    /**
     * Drives viewport battery levels and found-footage timecodes
     */
    updateHUD() {
        // Battery bar width scaling
        const batteryBar = document.getElementById('battery-level');
        if (batteryBar) {
            const batteryPct = this.flashlight.battery;
            batteryBar.style.width = `${batteryPct}%`;

            // Low battery blinking CSS indicators
            if (batteryPct < 20.0) {
                batteryBar.classList.add('low');
            } else {
                batteryBar.classList.remove('low');
            }
        }

        // Viewfinder time counter
        const timeElement = document.getElementById('vhs-time');
        if (timeElement) {
            const hrs = Math.floor(this.playtimeElapsed / 3600).toString().padStart(2, '0');
            const mins = Math.floor((this.playtimeElapsed % 3600) / 60).toString().padStart(2, '0');
            const secs = Math.floor(this.playtimeElapsed % 60).toString().padStart(2, '0');
            timeElement.innerText = `${hrs}:${mins}:${secs}`;
        }

        // Viewfinder VHS mode status
        const modeElement = document.querySelector('.vhs-mode');
        if (modeElement) {
            if (this.state === 'INTRO_WAREHOUSE') {
                modeElement.innerText = "SEARCH FOR THE SOURCE";
            } else if (this.state === 'INTRO_FALLING') {
                modeElement.innerText = "SIGNAL LOST / FALLING...";
            } else if (this.state === 'INTRO_GETTING_UP') {
                modeElement.innerText = "CORRUPTED FEED / SIGNAL RESTORE...";
            } else if (this.state === 'PLAYING') {
                modeElement.innerText = "PLAY";
            } else if (this.state === 'JUMPSCARE' || this.state === 'GAMEOVER') {
                modeElement.innerText = "SIGNAL LOST";
            }
        }

        this.updateObjectiveHint();
    }

    /**
     * Shows contextual survival hints on the viewfinder HUD
     */
    updateObjectiveHint() {
        const hintEl = document.getElementById('objective-hint');
        const textEl = document.getElementById('objective-text');
        const iconEl = document.getElementById('objective-icon');
        if (!hintEl || !textEl || !iconEl) return;

        const showStates = this.state === 'PLAYING' || this.state === 'INTRO_GETTING_UP';
        if (!showStates || this.isPaused) {
            hintEl.classList.add('hidden');
            return;
        }

        hintEl.classList.remove('hidden', 'pulse', 'danger');

        let text = 'SURVIVE';
        let icon = '▲';
        let pulse = false;
        let danger = false;

        if (this.flashlight && this.flashlight.battery < 20.0) {
            text = 'FIND POWER';
            icon = '⚡';
            pulse = true;
        }

        if (this.monster && this.monster.isActive) {
            const dx = this.player.position.x - this.monster.position.x;
            const dz = this.player.position.z - this.monster.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < this.monster.panicDist * 0.85) {
                text = 'AVOID IT';
                icon = '◆';
                danger = true;
                pulse = dist < this.monster.panicDist * 0.5;
            }
        }

        textEl.innerText = text;
        iconEl.innerText = icon;
        if (pulse) hintEl.classList.add('pulse');
        if (danger) hintEl.classList.add('danger');
    }
}

// Attach a standard helper to recharge battery on flashlight object directly
Flashlight.prototype.resetLights = function() {
    this.isOn = true;
    this.battery = 100.0;
    this.flickering = false;
    this.flickerTimer = 0.0;
    this.flickerIntensity = 1.0;
    this.scaryFlickerTimer = 0.0;
};

// Bootstrap the game controller on DOM load
window.addEventListener('DOMContentLoaded', () => {
    new GameController();
});
