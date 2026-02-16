/**
 * CineGrade App — Main Application Logic
 * Handles UI, video playback, controls, presets, auto-grade, split view, and MP4 export.
 */

(function () {
    'use strict';

    // === State ===
    let engine = null;
    let isPlaying = false;
    let animFrameId = null;
    let viewMode = 1; // 0=original, 1=graded, 2=split
    let splitPos = 0.5;
    let activePreset = null;
    let exportCancelled = false;
    let currentFile = null; // Keep reference to uploaded file for MP4 export
    let analyzer = null;
    let ffmpegLoaded = false;
    let ffmpegInstance = null;

    // === DOM Elements ===
    const uploadScreen = document.getElementById('upload-screen');
    const editorScreen = document.getElementById('editor-screen');
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const videoEl = document.getElementById('video-original');
    const canvasEl = document.getElementById('canvas-graded');
    const presetsGrid = document.getElementById('presets-grid');

    const btnOriginal = document.getElementById('btn-original');
    const btnGraded = document.getElementById('btn-graded');
    const btnSplit = document.getElementById('btn-split');
    const btnPlay = document.getElementById('btn-play');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnReset = document.getElementById('btn-reset');
    const btnExport = document.getElementById('btn-export');
    const btnExportFrame = document.getElementById('btn-export-frame');
    const btnNewVideo = document.getElementById('btn-new-video');
    const btnCancelExport = document.getElementById('btn-cancel-export');
    const btnAutoGrade = document.getElementById('btn-auto-grade');

    const timelineSlider = document.getElementById('timeline-slider');
    const timeDisplay = document.getElementById('time-display');
    const splitLine = document.getElementById('split-line');
    const splitLabelLeft = document.getElementById('split-label-left');
    const splitLabelRight = document.getElementById('split-label-right');
    const exportModal = document.getElementById('export-modal');
    const exportProgress = document.getElementById('export-progress');
    const exportStatus = document.getElementById('export-status');
    const analysisModal = document.getElementById('analysis-modal');
    const analysisProgress = document.getElementById('analysis-progress');
    const analysisStatus = document.getElementById('analysis-status');
    const autoGradeResult = document.getElementById('auto-grade-result');
    const autoGradeScene = document.getElementById('auto-grade-scene');
    const logProfileSelect = document.getElementById('log-profile');

    // === Initialize ===
    function init() {
        analyzer = new AutoAnalyzer();
        setupUpload();
        setupPresets();
        setupControls();
        setupPlayback();
        setupViewModes();
        setupSplitView();
        setupExport();
        setupActions();
        setupAutoGrade();
    }

    // === Upload ===
    function setupUpload() {
        uploadZone.addEventListener('click', () => fileInput.click());

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('video/')) {
                loadVideo(file);
            }
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) loadVideo(file);
        });
    }

    function loadVideo(file) {
        currentFile = file;
        const url = URL.createObjectURL(file);
        videoEl.src = url;

        // Wait until enough data is loaded to seek and read frames
        videoEl.addEventListener('loadeddata', function onData() {
            videoEl.removeEventListener('loadeddata', onData);

            // Initialize WebGL engine
            canvasEl.width = videoEl.videoWidth;
            canvasEl.height = videoEl.videoHeight;

            try {
                engine = new ColorEngine(canvasEl);
            } catch (err) {
                alert('Error initializing WebGL: ' + err.message);
                return;
            }

            // Show editor
            uploadScreen.classList.add('hidden');
            editorScreen.classList.remove('hidden');

            // Update timeline
            timelineSlider.max = videoEl.duration || 100;

            // Render first frame and then auto-analyze
            renderFrame();
            runAutoGrade();
        });

        videoEl.load();
    }

    // === Auto Grade ===
    function setupAutoGrade() {
        btnAutoGrade.addEventListener('click', runAutoGrade);
    }

    async function runAutoGrade() {
        if (!engine || !videoEl.duration) return;

        // Pause playback
        if (isPlaying) togglePlay();

        // Show analysis modal
        btnAutoGrade.classList.add('analyzing');
        analysisModal.classList.remove('hidden');
        analysisProgress.style.width = '0%';
        analysisStatus.textContent = 'Preparando análisis...';

        try {
            const optimalParams = await analyzer.analyze(videoEl, (progress, message) => {
                analysisProgress.style.width = (progress * 100).toFixed(0) + '%';
                analysisStatus.textContent = message;
            });

            // Extract scene name before applying
            const sceneName = optimalParams.sceneName || 'Cinematic Auto';
            delete optimalParams.sceneName;

            // Apply the computed params
            // Keep logProfile from current selection
            optimalParams.logProfile = engine.params.logProfile;
            Object.assign(engine.params, optimalParams);

            // Update UI
            syncControlsFromEngine();

            // Deactivate manual preset highlights
            activePreset = null;
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));

            // Show result
            autoGradeResult.classList.remove('hidden');
            autoGradeScene.textContent = 'Look aplicado: ' + sceneName;

            // Switch to graded view
            setViewMode(1);

            // Seek back to start and render
            videoEl.currentTime = 0;
            await seekTo(0);
            renderFrame();

        } catch (err) {
            analysisStatus.textContent = 'Error: ' + err.message;
            await new Promise(r => setTimeout(r, 2000));
        }

        // Hide analysis modal
        analysisModal.classList.add('hidden');
        btnAutoGrade.classList.remove('analyzing');
    }

    // === Render Loop ===
    function renderFrame() {
        if (!engine || !videoEl.videoWidth) return;

        // Render
        engine.render(videoEl, viewMode, splitPos);

        // Show/hide elements based on view mode
        if (viewMode === 0) {
            videoEl.style.zIndex = '2';
            canvasEl.style.zIndex = '1';
        } else {
            videoEl.style.zIndex = '1';
            canvasEl.style.zIndex = '2';
        }
    }

    function startRenderLoop() {
        function loop() {
            renderFrame();
            updateTimeline();
            animFrameId = requestAnimationFrame(loop);
        }
        loop();
    }

    function stopRenderLoop() {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
    }

    // === Playback Controls ===
    function setupPlayback() {
        btnPlay.addEventListener('click', togglePlay);

        videoEl.addEventListener('ended', () => {
            videoEl.currentTime = 0;
            videoEl.play();
        });

        videoEl.addEventListener('timeupdate', updateTimeline);

        timelineSlider.addEventListener('input', () => {
            videoEl.currentTime = parseFloat(timelineSlider.value);
            if (!isPlaying) {
                renderFrame();
            }
        });

        btnFullscreen.addEventListener('click', () => {
            const wrapper = document.querySelector('.preview-container');
            if (wrapper.requestFullscreen) wrapper.requestFullscreen();
            else if (wrapper.webkitRequestFullscreen) wrapper.webkitRequestFullscreen();
        });

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && editorScreen && !editorScreen.classList.contains('hidden')) {
                e.preventDefault();
                togglePlay();
            }
        });
    }

    function togglePlay() {
        if (isPlaying) {
            videoEl.pause();
            stopRenderLoop();
            isPlaying = false;
            btnPlay.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        } else {
            videoEl.play();
            startRenderLoop();
            isPlaying = true;
            btnPlay.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        }
    }

    function updateTimeline() {
        if (!videoEl.duration) return;
        timelineSlider.value = videoEl.currentTime;
        timelineSlider.max = videoEl.duration;

        const cur = formatTime(videoEl.currentTime);
        const dur = formatTime(videoEl.duration);
        timeDisplay.textContent = `${cur} / ${dur}`;
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // === View Modes ===
    function setupViewModes() {
        btnOriginal.addEventListener('click', () => setViewMode(0));
        btnGraded.addEventListener('click', () => setViewMode(1));
        btnSplit.addEventListener('click', () => setViewMode(2));
    }

    function setViewMode(mode) {
        viewMode = mode;
        [btnOriginal, btnGraded, btnSplit].forEach((btn, i) => {
            btn.classList.toggle('active', i === mode);
        });

        const showSplit = mode === 2;
        splitLine.classList.toggle('hidden', !showSplit);
        splitLabelLeft.classList.toggle('hidden', !showSplit);
        splitLabelRight.classList.toggle('hidden', !showSplit);

        renderFrame();
    }

    // === Split View Dragging ===
    function setupSplitView() {
        let dragging = false;

        splitLine.addEventListener('mousedown', (e) => {
            dragging = true;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const wrapper = document.querySelector('.video-wrapper');
            const rect = wrapper.getBoundingClientRect();
            splitPos = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
            splitLine.style.left = (splitPos * 100) + '%';
            renderFrame();
        });

        document.addEventListener('mouseup', () => { dragging = false; });

        splitLine.addEventListener('touchstart', (e) => {
            dragging = true;
            e.preventDefault();
        });

        document.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const wrapper = document.querySelector('.video-wrapper');
            const rect = wrapper.getBoundingClientRect();
            const touch = e.touches[0];
            splitPos = Math.max(0.05, Math.min(0.95, (touch.clientX - rect.left) / rect.width));
            splitLine.style.left = (splitPos * 100) + '%';
            renderFrame();
        });

        document.addEventListener('touchend', () => { dragging = false; });
    }

    // === Presets ===
    function setupPresets() {
        CINEMATIC_PRESETS.forEach((preset, index) => {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.textContent = preset.name;
            btn.title = preset.description;
            btn.addEventListener('click', () => applyPreset(index));
            presetsGrid.appendChild(btn);
        });
    }

    function applyPreset(index) {
        const preset = CINEMATIC_PRESETS[index];
        if (!preset || !engine) return;

        activePreset = index;
        Object.assign(engine.params, preset.params);
        syncControlsFromEngine();

        document.querySelectorAll('.preset-btn').forEach((btn, i) => {
            btn.classList.toggle('active', i === index);
        });

        // Hide auto-grade result since we're using a manual preset
        autoGradeResult.classList.add('hidden');

        if (viewMode === 0) setViewMode(1);
        renderFrame();
    }

    // === Controls ===
    function setupControls() {
        const controlMap = {
            'ctrl-exposure': 'exposure',
            'ctrl-contrast': 'contrast',
            'ctrl-highlights': 'highlights',
            'ctrl-shadows': 'shadows',
            'ctrl-temperature': 'temperature',
            'ctrl-tint': 'tint',
            'ctrl-saturation': 'saturation',
            'ctrl-vibrance': 'vibrance',
            'ctrl-lift-r': 'liftR',
            'ctrl-lift-g': 'liftG',
            'ctrl-lift-b': 'liftB',
            'ctrl-gamma-r': 'gammaR',
            'ctrl-gamma-g': 'gammaG',
            'ctrl-gamma-b': 'gammaB',
            'ctrl-gain-r': 'gainR',
            'ctrl-gain-g': 'gainG',
            'ctrl-gain-b': 'gainB',
            'ctrl-grain': 'grain',
            'ctrl-vignette': 'vignette',
            'ctrl-halation': 'halation',
            'ctrl-fade': 'fade',
            'ctrl-sharpen': 'sharpen',
        };

        Object.entries(controlMap).forEach(([ctrlId, paramName]) => {
            const slider = document.getElementById(ctrlId);
            if (!slider) return;

            const valueDisplay = document.querySelector(`.slider-value[data-for="${ctrlId}"]`);

            slider.addEventListener('input', () => {
                const val = parseFloat(slider.value);
                if (engine) engine.params[paramName] = val;
                if (valueDisplay) valueDisplay.textContent = val.toFixed(2);

                activePreset = null;
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));

                renderFrame();
            });

            slider.addEventListener('dblclick', () => {
                const defaults = engine ? engine.getDefaultParams() : {};
                const defaultVal = defaults[paramName];
                if (defaultVal !== undefined) {
                    slider.value = defaultVal;
                    slider.dispatchEvent(new Event('input'));
                }
            });
        });

        logProfileSelect.addEventListener('change', () => {
            if (engine) {
                engine.params.logProfile = logProfileSelect.value;
                renderFrame();
            }
        });
    }

    function syncControlsFromEngine() {
        if (!engine) return;
        const p = engine.params;

        const syncMap = {
            'ctrl-exposure': p.exposure,
            'ctrl-contrast': p.contrast,
            'ctrl-highlights': p.highlights,
            'ctrl-shadows': p.shadows,
            'ctrl-temperature': p.temperature,
            'ctrl-tint': p.tint,
            'ctrl-saturation': p.saturation,
            'ctrl-vibrance': p.vibrance,
            'ctrl-lift-r': p.liftR,
            'ctrl-lift-g': p.liftG,
            'ctrl-lift-b': p.liftB,
            'ctrl-gamma-r': p.gammaR,
            'ctrl-gamma-g': p.gammaG,
            'ctrl-gamma-b': p.gammaB,
            'ctrl-gain-r': p.gainR,
            'ctrl-gain-g': p.gainG,
            'ctrl-gain-b': p.gainB,
            'ctrl-grain': p.grain,
            'ctrl-vignette': p.vignette,
            'ctrl-halation': p.halation,
            'ctrl-fade': p.fade,
            'ctrl-sharpen': p.sharpen,
        };

        Object.entries(syncMap).forEach(([ctrlId, value]) => {
            const slider = document.getElementById(ctrlId);
            if (slider) {
                slider.value = value;
                const valueDisplay = document.querySelector(`.slider-value[data-for="${ctrlId}"]`);
                if (valueDisplay) valueDisplay.textContent = parseFloat(value).toFixed(2);
            }
        });

        logProfileSelect.value = p.logProfile || 'apple-log';
    }

    // === Actions ===
    function setupActions() {
        btnReset.addEventListener('click', () => {
            if (!engine) return;
            engine.params = engine.getDefaultParams();
            syncControlsFromEngine();
            activePreset = null;
            autoGradeResult.classList.add('hidden');
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            renderFrame();
        });

        btnNewVideo.addEventListener('click', () => {
            if (isPlaying) togglePlay();
            stopRenderLoop();

            videoEl.src = '';
            engine = null;
            currentFile = null;
            fileInput.value = '';
            autoGradeResult.classList.add('hidden');

            editorScreen.classList.add('hidden');
            uploadScreen.classList.remove('hidden');
        });
    }

    // === FFmpeg MP4 Export ===

    async function loadFFmpeg() {
        if (ffmpegLoaded && ffmpegInstance) return ffmpegInstance;

        exportStatus.textContent = 'Cargando encoder MP4 (primera vez)...';

        const { FFmpeg } = FFmpegWASM;
        const ffmpeg = new FFmpeg();

        ffmpeg.on('progress', ({ progress }) => {
            const pct = Math.round(progress * 100);
            exportProgress.style.width = pct + '%';
            exportStatus.textContent = `Codificando MP4... ${pct}%`;
        });

        await ffmpeg.load({
            coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
            wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
        });

        ffmpegLoaded = true;
        ffmpegInstance = ffmpeg;
        return ffmpeg;
    }

    function setupExport() {
        // Export frame as PNG
        btnExportFrame.addEventListener('click', () => {
            if (!engine) return;

            const prevMode = viewMode;
            engine.render(videoEl, 1, 0.5);

            const dataUrl = engine.exportFrame('image/png');
            const link = document.createElement('a');
            link.download = `cinegrade-frame-${Date.now()}.png`;
            link.href = dataUrl;
            link.click();

            if (prevMode !== 1) {
                engine.render(videoEl, prevMode, splitPos);
            }
        });

        // Export full video as MP4
        btnExport.addEventListener('click', exportVideoMP4);
        btnCancelExport.addEventListener('click', () => {
            exportCancelled = true;
        });
    }

    async function exportVideoMP4() {
        if (!engine || !videoEl.duration) return;

        exportCancelled = false;
        exportModal.classList.remove('hidden');
        exportProgress.style.width = '0%';
        exportStatus.textContent = 'Preparando exportación MP4...';

        if (isPlaying) togglePlay();

        const fps = 30;
        const duration = videoEl.duration;
        const totalFrames = Math.ceil(duration * fps);
        const frameInterval = 1 / fps;
        const width = videoEl.videoWidth;
        const height = videoEl.videoHeight;

        try {
            // Step 1: Render all graded frames as PNGs into a WebM intermediary
            exportStatus.textContent = 'Renderizando frames gradeados...';

            // Use a temporary canvas to read pixels
            const readCanvas = document.createElement('canvas');
            readCanvas.width = width;
            readCanvas.height = height;
            const readCtx = readCanvas.getContext('2d');

            // Collect frames as blobs for FFmpeg
            const frameBlobs = [];

            for (let i = 0; i <= totalFrames; i++) {
                if (exportCancelled) break;

                const time = Math.min(i * frameInterval, duration);
                await seekTo(time);

                // Render graded frame on the WebGL canvas
                engine.render(videoEl, 1, 0.5);

                // Read from WebGL canvas to 2D canvas
                readCtx.drawImage(canvasEl, 0, 0);

                // Get as blob (JPEG for speed, high quality)
                const blob = await new Promise(resolve => {
                    readCanvas.toBlob(resolve, 'image/jpeg', 0.95);
                });

                frameBlobs.push(blob);

                const progress = ((i / totalFrames) * 50).toFixed(1); // First 50%
                exportProgress.style.width = progress + '%';
                exportStatus.textContent = `Renderizando frame ${i + 1}/${totalFrames}`;

                // Yield to browser
                if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
            }

            if (exportCancelled) {
                exportStatus.textContent = 'Exportación cancelada.';
                setTimeout(() => exportModal.classList.add('hidden'), 1500);
                return;
            }

            // Step 2: Load FFmpeg and encode to MP4
            exportStatus.textContent = 'Cargando encoder MP4...';
            exportProgress.style.width = '50%';

            const ffmpeg = await loadFFmpeg();

            // Write frames to FFmpeg filesystem
            exportStatus.textContent = 'Preparando frames para encoder...';
            const { fetchFile } = FFmpegUtil;

            for (let i = 0; i < frameBlobs.length; i++) {
                const paddedNum = String(i).padStart(6, '0');
                const arrayBuf = await frameBlobs[i].arrayBuffer();
                await ffmpeg.writeFile(`frame_${paddedNum}.jpg`, new Uint8Array(arrayBuf));

                if (i % 30 === 0) {
                    const progress = (50 + (i / frameBlobs.length) * 20).toFixed(1);
                    exportProgress.style.width = progress + '%';
                    exportStatus.textContent = `Preparando frame ${i + 1}/${frameBlobs.length}...`;
                }
            }

            // Step 3: Run FFmpeg to encode JPEG sequence → MP4
            exportStatus.textContent = 'Codificando MP4 con H.264...';
            exportProgress.style.width = '70%';

            await ffmpeg.exec([
                '-framerate', String(fps),
                '-i', 'frame_%06d.jpg',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-crf', '18',           // High quality
                '-preset', 'fast',
                '-movflags', '+faststart',
                '-y',
                'output.mp4'
            ]);

            // Step 4: Read output and download
            exportStatus.textContent = 'Descargando MP4...';
            exportProgress.style.width = '95%';

            const outputData = await ffmpeg.readFile('output.mp4');
            const mp4Blob = new Blob([outputData.buffer], { type: 'video/mp4' });
            const url = URL.createObjectURL(mp4Blob);

            const link = document.createElement('a');
            // Use original filename as base
            const baseName = currentFile ? currentFile.name.replace(/\.[^.]+$/, '') : 'video';
            link.download = `${baseName}_cinegrade.mp4`;
            link.href = url;
            link.click();

            exportProgress.style.width = '100%';
            exportStatus.textContent = 'MP4 exportado exitosamente.';

            // Cleanup FFmpeg filesystem
            for (let i = 0; i < frameBlobs.length; i++) {
                const paddedNum = String(i).padStart(6, '0');
                try { await ffmpeg.deleteFile(`frame_${paddedNum}.jpg`); } catch (_) {}
            }
            try { await ffmpeg.deleteFile('output.mp4'); } catch (_) {}

            setTimeout(() => URL.revokeObjectURL(url), 10000);

        } catch (err) {
            console.error('Export error:', err);
            exportStatus.textContent = 'Error de exportación: ' + err.message;
        }

        setTimeout(() => {
            exportModal.classList.add('hidden');
        }, 2500);

        // Restore
        videoEl.currentTime = 0;
        renderFrame();
    }

    function seekTo(time) {
        return new Promise((resolve) => {
            // If already at this time (within a small epsilon), resolve immediately
            if (Math.abs(videoEl.currentTime - time) < 0.01) {
                resolve();
                return;
            }
            const onSeeked = () => resolve();
            videoEl.addEventListener('seeked', onSeeked, { once: true });
            videoEl.currentTime = time;

            // Safety timeout: if seeked never fires, resolve after 2s
            setTimeout(() => {
                videoEl.removeEventListener('seeked', onSeeked);
                resolve();
            }, 2000);
        });
    }

    // === Start ===
    init();
})();
