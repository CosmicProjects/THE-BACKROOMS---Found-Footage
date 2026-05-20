/**
 * Flashlight - Simulates a handheld tactical flashlight with realistic
 * spotlighting, secondary lighting bounce, high-performance volumetric cone,
 * hand motion lag/sway, battery drain, and emergency low-power flickering.
 * Extended to support scary flickering triggered on demand by environmental events.
 */

export class Flashlight {
    constructor(scene, camera, audioEngine) {
        this.scene = scene;
        this.camera = camera;
        this.audio = audioEngine;

        this.isOn = true;
        this.battery = 100.0; // 0 to 100%
        this.maxIntensity = 2.5;
        this.batteryDepletionRate = 0.08; // % per second (~12.5 mins total life)
        
        this.flickerTimer = 0.0;
        this.flickering = false;
        this.flickerIntensity = 1.0;

        // Scary environmental flicker timer
        this.scaryFlickerTimer = 0.0;

        // Flashlight hand lag/sway interpolation parameters
        this.position = new THREE.Vector3();
        this.rotation = new THREE.Quaternion();
        this.swaySpeed = 6.0; // Lerp factor

        // Pre-allocated vectors for zero-allocation performance
        this.flashlightTargetPos = new THREE.Vector3();
        this.flashlightRightOffset = new THREE.Vector3(0.18, -0.22, -0.15);
        this.flashlightForward = new THREE.Vector3(0, 0, -1);
        
        this.initLights();
    }

    initLights() {
        // 1. Core Tactical Spotlight
        this.spotLight = new THREE.SpotLight(0xfffae6, this.maxIntensity, 25, Math.PI / 6, 0.45, 1.2);
        this.spotLight.castShadow = true;
        // Optimized shadow map resolution to 512x512 for huge speedups, also looks more authentically low-res/vintage
        this.spotLight.shadow.mapSize.width = 512;
        this.spotLight.shadow.mapSize.height = 512;
        this.spotLight.shadow.camera.near = 0.1;
        this.spotLight.shadow.camera.far = 25;
        this.spotLight.shadow.bias = -0.001; // Avoid shadow acne
        this.scene.add(this.spotLight);

        // 2. Spotlight Target (must be in scene so Three.js knows where it points)
        this.lightTarget = new THREE.Object3D();
        this.scene.add(this.lightTarget);
        this.spotLight.target = this.lightTarget;

        // 3. Subtle ambient bounce light centered at flashlight origin
        // Simulates photon bounces in cramped spaces (prevents pitch-black dark zones)
        this.bounceLight = new THREE.PointLight(0xfffae6, 0.1, 8, 1.5);
        this.scene.add(this.bounceLight);

        // 4. Volumetric Cone (Procedural Cylinder Mesh)
        // Cylinder starts narrow (radius 0.02) and broadens (radius 2.5) over a length of 12 units
        const coneGeom = new THREE.CylinderGeometry(0.02, 2.8, 14, 16, 4, true);
        
        // Tilt the cylinder geometry so its coordinate system points straight forward (along Z axis)
        coneGeom.translate(0, -7, 0); // Shift origin to base
        coneGeom.rotateX(-Math.PI / 2); // Orient horizontal

        // Create additive volumetric shader-like material using simple blending and vertex alphas
        this.coneMat = new THREE.MeshBasicMaterial({
            color: 0xfffae6,
            transparent: true,
            opacity: 0.08,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.volumeCone = new THREE.Mesh(coneGeom, this.coneMat);
        this.scene.add(this.volumeCone);

        // Set initial positions
        this.updatePosImmediately();
    }

    /**
     * Toggles flashlight on/off with clicking audio triggers
     */
    toggle() {
        if (this.battery <= 0) return; // Cannot toggle dead light

        this.isOn = !this.isOn;
        this.audio.playFlashlightClick();
    }

    /**
     * Instantly matches the camera position (e.g. at spawn)
     */
    updatePosImmediately() {
        const camPos = this.camera.position;
        const camRot = this.camera.quaternion;

        this.position.copy(camPos);
        this.rotation.copy(camRot);

        this.spotLight.position.copy(camPos);
        this.bounceLight.position.copy(camPos);
        this.volumeCone.position.copy(camPos);
        this.volumeCone.quaternion.copy(camRot);

        // Set target 10 units in front (zero-allocation)
        this.flashlightForward.set(0, 0, -1).applyQuaternion(camRot);
        this.lightTarget.position.copy(camPos).add(this.flashlightForward);
    }

    /**
     * Triggers a creepy environmental flashlight flicker for a given duration
     */
    triggerScaryFlicker(duration = 2.5) {
        this.scaryFlickerTimer = duration;
        this.audio.playFlashlightClick(); // Add a quick bulb click sound
    }

    /**
     * Updates flashlight position with interpolation (adding hand-sway and light lag)
     */
    update(dt, isSprinting = false) {
        // A. Battery Depletion Logic
        if (this.isOn) {
            this.battery = Math.max(0.0, this.battery - this.batteryDepletionRate * dt);
            if (this.battery <= 0.0) {
                this.isOn = false;
                this.audio.playFlashlightClick(); // click off when dead
            }
        }

        // B. Flashlight Low Power / Environmental Flickering Logic
        this.flickering = this.isOn && (this.battery < 20.0 || this.scaryFlickerTimer > 0.0);
        this.flickerIntensity = 1.0;

        if (this.scaryFlickerTimer > 0.0) {
            this.scaryFlickerTimer -= dt;
        }

        if (this.flickering) {
            this.flickerTimer -= dt;
            if (this.flickerTimer <= 0.0) {
                // Determine next flicker duration (random)
                this.flickerTimer = 0.02 + Math.random() * 0.18;
                
                // Random intensity (mostly bright, occasionally zero)
                if (Math.random() < 0.4) {
                    this.flickerIntensity = Math.random() < 0.35 ? 0.0 : 0.2 + Math.random() * 0.6;
                }
            }
        }

        // C. Positional Sway & Hand Lag Interpolation
        // The flashlight follows the camera with a slight lag (lerping) - zero-allocation
        this.flashlightTargetPos.copy(this.camera.position);
        
        // Offset flashlight down-right relative to camera orientation to simulate right-hand carry
        this.flashlightRightOffset.set(0.18, -0.22, -0.15).applyQuaternion(this.camera.quaternion);
        this.flashlightTargetPos.add(this.flashlightRightOffset);

        // Lerp position & rotation to create natural trailing weight.
        // We use true mathematical exponential decay for perfectly smooth trailing under any frame rate.
        const lerpFactor = 1.0 - Math.exp(-this.swaySpeed * dt);
        this.position.lerp(this.flashlightTargetPos, lerpFactor);
        this.rotation.slerp(this.camera.quaternion, lerpFactor);

        // Apply to 3D entities
        this.spotLight.position.copy(this.position);
        this.bounceLight.position.copy(this.position);
        
        // Set volume cone pointing straight ahead of flashlight orientation
        this.volumeCone.position.copy(this.position);
        this.volumeCone.quaternion.copy(this.rotation);

        // Direct spotlight forward target vector (zero-allocation)
        this.flashlightForward.set(0, 0, -1).applyQuaternion(this.rotation);
        this.lightTarget.position.copy(this.position).add(this.flashlightForward);

        // D. Apply Final Light Intensities based on state, flickers, and battery decay
        if (this.isOn) {
            // Gradual fading as battery dies
            const batteryFactor = this.battery > 20.0 ? 1.0 : (this.battery / 20.0) * 0.8 + 0.2;
            const currentIntensity = this.maxIntensity * this.flickerIntensity * batteryFactor;

            this.spotLight.intensity = currentIntensity;
            this.bounceLight.intensity = currentIntensity * 0.04;
            
            // Volumetric cone opacity matches lighting intensity
            this.volumeCone.visible = true;
            this.coneMat.opacity = 0.07 * this.flickerIntensity * batteryFactor;
        } else {
            this.spotLight.intensity = 0.0;
            this.bounceLight.intensity = 0.0;
            this.volumeCone.visible = false;
        }
    }
}
