/**
 * InputManager - Handles PointerLock controls, cursor locking,
 * keyboard directional triggers (WASD + Shift), and toggles.
 * Provides clean Euler angles for player head movements.
 */

export class InputManager {
    constructor(gameContainer) {
        this.container = gameContainer;
        
        // Keyboard state
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            shift: false
        };

        // Mouse orientation (yaw / pitch)
        this.yaw = 0.0;
        this.pitch = 0.0;
        this.targetYaw = 0.0;
        this.targetPitch = 0.0;
        this.mouseSensitivity = 0.0022;

        // PointerLock status
        this.isLocked = false;

        // Custom disable mouse look flag for cutscenes
        this.disableMouseLook = false;

        // Custom shortcut callbacks (e.g. toggle flashlight)
        this.onToggleFlashlight = null;

        // Bind events
        this.bindEvents();
    }

    bindEvents() {
        // Pointer lock status listeners
        document.addEventListener('pointerlockchange', () => this.handleLockChange());
        document.addEventListener('mozpointerlockchange', () => this.handleLockChange());

        // Keyboard listeners
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // Mouse move listener
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    }

    /**
     * Attempts to request pointer lock on the viewport
     */
    lock() {
        this.container.requestPointerLock = this.container.requestPointerLock ||
                                           this.container.mozRequestPointerLock ||
                                           this.container.webkitRequestPointerLock;
        if (this.container.requestPointerLock) {
            this.container.requestPointerLock();
        }
    }

    /**
     * Unlocks the pointer lock
     */
    unlock() {
        document.exitPointerLock = document.exitPointerLock ||
                                   document.mozExitPointerLock ||
                                   document.webkitExitPointerLock;
        if (document.exitPointerLock) {
            document.exitPointerLock();
        }
    }

    handleLockChange() {
        this.isLocked = (document.pointerLockElement === this.container ||
                         document.mozPointerLockElement === this.container ||
                         document.webkitPointerLockElement === this.container);
        
        // Pause/resume game loops in main if necessary based on this state
    }

    handleMouseMove(e) {
        if (!this.isLocked || this.disableMouseLook) return;

        // Fetch deltas
        const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
        const movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;

        // Apply sensitivity and update target orientations
        this.targetYaw -= movementX * this.mouseSensitivity;
        this.targetPitch -= movementY * this.mouseSensitivity;

        // Clamp head pitch look (cannot look upside down, -85 to +85 degrees)
        const maxPitch = Math.PI / 2 * 0.95;
        this.targetPitch = Math.max(-maxPitch, Math.min(maxPitch, this.targetPitch));
    }

    handleKeyDown(e) {
        if (!this.isLocked) return;

        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.keys.forward = true;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.keys.backward = true;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.keys.left = true;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.keys.right = true;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.shift = true;
                break;
            case 'KeyF':
                if (this.onToggleFlashlight) {
                    this.onToggleFlashlight();
                }
                break;
        }
    }

    handleKeyUp(e) {
        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.keys.forward = false;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.keys.backward = false;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.keys.left = false;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.keys.right = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.shift = false;
                break;
        }
    }

    /**
     * Applies the accumulated mouse angles and player head-bob roll onto the camera's orientation.
     * Uses frame-rate independent interpolation (lerping) to make mouse look silky smooth.
     */
    updateCameraRotation(camera, roll = 0.0, dt = 0.016) {
        // High lerp speed (e.g. 18.5) gives immediate responsiveness but removes pixel step jitters.
        // We use true mathematical exponential decay for perfect frame-rate independence.
        const lerpFactor = 1.0 - Math.exp(-18.5 * dt);
        this.yaw += (this.targetYaw - this.yaw) * lerpFactor;
        this.pitch += (this.targetPitch - this.pitch) * lerpFactor;

        camera.rotation.order = 'YXZ';
        camera.rotation.x = this.pitch;
        camera.rotation.y = this.yaw;
        camera.rotation.z = roll;
    }
    
    /**
     * Resets input angles (useful when spawning or resetting after death)
     */
    reset() {
        this.yaw = 0.0;
        this.pitch = 0.0;
        this.targetYaw = 0.0;
        this.targetPitch = 0.0;
        this.keys.forward = false;
        this.keys.backward = false;
        this.keys.left = false;
        this.keys.right = false;
        this.keys.shift = false;
    }
}
