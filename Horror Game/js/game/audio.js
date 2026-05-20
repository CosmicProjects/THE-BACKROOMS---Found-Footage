/**
 * AudioEngine - Synthesizes hyper-realistic horror soundscapes entirely programmatically
 * using the HTML5 Web Audio API and SpeechSynthesis API. Eliminates network asset dependencies 
 * while delivering immersive, dynamic, position-aware and event-driven binaural horror sounds.
 * Integrates creepy, slow, low-pitched robotic/demonic voice synthesis triggers.
 * Extended to support dynamic, high-altitude falling wind sweeps and heavy chest impact thuds.
 */

export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterVolume = null;
        this.humNode = null;
        this.humBallastOsc = null;
        
        // Heartbeat state
        this.heartbeatTimer = null;
        this.panicLevel = 0.0; // 0.0 (calm) to 1.0 (terror)
        
        // Ambient scare timers
        this.scareTimer = null;
        
        // Rushing wind intro references
        this.windNode = null;
        this.windGain = null;

        // Realistic monologue/survivor speech timeouts
        this.landingSpeechTimeouts = [];
        this.survivorSpeechTimeouts = [];

        this.isInitialized = false;
    }

    /**
     * Bootstraps the Web Audio API Context (must be triggered by user interaction)
     */
    init() {
        if (this.isInitialized) return;

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            
            // Master gain node
            this.masterVolume = this.ctx.createGain();
            this.masterVolume.gain.setValueAtTime(0.5, this.ctx.currentTime);
            this.masterVolume.connect(this.ctx.destination);

            // Pre-warm Speech Synthesis to unlock capabilities seamlessly on click
            if (window.speechSynthesis) {
                try {
                    window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
                } catch (e) {}
            }

            // 1. Start Ambient Fluorescent Hum immediately
            this.startFluorescentHum();

            // 2. Start Panic heartbeat controller
            this.tickHeartbeat();

            // 3. Start random spooky ambient sound scheduler
            this.scheduleAmbientScares();

            this.isInitialized = true;
            console.log("Audio Engine procedurally initialized successfully.");
        } catch (e) {
            console.error("Web Audio API is not supported in this browser:", e);
        }
    }

    /**
     * Synthesizes a realistic physical toggle click for the flashlight
     */
    playFlashlightClick() {
        if (!this.ctx) return;
        
        const now = this.ctx.currentTime;
        
        // High click sound (FM-like quick pitch drop)
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.02);
        
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        
        osc.connect(gain);
        gain.connect(this.masterVolume);
        
        osc.start(now);
        osc.stop(now + 0.04);

        // Subtler metallic spring echo
        const springOsc = this.ctx.createOscillator();
        const springGain = this.ctx.createGain();
        
        springOsc.type = 'sine';
        springOsc.frequency.setValueAtTime(2800, now);
        springGain.gain.setValueAtTime(0.08, now);
        springGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        
        springOsc.connect(springGain);
        springGain.connect(this.masterVolume);
        
        springOsc.start(now);
        springOsc.stop(now + 0.1);
    }

    /**
     * Synthesizes the buzzing fluorescent hum of the Backrooms
     */
    startFluorescentHum() {
        const now = this.ctx.currentTime;

        // Base 60Hz magnetic core hum
        const baseHum = this.ctx.createOscillator();
        baseHum.type = 'sine';
        baseHum.frequency.setValueAtTime(60, now);

        // Ballast multi-harmonics (buzzing feel)
        const ballastHum = this.ctx.createOscillator();
        ballastHum.type = 'sawtooth';
        ballastHum.frequency.setValueAtTime(120, now); // Second harmonic

        // Eerie fluorescent static (modulated high bandpassed noise)
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(3500, now);
        noiseFilter.Q.setValueAtTime(3.0, now);

        // Generate white noise buffer
        const bufferSize = this.ctx.sampleRate * 2;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = noiseBuffer;
        noiseNode.loop = true;

        // Modulate hum with an LFO to simulate electric fluctuations
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(0.2, now); // slow 0.2Hz wave
        
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.setValueAtTime(0.015, now);
        
        lfo.connect(lfoGain);

        // Mix volume nodes
        const baseGain = this.ctx.createGain();
        baseGain.gain.setValueAtTime(0.12, now);

        const ballastGain = this.ctx.createGain();
        ballastGain.gain.setValueAtTime(0.018, now); // keep low since sawtooth is harsh

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.005, now);

        // Dynamic buzz flicker modulator (connects to hum level)
        const flickerGain = this.ctx.createGain();
        flickerGain.gain.setValueAtTime(1.0, now);
        lfoGain.connect(flickerGain.gain); // apply slow variance

        // Connect base elements
        baseHum.connect(baseGain);
        ballastHum.connect(ballastGain);
        noiseNode.connect(noiseFilter);
        noiseFilter.connect(noiseGain);

        // Mix down
        const humMix = this.ctx.createGain();
        baseGain.connect(humMix);
        ballastGain.connect(humMix);
        noiseGain.connect(humMix);

        humMix.connect(flickerGain);
        flickerGain.connect(this.masterVolume);

        // Start all oscillators
        baseHum.start(now);
        ballastHum.start(now);
        noiseNode.start(now);
        lfo.start(now);

        // Retain nodes to manipulate volume or turn off
        this.humNode = humMix;
    }

    /**
     * Plays a single carpeted footstep thud
     */
    playFootstep(isSprinting = false) {
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        
        // Low frequency thud
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(45, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.15);
        
        oscGain.gain.setValueAtTime(isSprinting ? 0.35 : 0.2, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        // Carpet rustle noise
        const rustleFilter = this.ctx.createBiquadFilter();
        rustleFilter.type = 'lowpass';
        rustleFilter.frequency.setValueAtTime(180, now);

        // Quick noise source
        const bufferSize = this.ctx.sampleRate * 0.15; // 150ms
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for(let i=0; i<bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const rustleNode = this.ctx.createBufferSource();
        rustleNode.buffer = noiseBuffer;

        const rustleGain = this.ctx.createGain();
        rustleGain.gain.setValueAtTime(isSprinting ? 0.22 : 0.12, now);
        rustleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        // Connect
        osc.connect(oscGain);
        oscGain.connect(this.masterVolume);

        rustleNode.connect(rustleFilter);
        rustleFilter.connect(rustleGain);
        rustleGain.connect(this.masterVolume);

        osc.start(now);
        rustleNode.start(now);

        osc.stop(now + 0.25);
        rustleNode.stop(now + 0.25);
    }

    /**
     * Heartbeat controller - gets louder and faster based on panicLevel
     */
    tickHeartbeat() {
        if (!this.ctx) {
            setTimeout(() => this.tickHeartbeat(), 1000);
            return;
        }

        const now = this.ctx.currentTime;
        
        // Base heartbeat tempo: panic ranges from 0.0 to 1.0
        // Calm: 60 BPM (1s interval) -> Panicked: 155 BPM (0.38s interval)
        const interval = 1.0 - (this.panicLevel * 0.62);

        // Only play heartbeat audibly if panic is > 0.05
        if (this.panicLevel > 0.05) {
            const beatVolume = this.panicLevel * 0.65;

            // Heart double-thump sound (lub-dub)
            this.playHeartThump(now, beatVolume);
            this.playHeartThump(now + 0.15, beatVolume * 0.7); // Secondary slightly quieter "dub"
        }

        // Loop next tick
        this.heartbeatTimer = setTimeout(() => this.tickHeartbeat(), interval * 1000);
    }

    playHeartThump(time, volume) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(45, time); // Extremely low thud
        osc.frequency.exponentialRampToValueAtTime(10, time + 0.12);

        gain.gain.setValueAtTime(volume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

        osc.connect(gain);
        gain.connect(this.masterVolume);

        osc.start(time);
        osc.stop(time + 0.16);
    }

    /**
     * Synthesizes sudden horrifying ambient scrapes or drone swells
     */
    scheduleAmbientScares() {
        if (!this.ctx) {
            setTimeout(() => this.scheduleAmbientScares(), 1000);
            return;
        }

        // Trigger an ambient scare sound every 12 to 35 seconds
        const delay = 12000 + Math.random() * 23000;

        this.scareTimer = setTimeout(() => {
            // 45% chance of terrifying voice lines, 55% chance of structural ambient chimes/drops
            if (Math.random() < 0.45 && window.speechSynthesis) {
                this.playScaryTalking();
            } else {
                this.playAmbientScare();
            }
            this.scheduleAmbientScares();
        }, delay);
    }

    /**
     * Synthesizes and plays a slow, demonic-pitched whisper voice using browser SpeechSynthesis
     * and dispatches a synchronizing event to flicker the player's flashlight.
     */
    playScaryTalking() {
        if (!window.speechSynthesis || this.panicLevel > 0.8) return;

        // Cancel any currently speaking utterances to avoid overlapping talk
        window.speechSynthesis.cancel();

        const phrases = [
            "Don't look back.",
            "I can hear you breathing.",
            "It's standing behind you.",
            "There is no way out.",
            "It is watching.",
            "Help me...",
            "Do you hear it?",
            "You shouldn't have come here.",
            "It knows you're here.",
            "Run.",
            "Don't turn around.",
            "It's closer now.",
            "Behind you...",
            "It is already here."
        ];
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];

        // Creepy low sub-bass sound swell as warning
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.linearRampToValueAtTime(40, now + 2.0);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
        osc.connect(gain);
        gain.connect(this.masterVolume);
        osc.start(now);
        osc.stop(now + 2.6);

        // Fetch voices and construct creepiest voice possible
        const speak = () => {
            const utterance = new SpeechSynthesisUtterance(phrase);
            const voices = window.speechSynthesis.getVoices();
            
            // Look for deep male, english, robotic, or natural voices
            let bestVoice = null;
            for (const voice of voices) {
                const name = voice.name.toLowerCase();
                const lang = voice.lang.toLowerCase();
                if (lang.includes('en') && (name.includes('male') || name.includes('google') || name.includes('david') || name.includes('robotic') || name.includes('natural'))) {
                    bestVoice = voice;
                    break;
                }
            }
            if (!bestVoice && voices.length > 0) {
                bestVoice = voices.find(v => v.lang.toLowerCase().includes('en')) || voices[0];
            }
            if (bestVoice) {
                utterance.voice = bestVoice;
            }

            utterance.pitch = 0.1 + Math.random() * 0.25; // Demonic low pitch (0.1 to 0.35)
            utterance.rate = 0.55 + Math.random() * 0.15;  // Slow creepy pace
            utterance.volume = 0.8;

            window.speechSynthesis.speak(utterance);
        };

        // If voices aren't loaded yet, attach to voiceschanged event
        if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.onvoiceschanged = () => {
                speak();
                window.speechSynthesis.onvoiceschanged = null; // Unbind
            };
        } else {
            speak();
        }

        // Dispatch event for visual synchronizations (like flashlight flicker)
        const event = new CustomEvent('scary_talking_triggered', {
            detail: { phrase: phrase }
        });
        window.dispatchEvent(event);
    }

    playAmbientScare() {
        if (!this.ctx || this.panicLevel > 0.8) return; // Don't trigger if already in active chase

        const now = this.ctx.currentTime;
        const type = Math.floor(Math.random() * 3);

        if (type === 0) {
            // Eerie sub-bass drop drone
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(90, now);
            osc.frequency.linearRampToValueAtTime(30, now + 4.0);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(60, now);
            filter.frequency.linearRampToValueAtTime(25, now + 4.0);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.4, now + 1.0);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 4.5);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterVolume);

            osc.start(now);
            osc.stop(now + 5.0);
        } else if (type === 1) {
            // High-pitched metallic scraping/ringing sound
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            // Ring modulator setup
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(950, now);
            osc1.frequency.linearRampToValueAtTime(970, now + 3.0);

            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(962, now); // creates metallic beating frequency (12Hz diff)
            
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.05, now + 0.8);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(this.masterVolume);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 3.5);
            osc2.stop(now + 3.5);
        } else {
            // Eerie distant heavy mechanical clank/thud
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(60, now);
            osc.frequency.linearRampToValueAtTime(30, now + 0.5);

            gain.gain.setValueAtTime(0.35, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

            // Mechanical resonance
            const resonance = this.ctx.createOscillator();
            resonance.type = 'triangle';
            resonance.frequency.setValueAtTime(140, now);
            
            const resGain = this.ctx.createGain();
            resGain.gain.setValueAtTime(0.08, now);
            resGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

            osc.connect(gain);
            resonance.connect(resGain);
            
            gain.connect(this.masterVolume);
            resGain.connect(this.masterVolume);

            osc.start(now);
            resonance.start(now);
            osc.stop(now + 1.0);
            resonance.stop(now + 0.5);
        }
    }

    /**
     * Synthesizes a terrifying distorted FM-based monster growl/screech
     */
    playMonsterScreech() {
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        
        // FM Synthesis setup: Modulator -> Carrier
        const carrier = this.ctx.createOscillator();
        const modulator = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const masterGain = this.ctx.createGain();

        // Carrier frequency sweep (starts high, crashes down)
        carrier.type = 'sawtooth';
        carrier.frequency.setValueAtTime(380, now);
        carrier.frequency.exponentialRampToValueAtTime(80, now + 1.5);

        // Modulator makes the sound chaotic and metallic
        modulator.type = 'sawtooth';
        modulator.frequency.setValueAtTime(145, now);
        modulator.frequency.linearRampToValueAtTime(30, now + 1.5);

        modGain.gain.setValueAtTime(600, now); // Massive modulation index
        modGain.gain.linearRampToValueAtTime(50, now + 1.5);

        // Connect FM
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);

        // Heavy distortion/waveshaper
        const dist = this.ctx.createWaveShaper();
        dist.curve = this.makeDistortionCurve(100);

        // Volume Envelope
        masterGain.gain.setValueAtTime(0.01, now);
        masterGain.gain.linearRampToValueAtTime(0.9, now + 0.15); // Loud jump scare volume
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);

        // Connect pipeline
        carrier.connect(dist);
        dist.connect(masterGain);
        masterGain.connect(this.masterVolume);

        // Start
        carrier.start(now);
        modulator.start(now);
        
        carrier.stop(now + 1.7);
        modulator.stop(now + 1.7);
    }

    // Distortion curve generation helper
    makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    /**
     * Synthesizes and loops a high-altitude rushing wind sweep for the noclip intro
     */
    startFallingWind() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        // Generate white noise buffer
        const bufferSize = this.ctx.sampleRate * 4; // 4 seconds of loop
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const source = this.ctx.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;

        // Low-pass/Band-pass resonant sweeps for whooshing effects
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(950, now);
        filter.frequency.linearRampToValueAtTime(250, now + 2.4); // sweep downwards as player descends
        filter.Q.setValueAtTime(4.5, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.32, now + 0.35); // quick swell

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterVolume);

        source.start(now);

        this.windNode = source;
        this.windGain = gain;
    }

    /**
     * Fades out and cleans up the noclip rushing wind audio source on floor collision
     */
    stopFallingWind() {
        if (!this.ctx || !this.windNode || !this.windGain) return;
        const now = this.ctx.currentTime;

        try {
            // Quick linear ramp down to zero in 150ms to avoid audio pops
            this.windGain.gain.setValueAtTime(this.windGain.gain.value, now);
            this.windGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

            const source = this.windNode;
            setTimeout(() => {
                try {
                    source.stop();
                } catch (e) {}
            }, 200);
        } catch (e) {}

        this.windNode = null;
        this.windGain = null;
    }

    /**
     * Synthesizes a heavy double-thud landing impact combined with physical floor crunch
     * and schedules breathing gasps to reflect the bodily shock of falling.
     */
    playLandingImpact() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        // 1. Core deep sub-bass crash (60Hz -> 10Hz pitch drop)
        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(60, now);
        subOsc.frequency.exponentialRampToValueAtTime(10, now + 0.35);

        subGain.gain.setValueAtTime(0.75, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        subOsc.connect(subGain);
        subGain.connect(this.masterVolume);

        // 2. Secondary mid-body thud (120Hz -> 25Hz triangle wave)
        const midOsc = this.ctx.createOscillator();
        const midGain = this.ctx.createGain();
        midOsc.type = 'triangle';
        midOsc.frequency.setValueAtTime(125, now);
        midOsc.frequency.exponentialRampToValueAtTime(25, now + 0.28);

        midGain.gain.setValueAtTime(0.45, now);
        midGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        midOsc.connect(midGain);
        midGain.connect(this.masterVolume);

        // Start impact oscillators
        subOsc.start(now);
        subOsc.stop(now + 0.45);
        midOsc.start(now);
        midOsc.stop(now + 0.35);

        // 3. Dense damp carpet compression rustle (noise burst filtered at low-pass)
        const crunchFilter = this.ctx.createBiquadFilter();
        crunchFilter.type = 'lowpass';
        crunchFilter.frequency.setValueAtTime(240, now);

        const bufferSize = this.ctx.sampleRate * 0.38; // ~380ms crunch
        const crunchBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = crunchBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const crunchNode = this.ctx.createBufferSource();
        crunchNode.buffer = crunchBuffer;

        const crunchGain = this.ctx.createGain();
        crunchGain.gain.setValueAtTime(0.55, now);
        crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

        crunchNode.connect(crunchFilter);
        crunchFilter.connect(crunchGain);
        crunchGain.connect(this.masterVolume);

        crunchNode.start(now);
        crunchNode.stop(now + 0.4);

        // 4. Hollow corridor metallic resonance ringing
        const metallicOsc = this.ctx.createOscillator();
        const metallicGain = this.ctx.createGain();
        metallicOsc.type = 'sine';
        metallicOsc.frequency.setValueAtTime(190, now);

        metallicGain.gain.setValueAtTime(0.12, now);
        metallicGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9); // longer decay

        metallicOsc.connect(metallicGain);
        metallicGain.connect(this.masterVolume);

        metallicOsc.start(now);
        metallicOsc.stop(now + 0.95);

        // 5. Schedule heavy, panic-induced body breathing and shock gasps
        this.scheduleGasps(now + 0.42);
    }

    /**
     * Schedules consecutive deep heavy breathing loops following high impact
     */
    scheduleGasps(startTime) {
        // Gasp 1 (Loud exhale)
        this.playGaspSound(startTime, 0.42, 0.16, true);
        // Gasp 2 (Sharp intake of breath)
        this.playGaspSound(startTime + 0.58, 0.3, 0.10, false);
        // Gasp 3 (Slower exhale)
        this.playGaspSound(startTime + 0.98, 0.55, 0.08, true);
    }

    /**
     * Procedurally synthesizes a brief breath audio swell
     */
    playGaspSound(time, duration, volume, isExhale) {
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        
        // Exhaling is lower frequency and wider; inhaling is higher-pitched and narrower
        noiseFilter.frequency.setValueAtTime(isExhale ? 350 : 540, time);
        noiseFilter.frequency.exponentialRampToValueAtTime(isExhale ? 190 : 460, time + duration);
        noiseFilter.Q.setValueAtTime(2.2, time);

        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(volume, time + 0.09); // swell
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        source.connect(noiseFilter);
        noiseFilter.connect(gain);
        gain.connect(this.masterVolume);

        source.start(time);
        source.stop(time + duration + 0.05);
    }

    /**
     * SpeechSynthesis fallback helper to scream "Aaaaaah!!!" - DISABLED to prevent robotic screaming
     */
    playPlayerScreamVoice() {
        // Disabled: The realistic Web Audio scream synth below is used exclusively
    }

    /**
     * Synthesizes a terrifying throat-clearing procedural vocal scream for the noclip plunge.
     * Uses parallel formant filtering, dual detuned vocal cord sawtooth oscillators,
     * low-frequency vocal fry roughness, throat tremble vibrato, and waveshaper distortion.
     */
    playPlayerScream() {
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            
            // 1. Two detuned sawtooth oscillators to simulate vocal cords under extreme tension
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(210, now);
            osc1.frequency.exponentialRampToValueAtTime(310, now + 0.18);
            osc1.frequency.linearRampToValueAtTime(130, now + 1.8);
            
            osc2.type = 'sawtooth';
            osc2.frequency.setValueAtTime(213, now); // detuned by 3Hz to create raw vocal beats
            osc2.frequency.exponentialRampToValueAtTime(314, now + 0.18);
            osc2.frequency.linearRampToValueAtTime(132, now + 1.8);

            // 2. High-frequency sawtooth oscillator to modulate pitch, creating throat roughness (raspy vocal fry/growl)
            const roughnessOsc = this.ctx.createOscillator();
            const roughnessGain = this.ctx.createGain();
            roughnessOsc.type = 'sawtooth';
            roughnessOsc.frequency.setValueAtTime(88, now); // 88Hz creates aggressive growl modulation
            roughnessGain.gain.setValueAtTime(130, now); // high modulation index
            roughnessGain.gain.linearRampToValueAtTime(50, now + 1.8);
            
            roughnessOsc.connect(roughnessGain);
            roughnessGain.connect(osc1.frequency);
            roughnessGain.connect(osc2.frequency);

            // 3. Vibrato LFO for dramatic panic-stricken throat shudder
            const vibratoLfo = this.ctx.createOscillator();
            const vibratoGain = this.ctx.createGain();
            vibratoLfo.type = 'sine';
            vibratoLfo.frequency.setValueAtTime(10.0, now); // 10Hz rapid throat quiver
            vibratoGain.gain.setValueAtTime(40, now);
            
            vibratoLfo.connect(vibratoGain);
            vibratoGain.connect(osc1.frequency);
            vibratoGain.connect(osc2.frequency);

            // 4. White noise bandpass-filtered to represent breath turbulence/air rushing under intense scream pressure
            const bufferSize = this.ctx.sampleRate * 2.0;
            const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const noiseData = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                noiseData[i] = Math.random() * 2 - 1;
            }
            const noiseNode = this.ctx.createBufferSource();
            noiseNode.buffer = noiseBuffer;

            const noiseFilter = this.ctx.createBiquadFilter();
            noiseFilter.type = 'bandpass';
            noiseFilter.frequency.setValueAtTime(2100, now);
            noiseFilter.Q.setValueAtTime(1.8, now);

            const noiseGain = this.ctx.createGain();
            noiseGain.gain.setValueAtTime(0.38, now);
            noiseGain.gain.linearRampToValueAtTime(0.08, now + 1.8);

            noiseNode.connect(noiseFilter);
            noiseFilter.connect(noiseGain);

            // 5. Formant Filter Bank to shape vocal tract resonances ("Ahhh" voice formant)
            // F1: ~850Hz, F2: ~1300Hz, F3: ~2600Hz
            const f1 = this.ctx.createBiquadFilter();
            f1.type = 'bandpass';
            f1.frequency.setValueAtTime(850, now);
            f1.Q.setValueAtTime(3.2, now);

            const f2 = this.ctx.createBiquadFilter();
            f2.type = 'bandpass';
            f2.frequency.setValueAtTime(1320, now);
            f2.Q.setValueAtTime(3.2, now);

            const f3 = this.ctx.createBiquadFilter();
            f3.type = 'bandpass';
            f3.frequency.setValueAtTime(2650, now);
            f3.Q.setValueAtTime(2.8, now);

            // Sweep filters to simulate the shape of the mouth screaming open and closing slightly at decay
            f1.frequency.exponentialRampToValueAtTime(740, now + 1.8);
            f2.frequency.exponentialRampToValueAtTime(1160, now + 1.8);
            f3.frequency.exponentialRampToValueAtTime(2350, now + 1.8);

            // 6. Waveshaper Distortion to add realistic throat clipping / saturation
            const distort = this.ctx.createWaveShaper();
            distort.curve = this.makeDistortionCurve(70);

            // 7. Envelopes and Final Mixer
            const sourceMix = this.ctx.createGain();
            const oscGain = this.ctx.createGain();
            oscGain.gain.setValueAtTime(0.75, now);
            
            osc1.connect(oscGain);
            osc2.connect(oscGain);
            
            oscGain.connect(sourceMix);
            noiseGain.connect(sourceMix);

            const masterScreamGain = this.ctx.createGain();
            masterScreamGain.gain.setValueAtTime(0.01, now);
            masterScreamGain.gain.linearRampToValueAtTime(0.85, now + 0.12); // lightning-fast scream attack
            masterScreamGain.gain.setValueAtTime(0.85, now + 1.2);
            masterScreamGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

            // Parallel formant connection
            sourceMix.connect(f1);
            sourceMix.connect(f2);
            sourceMix.connect(f3);
            
            const formantMix = this.ctx.createGain();
            f1.connect(formantMix);
            f2.connect(formantMix);
            f3.connect(formantMix);

            // Distort the formant group to fuse elements organically
            formantMix.connect(distort);
            distort.connect(masterScreamGain);
            masterScreamGain.connect(this.masterVolume);

            // Start all generators
            osc1.start(now);
            osc2.start(now);
            roughnessOsc.start(now);
            vibratoLfo.start(now);
            noiseNode.start(now);

            // Stop
            osc1.stop(now + 1.9);
            osc2.stop(now + 1.9);
            roughnessOsc.stop(now + 1.9);
            vibratoLfo.stop(now + 1.9);
            noiseNode.stop(now + 1.9);

        } catch (e) {
            console.warn("Procedural scream synthesis failed:", e);
        }
    }

    /**
     * Speaks the disoriented landing monologue using SpeechSynthesis.
     * Splits monologue into separate phrases played with natural staggered pauses,
     * slightly varying pitch/rate to sound realistically terrified and disoriented.
     */
    playPlayerLandingSpeech() {
        if (!window.speechSynthesis) return;
        try {
            window.speechSynthesis.cancel(); // stop any other voices
            
            // Clear any outstanding phrase timeouts
            this.landingSpeechTimeouts.forEach(t => clearTimeout(t));
            this.landingSpeechTimeouts = [];

            const phrases = [
                { text: "Ow!", pause: 450, pitch: 1.15, rate: 1.1 },
                { text: "What the heck?", pause: 600, pitch: 1.05, rate: 0.95 },
                { text: "How did I get here?", pause: 550, pitch: 1.0, rate: 1.0 },
                { text: "Where am I?", pause: 650, pitch: 0.98, rate: 0.9 },
                { text: "What is this place?", pause: 0, pitch: 0.95, rate: 0.85 }
            ];

            let delay = 0;
            phrases.forEach((phrase) => {
                const timeoutId = setTimeout(() => {
                    if (!this.isInitialized) return;
                    try {
                        const utterance = new SpeechSynthesisUtterance(phrase.text);
                        const voices = window.speechSynthesis.getVoices();
                        
                        // Select best natural/English male or premium voice
                        let bestVoice = null;
                        for (const voice of voices) {
                            const name = voice.name.toLowerCase();
                            const lang = voice.lang.toLowerCase();
                            if (lang.includes('en') && !name.includes('zira') && (name.includes('natural') || name.includes('david') || name.includes('mark') || name.includes('microsoft') || name.includes('google') || name.includes('premium') || name.includes('male') || name.includes('hazel'))) {
                                bestVoice = voice;
                                break;
                            }
                        }
                        if (!bestVoice && voices.length > 0) {
                            bestVoice = voices.find(v => v.lang.toLowerCase().includes('en')) || voices[0];
                        }
                        if (bestVoice) {
                            utterance.voice = bestVoice;
                        }

                        utterance.pitch = phrase.pitch;
                        utterance.rate = phrase.rate;
                        utterance.volume = 1.0;

                        window.speechSynthesis.speak(utterance);
                    } catch (e) {
                        console.warn("Landing utterance failed:", e);
                    }
                }, delay);

                this.landingSpeechTimeouts.push(timeoutId);
                delay += phrase.pause + 1100; // speech duration approximation + custom pause gap
            });
        } catch (e) {
            console.warn("SpeechSynthesis landing monologue failed:", e);
        }
    }

    /**
     * Speaks the panicked survivor cry for help using SpeechSynthesis.
     * Splits into dramatic individual phrases: "Help me! ... I need help! ... It's coming!"
     */
    playSurvivorSpeech() {
        if (!window.speechSynthesis) return;
        try {
            window.speechSynthesis.cancel();
            
            // Clear outstanding survivor timeouts
            this.survivorSpeechTimeouts.forEach(t => clearTimeout(t));
            this.survivorSpeechTimeouts = [];

            // Low sub-bass horror drone to accompany the voice line dramatically
            const now = this.ctx ? this.ctx.currentTime : 0;
            if (this.ctx) {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(70, now);
                osc.frequency.linearRampToValueAtTime(35, now + 2.5);
                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.35, now + 0.4);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);
                osc.connect(gain);
                gain.connect(this.masterVolume);
                osc.start(now);
                osc.stop(now + 3.1);
            }

            const phrases = [
                { text: "Help me!", pause: 400, pitch: 1.2, rate: 1.2 },
                { text: "I need help!", pause: 450, pitch: 1.15, rate: 1.15 },
                { text: "It's coming!", pause: 0, pitch: 1.25, rate: 1.3 }
            ];

            let delay = 0;
            phrases.forEach((phrase) => {
                const timeoutId = setTimeout(() => {
                    if (!this.isInitialized) return;
                    try {
                        const utterance = new SpeechSynthesisUtterance(phrase.text);
                        const voices = window.speechSynthesis.getVoices();
                        
                        // Select English voice
                        let bestVoice = null;
                        for (const voice of voices) {
                            const name = voice.name.toLowerCase();
                            const lang = voice.lang.toLowerCase();
                            if (lang.includes('en') && (name.includes('natural') || name.includes('google') || name.includes('microsoft') || name.includes('david') || name.includes('zira') || name.includes('hazel'))) {
                                bestVoice = voice;
                                break;
                            }
                        }
                        if (!bestVoice && voices.length > 0) {
                            bestVoice = voices.find(v => v.lang.toLowerCase().includes('en')) || voices[0];
                        }
                        if (bestVoice) {
                            utterance.voice = bestVoice;
                        }

                        utterance.pitch = phrase.pitch;
                        utterance.rate = phrase.rate;
                        utterance.volume = 1.0;

                        window.speechSynthesis.speak(utterance);
                    } catch (e) {
                        console.warn("Survivor utterance failed:", e);
                    }
                }, delay);

                this.survivorSpeechTimeouts.push(timeoutId);
                delay += phrase.pause + 900;
            });
        } catch (e) {
            console.warn("SpeechSynthesis survivor speech failed:", e);
        }
    }

    /**
     * Sets the active panic level, speeding up the heartbeat dynamically
     */
    setPanicLevel(level) {
        this.panicLevel = Math.max(0.0, Math.min(1.0, level));
    }

    /**
     * Stop and cleanup all audio processes
     */
    stop() {
        clearTimeout(this.heartbeatTimer);
        clearTimeout(this.scareTimer);
        
        // Clear all active SpeechSynthesis phrase timeouts to prevent leaks on reset
        this.landingSpeechTimeouts.forEach(t => clearTimeout(t));
        this.landingSpeechTimeouts = [];
        this.survivorSpeechTimeouts.forEach(t => clearTimeout(t));
        this.survivorSpeechTimeouts = [];

        this.stopFallingWind();
        if (this.ctx) {
            this.ctx.close();
            this.ctx = null;
        }
        this.isInitialized = false;
    }
}
