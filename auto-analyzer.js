/**
 * CineGrade Auto Analyzer
 *
 * Analyzes video frames to determine optimal color grading parameters.
 * Samples multiple frames, computes luminance histogram, color temperature,
 * saturation levels, dynamic range, and dominant colors to automatically
 * select and fine-tune the best cinematic look.
 */

class AutoAnalyzer {
    constructor() {
        this.analysisCanvas = document.createElement('canvas');
        this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
    }

    /**
     * Analyze a video and return optimal grading parameters.
     * @param {HTMLVideoElement} video
     * @param {function} onProgress - callback(progress 0-1, message)
     * @returns {Promise<object>} optimal params
     */
    async analyze(video, onProgress = () => {}) {
        const duration = video.duration;
        // Sample 8 frames spread across the video (skip first/last 5%)
        const numSamples = 8;
        const start = duration * 0.05;
        const end = duration * 0.95;
        const step = (end - start) / (numSamples - 1);

        const frameStats = [];

        for (let i = 0; i < numSamples; i++) {
            const time = start + step * i;
            onProgress(i / numSamples, `Analizando frame ${i + 1}/${numSamples}...`);

            await this._seekTo(video, time);
            const stats = this._analyzeFrame(video);
            frameStats.push(stats);
        }

        onProgress(0.9, 'Calculando grade óptimo...');

        // Aggregate stats across all sampled frames
        const aggregated = this._aggregateStats(frameStats);

        // Determine optimal grading based on analysis
        const params = this._computeOptimalGrade(aggregated);

        onProgress(1.0, 'Análisis completo');

        return params;
    }

    _seekTo(video, time) {
        return new Promise((resolve) => {
            video.currentTime = time;
            video.addEventListener('seeked', resolve, { once: true });
        });
    }

    _analyzeFrame(video) {
        const w = Math.min(video.videoWidth, 480); // Downscale for speed
        const h = Math.round((w / video.videoWidth) * video.videoHeight);
        this.analysisCanvas.width = w;
        this.analysisCanvas.height = h;
        this.analysisCtx.drawImage(video, 0, 0, w, h);

        const imageData = this.analysisCtx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const pixelCount = w * h;

        // Histograms
        const histR = new Float32Array(256);
        const histG = new Float32Array(256);
        const histB = new Float32Array(256);
        const histLum = new Float32Array(256);

        let totalR = 0, totalG = 0, totalB = 0;
        let totalLum = 0;
        let totalSat = 0;
        let minLum = 255, maxLum = 0;

        // Color accumulation for dominant color detection
        const colorBuckets = {}; // hue buckets (0-35, each 10 degrees)

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            histR[r]++;
            histG[g]++;
            histB[b]++;

            const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
            histLum[lum]++;

            totalR += r;
            totalG += g;
            totalB += b;
            totalLum += lum;

            if (lum < minLum) minLum = lum;
            if (lum > maxLum) maxLum = lum;

            // Saturation (simple: max - min of RGB)
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
            totalSat += sat;

            // Hue bucket (for dominant color)
            if (maxC - minC > 15) { // Only count somewhat saturated pixels
                let hue;
                const d = maxC - minC;
                if (maxC === r) hue = ((g - b) / d + 6) % 6;
                else if (maxC === g) hue = (b - r) / d + 2;
                else hue = (r - g) / d + 4;
                const hueDeg = Math.round(hue * 60);
                const bucket = Math.floor(hueDeg / 10) % 36;
                colorBuckets[bucket] = (colorBuckets[bucket] || 0) + 1;
            }
        }

        const avgR = totalR / pixelCount;
        const avgG = totalG / pixelCount;
        const avgB = totalB / pixelCount;
        const avgLum = totalLum / pixelCount;
        const avgSat = totalSat / pixelCount;

        // Dynamic range
        const dynamicRange = maxLum - minLum;

        // Percentile luminance (for shadow/highlight clipping detection)
        let cumLum = 0;
        let p5Lum = 0, p95Lum = 255;
        for (let i = 0; i < 256; i++) {
            cumLum += histLum[i];
            if (cumLum >= pixelCount * 0.05 && p5Lum === 0) p5Lum = i;
            if (cumLum >= pixelCount * 0.95) { p95Lum = i; break; }
        }

        // Find dominant hue bucket
        let dominantHueBucket = 0;
        let maxHueCount = 0;
        for (const [bucket, count] of Object.entries(colorBuckets)) {
            if (count > maxHueCount) {
                maxHueCount = count;
                dominantHueBucket = parseInt(bucket);
            }
        }

        // Color temperature estimation (warm vs cool)
        // Higher R relative to B = warmer
        const warmth = (avgR - avgB) / 128; // -1 to +1 roughly

        return {
            avgR: avgR / 255,
            avgG: avgG / 255,
            avgB: avgB / 255,
            avgLum: avgLum / 255,
            avgSat,
            dynamicRange: dynamicRange / 255,
            p5Lum: p5Lum / 255,
            p95Lum: p95Lum / 255,
            warmth,
            dominantHueBucket,
            dominantHueStrength: maxHueCount / pixelCount,
        };
    }

    _aggregateStats(frameStats) {
        const keys = Object.keys(frameStats[0]);
        const agg = {};
        for (const key of keys) {
            const values = frameStats.map(f => f[key]);
            agg[key] = values.reduce((a, b) => a + b, 0) / values.length;
        }

        // Also compute variance of luminance across frames (scene consistency)
        const lumValues = frameStats.map(f => f.avgLum);
        const lumMean = agg.avgLum;
        const lumVar = lumValues.reduce((sum, v) => sum + (v - lumMean) ** 2, 0) / lumValues.length;
        agg.lumVariance = lumVar;

        return agg;
    }

    _computeOptimalGrade(stats) {
        // LOG footage characteristics:
        // - avgLum is typically 0.3-0.5 (flat, mid-gray heavy)
        // - avgSat is very low (desaturated)
        // - dynamicRange is compressed

        // Start with a clean Rec.709 base
        const params = {
            exposure: 0,
            contrast: 1.1,
            highlights: 0,
            shadows: 0,
            temperature: 0,
            tint: 0,
            saturation: 1.0,
            vibrance: 0.1,
            liftR: 0, liftG: 0, liftB: 0,
            gammaR: 0, gammaG: 0, gammaB: 0,
            gainR: 1, gainG: 1, gainB: 1,
            grain: 0.015,
            vignette: 0.2,
            halation: 0.1,
            fade: 0.005,
            sharpen: 0.35,
        };

        // === 1. EXPOSURE CORRECTION ===
        // LOG footage is typically flat around 0.35-0.45
        // Target a post-grade average luminance around 0.4-0.5
        const targetLum = 0.42;
        if (stats.avgLum < 0.25) {
            // Very dark scene (night/indoor)
            params.exposure = Math.min(1.5, (targetLum - stats.avgLum) * 4);
        } else if (stats.avgLum > 0.55) {
            // Overexposed
            params.exposure = Math.max(-1.5, (targetLum - stats.avgLum) * 3);
        } else {
            // Normal LOG range
            params.exposure = (targetLum - stats.avgLum) * 2.5;
        }

        // === 2. CONTRAST ===
        // LOG has compressed dynamic range — we need to expand it
        if (stats.dynamicRange < 0.4) {
            // Very flat image — needs more contrast
            params.contrast = 1.35;
        } else if (stats.dynamicRange < 0.6) {
            // Normal LOG range
            params.contrast = 1.25;
        } else {
            // Already decent range
            params.contrast = 1.15;
        }

        // === 3. HIGHLIGHT & SHADOW RECOVERY ===
        // Protect highlights from clipping
        if (stats.p95Lum > 0.85) {
            params.highlights = -0.2;
        } else if (stats.p95Lum > 0.7) {
            params.highlights = -0.1;
        }

        // Lift shadows if they're too crushed
        if (stats.p5Lum < 0.05) {
            params.shadows = 0.1;
        } else if (stats.p5Lum < 0.15) {
            params.shadows = 0.05;
        }

        // === 4. COLOR TEMPERATURE ===
        // Correct any color cast and add slight cinematic warmth
        if (stats.warmth < -0.15) {
            // Image is too cool — warm it up
            params.temperature = Math.min(0.3, -stats.warmth * 0.6);
        } else if (stats.warmth > 0.15) {
            // Image is too warm — cool it slightly
            params.temperature = Math.max(-0.15, -stats.warmth * 0.3);
        } else {
            // Neutral — add very slight cinematic warmth
            params.temperature = 0.05;
        }

        // === 5. SATURATION ===
        // LOG footage is very desaturated
        if (stats.avgSat < 0.1) {
            // Very desaturated (typical LOG)
            params.saturation = 1.2;
            params.vibrance = 0.2;
        } else if (stats.avgSat < 0.2) {
            params.saturation = 1.1;
            params.vibrance = 0.15;
        } else {
            // Already somewhat saturated
            params.saturation = 1.0;
            params.vibrance = 0.1;
        }

        // === 6. SCENE-AWARE CINEMATIC LOOK ===
        // Choose a cinematic direction based on scene analysis

        const isNightScene = stats.avgLum < 0.25;
        const isGoldenHour = stats.warmth > 0.1 && stats.avgLum > 0.3;
        const isCoolScene = stats.warmth < -0.1;
        const isHighContrast = stats.dynamicRange > 0.65;
        const isLowSat = stats.avgSat < 0.08;

        if (isNightScene) {
            // Night/dark scene — cool shadows, slightly desaturated, moody
            params.liftR = -0.015;
            params.liftG = 0.0;
            params.liftB = 0.03;
            params.gammaR = 0.0;
            params.gammaG = 0.0;
            params.gammaB = 0.01;
            params.gainR = 0.97;
            params.gainG = 0.98;
            params.gainB = 1.04;
            params.vignette = 0.35;
            params.saturation *= 0.9;
            params.grain = 0.025;
            params.sceneName = 'Noche Cinematográfica';
        } else if (isGoldenHour) {
            // Golden hour — warm highlights, teal shadows (classic Hollywood)
            params.liftR = -0.01;
            params.liftG = 0.005;
            params.liftB = 0.03;
            params.gammaR = 0.02;
            params.gammaG = 0.005;
            params.gammaB = -0.01;
            params.gainR = 1.06;
            params.gainG = 1.0;
            params.gainB = 0.92;
            params.halation = 0.2;
            params.vignette = 0.25;
            params.sceneName = 'Golden Hour Cinematic';
        } else if (isCoolScene) {
            // Cool scene — lean into the blue, filmic
            params.liftR = -0.01;
            params.liftG = 0.01;
            params.liftB = 0.025;
            params.gammaR = 0.0;
            params.gammaG = 0.005;
            params.gammaB = 0.015;
            params.gainR = 0.96;
            params.gainG = 1.0;
            params.gainB = 1.05;
            params.temperature = Math.min(params.temperature, -0.05);
            params.sceneName = 'Cool Cinematic';
        } else if (isLowSat) {
            // Very flat/desaturated — go for Kodak film stock look
            params.liftR = 0.015;
            params.liftG = 0.005;
            params.liftB = -0.01;
            params.gammaR = 0.01;
            params.gammaG = 0.005;
            params.gammaB = -0.005;
            params.gainR = 1.04;
            params.gainG = 1.0;
            params.gainB = 0.94;
            params.saturation = 1.2;
            params.halation = 0.15;
            params.sceneName = 'Film Stock Warm';
        } else {
            // General daylight — clean cinematic with slight teal & orange push
            params.liftR = -0.01;
            params.liftG = 0.005;
            params.liftB = 0.02;
            params.gammaR = 0.015;
            params.gammaG = 0.005;
            params.gammaB = -0.01;
            params.gainR = 1.04;
            params.gainG = 0.99;
            params.gainB = 0.93;
            params.vignette = 0.2;
            params.halation = 0.12;
            params.sceneName = 'Daylight Cinematic';
        }

        // === 7. Final polish ===
        params.fade = 0.005; // Very subtle raised blacks for filmic feel

        return params;
    }
}
