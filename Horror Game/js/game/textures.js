/**
 * TextureGenerator - Generates high-fidelity procedural textures
 * and standard tangent-space normal maps for the Backrooms.
 * Uses vanilla HTML Canvas APIs to produce realistic repeating textures.
 */

export class TextureGenerator {
    constructor() {
        // Shared parameters for wrapping textures
        this.size = 512; // 512x512 textures are great for performance & memory
    }

    /**
     * Helper to convert an HTML Canvas into a Three.js CanvasTexture
     */
    createThreeTexture(canvas, repeatX = 1, repeatY = 1) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeatX, repeatY);
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    /**
     * Generates a 2D heightmap array from canvas pixel grayscale values
     * to compute normal vectors for bump/normal mapping.
     */
    generateNormalMapFromHeightmap(heightCanvas, strength = 1.5) {
        const width = heightCanvas.width;
        const height = heightCanvas.height;
        const ctx = heightCanvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, width, height);
        const pixels = imgData.data;

        // Create normal map canvas
        const normalCanvas = document.createElement('canvas');
        normalCanvas.width = width;
        normalCanvas.height = height;
        const normalCtx = normalCanvas.getContext('2d');
        const normalData = normalCtx.createImageData(width, height);
        const normalPixels = normalData.data;

        // Grayscale helper
        const getHeight = (x, y) => {
            // Handle wrapping boundary checks
            const wrapX = (x + width) % width;
            const wrapY = (y + height) % height;
            const idx = (wrapY * width + wrapX) * 4;
            // Return brightness (R + G + B) / 3
            return (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3.0 / 255.0;
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Sobel/Central differences for height slopes
                const hL = getHeight(x - 1, y);
                const hR = getHeight(x + 1, y);
                const hU = getHeight(x, y - 1);
                const hD = getHeight(x, y + 1);

                // Compute normal vector elements
                // Red = X normal, Green = Y normal, Blue = Z normal (facing outward)
                const nx = (hL - hR) * strength;
                const ny = (hU - hD) * strength;
                const nz = 1.0;

                // Normalize vector [nx, ny, nz]
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                const r = (nx / len) * 0.5 + 0.5;
                const g = (ny / len) * 0.5 + 0.5;
                const b = (nz / len) * 0.5 + 0.5;

                const idx = (y * width + x) * 4;
                normalPixels[idx] = Math.floor(r * 255);     // Red
                normalPixels[idx + 1] = Math.floor(g * 255); // Green
                normalPixels[idx + 2] = Math.floor(b * 255); // Blue
                normalPixels[idx + 3] = 255;                 // Alpha
            }
        }

        normalCtx.putImageData(normalData, 0, 0);
        return normalCanvas;
    }

    /**
     * 1. WALL TEXTURE - Eerie, dirty yellow/beige wallpaper with vertical stripes
     */
    getWallTextures() {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Heightmap canvas for Wall Normal Map
        const heightCanvas = document.createElement('canvas');
        heightCanvas.width = this.size;
        heightCanvas.height = this.size;
        const hCtx = heightCanvas.getContext('2d');

        // Fill background with dull beige-yellow
        ctx.fillStyle = '#c5b57d';
        ctx.fillRect(0, 0, this.size, this.size);

        // Fill heightmap background with neutral flat grey
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, this.size, this.size);

        // A. Draw vertical wallpaper stripes
        const stripeWidth = 8;
        const stripeSpacing = 24;
        
        ctx.fillStyle = '#a69660'; // Darker stripe color
        hCtx.fillStyle = '#656565'; // Lower height for stripe recesses

        for (let x = 0; x < this.size; x += stripeSpacing) {
            ctx.fillRect(x, 0, stripeWidth, this.size);
            hCtx.fillRect(x, 0, stripeWidth, this.size);
        }

        // B. Add fine-grained plaster noise
        const imgData = ctx.getImageData(0, 0, this.size, this.size);
        const pixels = imgData.data;
        const hImgData = hCtx.getImageData(0, 0, this.size, this.size);
        const hPixels = hImgData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            // High frequency plaster noise
            const noise = (Math.random() - 0.5) * 14;
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + noise));
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + noise));

            // Map plaster noise to heightmap
            hPixels[i] = Math.max(0, Math.min(255, hPixels[i] + noise * 1.5));
            hPixels[i + 1] = Math.max(0, Math.min(255, hPixels[i + 1] + noise * 1.5));
            hPixels[i + 2] = Math.max(0, Math.min(255, hPixels[i + 2] + noise * 1.5));
        }
        ctx.putImageData(imgData, 0, 0);
        hCtx.putImageData(hImgData, 0, 0);

        // C. Draw dirty water-damage spots and mold (Diffuse only)
        // Add random splotches of dirt/grime
        ctx.fillStyle = 'rgba(75, 60, 35, 0.25)'; // Dirt color
        for (let i = 0; i < 6; i++) {
            const rx = Math.random() * this.size;
            const ry = Math.random() * this.size;
            const rSize = 30 + Math.random() * 50;

            const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rSize);
            grad.addColorStop(0, 'rgba(65, 50, 25, 0.4)');
            grad.addColorStop(0.5, 'rgba(80, 70, 45, 0.2)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(rx, ry, rSize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Generate normal canvas
        const normalCanvas = this.generateNormalMapFromHeightmap(heightCanvas, 2.5);

        return {
            diffuse: this.createThreeTexture(canvas, 1, 1),
            normal: this.createThreeTexture(normalCanvas, 1, 1)
        };
    }

    /**
     * 2. CARPET TEXTURE - Wet, dirty, organic brown-yellow fabric pile
     */
    getCarpetTextures() {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        const heightCanvas = document.createElement('canvas');
        heightCanvas.width = this.size;
        heightCanvas.height = this.size;
        const hCtx = heightCanvas.getContext('2d');

        // Fill background with carpet beige-brown
        ctx.fillStyle = '#8c7645';
        ctx.fillRect(0, 0, this.size, this.size);

        // Fill heightmap background
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, this.size, this.size);

        // Draw dense procedural noise to simulate thick carpet pile fibers
        const imgData = ctx.getImageData(0, 0, this.size, this.size);
        const pixels = imgData.data;
        const hImgData = hCtx.getImageData(0, 0, this.size, this.size);
        const hPixels = hImgData.data;

        // Apply dynamic high frequency noise to create texture depth
        for (let i = 0; i < pixels.length; i += 4) {
            // Carpet pile fiber noise
            const fiberNoise = (Math.random() - 0.5) * 45;
            
            // Apply brown-yellow shifting
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + fiberNoise));       // Red
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + fiberNoise * 0.9)); // Green
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + fiberNoise * 0.6)); // Blue

            // Map fiber heights
            const heightVal = 128 + fiberNoise * 2.0;
            hPixels[i] = Math.max(0, Math.min(255, heightVal));
            hPixels[i + 1] = Math.max(0, Math.min(255, heightVal));
            hPixels[i + 2] = Math.max(0, Math.min(255, heightVal));
        }
        ctx.putImageData(imgData, 0, 0);
        hCtx.putImageData(hImgData, 0, 0);

        // Draw dark fluid/mold damage splotches (representing "moist carpet" dampness)
        for (let i = 0; i < 8; i++) {
            const rx = Math.random() * this.size;
            const ry = Math.random() * this.size;
            const rSize = 40 + Math.random() * 70;

            const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rSize);
            grad.addColorStop(0, 'rgba(45, 36, 18, 0.7)'); // Very damp wet spot
            grad.addColorStop(0.6, 'rgba(55, 46, 25, 0.35)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(rx, ry, rSize, 0, Math.PI * 2);
            ctx.fill();

            // Lower height slightly in wet spots (representing matted wet carpet)
            const hGrad = hCtx.createRadialGradient(rx, ry, 0, rx, ry, rSize);
            hGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
            hGrad.addColorStop(1, 'rgba(0,0,0,0)');
            hCtx.fillStyle = hGrad;
            hCtx.beginPath();
            hCtx.arc(rx, ry, rSize, 0, Math.PI * 2);
            hCtx.fill();
        }

        // Generate normal mapping (highly detailed for bumpy carpet fabric pile)
        const normalCanvas = this.generateNormalMapFromHeightmap(heightCanvas, 3.5);

        return {
            diffuse: this.createThreeTexture(canvas, 2, 2), // Tiled 2x2 for detail
            normal: this.createThreeTexture(normalCanvas, 2, 2)
        };
    }

    /**
     * 3. CEILING TEXTURE - Acoustic tiles grid with dark pits/speckles
     */
    getCeilingTextures() {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        const heightCanvas = document.createElement('canvas');
        heightCanvas.width = this.size;
        heightCanvas.height = this.size;
        const hCtx = heightCanvas.getContext('2d');

        // Fill background with off-white/grey ceiling tile color
        ctx.fillStyle = '#b0b0a5';
        ctx.fillRect(0, 0, this.size, this.size);

        // Fill heightmap background with light neutral flat gray
        hCtx.fillStyle = '#cccccc';
        hCtx.fillRect(0, 0, this.size, this.size);

        // Draw grid lines separating panels
        ctx.strokeStyle = '#6e6e60';
        ctx.lineWidth = 4;
        
        hCtx.strokeStyle = '#303030'; // Dark lines represent deep cracks
        hCtx.lineWidth = 4;

        // Draw outer borders
        ctx.strokeRect(0, 0, this.size, this.size);
        hCtx.strokeRect(0, 0, this.size, this.size);

        // Add acoustic tile fine texture speckles and pits
        const imgData = ctx.getImageData(0, 0, this.size, this.size);
        const pixels = imgData.data;
        const hImgData = hCtx.getImageData(0, 0, this.size, this.size);
        const hPixels = hImgData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            // General noise
            const noise = (Math.random() - 0.5) * 10;
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + noise));
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + noise));

            hPixels[i] = Math.max(0, Math.min(255, hPixels[i] + noise * 1.2));
            hPixels[i + 1] = Math.max(0, Math.min(255, hPixels[i + 1] + noise * 1.2));
            hPixels[i + 2] = Math.max(0, Math.min(255, hPixels[i + 2] + noise * 1.2));

            // Acoustic tile PITS: draw small dark crater speckles randomly
            if (Math.random() < 0.015) {
                const pitDepth = 40 + Math.floor(Math.random() * 50);
                
                // Diffuse: make it dark grey
                pixels[i] = Math.max(20, pixels[i] - pitDepth);
                pixels[i + 1] = Math.max(20, pixels[i + 1] - pitDepth);
                pixels[i + 2] = Math.max(20, pixels[i + 2] - pitDepth);

                // Heightmap: make it a deep pit
                hPixels[i] = Math.max(10, hPixels[i] - pitDepth * 2);
                hPixels[i + 1] = Math.max(10, hPixels[i + 1] - pitDepth * 2);
                hPixels[i + 2] = Math.max(10, hPixels[i + 2] - pitDepth * 2);
            }
        }
        ctx.putImageData(imgData, 0, 0);
        hCtx.putImageData(hImgData, 0, 0);

        // Generate normal map (rough acoustics, grid seams)
        const normalCanvas = this.generateNormalMapFromHeightmap(heightCanvas, 2.0);

        return {
            diffuse: this.createThreeTexture(canvas, 1, 1),
            normal: this.createThreeTexture(normalCanvas, 1, 1)
        };
    }

    /**
     * 4. WAREHOUSE WALL TEXTURE - Cracked grey concrete brick walls with dark stains
     */
    getWarehouseWallTextures() {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        const heightCanvas = document.createElement('canvas');
        heightCanvas.width = this.size;
        heightCanvas.height = this.size;
        const hCtx = heightCanvas.getContext('2d');

        // Dark grey concrete base
        ctx.fillStyle = '#424242';
        ctx.fillRect(0, 0, this.size, this.size);

        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, this.size, this.size);

        // Draw concrete blocks/brick lines
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 6;
        hCtx.strokeStyle = '#3a3a3a';
        hCtx.lineWidth = 6;

        const rows = 4;
        const cols = 2;
        const rowH = this.size / rows;
        const colW = this.size / cols;

        for (let r = 0; r <= rows; r++) {
            const y = r * rowH;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.size, y); ctx.stroke();
            hCtx.beginPath(); hCtx.moveTo(0, y); hCtx.lineTo(this.size, y); hCtx.stroke();
        }
        for (let r = 0; r < rows; r++) {
            const y = r * rowH;
            const xOffset = (r % 2) * (colW / 2);
            for (let c = 0; c <= cols + 1; c++) {
                const x = c * colW - xOffset;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
                hCtx.beginPath(); hCtx.moveTo(x, y); hCtx.lineTo(x, y + rowH); hCtx.stroke();
            }
        }

        // Add concrete texture noise and cracks
        const imgData = ctx.getImageData(0, 0, this.size, this.size);
        const pixels = imgData.data;
        const hImgData = hCtx.getImageData(0, 0, this.size, this.size);
        const hPixels = hImgData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            const noise = (Math.random() - 0.5) * 22;
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + noise));
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + noise));

            hPixels[i] = Math.max(0, Math.min(255, hPixels[i] + noise * 1.5));
            hPixels[i + 1] = Math.max(0, Math.min(255, hPixels[i + 1] + noise * 1.5));
            hPixels[i + 2] = Math.max(0, Math.min(255, hPixels[i + 2] + noise * 1.5));
        }
        ctx.putImageData(imgData, 0, 0);
        hCtx.putImageData(hImgData, 0, 0);

        // Add cracks on wall
        ctx.strokeStyle = '#2b2b2b';
        ctx.lineWidth = 1.5;
        hCtx.strokeStyle = '#1a1a1a';
        hCtx.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) {
            let cx = Math.random() * this.size;
            let cy = Math.random() * this.size;
            ctx.beginPath();
            hCtx.beginPath();
            ctx.moveTo(cx, cy);
            hCtx.moveTo(cx, cy);
            for (let s = 0; s < 5; s++) {
                cx += (Math.random() - 0.5) * 30;
                cy += (Math.random() - 0.1) * 30; // downward trend
                ctx.lineTo(cx, cy);
                hCtx.lineTo(cx, cy);
            }
            ctx.stroke();
            hCtx.stroke();
        }

        // Add dark stains / water damage mold splotches
        for (let i = 0; i < 5; i++) {
            const rx = Math.random() * this.size;
            const ry = Math.random() * this.size;
            const rSize = 40 + Math.random() * 60;
            const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rSize);
            grad.addColorStop(0, 'rgba(25, 25, 20, 0.65)');
            grad.addColorStop(0.5, 'rgba(35, 35, 30, 0.35)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(rx, ry, rSize, 0, Math.PI * 2); ctx.fill();
        }

        const normalCanvas = this.generateNormalMapFromHeightmap(heightCanvas, 2.0);

        return {
            diffuse: this.createThreeTexture(canvas, 1.1, 1.1),
            normal: this.createThreeTexture(normalCanvas, 1.1, 1.1)
        };
    }

    /**
     * 5. WAREHOUSE FLOOR TEXTURE - Dirty, stained concrete slabs
     */
    getWarehouseFloorTextures() {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        const heightCanvas = document.createElement('canvas');
        heightCanvas.width = this.size;
        heightCanvas.height = this.size;
        const hCtx = heightCanvas.getContext('2d');

        // Dark concrete color base
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(0, 0, this.size, this.size);

        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, this.size, this.size);

        // Draw 2x2 concrete slab grid seams
        ctx.strokeStyle = '#1e1e1e';
        ctx.lineWidth = 5;
        hCtx.strokeStyle = '#222222';
        hCtx.lineWidth = 5;
        
        ctx.strokeRect(0, 0, this.size, this.size);
        hCtx.strokeRect(0, 0, this.size, this.size);
        
        ctx.beginPath(); ctx.moveTo(this.size / 2, 0); ctx.lineTo(this.size / 2, this.size); ctx.stroke();
        hCtx.beginPath(); hCtx.moveTo(this.size / 2, 0); hCtx.lineTo(this.size / 2, this.size); hCtx.stroke();
        
        ctx.beginPath(); ctx.moveTo(0, this.size / 2); ctx.lineTo(this.size, this.size / 2); ctx.stroke();
        hCtx.beginPath(); hCtx.moveTo(0, this.size / 2); hCtx.lineTo(this.size, this.size / 2); hCtx.stroke();

        // Noise
        const imgData = ctx.getImageData(0, 0, this.size, this.size);
        const pixels = imgData.data;
        const hImgData = hCtx.getImageData(0, 0, this.size, this.size);
        const hPixels = hImgData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            const noise = (Math.random() - 0.5) * 30;
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + noise * 0.95));
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + noise * 0.9));

            hPixels[i] = Math.max(0, Math.min(255, hPixels[i] + noise * 1.5));
            hPixels[i + 1] = Math.max(0, Math.min(255, hPixels[i + 1] + noise * 1.5));
            hPixels[i + 2] = Math.max(0, Math.min(255, hPixels[i + 2] + noise * 1.5));
        }
        ctx.putImageData(imgData, 0, 0);
        hCtx.putImageData(hImgData, 0, 0);

        // Heavy dark water/oil spill stains
        for (let i = 0; i < 4; i++) {
            const rx = Math.random() * this.size;
            const ry = Math.random() * this.size;
            const rSize = 50 + Math.random() * 80;
            const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rSize);
            grad.addColorStop(0, 'rgba(15, 12, 8, 0.75)');
            grad.addColorStop(0.6, 'rgba(25, 20, 15, 0.35)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(rx, ry, rSize, 0, Math.PI * 2); ctx.fill();
        }

        const normalCanvas = this.generateNormalMapFromHeightmap(heightCanvas, 2.5);

        return {
            diffuse: this.createThreeTexture(canvas, 1, 1),
            normal: this.createThreeTexture(normalCanvas, 1, 1)
        };
    }

    /**
     * 6. WAREHOUSE CEILING TEXTURE - Dark corrugated iron/steel sheets
     */
    getWarehouseCeilingTextures() {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        const heightCanvas = document.createElement('canvas');
        heightCanvas.width = this.size;
        heightCanvas.height = this.size;
        const hCtx = heightCanvas.getContext('2d');

        // Draw vertical repeating linear gradients simulating metal corrugations
        const stripeW = 32;
        for (let x = 0; x < this.size; x += stripeW) {
            // Diffuse gradient
            const grad = ctx.createLinearGradient(x, 0, x + stripeW, 0);
            grad.addColorStop(0, '#1c1c1e');
            grad.addColorStop(0.3, '#2a2a2d');
            grad.addColorStop(0.5, '#3b3b40');
            grad.addColorStop(0.7, '#2a2a2d');
            grad.addColorStop(1, '#1c1c1e');

            ctx.fillStyle = grad;
            ctx.fillRect(x, 0, stripeW, this.size);

            // Heightmap gradient
            const hGrad = hCtx.createLinearGradient(x, 0, x + stripeW, 0);
            hGrad.addColorStop(0, '#303030');
            hGrad.addColorStop(0.5, '#b0b0b0');
            hGrad.addColorStop(1, '#303030');

            hCtx.fillStyle = hGrad;
            hCtx.fillRect(x, 0, stripeW, this.size);
        }

        // Add rust stains
        ctx.fillStyle = 'rgba(78, 56, 40, 0.35)'; // Rust brown
        for (let i = 0; i < 5; i++) {
            const rx = Math.random() * this.size;
            const ry = Math.random() * this.size;
            const rSize = 25 + Math.random() * 40;
            const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rSize);
            grad.addColorStop(0, 'rgba(85, 60, 42, 0.5)');
            grad.addColorStop(0.7, 'rgba(68, 48, 32, 0.2)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(rx, ry, rSize, 0, Math.PI * 2); ctx.fill();
        }

        const normalCanvas = this.generateNormalMapFromHeightmap(heightCanvas, 3.0);

        return {
            diffuse: this.createThreeTexture(canvas, 1, 1),
            normal: this.createThreeTexture(normalCanvas, 1, 1)
        };
    }

    /**
     * 7. WOOD CRATE TEXTURE - Classic shipping wooden crate paneling
     */
    getCrateTextures() {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        const heightCanvas = document.createElement('canvas');
        heightCanvas.width = this.size;
        heightCanvas.height = this.size;
        const hCtx = heightCanvas.getContext('2d');

        // Warm wood brown base
        ctx.fillStyle = '#6b4e31';
        ctx.fillRect(0, 0, this.size, this.size);

        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, this.size, this.size);

        // Draw thick outer wood frame
        const fW = 40; // frame width
        ctx.fillStyle = '#523b24';
        ctx.fillRect(0, 0, this.size, fW); // Top
        ctx.fillRect(0, this.size - fW, this.size, fW); // Bottom
        ctx.fillRect(0, 0, fW, this.size); // Left
        ctx.fillRect(this.size - fW, 0, fW, this.size); // Right

        // Heightmap frame (raised wood frame)
        hCtx.fillStyle = '#b0b0b0';
        hCtx.fillRect(0, 0, this.size, fW);
        hCtx.fillRect(0, this.size - fW, this.size, fW);
        hCtx.fillRect(0, 0, fW, this.size);
        hCtx.fillRect(this.size - fW, 0, fW, this.size);

        // Draw "X" cross-brace in center
        ctx.strokeStyle = '#523b24';
        ctx.lineWidth = fW;
        ctx.beginPath();
        ctx.moveTo(fW, fW);
        ctx.lineTo(this.size - fW, this.size - fW);
        ctx.moveTo(this.size - fW, fW);
        ctx.lineTo(fW, this.size - fW);
        ctx.stroke();

        hCtx.strokeStyle = '#a6a6a6';
        hCtx.lineWidth = fW;
        hCtx.beginPath();
        hCtx.moveTo(fW, fW);
        hCtx.lineTo(this.size - fW, this.size - fW);
        hCtx.moveTo(this.size - fW, fW);
        hCtx.lineTo(fW, this.size - fW);
        hCtx.stroke();

        // Draw recessed planks behind the braces (subtle black vertical lines)
        ctx.strokeStyle = '#352516';
        ctx.lineWidth = 4;
        hCtx.strokeStyle = '#404040';
        hCtx.lineWidth = 4;
        
        const numPlanks = 6;
        const pW = this.size / numPlanks;
        for (let i = 1; i < numPlanks; i++) {
            const px = i * pW;
            ctx.beginPath(); ctx.moveTo(px, fW); ctx.lineTo(px, this.size - fW); ctx.stroke();
            hCtx.beginPath(); hCtx.moveTo(px, fW); hCtx.lineTo(px, this.size - fW); hCtx.stroke();
        }

        // Add fine wood-grain noise
        const imgData = ctx.getImageData(0, 0, this.size, this.size);
        const pixels = imgData.data;
        const hImgData = hCtx.getImageData(0, 0, this.size, this.size);
        const hPixels = hImgData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            const noise = (Math.random() - 0.5) * 16;
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + noise * 0.9));
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + noise * 0.8));

            hPixels[i] = Math.max(0, Math.min(255, hPixels[i] + noise * 1.2));
            hPixels[i + 1] = Math.max(0, Math.min(255, hPixels[i + 1] + noise * 1.2));
            hPixels[i + 2] = Math.max(0, Math.min(255, hPixels[i + 2] + noise * 1.2));
        }
        ctx.putImageData(imgData, 0, 0);
        hCtx.putImageData(hImgData, 0, 0);

        const normalCanvas = this.generateNormalMapFromHeightmap(heightCanvas, 3.0);

        return {
            diffuse: this.createThreeTexture(canvas, 1, 1),
            normal: this.createThreeTexture(normalCanvas, 1, 1)
        };
    }
}

