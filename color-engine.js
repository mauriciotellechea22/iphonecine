/**
 * CineGrade Color Engine
 * WebGL-based real-time color grading for LOG video footage.
 * Supports Apple Log (iPhone 15 Pro Max), S-Log3, C-Log3, V-Log, N-Log.
 */

class ColorEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', {
            preserveDrawingBuffer: true,
            premultipliedAlpha: false,
        });
        if (!this.gl) {
            this.gl = canvas.getContext('webgl', {
                preserveDrawingBuffer: true,
                premultipliedAlpha: false,
            });
        }
        if (!this.gl) throw new Error('WebGL not supported');

        this.params = this.getDefaultParams();
        this._initGL();
    }

    getDefaultParams() {
        return {
            logProfile: 'apple-log',
            exposure: 0,
            contrast: 1,
            highlights: 0,
            shadows: 0,
            temperature: 0,
            tint: 0,
            saturation: 1,
            vibrance: 0,
            liftR: 0, liftG: 0, liftB: 0,
            gammaR: 0, gammaG: 0, gammaB: 0,
            gainR: 1, gainG: 1, gainB: 1,
            grain: 0,
            vignette: 0,
            halation: 0,
            fade: 0,
            sharpen: 0,
        };
    }

    _initGL() {
        const gl = this.gl;

        // Vertex shader
        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        // Fragment shader — the full color grading pipeline
        const fsSource = `
            precision highp float;
            varying vec2 v_texCoord;
            uniform sampler2D u_image;
            uniform float u_time;
            uniform vec2 u_resolution;

            // Log profile
            uniform int u_logProfile;

            // Primary corrections
            uniform float u_exposure;
            uniform float u_contrast;
            uniform float u_highlights;
            uniform float u_shadows;
            uniform float u_temperature;
            uniform float u_tint;
            uniform float u_saturation;
            uniform float u_vibrance;

            // Lift/Gamma/Gain
            uniform vec3 u_lift;
            uniform vec3 u_gamma;
            uniform vec3 u_gain;

            // Effects
            uniform float u_grain;
            uniform float u_vignette;
            uniform float u_halation;
            uniform float u_fade;
            uniform float u_sharpen;

            // Split view
            uniform int u_viewMode; // 0=original, 1=graded, 2=split
            uniform float u_splitPos;

            // === LOG to Linear conversions ===

            // Apple Log (iPhone 15 Pro Max) transfer function
            // Based on Apple's published Apple Log curve
            vec3 appleLogToLinear(vec3 logVal) {
                vec3 lin;
                // Apple Log encoding: cut at 0.0928
                // Simplified piecewise from Apple's spec
                float cut = 0.0928;
                for (int i = 0; i < 3; i++) {
                    float v = (i == 0) ? logVal.r : (i == 1) ? logVal.g : logVal.b;
                    float result;
                    if (v < cut) {
                        result = (v - 0.0928) / 8.684;
                    } else {
                        // Power curve segment
                        result = pow(2.0, (v - 0.534) / 0.0924) / 32.0;
                    }
                    if (i == 0) lin.r = result;
                    else if (i == 1) lin.g = result;
                    else lin.b = result;
                }
                return max(lin, vec3(0.0));
            }

            // Sony S-Log3 to Linear
            vec3 slog3ToLinear(vec3 slog) {
                vec3 lin;
                for (int i = 0; i < 3; i++) {
                    float v = (i == 0) ? slog.r : (i == 1) ? slog.g : slog.b;
                    float result;
                    if (v >= 171.2102946929 / 1023.0) {
                        result = pow(10.0, ((v * 1023.0 - 420.0) / 261.5)) * (0.18 + 0.01) - 0.01;
                    } else {
                        result = (v * 1023.0 - 95.0) * 0.01125000 / (171.2102946929 - 95.0);
                    }
                    if (i == 0) lin.r = result;
                    else if (i == 1) lin.g = result;
                    else lin.b = result;
                }
                return max(lin, vec3(0.0));
            }

            // Canon C-Log3 to Linear
            vec3 clog3ToLinear(vec3 clog) {
                vec3 lin;
                for (int i = 0; i < 3; i++) {
                    float v = (i == 0) ? clog.r : (i == 1) ? clog.g : clog.b;
                    float result;
                    if (v > 0.097465473) {
                        result = (pow(10.0, (v - 0.069886632) / 0.42889912) - 1.0) / 14.98325;
                    } else if (v < -0.011734286) {
                        result = -(pow(10.0, (-v - 0.069886632) / 0.42889912) - 1.0) / 14.98325;
                    } else {
                        result = (v - 0.069886632) / 8.283057;
                    }
                    if (i == 0) lin.r = result;
                    else if (i == 1) lin.g = result;
                    else lin.b = result;
                }
                return max(lin, vec3(0.0));
            }

            // Panasonic V-Log to Linear
            vec3 vlogToLinear(vec3 vlog) {
                vec3 lin;
                float cut = 0.181;
                for (int i = 0; i < 3; i++) {
                    float v = (i == 0) ? vlog.r : (i == 1) ? vlog.g : vlog.b;
                    float result;
                    if (v < cut) {
                        result = (v - 0.125) / 5.6;
                    } else {
                        result = pow(10.0, (v - 0.598206) / 0.241514) - 0.00873;
                    }
                    if (i == 0) lin.r = result;
                    else if (i == 1) lin.g = result;
                    else lin.b = result;
                }
                return max(lin, vec3(0.0));
            }

            // Nikon N-Log to Linear
            vec3 nlogToLinear(vec3 nlog) {
                vec3 lin;
                for (int i = 0; i < 3; i++) {
                    float v = (i == 0) ? nlog.r : (i == 1) ? nlog.g : nlog.b;
                    float result;
                    if (v > 328.0 / 1023.0) {
                        result = pow(2.0, (v * 1023.0 / 150.0)) * 0.9 / 1023.0;
                    } else {
                        result = v * 1023.0 / (650.0 * 0.9);
                    }
                    if (i == 0) lin.r = result;
                    else if (i == 1) lin.g = result;
                    else lin.b = result;
                }
                return max(lin, vec3(0.0));
            }

            vec3 logToLinear(vec3 logVal) {
                if (u_logProfile == 0) return appleLogToLinear(logVal);
                if (u_logProfile == 1) return slog3ToLinear(logVal);
                if (u_logProfile == 2) return clog3ToLinear(logVal);
                if (u_logProfile == 3) return vlogToLinear(logVal);
                if (u_logProfile == 4) return nlogToLinear(logVal);
                return appleLogToLinear(logVal);
            }

            // === Linear to sRGB (Rec.709 display) ===
            vec3 linearToSRGB(vec3 lin) {
                vec3 result;
                for (int i = 0; i < 3; i++) {
                    float v = (i == 0) ? lin.r : (i == 1) ? lin.g : lin.b;
                    float s;
                    if (v <= 0.0031308) {
                        s = v * 12.92;
                    } else {
                        s = 1.055 * pow(v, 1.0 / 2.4) - 0.055;
                    }
                    if (i == 0) result.r = s;
                    else if (i == 1) result.g = s;
                    else result.b = s;
                }
                return clamp(result, 0.0, 1.0);
            }

            // === Color grading operations ===

            // RGB to HSL
            vec3 rgbToHsl(vec3 c) {
                float maxC = max(c.r, max(c.g, c.b));
                float minC = min(c.r, min(c.g, c.b));
                float l = (maxC + minC) / 2.0;
                float h = 0.0, s = 0.0;

                if (maxC != minC) {
                    float d = maxC - minC;
                    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
                    if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
                    else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
                    else h = (c.r - c.g) / d + 4.0;
                    h /= 6.0;
                }
                return vec3(h, s, l);
            }

            float hue2rgb(float p, float q, float t) {
                if (t < 0.0) t += 1.0;
                if (t > 1.0) t -= 1.0;
                if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
                if (t < 1.0/2.0) return q;
                if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
                return p;
            }

            vec3 hslToRgb(vec3 hsl) {
                float h = hsl.x, s = hsl.y, l = hsl.z;
                if (s == 0.0) return vec3(l);
                float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
                float p = 2.0 * l - q;
                return vec3(
                    hue2rgb(p, q, h + 1.0/3.0),
                    hue2rgb(p, q, h),
                    hue2rgb(p, q, h - 1.0/3.0)
                );
            }

            // Luminance
            float luminance(vec3 c) {
                return dot(c, vec3(0.2126, 0.7152, 0.0722));
            }

            // Apply exposure in linear space
            vec3 applyExposure(vec3 c, float ev) {
                return c * pow(2.0, ev);
            }

            // Apply contrast (S-curve centered at 0.5)
            vec3 applyContrast(vec3 c, float amount) {
                return (c - 0.5) * amount + 0.5;
            }

            // Highlight and shadow recovery
            vec3 applyHighlightsShadows(vec3 c, float hi, float sh) {
                float lum = luminance(c);
                // Highlights affect bright areas
                float hiMask = smoothstep(0.5, 1.0, lum);
                c += c * hi * hiMask;
                // Shadows affect dark areas
                float shMask = 1.0 - smoothstep(0.0, 0.5, lum);
                c += c * sh * shMask;
                return c;
            }

            // Temperature (blue-yellow) and Tint (green-magenta)
            vec3 applyWhiteBalance(vec3 c, float temp, float tint) {
                // Temperature: shift blue ↔ yellow
                c.r += temp * 0.1;
                c.b -= temp * 0.1;
                // Tint: shift green ↔ magenta
                c.g += tint * 0.1;
                return c;
            }

            // Saturation
            vec3 applySaturation(vec3 c, float sat) {
                float lum = luminance(c);
                return mix(vec3(lum), c, sat);
            }

            // Vibrance (saturates less-saturated colors more)
            vec3 applyVibrance(vec3 c, float vib) {
                float maxC = max(c.r, max(c.g, c.b));
                float minC = min(c.r, min(c.g, c.b));
                float sat = maxC - minC;
                float lum = luminance(c);
                float amount = 1.0 + vib * (1.0 - sat);
                return mix(vec3(lum), c, amount);
            }

            // Lift/Gamma/Gain color wheels
            vec3 applyLiftGammaGain(vec3 c, vec3 lift, vec3 gamma, vec3 gain) {
                // Gain (multiply)
                c = c * gain;
                // Lift (add to shadows)
                c = c + lift * (1.0 - c);
                // Gamma (power curve on midtones)
                vec3 gam = 1.0 / max(vec3(0.01), 1.0 + gamma);
                c = pow(max(c, vec3(0.0)), gam);
                return c;
            }

            // Film grain noise
            float rand(vec2 co) {
                return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
            }

            vec3 applyGrain(vec3 c, vec2 uv, float amount, float time) {
                float noise = rand(uv * 1000.0 + time) * 2.0 - 1.0;
                // Make grain more visible in midtones, less in shadows/highlights
                float lum = luminance(c);
                float mask = 1.0 - abs(lum - 0.5) * 2.0;
                mask = mix(0.5, 1.0, mask);
                c += vec3(noise * amount * mask);
                return c;
            }

            // Vignette
            vec3 applyVignette(vec3 c, vec2 uv, float amount) {
                vec2 center = uv - 0.5;
                float dist = length(center);
                float vig = 1.0 - smoothstep(0.3, 0.9, dist * amount * 1.5);
                return c * vig;
            }

            // Halation (warm glow in highlights, simulating film halation)
            vec3 applyHalation(vec3 c, float amount) {
                float lum = luminance(c);
                float hlMask = smoothstep(0.6, 1.0, lum);
                c.r += hlMask * amount * 0.15;
                c.g += hlMask * amount * 0.05;
                return c;
            }

            // Fade (raise blacks for faded film look)
            vec3 applyFade(vec3 c, float amount) {
                return c + amount;
            }

            void main() {
                vec2 uv = v_texCoord;
                vec4 texColor = texture2D(u_image, uv);
                vec3 color = texColor.rgb;

                // Determine if we should apply grading at this pixel
                bool applyGrade = true;
                if (u_viewMode == 0) {
                    applyGrade = false;
                } else if (u_viewMode == 2) {
                    applyGrade = (uv.x > u_splitPos);
                }

                if (applyGrade) {
                    // 1. LOG to Linear
                    vec3 linear = logToLinear(color);

                    // 2. Exposure (in linear space)
                    linear = applyExposure(linear, u_exposure);

                    // 3. Convert to display (sRGB/Rec.709)
                    vec3 display = linearToSRGB(linear);

                    // 4. Contrast
                    display = applyContrast(display, u_contrast);

                    // 5. Highlights / Shadows
                    display = applyHighlightsShadows(display, u_highlights, u_shadows);

                    // 6. White Balance
                    display = applyWhiteBalance(display, u_temperature, u_tint);

                    // 7. Lift / Gamma / Gain
                    display = applyLiftGammaGain(display, u_lift, u_gamma, u_gain);

                    // 8. Saturation
                    display = applySaturation(display, u_saturation);

                    // 9. Vibrance
                    display = applyVibrance(display, u_vibrance);

                    // 10. Halation
                    if (u_halation > 0.001) {
                        display = applyHalation(display, u_halation);
                    }

                    // 11. Fade
                    if (u_fade > 0.001) {
                        display = applyFade(display, u_fade);
                    }

                    // 12. Vignette
                    if (u_vignette > 0.001) {
                        display = applyVignette(display, uv, u_vignette);
                    }

                    // 13. Film grain
                    if (u_grain > 0.001) {
                        display = applyGrain(display, uv, u_grain, u_time);
                    }

                    color = clamp(display, 0.0, 1.0);
                }

                // Sharpening (unsharp mask, works in both modes for consistency)
                if (u_sharpen > 0.01 && applyGrade) {
                    vec2 texel = 1.0 / u_resolution;
                    vec3 neighbors = vec3(0.0);
                    neighbors += texture2D(u_image, uv + vec2(-texel.x, 0.0)).rgb;
                    neighbors += texture2D(u_image, uv + vec2(texel.x, 0.0)).rgb;
                    neighbors += texture2D(u_image, uv + vec2(0.0, -texel.y)).rgb;
                    neighbors += texture2D(u_image, uv + vec2(0.0, texel.y)).rgb;
                    neighbors /= 4.0;

                    // Re-grade the neighbor samples through the same pipeline
                    // For performance, approximate by sharpening the final output
                    vec3 sharp = color + (color - neighbors) * u_sharpen;
                    color = clamp(sharp, 0.0, 1.0);
                }

                gl_FragColor = vec4(color, 1.0);
            }
        `;

        // Compile shaders
        const vs = this._compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSource);

        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error('Shader link failed: ' + gl.getProgramInfoLog(this.program));
        }

        gl.useProgram(this.program);

        // Setup geometry (fullscreen quad)
        const positions = new Float32Array([
            -1, -1,  1, -1,  -1, 1,
            -1,  1,  1, -1,   1, 1,
        ]);
        const texCoords = new Float32Array([
            0, 1,  1, 1,  0, 0,
            0, 0,  1, 1,  1, 0,
        ]);

        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const texBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
        const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

        // Create texture for video frames
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Cache uniform locations
        this.uniforms = {};
        const uniformNames = [
            'u_image', 'u_time', 'u_resolution', 'u_logProfile',
            'u_exposure', 'u_contrast', 'u_highlights', 'u_shadows',
            'u_temperature', 'u_tint', 'u_saturation', 'u_vibrance',
            'u_lift', 'u_gamma', 'u_gain',
            'u_grain', 'u_vignette', 'u_halation', 'u_fade', 'u_sharpen',
            'u_viewMode', 'u_splitPos',
        ];
        for (const name of uniformNames) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader compile error: ' + info);
        }
        return shader;
    }

    /**
     * Render a single frame from the video element with current grading params.
     * @param {HTMLVideoElement} video
     * @param {number} viewMode - 0=original, 1=graded, 2=split
     * @param {number} splitPos - 0..1 split position for split view
     */
    render(video, viewMode = 1, splitPos = 0.5) {
        const gl = this.gl;
        const p = this.params;

        // Size canvas to match video
        if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
            this.canvas.width = video.videoWidth;
            this.canvas.height = video.videoHeight;
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }

        // Upload video frame to texture
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

        // Set uniforms
        gl.uniform1i(this.uniforms.u_image, 0);
        gl.uniform1f(this.uniforms.u_time, performance.now() / 1000.0);
        gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);

        // Log profile
        const profileMap = { 'apple-log': 0, 'slog3': 1, 'clog3': 2, 'vlog': 3, 'nlog': 4 };
        gl.uniform1i(this.uniforms.u_logProfile, profileMap[p.logProfile] || 0);

        // Primary corrections
        gl.uniform1f(this.uniforms.u_exposure, p.exposure);
        gl.uniform1f(this.uniforms.u_contrast, p.contrast);
        gl.uniform1f(this.uniforms.u_highlights, p.highlights);
        gl.uniform1f(this.uniforms.u_shadows, p.shadows);
        gl.uniform1f(this.uniforms.u_temperature, p.temperature);
        gl.uniform1f(this.uniforms.u_tint, p.tint);
        gl.uniform1f(this.uniforms.u_saturation, p.saturation);
        gl.uniform1f(this.uniforms.u_vibrance, p.vibrance);

        // Lift/Gamma/Gain
        gl.uniform3f(this.uniforms.u_lift, p.liftR, p.liftG, p.liftB);
        gl.uniform3f(this.uniforms.u_gamma, p.gammaR, p.gammaG, p.gammaB);
        gl.uniform3f(this.uniforms.u_gain, p.gainR, p.gainG, p.gainB);

        // Effects
        gl.uniform1f(this.uniforms.u_grain, p.grain);
        gl.uniform1f(this.uniforms.u_vignette, p.vignette);
        gl.uniform1f(this.uniforms.u_halation, p.halation);
        gl.uniform1f(this.uniforms.u_fade, p.fade);
        gl.uniform1f(this.uniforms.u_sharpen, p.sharpen);

        // View mode
        gl.uniform1i(this.uniforms.u_viewMode, viewMode);
        gl.uniform1f(this.uniforms.u_splitPos, splitPos);

        // Draw
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /**
     * Export a single frame as a data URL.
     */
    exportFrame(format = 'image/png') {
        return this.canvas.toDataURL(format, 1.0);
    }
}
