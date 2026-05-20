/**
 * RendererEngine - Manages Three.js WebGL scene renders, camera setups,
 * and executes a high-fidelity retro VHS found-footage screen shader using
 * custom render targets. Avoids external post-processing package dependencies.
 */

export class RendererEngine {
    constructor() {
        this.container = document.getElementById('game-container');
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Custom post-processing elements
        this.postScene = null;
        this.postCamera = null;
        this.renderTarget = null;
        this.postMaterial = null;
        this.postQuad = null;

        this.initCore();
        this.initPostProcessing();
        
        window.addEventListener('resize', () => this.handleResize());
    }

    /**
     * Initializes the core Three.js scene, camera, and renderer
     */
    initCore() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0a05, 0.12); // Thick, yellow-tinted dark fog for claustrophobic feel

        // Camera - Perspective (75 degree horizontal field of view)
        this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 1000);

        // Calculate a restricted retro drawing buffer height to completely eliminate Retina/4K fill-rate GPU lag
        const targetHeight = 540;
        if (this.height > targetHeight) {
            const scale = targetHeight / this.height;
            this.width = Math.max(320, Math.floor(this.width * scale));
            this.height = targetHeight;
        }

        // Renderer (antialias: false for authentic sharp pixelated retro scaling and extra speed)
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: false, 
            powerPreference: "high-performance" 
        });
        // We set updateStyle = false so Three.js adjusts the internal canvas dimensions without resizing the HTML element
        this.renderer.setSize(this.width, this.height, false);
        this.renderer.setPixelRatio(1.0); 
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap; 
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        // Attach canvas
        this.container.appendChild(this.renderer.domElement);
    }

    /**
     * Set up full-screen quad VHS post-processing using a custom GLSL ShaderMaterial
     */
    initPostProcessing() {
        // 1. Create secondary scene and orthographic camera to render the full screen quad
        this.postScene = new THREE.Scene();
        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // 2. Create the WebGLRenderTarget that our primary 3D game scene renders into
        this.renderTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat
        });

        // 3. VHS shader GLSL definition
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform sampler2D tDiffuse;
            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uPanic; // Panic level (0.0 to 1.0)
            varying vec2 vUv;

            // Simple pseudo-random static generator
            float rand(vec2 co) {
                return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
            }

            void main() {
                vec2 uv = vUv;
                float panicFactor = uPanic;

                // A. VHS Tracking Line Distortion & Horizontal Glitch Jitter
                // Triggered at random horizontal stripes, and increases as panic goes up
                float jitter = 0.0;
                float tick = uTime * 8.0;

                // Base tracking noise jitter band
                float trackingVal = sin(uv.y * 3.0 - tick * 0.5) * cos(uv.y * 8.0 + tick);
                if (trackingVal > 0.95) {
                    jitter = (rand(vec2(uTime, uv.y)) - 0.5) * 0.015;
                }

                // Add monster-proximity glitch coordinates warping
                if (panicFactor > 0.1) {
                    float panicWarp = sin(uv.y * 40.0 + uTime * 30.0) * cos(uv.y * 10.0 - uTime * 15.0);
                    if (panicWarp > (1.2 - panicFactor * 0.9)) {
                        jitter += (rand(vec2(uTime * 5.0, uv.y * 10.0)) - 0.5) * (0.005 + panicFactor * 0.045);
                    }
                }

                // Apply horizontal coordinate skew offset
                uv.x += jitter;

                // B. Chromatic Aberration (Radial Color Channel Shifting)
                // Color splits near edges, expanding heavily during monster presence
                float distFromCenter = length(uv - 0.5);
                float splitAmount = 0.003 + (distFromCenter * 0.006) + (panicFactor * 0.025);

                float colR = texture2D(tDiffuse, vec2(uv.x - splitAmount, uv.y)).r;
                float colG = texture2D(tDiffuse, uv).g;
                float colB = texture2D(tDiffuse, vec2(uv.x + splitAmount, uv.y)).b;
                
                vec3 finalColor = vec3(colR, colG, colB);

                // C. Horizontal VHS Scanlines Overlay
                float scanline = sin(uv.y * uResolution.y * 1.5) * 0.04;
                finalColor -= scanline;

                // D. VHS Film Grain Static Noise
                float noise = (rand(uv + uTime) - 0.5) * 0.06;
                // Add stronger dynamic snow noise when monster is close
                if (panicFactor > 0.5) {
                    noise += (rand(uv * 2.0 - uTime * 10.0) - 0.5) * (panicFactor * 0.2);
                }
                finalColor += vec3(noise);

                // E. Color Grading (Security Cam washouts and yellow-green tint)
                // Desaturate colors
                float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
                finalColor = mix(finalColor, vec3(gray), 0.35); // wash out by 35%

                // Inject nostalgic Backrooms tint (warm yellow/green hue)
                finalColor.r *= 1.05;
                finalColor.g *= 1.03;
                finalColor.b *= 0.90;

                // F. Vignette (Darkening towards viewport corners)
                float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
                vignette = clamp(pow(16.0 * vignette, 0.4), 0.0, 1.0);
                finalColor *= vignette;

                // G. Sudden full frame glitch flashing when panic is maximum
                if (panicFactor > 0.8) {
                    float flash = rand(vec2(uTime, 0.0));
                    if (flash > (1.9 - panicFactor)) {
                        // Invert colors or flash green
                        finalColor = 1.0 - finalColor;
                    }
                }

                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        // 4. Instantiate custom ShaderMaterial
        this.postMaterial = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                tDiffuse: { value: null },
                uTime: { value: 0.0 },
                uResolution: { value: new THREE.Vector2(this.width, this.height) },
                uPanic: { value: 0.0 }
            }
        });

        // 5. Create full-screen mesh and render it in our screen space scene
        this.postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
        this.postScene.add(this.postQuad);
    }

    /**
     * Performs standard aspect ratio resizing operations
     */
    handleResize() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Core camera aspect ratio should match screen viewport aspect ratio
        this.camera.aspect = screenWidth / screenHeight;
        this.camera.updateProjectionMatrix();

        // Calculate scaled down retro resolution
        const targetHeight = 540;
        let scaledWidth = screenWidth;
        let scaledHeight = screenHeight;

        if (screenHeight > targetHeight) {
            const scale = targetHeight / screenHeight;
            scaledWidth = Math.max(320, Math.floor(screenWidth * scale));
            scaledHeight = targetHeight;
        }

        this.width = scaledWidth;
        this.height = scaledHeight;

        // Set renderer size (updateStyle = false so CSS handles scaling)
        this.renderer.setSize(this.width, this.height, false);

        // Update render target size
        this.renderTarget.setSize(this.width, this.height);

        // Update shader uniforms
        this.postMaterial.uniforms.uResolution.value.set(this.width, this.height);
    }

    /**
     * Executes double-pass rendering: 3D scene -> RenderTarget -> Full-screen Quad Shader -> Canvas
     */
    render(time, panic = 0.0) {
        // Pass 1: Render realistic 3D game scene onto the WebGLRenderTarget
        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.render(this.scene, this.camera);

        // Update shader variables
        this.postMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
        this.postMaterial.uniforms.uTime.value = time;
        this.postMaterial.uniforms.uPanic.value = panic;

        // Pass 2: Draw the processed quad image onto the direct HTML viewport canvas
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.postScene, this.postCamera);
    }
}
