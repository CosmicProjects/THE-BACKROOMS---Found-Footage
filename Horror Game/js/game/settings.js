/**
 * GameSettings - Persists accessibility and comfort options in localStorage.
 */

const STORAGE_KEY = 'backrooms_horror_settings_v1';

const DEFAULTS = {
    masterVolume: 0.5,
    mouseSensitivity: 0.0022,
    reduceEffects: false,
    skipIntro: false
};

export class GameSettings {
    constructor() {
        this.data = { ...DEFAULTS };
        this.load();
    }

    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'object' && parsed !== null) {
                this.data = { ...DEFAULTS, ...parsed };
            }
        } catch (e) {
            console.warn('Could not load settings:', e);
        }
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.warn('Could not save settings:', e);
        }
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        this.data[key] = value;
        this.save();
    }

    getEffectsMultiplier() {
        return this.data.reduceEffects ? 0.35 : 1.0;
    }

    applyTo(controller) {
        if (!controller) return;

        if (controller.inputManager) {
            controller.inputManager.mouseSensitivity = this.data.mouseSensitivity;
        }

        if (controller.audioEngine) {
            controller.audioEngine.setMasterVolume(this.data.masterVolume);
        }
    }
}
