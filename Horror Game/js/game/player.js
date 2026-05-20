/**
 * Player - Coordinates player movement physics, velocity damping,
 * keyboard direction inputs, sliding AABB wall collision corrections,
 * camera head-bobbing mechanics, and footstep sound timings.
 * Extended to support cinematic falling noclip intro sequences.
 * Optimized for zero-allocation rendering execution.
 */

export class Player {
    constructor(camera, world, input, audio) {
        this.camera = camera;
        this.world = world;
        this.input = input;
        this.audio = audio;

        // Physics variables
        this.position = new THREE.Vector3(2.0, 0.0, 2.0); // Spawn offset in first cell
        this.velocity = new THREE.Vector3();
        this.acceleration = 24.0;
        this.damping = 9.0; // Smooth deceleration drag
        this.mass = 1.0;
        this.radius = 0.35; // Collision radius

        // Speed settings
        this.walkSpeed = 1.8;
        this.sprintSpeed = 3.6;

        // Camera heights
        this.eyeHeight = 1.62; // Realistic 1.62 meters
        
        // Bobbing & Audio variables
        this.stepTimer = 0.0;
        this.bobCycle = 0.0;
        this.bobRoll = 0.0; // Dynamic camera roll tilt
        this.isMoving = false;
        this.isSprinting = false;

        // Falling sequence states
        this.isFallingIntro = false;
        this.fallVelocity = 0.0;
        this.isGettingUp = false;
        this.gettingUpTimer = 0.0;

        // PRE-ALLOCATED VECTORS FOR ZERO-ALLOCATION RENDER LOOP RUNNING
        this.accelVec = new THREE.Vector3();
        this.forwardDir = new THREE.Vector3();
        this.rightDir = new THREE.Vector3();
        this.dragDirection = new THREE.Vector3();

        // Reset camera initial pos
        this.camera.position.set(this.position.x, this.eyeHeight, this.position.z);
    }

    /**
     * Prepares player parameters for the cinematic noclip falling sequence
     */
    startFallingIntro() {
        this.position.set(2.0, 15.0, 2.0); // 15 meters high (well above the 2.8m ceiling)
        this.velocity.set(0, 0, 0);
        this.fallVelocity = 0.0;
        this.isFallingIntro = true;
        this.bobCycle = 0;
        this.stepTimer = 0;
        
        // Reset input yaw/pitch to prevent camera snapping
        if (this.input) {
            this.input.reset();
        }
        
        // Match camera to starting height
        this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
        this.camera.rotation.set(0, 0, 0);
    }

    /**
     * Updates falling physics and camera positioning during the starting intro
     */
    updateFalling(dt) {
        if (!this.isFallingIntro) return false;

        // Apply gravitational acceleration (22.0 m/s^2)
        this.fallVelocity += 22.0 * dt;
        
        // Decelerate air resistance slightly if falling extremely fast
        if (this.fallVelocity > 35.0) {
            this.fallVelocity = 35.0;
        }

        // Apply fall movement
        this.position.y -= this.fallVelocity * dt;

        // Add visual roll sway based on falling velocity to make it look chaotic
        const fallProgress = Math.min(1.0, this.fallVelocity / 15.0);
        const sway = Math.sin(this.position.y * 1.5) * 0.06 * fallProgress;
        this.bobRoll = sway;

        // Keep camera matched to position (falling floor + height)
        this.camera.position.x = this.position.x;
        this.camera.position.z = this.position.z;
        this.camera.position.y = this.position.y + this.eyeHeight;

        // Check if player has impacted the floor
        if (this.position.y <= 0.0) {
            this.position.y = 0.0;
            this.fallVelocity = 0.0;
            this.isFallingIntro = false;
            this.bobRoll = 1.0; // Tilted sideways 60 degrees lying on carpet
            this.isGettingUp = true;
            this.gettingUpTimer = 0.0;
            return true; // Signaling landing complete
        }

        return false;
    }

    /**
     * Updates getting-up animation physics, floor laying heights, and camera standing interpolations
     */
    updateGettingUp(dt) {
        if (!this.isGettingUp) return true;

        this.gettingUpTimer += dt;

        const gaspDuration = 1.5;
        const riseDuration = 2.0;
        const totalDuration = gaspDuration + riseDuration;

        if (this.gettingUpTimer <= gaspDuration) {
            // First 1.5 seconds: gasping/groaning on floor
            this.position.y = 0.0;
            this.camera.position.y = 0.2;
            this.bobRoll = 1.0; // Sideways tilt
        } else if (this.gettingUpTimer < totalDuration) {
            // Next 2.0 seconds: getting up slowly
            const t = (this.gettingUpTimer - gaspDuration) / riseDuration; // 0.0 to 1.0
            
            // Cubic hermite smooth step for luxurious premium movement feel
            const smoothT = t * t * (3 - 2 * t);
            
            // Interpolate camera height from 0.2 to standing 1.62m
            this.camera.position.y = 0.2 + (this.eyeHeight - 0.2) * smoothT;
            
            // Interpolate sideways tilt bobRoll from 1.0 back to 0.0
            this.bobRoll = 1.0 * (1.0 - smoothT);
        } else {
            // Completed getting up
            this.camera.position.y = this.eyeHeight;
            this.bobRoll = 0.0;
            this.isGettingUp = false;
            return true; // Getting up complete
        }

        // Lock horizontal camera to player's positions
        this.camera.position.x = this.position.x;
        this.camera.position.z = this.position.z;

        return false;
    }

    /**
     * Updates player position, handles keys, applies collision sliding, and bobs camera
     * Fully optimized to execute with ZERO Object Allocations in active gameplay loops.
     */
    update(dt) {
        if (!this.input.isLocked) return;

        // 1. Calculate Acceleration Vector based on Input keys and Camera Yaw
        this.accelVec.set(0, 0, 0);
        
        // Determine forward direction in XZ plane (ignore looking up/down)
        this.forwardDir.set(0, 0, -1);
        this.forwardDir.applyQuaternion(this.camera.quaternion);
        this.forwardDir.y = 0;
        this.forwardDir.normalize();

        this.rightDir.set(1, 0, 0);
        this.rightDir.applyQuaternion(this.camera.quaternion);
        this.rightDir.y = 0;
        this.rightDir.normalize();

        // Accumulate keyboard inputs in pre-allocated vector
        if (this.input.keys.forward) this.accelVec.add(this.forwardDir);
        if (this.input.keys.backward) this.accelVec.sub(this.forwardDir);
        if (this.input.keys.left) this.accelVec.sub(this.rightDir);
        if (this.input.keys.right) this.accelVec.add(this.rightDir);

        this.accelVec.normalize(); // Prevent faster diagonal walking

        // Determine current speed tier
        this.isMoving = this.accelVec.lengthSq() > 0.001;
        this.isSprinting = this.isMoving && this.input.keys.shift;
        const targetMaxSpeed = this.isSprinting ? this.sprintSpeed : this.walkSpeed;

        // Apply acceleration force
        if (this.isMoving) {
            this.accelVec.multiplyScalar(this.acceleration * dt);
            this.velocity.add(this.accelVec);
        }

        // 2. Apply Friction Damping Drag without allocations
        const speedSq = this.velocity.lengthSq();
        if (speedSq > 0.00001) {
            const speed = Math.sqrt(speedSq);
            const dragForce = speed * this.damping * dt;
            this.dragDirection.copy(this.velocity).normalize();
            
            if (dragForce >= speed) {
                this.velocity.set(0, 0, 0);
            } else {
                this.velocity.addScaledVector(this.dragDirection, -dragForce);
            }
        }

        // Clamp velocity to speed limits (optimized lengthSq to bypass square root math)
        if (this.velocity.lengthSq() > targetMaxSpeed * targetMaxSpeed) {
            this.velocity.normalize().multiplyScalar(targetMaxSpeed);
        }

        // 3. Move Position & Perform Collision Sliding Checks
        // Update X position first
        this.position.x += this.velocity.x * dt;
        let correction = this.world.checkCollisions(this.position, this.radius);
        this.position.x += correction.x; // slide along X

        // Update Z position second
        this.position.z += this.velocity.z * dt;
        correction = this.world.checkCollisions(this.position, this.radius);
        this.position.z += correction.z; // slide along Z

        // Clamp player directly to carpet floor level
        this.position.y = 0;

        // Apply visual position to Three.js camera
        this.camera.position.x = this.position.x;
        this.camera.position.z = this.position.z;

        // 4. Camera Bobbing (Footsteps and Breathing oscillations)
        this.applyCameraBobbing(dt);
    }

    /**
     * Bobs camera and triggers synthesized footsteps dynamically based on speed
     */
    applyCameraBobbing(dt) {
        const speed = this.velocity.length();
        
        if (this.isMoving && speed > 0.1) {
            // A. Walking/Sprinting Bobbing
            // Footstep frequency: faster when sprinting
            const bobFrequency = this.isSprinting ? 14.0 : 8.5;
            const bobHeight = this.isSprinting ? 0.14 : 0.07;
            const bobSideSway = this.isSprinting ? 0.06 : 0.035;

            // Increment cycle
            this.bobCycle += bobFrequency * dt;

            // Vertical bobbing (sine wave squared creates smooth double hump)
            const bobY = Math.sin(this.bobCycle) * bobHeight;
            // Horizontal sway (sine wave)
            const bobX = Math.cos(this.bobCycle * 0.5) * bobSideSway;

            // Apply calculated offset to camera height
            this.camera.position.y = this.eyeHeight + bobY;
            
            // Set roll tilt instead of writing directly to rotation object
            this.bobRoll = bobX * 0.25;

            // Footstep Audio timing trigger
            // Trigger footstep sound at the bottom of the bob cycle (maximum downwards motion)
            const prevTimer = this.stepTimer;
            this.stepTimer = Math.sin(this.bobCycle);
            
            // Peak downward compression represents physical foot strike
            if (prevTimer > 0 && this.stepTimer <= 0) {
                this.audio.playFootstep(this.isSprinting);
            }
        } else {
            // B. Calm Idle Breathing Bobbing
            // Slow breathing oscillation
            this.bobCycle += 1.8 * dt;
            const breathY = Math.sin(this.bobCycle) * 0.016;

            this.camera.position.y = this.eyeHeight + breathY;
            this.bobRoll = 0.0; // Clear tilts
            this.stepTimer = 0;
        }
    }

    /**
     * Automated cinematic warehouse camera update (no player keyboard inputs used)
     * Now includes sliding AABB wall and crate collision checking for absolute safety.
     */
    updateWarehouseCutscene(dt, targetX, targetZ, isWalking, speed) {
        if (isWalking) {
            // Move position toward target
            const dx = targetX - this.position.x;
            const dz = targetZ - this.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist > 0.05) {
                const step = speed * dt;
                const ratio = Math.min(1.0, step / dist);
                
                // Apply step movement in X and resolve collisions immediately
                this.position.x += dx * ratio;
                let correction = this.world.checkCollisions(this.position, this.radius);
                this.position.x += correction.x;

                // Apply step movement in Z and resolve collisions immediately
                this.position.z += dz * ratio;
                correction = this.world.checkCollisions(this.position, this.radius);
                this.position.z += correction.z;
                
                // Set velocity to drive the bobbing cycle frequency and intensity
                this.velocity.set(dx, 0, dz).normalize().multiplyScalar(speed);
                this.isMoving = true;
            } else {
                this.position.set(targetX, 0, targetZ);
                this.velocity.set(0, 0, 0);
                this.isMoving = false;
            }
            this.isSprinting = false;
        } else {
            this.velocity.set(0, 0, 0);
            this.isMoving = false;
        }
        
        this.position.y = 0;
        
        // Apply sliding collision checks one more time to prevent any tiny edge clips
        const finalCorrection = this.world.checkCollisions(this.position, this.radius);
        this.position.add(finalCorrection);
        
        this.camera.position.x = this.position.x;
        this.camera.position.z = this.position.z;
        
        // Apply bobbing & footsteps
        this.applyCameraBobbing(dt);
    }

    /**
     * Resets player coordinates and velocities (used on restart/spawn)
     */
    reset() {
        this.position.set(2.0, 0.0, 2.0);
        this.velocity.set(0, 0, 0);
        this.bobCycle = 0;
        this.stepTimer = 0;
        this.bobRoll = 0.0;
        this.isFallingIntro = false;
        this.fallVelocity = 0.0;
        this.isGettingUp = false;
        this.gettingUpTimer = 0.0;
        this.camera.position.set(this.position.x, this.eyeHeight, this.position.z);
        this.camera.rotation.set(0, 0, 0);
    }
}
