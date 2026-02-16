/**
 * CineGrade App — Main Application Logic
 * Handles UI, video playback, controls, presets, split view, and export.
 */

(function () {
    'use strict';

    // === State ===
    let engine = null;
    let video = null;
    let isPlaying = false;
    let animFrameId = null;
    let viewMode = 1; // 0=original, 1=graded, 2=split
    let splitPos = 0.5;
    let activePreset = null;
    let exportCancelled = false;

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

    const timelineSlider = document.getElementById('timeline-slider');
    const timeDisplay = document.getElementById('time-display');
    const splitLine = document.getElementById('split-line');
    const splitLabelLeft = document.getElementById('split-label-left');
    const splitLabelRight = document.getElementById('split-label-right');
    const exportModal = document.getElementById('export-modal');
    const exportProgress = document.getElementById('export-progress');
    const exportStatus = document.getElementById('export-status');
    const logProfileSelect = document.getElementById('log-profile');

    // === Initialize ===
    function init() {
        setupUpload();
        setupPresets();
        setupControls();
        setupPlayback();
        setupViewModes();
        setupSplitView();
        setupExport();
        setupActions();
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
        const url = URL.createObjectURL(file);
        videoEl.src = url;

        videoEl.addEventListener('loadedmetadata', function onMeta() {
            videoEl.removeEventListener('loadedmetadata', onMeta);

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

            // Apply default preset (Rec.709)
            applyPreset(0);

            // Render first frame
            videoEl.currentTime = 0;
            videoEl.addEventListener('seeked', function onSeek() {
                videoEl.removeEventListener('seeked', onSeek);
                renderFrame();
            }, { once: true });

            // Update timeline
            timelineSlider.max = videoEl.duration || 100;
        });

        videoEl.load();
    }

    // === Render Loop ===
    function renderFrame() {
        if (!engine || !videoEl.videoWidth) return;

        // Update canvas size to match video wrapper
        const wrapper = document.querySelector('.video-wrapper');
        const displayWidth = videoEl.videoWidth;
        const displayHeight = videoEl.videoHeight;

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
            // Loop
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

        // Space bar to play/pause
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

        document.addEventListener('mouseup', () => {
            dragging = false;
        });

        // Touch support
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

        document.addEventListener('touchend', () => {
            dragging = false;
        });
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

        // Update engine params
        Object.assign(engine.params, preset.params);

        // Update UI controls to reflect preset values
        syncControlsFromEngine();

        // Highlight active preset
        document.querySelectorAll('.preset-btn').forEach((btn, i) => {
            btn.classList.toggle('active', i === index);
        });

        // Ensure we're in graded view
        if (viewMode === 0) setViewMode(1);

        renderFrame();
    }

    // === Controls ===
    function setupControls() {
        // Map control IDs to engine param names
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

                // Deactivate preset highlighting when manually adjusting
                activePreset = null;
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));

                renderFrame();
            });

            // Double-click to reset individual slider
            slider.addEventListener('dblclick', () => {
                const defaults = engine ? engine.getDefaultParams() : {};
                const defaultVal = defaults[paramName];
                if (defaultVal !== undefined) {
                    slider.value = defaultVal;
                    slider.dispatchEvent(new Event('input'));
                }
            });
        });

        // Log profile selector
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

        // Sync log profile
        logProfileSelect.value = p.logProfile || 'apple-log';
    }

    // === Actions ===
    function setupActions() {
        // Reset
        btnReset.addEventListener('click', () => {
            if (!engine) return;
            engine.params = engine.getDefaultParams();
            syncControlsFromEngine();
            activePreset = null;
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            renderFrame();
        });

        // New video
        btnNewVideo.addEventListener('click', () => {
            // Stop playback
            if (isPlaying) togglePlay();
            stopRenderLoop();

            // Reset
            videoEl.src = '';
            engine = null;
            fileInput.value = '';

            // Show upload screen
            editorScreen.classList.add('hidden');
            uploadScreen.classList.remove('hidden');
        });
    }

    // === Export ===
    function setupExport() {
        // Export frame as PNG
        btnExportFrame.addEventListener('click', () => {
            if (!engine) return;

            // Make sure we render graded
            const prevMode = viewMode;
            engine.render(videoEl, 1, 0.5);

            const dataUrl = engine.exportFrame('image/png');
            const link = document.createElement('a');
            link.download = `cinegrade-frame-${Date.now()}.png`;
            link.href = dataUrl;
            link.click();

            // Restore view mode
            if (prevMode !== 1) {
                engine.render(videoEl, prevMode, splitPos);
            }
        });

        // Export full video
        btnExport.addEventListener('click', exportVideo);
        btnCancelExport.addEventListener('click', () => {
            exportCancelled = true;
        });
    }

    async function exportVideo() {
        if (!engine || !videoEl.duration) return;

        exportCancelled = false;
        exportModal.classList.remove('hidden');
        exportProgress.style.width = '0%';
        exportStatus.textContent = 'Preparando exportación...';

        // Use MediaRecorder + Canvas captureStream for export
        const fps = 30;
        const duration = videoEl.duration;

        // We'll re-render the video frame by frame onto the canvas with grading applied,
        // and capture it with MediaRecorder.

        // Pause current playback
        const wasPlaying = isPlaying;
        if (isPlaying) togglePlay();

        try {
            // Setup MediaRecorder on canvas stream
            const stream = canvasEl.captureStream(fps);
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                ? 'video/webm;codecs=vp9'
                : 'video/webm';

            const recorder = new MediaRecorder(stream, {
                mimeType: mimeType,
                videoBitsPerSecond: 20000000, // 20 Mbps high quality
            });

            const chunks = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.start();

            // Seek through video and render each frame
            const frameInterval = 1 / fps;
            const totalFrames = Math.ceil(duration * fps);

            for (let i = 0; i <= totalFrames; i++) {
                if (exportCancelled) break;

                const time = Math.min(i * frameInterval, duration);

                // Seek video to this time
                await seekTo(time);

                // Render graded frame
                engine.render(videoEl, 1, 0.5);

                // Update progress
                const progress = ((i / totalFrames) * 100).toFixed(1);
                exportProgress.style.width = progress + '%';
                exportStatus.textContent = `Procesando frame ${i}/${totalFrames} (${progress}%)`;

                // Give the browser a chance to breathe
                await new Promise(r => setTimeout(r, 10));
            }

            // Stop recording
            recorder.stop();

            await new Promise((resolve) => {
                recorder.onstop = resolve;
            });

            if (!exportCancelled) {
                // Create download
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = `cinegrade-export-${Date.now()}.webm`;
                link.href = url;
                link.click();

                exportStatus.textContent = 'Exportación completada.';
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 5000);
            } else {
                exportStatus.textContent = 'Exportación cancelada.';
            }
        } catch (err) {
            exportStatus.textContent = 'Error: ' + err.message;
        }

        // Close modal after a moment
        setTimeout(() => {
            exportModal.classList.add('hidden');
        }, 2000);

        // Restore playback position
        videoEl.currentTime = 0;
        renderFrame();
    }

    function seekTo(time) {
        return new Promise((resolve) => {
            videoEl.currentTime = time;
            videoEl.addEventListener('seeked', resolve, { once: true });
        });
    }

    // === Start ===
    init();
})();
