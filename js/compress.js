// js/compress.js — PDF Compression Mode
// Compresses PDFs client-side by re-rendering each page through PDF.js at a
// target resolution and re-encoding as JPEG inside a new pdf-lib document.
// This gives real, measurable file-size reduction (typically 40–80% for
// scanned / image-heavy PDFs; less for text-only PDFs).

(function () {
    'use strict';

    // ─── State ────────────────────────────────────────────────────────────────
    let compressFiles   = [];      // [{ file, fileName, originalSize, status, result }]
    let compressRunning = false;
    let compressQuality = 0.75;    // JPEG quality 0.0–1.0 (default: medium)
    let compressScale   = 1.5;     // render scale (1.5 = ~108 DPI — good balance)

    // Unload guard
    if (window._unloadCheckers) window._unloadCheckers.push(() => compressFiles.length > 0);

    // ─── Expose helpers ───────────────────────────────────────────────────────
    window.clearCompressState = function () {
        compressFiles   = [];
        compressRunning = false;
    };
    window._compressHasFiles = function () { return compressFiles.length > 0; };

    // ─── Init ─────────────────────────────────────────────────────────────────
    window.initCompress = function () {
        clearCompressState();
        _renderCompressUI();
        _updateCompressLeftPanel();
    };

    // ─── Route global file input ──────────────────────────────────────────────
    const _origHandleFileSelect = window.handleFileSelect;
    window.handleFileSelect = function (event) {
        if (window.activeTool === 'compress') _handleCompressFileSelect(event);
        else if (_origHandleFileSelect) _origHandleFileSelect(event);
    };

    // ─── File select handler ──────────────────────────────────────────────────
    async function _handleCompressFileSelect(event) {
        const files = Array.from(event.target.files);
        event.target.value = '';
        if (!files.length) return;

        // Show loading animation while files are being prepared
        showProcessing('Loading files…');
        await new Promise(r => setTimeout(r, 40)); // let overlay paint

        const valid = [];
        for (const f of files) {
            if (f.type !== 'application/pdf') {
                showNotification(`"${f.name}" is not a PDF and was skipped.`, 'warning'); continue;
            }
            if (f.size > 100 * 1024 * 1024) {
                showNotification(`"${f.name}" exceeds 100 MB and was skipped.`, 'warning'); continue;
            }
            valid.push(f);
        }

        if (!valid.length) { hideProcessing(); return; }

        for (const f of valid) {
            compressFiles.push({
                id:             Date.now() + Math.random(),
                file:           f,
                fileName:       f.name,
                originalSize:   f.size,
                status:         'queued',
                progress:       0,
                result:         null,
                compressedSize: 0,
                errorMsg:       '',
                selected:       true   // for post-compression download checkbox
            });
        }

        hideProcessing();

        const uploadSection    = document.getElementById('uploadSection');
        const pageContainer    = document.getElementById('pageContainer');
        const compressControls = document.getElementById('compressControls');
        if (uploadSection)    uploadSection.classList.add('hidden');
        if (pageContainer)    { pageContainer.classList.add('active'); pageContainer.style.display = ''; }
        if (compressControls) compressControls.classList.add('active');

        _renderCompressGrid();
        _updateCompressLeftPanel();
        _updateCompressToolbar();

        showToast(`Added ${valid.length} file${valid.length > 1 ? 's' : ''}`, 'success');
    }

    // ─── Left panel ───────────────────────────────────────────────────────────
    function _updateCompressLeftPanel() {
        const panelTitle     = document.getElementById('panelTitle');
        const filesContainer = document.getElementById('filesContainer');
        if (panelTitle) panelTitle.innerHTML = `<i class="fa fa-file-zip-o"></i> Files to Compress (${compressFiles.length})`;
        if (!filesContainer) return;

        if (!compressFiles.length) {
            filesContainer.innerHTML = `
                <div class="empty-files">
                    <div style="font-size:32px;margin-bottom:6px"><i class="fa fa-file-pdf-o"></i></div>
                    <span>No files added yet</span>
                </div>`;
            return;
        }

        const colors = ['var(--file-color-1)','var(--file-color-2)','var(--file-color-3)',
                        'var(--file-color-4)','var(--file-color-5)','var(--file-color-6)'];

        filesContainer.innerHTML = compressFiles.map((entry, idx) => {
            const color   = colors[idx % colors.length];
            const saving  = entry.status === 'done'
                ? Math.max(0, Math.round((1 - entry.compressedSize / entry.originalSize) * 100))
                : null;
            const statusIcon = {
                queued:      '<i class="fa fa-clock-o" style="color:var(--text-secondary)"></i>',
                compressing: '<i class="fa fa-spinner fa-spin" style="color:#3b82f6"></i>',
                done:        `<i class="fa fa-check-circle" style="color:#22c55e"></i>`,
                error:       '<i class="fa fa-times-circle" style="color:#ef4444"></i>'
            }[entry.status] || '';

            return `
            <div class="file-card" data-compress-id="${entry.id}">
                <div class="file-icon" style="color:${color}">
                    <div style="font-size:22px"><i class="fa fa-file-pdf-o"></i></div>
                </div>
                <div class="file-info">
                    <div class="file-name" title="${_escHtml(entry.fileName)}">${_escHtml(entry.fileName)}</div>
                    <div class="file-meta">
                        <span>${_fmtSize(entry.originalSize)}</span>
                        ${saving !== null ? `<span class="file-pages" style="background:rgba(34,197,94,0.12);color:#22c55e">−${saving}%</span>` : ''}
                        ${statusIcon}
                    </div>
                </div>
                <button class="file-remove" onclick="compressRemoveFile('${entry.id}')" title="Remove">
                    <i class="fa fa-trash-o" style="font-size:18px"></i>
                </button>
            </div>`;
        }).join('');
    }

    // ─── Remove a file ────────────────────────────────────────────────────────
    window.compressRemoveFile = function (id) {
        if (compressRunning) { showToast('Cannot remove while compressing', 'warning'); return; }
        const entry = compressFiles.find(e => String(e.id) === String(id));
        const name  = entry ? entry.fileName : 'this file';
        showConfirm('Remove File', `Remove "${name}" from the list?`, () => {
            compressFiles = compressFiles.filter(e => String(e.id) !== String(id));
            if (!compressFiles.length) {
            const uploadSection    = document.getElementById('uploadSection');
            const pageContainer    = document.getElementById('pageContainer');
            const pageGrid         = document.getElementById('pageGrid');
            const compressControls = document.getElementById('compressControls');
            if (uploadSection)    uploadSection.classList.remove('hidden');
            if (pageContainer)    { pageContainer.classList.remove('active'); }
            if (pageGrid)         pageGrid.innerHTML = '';
            if (compressControls) compressControls.classList.remove('active');
            } else {
                _renderCompressGrid();
            }
            _updateCompressLeftPanel();
            _updateCompressToolbar();
        });
    };

    // ─── Render grid cards ────────────────────────────────────────────────────
    function _renderCompressGrid() {
        const grid = document.getElementById('pageGrid');
        if (!grid) return;
        grid.innerHTML = '';
        grid.style.display   = 'block';
        grid.style.padding   = '20px';
        grid.style.overflowY = 'auto';

        // ── Quality selector ─────────────────────────────────────────────────
        const qualityBar = document.createElement('div');
        qualityBar.style.cssText = `
            max-width:680px;margin:0 auto 16px;padding:12px 16px;
            background:var(--bg-secondary);border:1px solid var(--border-color);
            border-radius:10px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;`;
        qualityBar.innerHTML = `
            <span style="font-size:12px;font-weight:600;color:var(--text-primary);white-space:nowrap">
                <i class="fa fa-sliders"></i> Quality
            </span>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button onclick="setCompressQuality('low')"    id="cq-low"    class="compress-q-btn">Low (smallest)</button>
                <button onclick="setCompressQuality('medium')" id="cq-medium" class="compress-q-btn active">Medium</button>
                <button onclick="setCompressQuality('high')"   id="cq-high"   class="compress-q-btn">High (largest)</button>
            </div>
            <span style="font-size:11px;color:var(--text-secondary);margin-left:auto" id="cq-hint">
                Re-renders pages as JPEG images — images &amp; scans compress best.
            </span>`;
        grid.appendChild(qualityBar);

        const wrapper = document.createElement('div');
        wrapper.id = 'compressCardList';
        wrapper.style.cssText = 'display:flex;flex-direction:column;gap:10px;max-width:680px;margin:0 auto';
        grid.appendChild(wrapper);

        for (const entry of compressFiles) {
            wrapper.appendChild(_buildCompressCard(entry));
        }
    }

    // Quality preset button handler
    window.setCompressQuality = function(preset) {
        const presets = {
            low:    { quality: 0.5,  scale: 1.0 },
            medium: { quality: 0.75, scale: 1.5 },
            high:   { quality: 0.92, scale: 2.0 }
        };
        const p = presets[preset] || presets.medium;
        compressQuality = p.quality;
        compressScale   = p.scale;

        // Update button active state
        ['low','medium','high'].forEach(k => {
            const btn = document.getElementById(`cq-${k}`);
            if (btn) btn.classList.toggle('active', k === preset);
        });

        const hints = {
            low:    'Smaller files, visible quality loss. Good for archiving.',
            medium: 'Balanced quality and size. Works for most use cases.',
            high:   'Near-original quality, modest size reduction.'
        };
        const hint = document.getElementById('cq-hint');
        if (hint) hint.textContent = hints[preset];
    };

    function _buildCompressCard(entry) {
        const card = document.createElement('div');
        card.id            = `compress-card-${entry.id}`;
        card.className     = 'compress-file-card';
        card.style.cssText = `
            background:var(--bg-secondary);border:1px solid var(--border-color);
            border-radius:10px;padding:14px 16px;transition:border-color 0.2s;
            position:relative;`;

        card.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px">
                <!-- Checkbox — only visible after compression, only when >1 file -->
                <label id="compress-chk-wrap-${entry.id}"
                       class="compress-select-chk-wrap"
                       style="display:none;flex-shrink:0;cursor:pointer;align-items:center">
                    <input type="checkbox" id="compress-chk-${entry.id}"
                           class="compress-select-chk"
                           ${entry.selected ? 'checked' : ''}
                           onchange="compressToggleSelect('${entry.id}', this.checked)"
                           style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent-color)">
                </label>
                <div style="flex-shrink:0;font-size:28px;color:var(--file-color-1)">
                    <i class="fa fa-file-pdf-o"></i>
                </div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:600;color:var(--text-primary);
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                         title="${_escHtml(entry.fileName)}">${_escHtml(entry.fileName)}</div>
                    <div id="compress-meta-${entry.id}"
                         style="font-size:11px;color:var(--text-secondary);margin-top:3px">
                        ${_fmtSize(entry.originalSize)} &bull; Queued
                    </div>
                    <div id="compress-bar-wrap-${entry.id}" style="margin-top:8px;display:none">
                        <div style="background:var(--bg-tertiary);border-radius:99px;height:6px;overflow:hidden">
                            <div id="compress-bar-${entry.id}"
                                 style="height:100%;width:0%;background:linear-gradient(90deg,#3b82f6,#60a5fa);
                                        border-radius:99px;transition:width 0.25s"></div>
                        </div>
                        <div id="compress-bar-label-${entry.id}"
                             style="font-size:10px;color:var(--text-secondary);margin-top:3px">Preparing…</div>
                    </div>
                    <div id="compress-result-${entry.id}" style="display:none;margin-top:6px"></div>
                </div>
                <div id="compress-status-icon-${entry.id}" style="flex-shrink:0;font-size:22px">
                    <i class="fa fa-clock-o" style="color:var(--text-secondary)"></i>
                </div>
            </div>`;

        return card;
    }

    // ─── Update a single card's UI ────────────────────────────────────────────
    function _updateCard(entry) {
        const meta       = document.getElementById(`compress-meta-${entry.id}`);
        const barWrap    = document.getElementById(`compress-bar-wrap-${entry.id}`);
        const bar        = document.getElementById(`compress-bar-${entry.id}`);
        const barLabel   = document.getElementById(`compress-bar-label-${entry.id}`);
        const resultRow  = document.getElementById(`compress-result-${entry.id}`);
        const statusIcon = document.getElementById(`compress-status-icon-${entry.id}`);
        const card       = document.getElementById(`compress-card-${entry.id}`);
        if (!card) return;

        if (entry.status === 'queued') {
            if (meta)       meta.innerHTML = `${_fmtSize(entry.originalSize)} &bull; <span style="color:var(--text-secondary)">Queued</span>`;
            if (barWrap)    barWrap.style.display = 'none';
            if (resultRow)  resultRow.style.display = 'none';
            if (statusIcon) statusIcon.innerHTML = '<i class="fa fa-clock-o" style="color:var(--text-secondary)"></i>';
            card.style.borderColor = 'var(--border-color)';
        }

        if (entry.status === 'compressing') {
            if (meta)       meta.innerHTML = `${_fmtSize(entry.originalSize)} &bull; <span style="color:#3b82f6">Compressing…</span>`;
            if (barWrap)    barWrap.style.display = '';
            if (bar)        bar.style.width = entry.progress + '%';
            if (barLabel)   barLabel.textContent = _compressionLabel(entry.progress);
            if (resultRow)  resultRow.style.display = 'none';
            if (statusIcon) statusIcon.innerHTML = '<i class="fa fa-spinner fa-spin" style="color:#3b82f6;font-size:22px"></i>';
            card.style.borderColor = '#3b82f6';
        }

        if (entry.status === 'done') {
            const saving = Math.max(0, Math.round((1 - entry.compressedSize / entry.originalSize) * 100));
            const saved  = entry.originalSize - entry.compressedSize;
            if (meta) meta.innerHTML = `${_fmtSize(entry.originalSize)} &bull; <span style="color:#22c55e">Compressed</span>`;
            if (barWrap) {
                barWrap.style.display = '';
                if (bar)      { bar.style.width = '100%'; bar.style.background = 'linear-gradient(90deg,#22c55e,#4ade80)'; }
                if (barLabel) barLabel.innerHTML = `<span style="color:#22c55e;font-weight:600">Done — saved ${_fmtSize(saved)} (${saving}% smaller)</span>`;
            }
            if (resultRow) {
                resultRow.style.display = '';
                resultRow.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:space-between;
                                background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);
                                border-radius:6px;padding:6px 10px;font-size:11px">
                        <span style="color:#22c55e;font-weight:600">
                            <i class="fa fa-arrow-down"></i>
                            ${_fmtSize(entry.originalSize)} → ${_fmtSize(entry.compressedSize)}
                            &nbsp;(−${saving}%)
                        </span>
                        <button onclick="compressDownloadSingle('${entry.id}')"
                                style="background:none;border:none;cursor:pointer;
                                       color:#22c55e;font-size:11px;font-weight:600;padding:2px 6px">
                            <i class="fa fa-download"></i> Save
                        </button>
                    </div>`;
            }
            if (statusIcon) statusIcon.innerHTML = '<i class="fa fa-check-circle" style="color:#22c55e;font-size:22px"></i>';
            card.style.borderColor = 'rgba(34,197,94,0.4)';
        }

        if (entry.status === 'error') {
            if (meta) meta.innerHTML = `${_fmtSize(entry.originalSize)} &bull; <span style="color:#ef4444">Error</span>`;
            if (barWrap) {
                barWrap.style.display = '';
                if (bar)      { bar.style.width = '100%'; bar.style.background = '#ef4444'; }
                if (barLabel) barLabel.innerHTML = `<span style="color:#ef4444">${_escHtml(entry.errorMsg || 'Compression failed')}</span>`;
            }
            if (resultRow)  resultRow.style.display = 'none';
            if (statusIcon) statusIcon.innerHTML = '<i class="fa fa-times-circle" style="color:#ef4444;font-size:22px"></i>';
            card.style.borderColor = 'rgba(239,68,68,0.4)';
        }
    }

    // ─── Toggle individual file selection (post-compression) ─────────────────
    window.compressToggleSelect = function(id, checked) {
        const entry = compressFiles.find(e => String(e.id) === String(id));
        if (entry) entry.selected = checked;
        _updateCompressToolbar();
    };

    // Show / hide checkboxes depending on done count and file count
    function _showCompressCheckboxes() {
        const doneCount = compressFiles.filter(e => e.status === 'done').length;
        const multiFile = compressFiles.length > 1;
        compressFiles.forEach(entry => {
            const wrap = document.getElementById(`compress-chk-wrap-${entry.id}`);
            const chk  = document.getElementById(`compress-chk-${entry.id}`);
            if (!wrap) return;
            // Show checkbox only when >1 file AND at least one is done
            wrap.style.display = (multiFile && doneCount > 0) ? 'flex' : 'none';
            if (chk) chk.checked = !!entry.selected;
        });
    }

    function _compressionLabel(pct) {
        if (pct < 10)  return 'Loading PDF…';
        if (pct < 30)  return 'Rendering pages…';
        if (pct < 60)  return 'Encoding images…';
        if (pct < 80)  return 'Building output PDF…';
        if (pct < 95)  return 'Finalising…';
        return 'Done!';
    }

    // ─── Toolbar state ────────────────────────────────────────────────────────
    function _updateCompressToolbar() {
        const compressBtn  = document.getElementById('compressExecuteBtn');
        const downloadBtn  = document.getElementById('compressDownloadBtn');
        const countEl      = document.getElementById('compressFileCount');
        const total        = compressFiles.length;
        const doneCount    = compressFiles.filter(e => e.status === 'done').length;
        const hasAnyQueued = compressFiles.some(e => e.status === 'queued' || e.status === 'error');

        if (countEl)      countEl.textContent = `${total} file${total !== 1 ? 's' : ''}`;
        if (compressBtn)  compressBtn.disabled  = compressRunning || !hasAnyQueued;
        if (downloadBtn)  downloadBtn.disabled  = doneCount === 0;
    }

    // ─── Main compression — real image recompression via PDF.js + pdf-lib ────
    window.executeCompress = async function () {
        if (compressRunning) return;
        const toProcess = compressFiles.filter(e => e.status === 'queued' || e.status === 'error');
        if (!toProcess.length) { showNotification('No files to compress.', 'warning'); return; }

        compressRunning = true;
        _updateCompressToolbar();

        // Load pdf-lib
        if (!window.PDFLib) {
            showProcessing('Loading pdf-lib…');
            try {
                await _loadScript(window.PDF_LIB_SRC || `${window.PDF_MANAGER_BASE || 'PDF-file-manager-new'}/ScriptsJS/1.17.1-pdf-lib.min.js`);
            } catch (err) {
                hideProcessing();
                showNotification('Could not load pdf-lib: ' + err.message, 'error');
                compressRunning = false;
                _updateCompressToolbar();
                return;
            }
            hideProcessing();
        }

        // PDF.js should already be loaded (it's used throughout the app)
        if (!window.pdfjsLib) {
            showNotification('PDF.js is not available. Please refresh the page.', 'error');
            compressRunning = false;
            _updateCompressToolbar();
            return;
        }

        for (const entry of toProcess) {
            entry.status   = 'compressing';
            entry.progress = 5;
            _updateCard(entry);
            _updateCompressLeftPanel();

            try {
                const outBytes = await _compressPdf(entry, (pct, label) => {
                    entry.progress = pct;
                    if (label) {
                        const el = document.getElementById(`compress-bar-label-${entry.id}`);
                        if (el) el.textContent = label;
                    }
                    _updateCard(entry);
                });

                entry.status        = 'done';
                entry.progress      = 100;
                entry.result        = outBytes;
                entry.compressedSize = outBytes.length;

            } catch (err) {
                entry.status   = 'error';
                entry.progress = 100;
                entry.errorMsg = err.message || 'Unknown error';
                console.error(`Compress error [${entry.fileName}]:`, err);
            }

            _updateCard(entry);
            _showCompressCheckboxes();
            _updateCompressLeftPanel();
            await new Promise(r => setTimeout(r, 80));
        }

        compressRunning = false;
        _showCompressCheckboxes();
        _updateCompressToolbar();

        const doneCount  = compressFiles.filter(e => e.status === 'done').length;
        const errorCount = compressFiles.filter(e => e.status === 'error').length;

        if (doneCount > 0) {
            const msg = errorCount
                ? `Compressed ${doneCount} file${doneCount > 1 ? 's' : ''} (${errorCount} failed).`
                : `Successfully compressed ${doneCount} file${doneCount > 1 ? 's' : ''}!`;
            showNotification(msg, errorCount ? 'warning' : 'success');
            showToast(msg, errorCount ? 'warning' : 'success');
        } else {
            showNotification('All files failed to compress.', 'error');
        }
    };

    // ─── Core compression: render each page via PDF.js → JPEG → pdf-lib ──────
    async function _compressPdf(entry, onProgress) {
        const { PDFDocument, rgb } = window.PDFLib;
        const arrayBuffer = await entry.file.arrayBuffer();

        onProgress(8, 'Loading PDF…');

        // Load with PDF.js for rendering
        const pdfjs = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
        const numPages = pdfjs.numPages;

        // Create output pdf-lib document
        const outDoc = await PDFDocument.create();

        onProgress(12, `Rendering ${numPages} page${numPages > 1 ? 's' : ''}…`);

        // Off-screen canvas for rendering
        const canvas = document.createElement('canvas');
        const ctx    = canvas.getContext('2d');

        for (let p = 1; p <= numPages; p++) {
            const pct = 12 + Math.round(78 * (p - 1) / numPages);
            onProgress(pct, `Page ${p} of ${numPages}…`);

            const page     = await pdfjs.getPage(p);
            const viewport = page.getViewport({ scale: compressScale });

            canvas.width  = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);

            // Fill white background (for transparent PDFs)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport }).promise;

            // Encode as JPEG
            const jpegDataUrl = canvas.toDataURL('image/jpeg', compressQuality);
            const jpegBase64  = jpegDataUrl.split(',')[1];
            const jpegBytes   = Uint8Array.from(atob(jpegBase64), c => c.charCodeAt(0));

            // Embed JPEG into pdf-lib
            const jpegImage = await outDoc.embedJpg(jpegBytes);

            // Add page with same dimensions as original (in PDF points)
            const pageWidthPt  = viewport.width  / compressScale * (72 / 96);
            const pageHeightPt = viewport.height / compressScale * (72 / 96);

            const pdfPage = outDoc.addPage([pageWidthPt, pageHeightPt]);
            pdfPage.drawImage(jpegImage, {
                x: 0, y: 0,
                width:  pageWidthPt,
                height: pageHeightPt
            });
        }

        onProgress(92, 'Saving PDF…');
        const outBytes = await outDoc.save();
        onProgress(100, 'Done!');

        return outBytes;
    }

    // ─── Script loader helper ─────────────────────────────────────────────────
    function _loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve;
            s.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(s);
        });
    }

    // ─── Download single file ─────────────────────────────────────────────────
    window.compressDownloadSingle = function (id) {
        const entry = compressFiles.find(e => String(e.id) === String(id));
        if (!entry || !entry.result) return;
        _downloadBytes(entry.result, entry.fileName.replace(/\.pdf$/i, '_compressed.pdf'));
        showToast('Downloading ' + entry.fileName, 'success');
    };

    // ─── Open download modal ──────────────────────────────────────────────────
    window.openCompressDownloadModal = function () {
        // If multi-file, use checkbox selection; otherwise use all done files
        const multiFile = compressFiles.length > 1;
        const doneFiles = compressFiles.filter(e => e.status === 'done' && (multiFile ? e.selected : true));
        if (!doneFiles.length && multiFile) {
            showNotification('No files selected. Please check at least one file.', 'warning'); return;
        }
        if (!doneFiles.length) { showNotification('No compressed files ready.', 'warning'); return; }

        const totalOrig  = doneFiles.reduce((s, e) => s + e.originalSize, 0);
        const totalComp  = doneFiles.reduce((s, e) => s + e.compressedSize, 0);
        const totalSaved = totalOrig - totalComp;
        const pct        = Math.round((totalSaved / totalOrig) * 100);

        const modalStatsEl = document.getElementById('compressModalStats');
        if (modalStatsEl) {
            modalStatsEl.innerHTML = `
                <div style="display:flex;justify-content:space-between;padding:8px 0;
                            border-bottom:1px solid var(--border-color);font-size:12px">
                    <span style="color:var(--text-secondary)">Files ready</span>
                    <strong>${doneFiles.length}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;
                            border-bottom:1px solid var(--border-color);font-size:12px">
                    <span style="color:var(--text-secondary)">Original total</span>
                    <strong>${_fmtSize(totalOrig)}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;
                            border-bottom:1px solid var(--border-color);font-size:12px">
                    <span style="color:var(--text-secondary)">Compressed total</span>
                    <strong style="color:#22c55e">${_fmtSize(totalComp)}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:12px">
                    <span style="color:var(--text-secondary)">Space saved</span>
                    <strong style="color:#22c55e">${_fmtSize(totalSaved)} (${pct}%)</strong>
                </div>`;
        }

        document.getElementById('compressDownloadModal')?.classList.add('show');
    };

    window.closeCompressDownloadModal = function () {
        document.getElementById('compressDownloadModal')?.classList.remove('show');
    };

    // ─── Download individual files ────────────────────────────────────────────
    window.compressDownloadIndividual = async function () {
        const multiFile = compressFiles.length > 1;
        const doneFiles = compressFiles.filter(e => e.status === 'done' && (multiFile ? e.selected : true));
        closeCompressDownloadModal();
        showProcessing('Downloading files…');
        for (let i = 0; i < doneFiles.length; i++) {
            const entry = doneFiles[i];
            await new Promise(r => setTimeout(r, 200 * i));
            _downloadBytes(entry.result, entry.fileName.replace(/\.pdf$/i, '_compressed.pdf'));
        }
        hideProcessing();
        showToast(`Downloaded ${doneFiles.length} file${doneFiles.length > 1 ? 's' : ''}`, 'success');
    };

    // ─── Download as ZIP ──────────────────────────────────────────────────────
    window.compressDownloadZip = async function () {
        const multiFile = compressFiles.length > 1;
        const doneFiles = compressFiles.filter(e => e.status === 'done' && (multiFile ? e.selected : true));
        closeCompressDownloadModal();
        showProgress('Building ZIP…', 'Packaging compressed files…');
        try {
            const zip = new JSZip();
            doneFiles.forEach((entry, i) => {
                const fname = entry.fileName.replace(/\.pdf$/i, '_compressed.pdf');
                zip.file(fname, entry.result);
                updateProgress(10 + Math.round(60 * (i + 1) / doneFiles.length), `Adding ${fname}…`);
            });
            updateProgress(75, 'Generating ZIP…');
            const zipBlob = await zip.generateAsync(
                { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
                meta => updateProgress(75 + Math.round(20 * meta.percent / 100), 'Compressing ZIP…')
            );
            updateProgress(98, 'Almost done…');
            await new Promise(r => setTimeout(r, 200));
            hideProgress();
            const url = URL.createObjectURL(zipBlob);
            const a   = document.createElement('a');
            a.href = url; a.download = 'compressed_pdfs.zip';
            document.body.appendChild(a); a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`ZIP downloaded (${doneFiles.length} files)`, 'success');
        } catch (err) {
            hideProgress();
            showNotification('ZIP creation failed: ' + err.message, 'error');
        }
    };

    // ─── Clear all ────────────────────────────────────────────────────────────
    window.clearAllCompressFiles = function () {
        if (compressRunning) { showToast('Cannot clear while compressing', 'warning'); return; }
        if (!compressFiles.length) return;
        showConfirm('Clear All', 'Remove all files from the list?', () => {
            clearCompressState();
            const uploadSection    = document.getElementById('uploadSection');
            const pageContainer    = document.getElementById('pageContainer');
            const pageGrid         = document.getElementById('pageGrid');
            const compressControls = document.getElementById('compressControls');
            if (uploadSection)    uploadSection.classList.remove('hidden');
            if (pageContainer)    { pageContainer.classList.remove('active'); pageGrid.style.display = ''; }
            if (pageGrid)         pageGrid.innerHTML = '';
            if (compressControls) compressControls.classList.remove('active');
            _updateCompressLeftPanel();
            _updateCompressToolbar();
            showToast('All files cleared', 'info');
        });
    };

    // ─── Render compress UI ───────────────────────────────────────────────────
    function _renderCompressUI() {
        const uploadSection  = document.getElementById('uploadSection');
        const pageContainer  = document.getElementById('pageContainer');
        const pageGrid       = document.getElementById('pageGrid');
        if (uploadSection)  { uploadSection.classList.remove('hidden'); uploadSection.style.display = ''; }
        if (pageContainer)  { pageContainer.classList.remove('active'); }
        if (pageGrid)       { pageGrid.innerHTML = ''; pageGrid.style.cssText = ''; }
        const leftPanel    = document.getElementById('leftPanel');
        const mobileToggle = document.getElementById('mobileMenuToggle');
        if (leftPanel)    leftPanel.style.display = '';
        if (mobileToggle) mobileToggle.style.display = '';
    }

    // ─── Byte helpers ─────────────────────────────────────────────────────────
    function _downloadBytes(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function _fmtSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024, sizes = ['B','KB','MB','GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0) + ' ' + sizes[i];
    }

    function _escHtml(s) {
        return String(s).replace(/[&<>\"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

})();
