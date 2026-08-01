// js/merge.js — Merge PDF with full split-parity UI
// Hover overlay, per-page rotation, duplicate, delete, preview with nav/rotate/zoom

// ─── State ────────────────────────────────────────────────────────────────────
let isMergeMode = false;
let mergeFiles = [];
let mergeDraggedFileIndex = null;
let mergeDraggedPageData = null;
let mergeRenderedPages = new Map();
let currentMergeFileIndex = 0;
let mergePageOrder = [];
let mergeFolderSources = [];

// Per-page rotation: pageKey -> degrees
let mergePageRotations = new Map();

// Unique-key counter for merge duplicates
let mergeDupCounter = 0;

// Preview state
let currentMergePreviewScale = 1.5;
let mergePreviewGlobalIndex = 0;

const mergeFileColors = [
    'var(--file-color-1)', 'var(--file-color-2)', 'var(--file-color-3)',
    'var(--file-color-4)', 'var(--file-color-5)', 'var(--file-color-6)',
    'var(--file-color-7)', 'var(--file-color-8)'
];
const MERGE_THUMBNAIL_SCALE = 0.42;
const MERGE_THUMBNAIL_CONCURRENCY = 3;

Object.defineProperty(window, 'hasMergeFiles', { get: () => mergeFiles.length > 0 });

function resetMergeGridLayout() {
    const pageGrid = document.getElementById('pageGrid');
    if (!pageGrid) return;
    pageGrid.style.cssText = '';
}

function getMergePreviewFitScale(pageWidth, pageHeight) {
    const wrapper = document.getElementById('previewCanvasWrapper');
    const rect = wrapper?.getBoundingClientRect();
    const availableWidth = Math.max(240, (rect?.width || window.innerWidth * 0.92) - 28);
    const availableHeight = Math.max(240, (rect?.height || window.innerHeight * 0.82) - 28);
    return Math.max(0.3, Math.min(5, Math.min(availableWidth / pageWidth, availableHeight / pageHeight) * 0.98));
}

function setMergeActionLoading(isLoading) {
    const btn = document.getElementById('mergeBtn');
    if (!btn) return;
    if (isLoading) {
        if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
        btn.classList.add('is-processing');
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner"></span>Merging...';
    } else {
        btn.classList.remove('is-processing');
        btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
        delete btn.dataset.originalHtml;
        updateMergeButton();
    }
}

function setMergeFolderActionLoading(isLoading) {
    const btn = document.getElementById('mergeFolderExecuteBtn');
    if (!btn) return;
    if (isLoading) {
        if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
        btn.classList.add('is-processing');
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner"></span>Merging folders...';
    } else {
        btn.classList.remove('is-processing');
        btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
        delete btn.dataset.originalHtml;
        btn.disabled = mergeFolderSources.length < 2;
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function mergeDragHasFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function getMergeDroppedPdfFiles(event) {
    return Array.from(event.dataTransfer?.files || []).filter(file => {
        const name = file.name || '';
        return file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
    });
}

function setMergeDropActive(active) {
    document.querySelector('#uploadSection .upload-box')?.classList.toggle('pdf-drop-active', active);
    document.querySelectorAll('#pageGrid .add-page-item').forEach(item => {
        item.classList.toggle('pdf-drop-active', active);
    });
}

function shouldProcessPdfDrop(files) {
    const signature = Array.from(files || [])
        .map(file => `${file.name}:${file.size}:${file.lastModified}`)
        .join('|');
    const now = Date.now();
    const last = window._pdfManagerLastFileDrop || {};
    if (signature && last.signature === signature && now - last.time < 1500) {
        return false;
    }
    window._pdfManagerLastFileDrop = { signature, time: now };
    return true;
}

function handleMergeDroppedFiles(files) {
    if (!files.length) {
        showNotification('Please drop PDF files only.', 'warning');
        return;
    }
    if (!shouldProcessPdfDrop(files)) return;
    window._mergeInsertMode = false;
    handleMergeFileSelect({ target: { files, value: '' } });
}

function installMergePdfDropSupport() {
    if (window._mergePdfDropInstalled) return;
    window._mergePdfDropInstalled = true;
    let dragDepth = 0;

    const isMergeDropActive = () => window.activeTool === 'merge';
    const handleDragEnter = event => {
        if (!isMergeDropActive() || !mergeDragHasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth++;
        setMergeDropActive(true);
    };
    const handleDragOver = event => {
        if (!isMergeDropActive() || !mergeDragHasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        setMergeDropActive(true);
    };
    const handleDragLeave = event => {
        if (!isMergeDropActive() || !mergeDragHasFiles(event)) return;
        event.stopPropagation();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) setMergeDropActive(false);
    };
    const handleDrop = event => {
        if (event._pdfManagerFileDropHandled || !isMergeDropActive() || !mergeDragHasFiles(event)) return;
        event._pdfManagerFileDropHandled = true;
        event.preventDefault();
        event.stopPropagation();
        dragDepth = 0;
        setMergeDropActive(false);
        handleMergeDroppedFiles(getMergeDroppedPdfFiles(event));
    };

    ['uploadSection', 'pageContainer', 'pageGrid'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('dragenter', handleDragEnter);
        el.addEventListener('dragover', handleDragOver);
        el.addEventListener('dragleave', handleDragLeave);
        el.addEventListener('drop', handleDrop);
    });
}

function installMergeGridReorderSupport() {
    const pageGrid = document.getElementById('pageGrid');
    if (!pageGrid || pageGrid.dataset.mergeGridReorderInstalled === '1') return;
    pageGrid.dataset.mergeGridReorderInstalled = '1';
    pageGrid.addEventListener('dragover', event => window.handleMergeGridDragOver?.(event));
    pageGrid.addEventListener('drop', event => window.handleMergeGridDrop?.(event));
}

// Data-only reset — clears merge state without touching the UI.
// Called by index_enhanced.php when switching AWAY from merge mode.
window.clearMergeState = function() {
    mergeFiles        = [];
    mergePageOrder    = [];
    mergeRenderedPages.clear();
    mergePageRotations.clear();
    mergeDupCounter        = 0;
    currentMergeFileIndex  = 0;
};

// ─── Init / Reset ─────────────────────────────────────────────────────────────
window.initMerge = function() {
    installMergePdfDropSupport();
    installMergeGridReorderSupport();
    isMergeMode = true;
    const splitControls = document.getElementById('splitControls');
    const mergeControls = document.getElementById('mergeControls');
    if (splitControls) splitControls.classList.remove('show');
    if (mergeControls) mergeControls.classList.add('active');
    const titleSpan = document.querySelector('.title span');
    if (titleSpan) titleSpan.innerHTML = '<div><i class="fa fa-link"></i> Merge PDF</div>';
    resetMergeState();
};

function resetMergeState() {
    mergeFiles = [];
    mergeRenderedPages.clear();
    mergePageOrder = [];
    mergePageRotations.clear();
    mergeDupCounter = 0;
    currentMergeFileIndex = 0;

    const uploadSection = document.getElementById('uploadSection');
    const pageContainer = document.getElementById('pageContainer');
    const pageGrid = document.getElementById('pageGrid');

    if (pageContainer) { pageContainer.classList.remove('active'); pageContainer.style.display = 'none'; }
    if (pageGrid) { pageGrid.innerHTML = ''; resetMergeGridLayout(); }
    if (uploadSection) uploadSection.classList.remove('hidden');

    const prefixToggle = document.getElementById('mergeNamePrefixToggle');
    const prefixInput = document.getElementById('mergeNamePrefixInput');
    if (prefixToggle) prefixToggle.checked = false;
    if (prefixInput) {
        prefixInput.value = '';
        prefixInput.disabled = true;
    }

    updateMergeFileList();
    updateMergeButton();
}

window.resetMerge = function() {
    showConfirm('Start New Merge', 'Clear all files and start a new merge? This cannot be undone.',
        () => { resetMergeState(); showNotification('Ready for new merge', 'success'); showToast('Merge operation reset!', 'success'); }); 
};

// ─── File highlight ────────────────────────────────────────────────────────────
window.highlightFilePages = function(fileIndex) {
    document.querySelectorAll(`.page-item[data-file-index="${fileIndex}"]`).forEach(p => {
        p.style.boxShadow = '0 8px 24px var(--accent-color)';
    });
};
window.unhighlightFilePages = function(fileIndex) {
    document.querySelectorAll(`.page-item[data-file-index="${fileIndex}"]`).forEach(p => {
        p.style.boxShadow = '';
    });
};

// ─── File Upload ───────────────────────────────────────────────────────────────
async function handleMergeFileSelect(event) {
    // ── Insert-at-position mode (triggered by the between-page + button) ──────
    if (window._mergeInsertMode) {
        window._mergeInsertMode = false;
        const insertAfterPos   = _pendingInsertAfterPos ?? -1;
        _pendingInsertAfterPos = null;

        const files = Array.from(event.target.files);
        if (!files.length) { event.target.value = ''; return; }

        for (const f of files) {
            if (f.type !== 'application/pdf') { showNotification('Please select only PDF files.', 'error'); showToast('File type is not available.', 'danger');  event.target.value = ''; return; }
            if (f.size > 50 * 1024 * 1024)   { showNotification(`"${f.name}" exceeds 50MB.`, 'error'); showToast(`"${f.name}" exceeds 50MB.`, 'warning'); event.target.value = ''; return; }
        }

        showProcessing('Inserting document…');
        try {
            const inserted = [];
            for (let i = 0; i < files.length; i++) {
                const file        = files[i];
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc      = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
                currentMergeFileIndex++;
                const entry = {
                    document: pdfDoc, arrayBuffer,
                    fileIndex: currentMergeFileIndex,
                    fileName: file.name,
                    fileSize: file.size,
                    numPages: pdfDoc.numPages
                };
                mergeFiles.push(entry);
                inserted.push(entry);
            }

            hideProcessing();

            const pageGrid    = document.getElementById('pageGrid');
            const allWrappers = _getMergePageWrappers();
            let refWrapper    = allWrappers[insertAfterPos];

            // Phase 1: insert all skeletons immediately so the user sees placeholders
            const skeletonQueue = [];
            for (const fileData of inserted) {
                const { document: pdfDoc, fileIndex } = fileData;
                for (let p = 1; p <= pdfDoc.numPages; p++) {
                    const pageKey    = `${fileIndex}-${p}`;
                    const skeleton   = createMergeSkeletonItem();
                    const newWrapper = document.createElement('div');
                    newWrapper.className = 'page-item-wrapper';
                    newWrapper.appendChild(skeleton);

                    if (refWrapper && refWrapper.nextSibling) {
                        pageGrid.insertBefore(newWrapper, refWrapper.nextSibling);
                    } else {
                        const addFileWrapper = pageGrid.querySelector('.page-item-wrapper:has(.add-page-item)');
                        pageGrid.insertBefore(newWrapper, addFileWrapper || null);
                    }
                    refWrapper = newWrapper;
                    skeletonQueue.push({ wrapper: newWrapper, skeleton, pdfDoc, pageNum: p, fileIndex, pageKey });
                }
            }

            await renderMergePageSkeletonBatch(skeletonQueue);

            renumberMergePageItems();
            rebuildMergePageOrder();
            refreshMergeAddBetweenButtons();
            updateMergeFileList();
            updateMergeButton();
            showNotification(`Inserted ${inserted.reduce((s, f) => s + f.numPages, 0)} page(s)`, 'success');
            showToast('Inserted (' + inserted.reduce((s, f) => s + f.numPages, 0) + ') page(s)!', 'info');
        } catch (err) {
            hideProcessing();
            showNotification('Insert failed: ' + err.message, 'error');
            showToast('Insert failed.', 'error');
        }
        event.target.value = '';
        return; // ← done, don't fall through to normal append flow
    }

    // ── Normal append mode ────────────────────────────────────────────────────
    const files = Array.from(event.target.files);
    if (!files.length) return;

    if (files.length > 20) { showNotification('Maximum 20 PDF files allowed at once.', 'error');  showToast('Maximum 20 PDF files allowed at once.', 'error'); event.target.value = ''; return; }
    for (const f of files) {
        if (f.type !== 'application/pdf') { showNotification('Please select only PDF files.', 'error'); showToast('Please select only PDF files.', 'error'); event.target.value = ''; return; }
        if (f.size > 50 * 1024 * 1024) { showNotification(`File "${f.name}" is too large. Maximum 50MB.`, 'error'); showToast(`File "${f.name}" is too large. Maximum 50MB.`, 'error'); event.target.value = ''; return; }
    }
    if (files.reduce((s, f) => s + f.size, 0) > 100 * 1024 * 1024) {
        showNotification('Total file size exceeds 100MB.', 'error'); showToast('Total file size exceeds 100MB.', 'error'); event.target.value = ''; return;
    }

    showProcessing('Preparing files...');
    try {
        const newMergeFiles = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
            newMergeFiles.push({
                document: pdfDoc,
                arrayBuffer,
                fileIndex: currentMergeFileIndex + i + 1,
                fileName: file.name,
                fileSize: file.size,
                numPages: pdfDoc.numPages
            });
        }

        const currentTotal = mergeFiles.reduce((s, p) => s + p.numPages, 0);
        const newTotal = newMergeFiles.reduce((s, p) => s + p.numPages, 0);
        if (currentTotal + newTotal > 500) {
            hideProcessing();
            showNotification(`Total pages would be ${currentTotal + newTotal}. Maximum 500 pages allowed.`, 'error');
            showToast('Total pages would be ' + (currentTotal + newTotal) + '. Maximum 500 pages allowed.', 'error');
            event.target.value = ''; return;
        }

        currentMergeFileIndex += files.length;
        mergeFiles.push(...newMergeFiles);
        hideProcessing();

        if (mergeFiles.length > 0) {
            document.getElementById('uploadSection').classList.add('hidden');
            document.getElementById('pageContainer').classList.add('active');
            document.getElementById('mergeControls').classList.add('active');
            await appendNewMergeFiles(files.length);
            updateMergeFileList();
            showNotification(`Successfully uploaded ${files.length} file(s)!`, 'success');
            showToast('Successfully uploaded (' + files.length + ') file(s)!', 'info');
        }
    } catch (err) {
        hideProcessing();
        showNotification('Error uploading files: ' + err.message, 'error');
        showToast('Error uploading files.', 'error');
    }
    event.target.value = '';
}

// ─── Append pages with skeleton loaders ───────────────────────────────────────
async function appendNewMergeFiles(fileCount) {
    const pageGrid = document.getElementById('pageGrid');
    const addBtn = pageGrid.querySelector('.add-page-item');
    if (addBtn && addBtn.parentElement) addBtn.parentElement.remove();

    let globalPageIndex = 0;
    for (let i = 0; i < mergeFiles.length - fileCount; i++) globalPageIndex += mergeFiles[i].numPages;

    const newFiles = mergeFiles.slice(-fileCount);
    const skeletonData = [];

    for (const fileData of newFiles) {
        const { document: pdfDoc, fileIndex } = fileData;
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-item-wrapper';
            const skeleton = createMergeSkeletonItem();
            pageWrapper.appendChild(skeleton);
            pageGrid.appendChild(pageWrapper);

            const pageKey = `${fileIndex}-${i}`;
            mergePageOrder.push({ fileIndex, pageNum: i, globalIndex: globalPageIndex, pageKey });
            skeletonData.push({ wrapper: pageWrapper, skeleton, pdfDoc, pageNum: i, fileIndex, globalPageIndex, pageKey });
            globalPageIndex++;
        }
    }

    const addWrapper = document.createElement('div');
    addWrapper.className = 'page-item-wrapper';
    addWrapper.appendChild(createAddMergeFileButton());
    pageGrid.appendChild(addWrapper);

    await renderMergePageSkeletonBatch(skeletonData);

    refreshMergeAddBetweenButtons();
    updateMergeButton();
}

async function renderMergePageSkeletonBatch(skeletonData) {
    let nextIndex = 0;
    const workerCount = Math.min(MERGE_THUMBNAIL_CONCURRENCY, skeletonData.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < skeletonData.length) {
            const item = skeletonData[nextIndex++];
            await loadMergePageSequentially(item.wrapper, item.skeleton, item.pdfDoc, item.pageNum, item.fileIndex, item.globalPageIndex, item.pageKey);
            if (nextIndex % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
    });
    await Promise.all(workers);
}

async function loadMergePageSequentially(wrapper, skeleton, pdfDoc, pageNum, fileIndex, globalPageIndex, pageKey) {
    try {
        const progressBar = skeleton.querySelector('.progress-bar-fill');
        const percentEl = skeleton.querySelector('.progress-percentage');
        const labelEl = skeleton.querySelector('.progress-label');
        if (labelEl) labelEl.textContent = `Loading page ${globalPageIndex + 1}...`;

        let progress = 0;
        const iv = setInterval(() => {
            if (progress < 90) { progress += 15; if (progressBar) progressBar.style.width = progress + '%'; if (percentEl) percentEl.textContent = progress + '%'; }
        }, 80);

        const pageItem = await createMergePageItem(pdfDoc, pageNum, fileIndex, globalPageIndex, pageKey);

        clearInterval(iv);
        if (progressBar) progressBar.style.width = '100%';
        if (percentEl) percentEl.textContent = '100%';
        if (labelEl) labelEl.textContent = 'Complete!';
        wrapper.replaceChild(pageItem, skeleton);
    } catch (err) {
        console.error('Error loading merge page:', err);
        const labelEl = skeleton.querySelector('.progress-label');
        if (labelEl) labelEl.textContent = 'Error loading page';
    }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function createMergeSkeletonItem(globalPageIndex) {
    const div = document.createElement('div');
    div.className = 'skeleton-item';
 
    const pageLabel = globalPageIndex != null
        ? `Page ${globalPageIndex + 1}`
        : 'Loading…';
 
    div.innerHTML = `
        <div class="skeleton-thumbnail">
            <div class="page-progress-loader">
                <div class="progress-bar-container">
                    <div class="progress-bar-fill"></div>
                    <div class="progress-percentage">0%</div>
                </div>
                <div class="progress-label">${pageLabel}</div>
            </div>
        </div>
        <div class="skeleton-footer"></div>
    `;
 
    return div;
}

// ─── Create page item (with hover overlay) ────────────────────────────────────
async function createMergePageItem(pdfDoc, pageNum, fileIndex, globalPageIndex, pageKey) {
    if (!pageKey) pageKey = `${fileIndex}-${pageNum}`;

    const page = await pdfDoc.getPage(pageNum);

    const div = document.createElement('div');
    div.className = `page-item file-${(fileIndex - 1) % 8 + 1}`;
    div.dataset.page      = globalPageIndex;
    div.dataset.fileIndex = fileIndex;
    div.dataset.pageNum   = pageNum;
    div.dataset.pageKey   = pageKey;
    div.draggable = true;

    div.ondragstart = e => handleMergePageDragStart(e, parseInt(e.currentTarget.dataset.page));
    div.ondragover  = e => handleMergePageDragOver(e);
    div.ondrop      = e => handleMergePageDrop(e, parseInt(e.currentTarget.dataset.page));
    div.ondragend   = e => handleMergePageDragEnd(e);
    div.ondragleave = e => handleMergePageDragLeave(e);

    const thumbnail = document.createElement('div');
    thumbnail.className = 'page-thumbnail';
    thumbnail.style.position = 'relative';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const rotation = mergePageRotations.get(pageKey) || 0;
    const viewport = page.getViewport({ scale: MERGE_THUMBNAIL_SCALE, rotation });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    thumbnail.appendChild(canvas);

    // Hover overlay — identical structure to split.js
    const overlay = document.createElement('div');
    overlay.className = 'page-hover-overlay';
    overlay.innerHTML = `
        <div class="page-hover-actions">
            <button class="page-action-btn primary" title="Preview"      data-action="preview"><i class="fa fa-eye"></i></button>
            <button class="page-action-btn" title="Rotate Left"  data-action="rotate-left"><i class="fa fa-rotate-left"></i></button>
            <button class="page-action-btn" title="Rotate Right" data-action="rotate-right"><i class="fa fa-rotate-right"></i></button>
            <button class="page-action-btn" title="Duplicate"    data-action="duplicate"><i class="fa fa-copy"></i></button>
            <button class="page-action-btn danger"  title="Delete"       data-action="delete"><i class="fa fa-trash-o"></i></button>
        </div>`;

    overlay.querySelectorAll('.page-action-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const gIdx = parseInt(div.dataset.page);
            const key  = div.dataset.pageKey;
            switch (btn.dataset.action) {
                case 'preview':      openMergePreviewByIndex(gIdx), showToast('Previewing PDF page.', 'info'); break;
                case 'rotate-left':  rotateMergePageItem(div, pdfDoc, pageNum, key, -90), showToast('Rotated to left side.', 'info'); break;
                case 'rotate-right': rotateMergePageItem(div, pdfDoc, pageNum, key, 90), showToast('Rotated to right side.', 'info'); break;
                case 'duplicate':    duplicateMergePage(gIdx), showToast('Duplicating PDF page...', 'warning'); break;
                case 'delete':       deleteMergePage(gIdx); break;
            }
        });
    });

    thumbnail.appendChild(overlay);

    const footer = document.createElement('div');
    footer.className = 'page-footer';
    const pageNumber = document.createElement('span');
    pageNumber.className = 'page-number';
    pageNumber.textContent = globalPageIndex + 1;
    const fileBadge = document.createElement('span');
    fileBadge.className = 'file-badge';
    fileBadge.textContent = `File ${fileIndex}`;
    fileBadge.style.background = mergeFileColors[(fileIndex - 1) % mergeFileColors.length];
    fileBadge.style.color = 'white';
    footer.appendChild(pageNumber);
    footer.appendChild(fileBadge);

    div.appendChild(thumbnail);
    div.appendChild(footer);
    return div;
}

function createAddMergeFileButton() {
    const div = document.createElement('div');
    div.className = 'page-item add-page-item';
    div.onclick = () => document.getElementById('fileInput').click();
    div.innerHTML = `
        <div class="page-thumbnail">
                <div style="text-align:center;color:var(--text-secondary);font-size:12px;line-height:1.5;">
                <div style="font-size:28px;margin-bottom:6px;color:var(--accent-color);"><i class="fa fa-plus-circle"></i></div>
                    <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">Add PDF</div>
                </div>

        </div>`;
    return div;
}

// ─── Between-page + button ────────────────────────────────────────────────────
function createMergeAddBetweenButton(afterWrapperIndex) {
    const btn = document.createElement('div');
    btn.className = 'merge-add-between';
    btn.dataset.afterIndex = afterWrapperIndex;
    btn.innerHTML = `
        <div class="merge-add-line"></div>
        <button class="merge-add-btn" title="Insert here"><i class="fa fa-plus"></i></button>
        <div class="merge-add-tooltip" style="display:none;">
            <button class="merge-add-option" data-action="blank"><i class="fa fa-file-o"></i> Add blank page</button>
            <button class="merge-add-option" data-action="document"><i class="fa fa-folder-open"></i> Add document</button>
        </div>`;

    const addBtn    = btn.querySelector('.merge-add-btn');
    const tooltip   = btn.querySelector('.merge-add-tooltip');
    // Move tooltip to body so it's never clipped by any overflow:hidden ancestor
    document.body.appendChild(tooltip);
    const options   = tooltip.querySelectorAll('.merge-add-option');

    // Toggle tooltip — position with fixed coords so it's never off-screen
    addBtn.addEventListener('click', e => {
        e.stopPropagation();
        // Close any other open tooltips
        document.querySelectorAll('.merge-add-tooltip').forEach(t => {
            if (t !== tooltip) t.style.display = 'none';
        });
        const isOpen = tooltip.style.display !== 'none';
        if (isOpen) { tooltip.style.display = 'none'; return; }

        // Show temporarily off-screen to measure size
        tooltip.style.display = 'flex';
        tooltip.style.top  = '-9999px';
        tooltip.style.left = '-9999px';

        const btnRect = addBtn.getBoundingClientRect();
        const ttW     = tooltip.offsetWidth;
        const ttH     = tooltip.offsetHeight;
        const margin  = 6;

        // Prefer opening below the button, centred on it
        let top  = btnRect.bottom + margin;
        let left = btnRect.left + btnRect.width / 2 - ttW / 2;

        // Clamp to viewport
        if (left + ttW > window.innerWidth - margin)  left = window.innerWidth - ttW - margin;
        if (left < margin)                             left = margin;
        if (top  + ttH > window.innerHeight - margin) top  = btnRect.top - ttH - margin; // flip above

        tooltip.style.top  = top  + 'px';
        tooltip.style.left = left + 'px';
    });

    options.forEach(opt => {
        opt.addEventListener('click', e => {
            e.stopPropagation();
            tooltip.style.display = 'none';
            const action      = opt.dataset.action;
            // Read insertion point live from DOM
            const pageWrappers = _getMergePageWrappers();
            const wrapperEl    = btn.closest('.page-item-wrapper');
            const insertAfter  = pageWrappers.indexOf(wrapperEl); // insert AFTER this wrapper index

            if (action === 'blank') {
                insertMergeBlankPage(insertAfter);
            } else {
                insertMergeDocumentAt(insertAfter);
            }
        });
    });

    installMergeAddTooltipCloser();

    return btn;
}

function installMergeAddTooltipCloser() {
    if (window._mergeAddTooltipCloserInstalled) return;
    window._mergeAddTooltipCloserInstalled = true;
    document.addEventListener('click', () => {
        document.querySelectorAll('.merge-add-tooltip').forEach(t => { t.style.display = 'none'; });
    }, { capture: false });
}

// Attach a between-button to a wrapper (called after each real page wrapper is built)
function attachMergeAddBetween(wrapper) {
    // Remove any existing one first
    const existing = wrapper.querySelector('.merge-add-between');
    if (existing) existing.remove();
    const btn = createMergeAddBetweenButton(0); // index recalculated at click time
    wrapper.appendChild(btn);
}

// Refresh all between-buttons (called after any grid mutation)
function refreshMergeAddBetweenButtons() {
    // Remove all existing between buttons and their body-appended tooltips
    document.querySelectorAll('.merge-add-between').forEach(b => b.remove());
    document.querySelectorAll('.merge-add-tooltip').forEach(t => t.remove());
    // Add one to every real page wrapper
    const pageWrappers = _getMergePageWrappers();
    pageWrappers.forEach(w => attachMergeAddBetween(w));
}

// ─── Insert blank page ────────────────────────────────────────────────────────
async function insertMergeBlankPage(insertAfterPos) {
    showProcessing('Adding blank page…');
    try {
        if (!window.PDFLib) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = window.PDF_LIB_SRC || `${window.PDF_MANAGER_BASE || 'PDF-file-manager-new'}/ScriptsJS/1.17.1-pdf-lib.min.js`;
                s.onload = resolve; s.onerror = () => reject(new Error('Failed to load pdf-lib'));
                document.head.appendChild(s);
            });
        }
        const { PDFDocument } = window.PDFLib;
        const blankDoc   = await PDFDocument.create();
        blankDoc.addPage([595, 842]); // A4
        const blankUint8 = await blankDoc.save();

        // Correctly copy Uint8Array into a plain ArrayBuffer (avoid view-offset bug)
        const blankBuffer = blankUint8.buffer.slice(
            blankUint8.byteOffset,
            blankUint8.byteOffset + blankUint8.byteLength
        );

        // Load via pdfjsLib using a fresh copy of the buffer
        const blankPdfDoc = await pdfjsLib.getDocument({ data: blankUint8.slice(0) }).promise;

        currentMergeFileIndex++;
        const blankFileIndex = currentMergeFileIndex;
        mergeFiles.push({
            document: blankPdfDoc,
            arrayBuffer: blankBuffer,
            fileIndex: blankFileIndex,
            fileName: 'Blank Page',
            fileSize: blankUint8.byteLength,
            numPages: 1,
            isBlank: true
        });

        hideProcessing();

        // Place skeleton first, then render
        const pageKey    = `${blankFileIndex}-1`;
        const pageGrid   = document.getElementById('pageGrid');
        const allWrappers = _getMergePageWrappers();
        const refWrapper = allWrappers[insertAfterPos];

        const newWrapper = document.createElement('div');
        newWrapper.className = 'page-item-wrapper';
        const skeleton = createMergeSkeletonItem();
        newWrapper.appendChild(skeleton);

        if (refWrapper && refWrapper.nextSibling) {
            pageGrid.insertBefore(newWrapper, refWrapper.nextSibling);
        } else {
            const addFileWrapper = pageGrid.querySelector('.page-item-wrapper:has(.add-page-item)');
            pageGrid.insertBefore(newWrapper, addFileWrapper || null);
        }

        // Render into skeleton
        await loadMergePageSequentially(newWrapper, skeleton, blankPdfDoc, 1, blankFileIndex, 0, pageKey);

        // Add BLANK badge after render
        const pageItem = newWrapper.querySelector('.page-item');
        if (pageItem) {
            const badge = document.createElement('div');
            badge.style.cssText = 'position:absolute;top:4px;left:4px;background:rgba(100,100,100,0.82);color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;z-index:4;pointer-events:none;';
            badge.textContent = 'BLANK';
            pageItem.style.position = 'relative';
            pageItem.appendChild(badge);
        }

        renumberMergePageItems();
        rebuildMergePageOrder();
        refreshMergeAddBetweenButtons();
        updateMergeFileList();
        updateMergeButton();
        showNotification('Blank page inserted', 'success');
        showToast('Blank page inserted!', 'success');
    } catch (err) {
        hideProcessing();
        showNotification('Failed to insert blank page: ' + err.message, 'error');
        showToast('Failed to insert blank page.', 'error');
    }
}

// ─── Insert document at position ──────────────────────────────────────────────
let _pendingInsertAfterPos = null;

function insertMergeDocumentAt(insertAfterPos) {
    _pendingInsertAfterPos = insertAfterPos;
    window._mergeInsertMode = true;
    document.getElementById('fileInput').click();
}

// ─── Rotation ─────────────────────────────────────────────────────────────────
async function rotateMergePageItem(div, pdfDoc, pageNum, pageKey, delta) {
    const current = mergePageRotations.get(pageKey) || 0;
    const newRot  = ((current + delta) + 360) % 360;
    mergePageRotations.set(pageKey, newRot);

    try {
        const page    = await pdfDoc.getPage(pageNum);
        const canvas  = div.querySelector('canvas');
        if (!canvas) return;
        const viewport = page.getViewport({ scale: MERGE_THUMBNAIL_SCALE, rotation: newRot });
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (err) { console.error('Merge rotate error:', err); }
}

// ─── Duplicate ────────────────────────────────────────────────────────────────
async function duplicateMergePage(globalIndex) {
    const pageGrid = document.getElementById('pageGrid');
    const allWrappers = Array.from(pageGrid.querySelectorAll('.page-item-wrapper'));
    const sourceWrapper = allWrappers.find(w => {
        const pi = w.querySelector('.page-item:not(.add-page-item)');
        return pi && parseInt(pi.dataset.page) === globalIndex;
    });
    if (!sourceWrapper) return;
    const sourceItem = sourceWrapper.querySelector('.page-item');
    if (!sourceItem) return;

    const fileIndex = parseInt(sourceItem.dataset.fileIndex);
    const pageNum   = parseInt(sourceItem.dataset.pageNum);
    const sourceKey = sourceItem.dataset.pageKey;
    const fileData  = mergeFiles.find(f => f.fileIndex === fileIndex);
    if (!fileData) return;

    mergeDupCounter++;
    currentMergeFileIndex++;
    const duplicateFileIndex = currentMergeFileIndex;
    const duplicateFile = {
        document: fileData.document,
        arrayBuffer: fileData.arrayBuffer,
        fileIndex: duplicateFileIndex,
        fileName: `${fileData.fileName.replace(/\.pdf$/i, '')} - duplicate page ${pageNum}.pdf`,
        fileSize: fileData.fileSize,
        numPages: 1,
        isDuplicate: true,
        sourceFileIndex: fileIndex,
        sourcePageNum: pageNum
    };
    mergeFiles.push(duplicateFile);

    const dupKey = `${duplicateFileIndex}-${pageNum}-dup${mergeDupCounter}`;
    const sourceRot = mergePageRotations.get(sourceKey) || 0;
    if (sourceRot) mergePageRotations.set(dupKey, sourceRot);

    const sourceIndex = allWrappers.indexOf(sourceWrapper);
    const newItem = await createMergePageItem(fileData.document, pageNum, duplicateFileIndex, globalIndex, dupKey);

    newItem.title = 'Duplicate page';
    const badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(138,43,226,0.85);color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;z-index:4;pointer-events:none;';
    badge.textContent = 'DUP';
    newItem.style.position = 'relative';
    newItem.appendChild(badge);

    const newWrapper = document.createElement('div');
    newWrapper.className = 'page-item-wrapper';
    newWrapper.appendChild(newItem);

    const next = allWrappers[sourceIndex + 1];
    if (next) pageGrid.insertBefore(newWrapper, next);
    else pageGrid.appendChild(newWrapper);

    renumberMergePageItems();
    rebuildMergePageOrder();
    refreshMergeAddBetweenButtons();
    updateMergeFileList();
    updateMergeButton();
    showNotification('Page duplicated', 'success');
    showToast('Page duplicated!', 'info');
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function deleteMergePage(globalIndex) {
    showConfirm('Delete Page', `Remove page ${globalIndex + 1} from the merge? This only affects the current session.`, () => {
        const pageGrid = document.getElementById('pageGrid');
        const wrapper = Array.from(pageGrid.querySelectorAll('.page-item-wrapper'))
            .find(w => {
                const pi = w.querySelector('.page-item:not(.add-page-item)');
                return pi && parseInt(pi.dataset.page) === globalIndex;
            });
        if (wrapper) wrapper.remove();
        renumberMergePageItems();
        rebuildMergePageOrder();

        // ── Remove file cards for files whose pages are all gone from the grid ──
        const remainingFileIndexes = new Set(
            Array.from(pageGrid.querySelectorAll('.page-item:not(.add-page-item)'))
                .map(pi => parseInt(pi.dataset.fileIndex))
        );
        const removedAny = mergeFiles.some(f => !remainingFileIndexes.has(f.fileIndex));
        mergeFiles = mergeFiles.filter(f => remainingFileIndexes.has(f.fileIndex));

        refreshMergeAddBetweenButtons();
        updateMergeFileList();
        updateMergeButton();

        // If no pages remain at all, reset to upload view
        if (mergePageOrder.length === 0) {
            const uploadSection = document.getElementById('uploadSection');
            const pageContainer = document.getElementById('pageContainer');
            if (pageContainer) { pageContainer.classList.remove('active'); pageContainer.style.display = 'none'; }
            if (uploadSection) { uploadSection.classList.remove('hidden'); uploadSection.style.display = ''; }
        }

        showNotification('Page removed', 'success');
        showToast('Page removed!', 'info');
    });
}

// ─── Renumber + rebuild order ──────────────────────────────────────────────────
function renumberMergePageItems() {
    let n = 0;
    document.querySelectorAll('#pageGrid .page-item:not(.add-page-item)').forEach(item => {
        item.dataset.page = n;
        const numEl = item.querySelector('.page-number');
        if (numEl) numEl.textContent = n + 1;
        n++;
    });
    updateMergeButton();
}

function rebuildMergePageOrder() {
    mergePageOrder = [];
    document.querySelectorAll('#pageGrid .page-item:not(.add-page-item)').forEach(item => {
        mergePageOrder.push({
            fileIndex:   parseInt(item.dataset.fileIndex),
            pageNum:     parseInt(item.dataset.pageNum),
            pageKey:     item.dataset.pageKey,
            globalIndex: parseInt(item.dataset.page)
        });
    });
}

// ─── Page drag — smart insert-between / swap ──────────────────────────────────

// Tracks the current live drop target state
let _mergeDropTarget = null;  // { wrapperIndex, side: 'left'|'right'|'center' }

/**
 * Return the wrapper index (among non-add page wrappers) for a given .page-item element.
 */
function _getMergePageWrappers() {
    const pageGrid = document.getElementById('pageGrid');
    return Array.from(pageGrid.querySelectorAll('.page-item-wrapper:not(:has(.add-page-item))'));
}

function _clearMergeDropIndicators() {
    document.querySelectorAll('#pageGrid .page-item-wrapper').forEach(w => {
        w.classList.remove('drop-insert-before', 'drop-insert-after', 'drop-swap');
        // Remove animated push classes from neighbours
        w.classList.remove('push-right', 'push-left');
    });
    _mergeDropTarget = null;
}

/**
 * Given a dragover event on a .page-item, figure out whether it's
 * left-zone (insert before), right-zone (insert after), or center (swap).
 *
 * - Left 30% of card  → insert before
 * - Right 30% of card → insert after  
 * - Middle 40%        → swap
 */
function _getMergeDropSide(event, element) {
    const rect = element.getBoundingClientRect();
    const x    = event.clientX - rect.left;
    const pct  = x / rect.width;
    if (pct < 0.30) return 'left';
    if (pct > 0.70) return 'right';
    return 'center';
}

function _getMergeGridGapDropTarget(event) {
    const pageWrappers = _getMergePageWrappers();
    if (!pageWrappers.length) return null;

    const rows = [];
    pageWrappers.forEach((wrapper, index) => {
        const rect = wrapper.getBoundingClientRect();
        let row = rows.find(r => Math.abs(r.top - rect.top) < 12);
        if (!row) {
            row = { top: rect.top, bottom: rect.bottom, items: [] };
            rows.push(row);
        }
        row.top = Math.min(row.top, rect.top);
        row.bottom = Math.max(row.bottom, rect.bottom);
        row.items.push({ index, rect });
    });

    const row = rows.find(r => event.clientY >= r.top - 16 && event.clientY <= r.bottom + 16);
    if (!row) return null;

    row.items.sort((a, b) => a.rect.left - b.rect.left);
    const first = row.items[0];
    const last = row.items[row.items.length - 1];

    if (event.clientX < first.rect.left) return { wrapperIndex: first.index, side: 'left' };
    if (event.clientX > last.rect.right) return { wrapperIndex: last.index, side: 'right' };
    return null;
}

function _showMergeDropTarget(wrapperIndex, side) {
    const pageWrappers = _getMergePageWrappers();
    const wrapper = pageWrappers[wrapperIndex];
    if (!wrapper) return;

    if (_mergeDropTarget &&
        _mergeDropTarget.wrapperIndex === wrapperIndex &&
        _mergeDropTarget.side === side) return;

    _clearMergeDropIndicators();
    _mergeDropTarget = { wrapperIndex, side };

    if (side === 'center') {
        wrapper.classList.add('drop-swap');
    } else if (side === 'left') {
        wrapper.classList.add('drop-insert-before');
        wrapper.classList.add('push-right');
    } else {
        wrapper.classList.add('drop-insert-after');
        const next = pageWrappers[wrapperIndex + 1];
        if (next && !next.querySelector('.dragging')) next.classList.add('push-right');
    }
}

function _performMergePageDrop(wrapperIndex, side) {
    if (!mergeDraggedPageData) return;

    const pageWrappers = _getMergePageWrappers();
    const fromWrapper = mergeDraggedPageData.element.closest('.page-item-wrapper');
    if (!fromWrapper) return;

    const fromPos = pageWrappers.indexOf(fromWrapper);
    const targetPos = wrapperIndex;
    if (fromPos === -1 || targetPos === -1) return;

    if (side === 'center') {
        if (fromPos !== targetPos) swapMergePagesByPos(fromPos, targetPos, pageWrappers);
        return;
    }

    let insertPos = targetPos;
    if (side === 'right') insertPos += 1;
    if (fromPos !== insertPos && fromPos !== insertPos - 1) {
        insertMergePageByPos(fromPos, insertPos, pageWrappers);
    }
}

window.handleMergePageDragStart = function(event, globalIndex) {
    mergeDraggedPageData = { globalIndex, element: event.currentTarget };
    event.currentTarget.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
};

window.handleMergePageDragOver = function(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.stopPropagation();

    const target = event.currentTarget;
    if (target.classList.contains('dragging') || target.classList.contains('add-page-item')) return;

    const side = _getMergeDropSide(event, target);
    const wrapper = target.closest('.page-item-wrapper');
    if (!wrapper) return;

    const pageWrappers = _getMergePageWrappers();
    const wrapperIndex = pageWrappers.indexOf(wrapper);
    if (wrapperIndex === -1) return;

    _showMergeDropTarget(wrapperIndex, side);
};

window.handleMergePageDrop = function(event, _unused) {
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const side = _getMergeDropSide(event, target);
    if (!mergeDraggedPageData) return;

    const pageWrappers = _getMergePageWrappers();
    const targetWrapper = target.closest('.page-item-wrapper');
    if (!targetWrapper) return;

    const targetPos = pageWrappers.indexOf(targetWrapper);
    _clearMergeDropIndicators();
    if (targetPos === -1) return;

_performMergePageDrop(targetPos, side);
};
window.handleMergeGridDragOver = function(event) {
    if (!mergeDraggedPageData || mergeDragHasFiles(event)) return;
    if (event.target.closest('.page-item:not(.add-page-item)')) return;

    const target = _getMergeGridGapDropTarget(event);
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    _showMergeDropTarget(target.wrapperIndex, target.side);
};

window.handleMergeGridDrop = function(event) {
    if (!mergeDraggedPageData || mergeDragHasFiles(event)) return;
    if (event.target.closest('.page-item:not(.add-page-item)')) return;

    const target = _mergeDropTarget || _getMergeGridGapDropTarget(event);
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    _clearMergeDropIndicators();
    _performMergePageDrop(target.wrapperIndex, target.side);
};

window.handleMergePageDragEnd = function(event) {
    event.currentTarget.classList.remove('dragging');
    _clearMergeDropIndicators();
    mergeDraggedPageData = null;
};

window.handleMergePageDragLeave = function(event) {
    // Don't clear here — dragOver handles updates; dragEnd does final cleanup
};

// ─── Swap two pages by DOM wrapper position ───────────────────────────────────
function swapMergePagesByPos(fromPos, toPos, pageWrappers) {
    const pageGrid   = document.getElementById('pageGrid');
    const addWrapper = pageGrid.querySelector('.page-item-wrapper:has(.add-page-item)');

    // Swap in array then re-append
    [pageWrappers[fromPos], pageWrappers[toPos]] = [pageWrappers[toPos], pageWrappers[fromPos]];

    pageGrid.innerHTML = '';
    pageWrappers.forEach(w => pageGrid.appendChild(w));
    if (addWrapper) pageGrid.appendChild(addWrapper);

    renumberMergePageItems();
    rebuildMergePageOrder();
    refreshMergeAddBetweenButtons();
    showNotification('Pages swapped', 'success');
    showToast('Pages swapped!', 'info');
}

// ─── Insert page at target wrapper position ───────────────────────────────────
function insertMergePageByPos(fromPos, insertPos, pageWrappers) {
    const pageGrid   = document.getElementById('pageGrid');
    const addWrapper = pageGrid.querySelector('.page-item-wrapper:has(.add-page-item)');

    const [moved] = pageWrappers.splice(fromPos, 1);
    // After removal, adjust insertPos if source was before it
    const adjustedInsert = fromPos < insertPos ? insertPos - 1 : insertPos;
    const clamped = Math.max(0, Math.min(adjustedInsert, pageWrappers.length));
    pageWrappers.splice(clamped, 0, moved);

    pageGrid.innerHTML = '';
    pageWrappers.forEach(w => pageGrid.appendChild(w));
    if (addWrapper) pageGrid.appendChild(addWrapper);

    renumberMergePageItems();
    rebuildMergePageOrder();
    refreshMergeAddBetweenButtons();
    showNotification('Page inserted', 'success');
    showToast('Page inserted!', 'info');
}

// ─── File drag ────────────────────────────────────────────────────────────────
window.handleMergeFileDragStart = function(event, index) {
    mergeDraggedFileIndex = index;
    event.currentTarget.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
};
window.handleMergeFileDragOver = function(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!event.currentTarget.classList.contains('dragging')) event.currentTarget.classList.add('drag-over');
};
window.handleMergeFileDrop = function(event, targetIndex) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    if (mergeDraggedFileIndex !== null && mergeDraggedFileIndex !== targetIndex) {
        const [removed] = mergeFiles.splice(mergeDraggedFileIndex, 1);
        mergeFiles.splice(targetIndex, 0, removed);
        rebuildMergePageGrid();
    }
};
window.handleMergeFileDragEnd = function(event) {
    event.currentTarget.classList.remove('dragging');
    mergeDraggedFileIndex = null;
};
window.handleMergeFileDragLeave = function(event) {
    event.currentTarget.classList.remove('drag-over');
};

// ─── Rebuild full grid ────────────────────────────────────────────────────────
async function rebuildMergePageGrid() {
    const pageGrid = document.getElementById('pageGrid');
    resetMergeGridLayout();
    pageGrid.innerHTML = '';
    mergePageOrder = [];

    let globalPageIndex = 0;
    for (const fileData of mergeFiles) {
        const { document: pdfDoc, fileIndex } = fileData;
        const pagesToRender = fileData.isDuplicate
            ? [fileData.sourcePageNum || 1]
            : Array.from({ length: pdfDoc.numPages }, (_, index) => index + 1);
        for (const i of pagesToRender) {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-item-wrapper';
            const pageKey = fileData.isDuplicate ? `${fileIndex}-${i}-dup` : `${fileIndex}-${i}`;
            mergePageOrder.push({ fileIndex, pageNum: i, globalIndex: globalPageIndex, pageKey });
            const pageItem = await createMergePageItem(pdfDoc, i, fileIndex, globalPageIndex, pageKey);
            if (fileData.isDuplicate) {
                const badge = document.createElement('div');
                badge.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(138,43,226,0.85);color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;z-index:4;pointer-events:none;';
                badge.textContent = 'DUP';
                pageItem.style.position = 'relative';
                pageItem.appendChild(badge);
            }
            pageWrapper.appendChild(pageItem);
            pageGrid.appendChild(pageWrapper);
            globalPageIndex++;
        }
    }

    const addWrapper = document.createElement('div');
    addWrapper.className = 'page-item-wrapper';
    addWrapper.appendChild(createAddMergeFileButton());
    pageGrid.appendChild(addWrapper);

    refreshMergeAddBetweenButtons();
    updateMergeFileList();
    updateMergeButton();
}

// ─── File list ────────────────────────────────────────────────────────────────
function updateMergeFileList() {
    const container = document.getElementById('filesContainer');
    const panelTitle = document.getElementById('panelTitle');
    if (panelTitle) panelTitle.innerHTML = `<i class="fa fa-folder-open"></i> Files to Merge (${mergeFiles.length})`;
    if (!container) return;

    if (!mergeFiles.length) {
        container.innerHTML = `<div class="empty-files"><div style="font-size:32px;margin-bottom:6px"><i class="fa fa-file-pdf-o"></i></div><span>Upload PDFs to merge</span></div>`;
        return;
    }

    container.innerHTML = mergeFiles.map((file, index) => {
        const color = mergeFileColors[(file.fileIndex - 1) % mergeFileColors.length];
        return `
            <div class="file-card file-${file.fileIndex}" data-file-index="${file.fileIndex}" draggable="true" data-index="${index}"
                 onmouseenter="highlightFilePages(${file.fileIndex})" onmouseleave="unhighlightFilePages(${file.fileIndex})"
                 ondragstart="handleMergeFileDragStart(event,${index})" ondragover="handleMergeFileDragOver(event)"
                 ondrop="handleMergeFileDrop(event,${index})" ondragend="handleMergeFileDragEnd(event)"
                 ondragleave="handleMergeFileDragLeave(event)">
                <div class="file-icon" style="color:${color}"><div style="font-size:28px;margin-bottom:6px"><i class="fa fa-file-pdf-o"></i></div></div>
                <div class="file-info">
                    <div class="file-name">${file.fileName}</div>
                    <div class="file-meta">
                        <span>${file.numPages} pages</span>
                        <span class="file-pages" style="background:${color}20;color:${color}">File ${file.fileIndex}</span>
                    </div>
                </div>
                <button class="file-remove" onclick="removeMergeFile(${index},event)" title="Remove">
                    <i class="fa fa-trash-o" style="font-size:20px;"></i> 
                </button>
            </div>`;
    }).join('');
}

function updateMergeButton() {
    const mergeBtn = document.getElementById('mergeBtn');
    const mergeCountBtn = document.getElementById('mergeCountBtn');
    const mergeFilesText = document.getElementById('mergeFilesText');
    const mergeTotalPages = document.getElementById('mergeTotalPages');
    if (!mergeBtn) return;

    const livePageItems = Array.from(document.querySelectorAll('#pageGrid .page-item:not(.add-page-item)'));
    const livePages = livePageItems.length || mergeFiles.reduce((s, f) => s + f.numPages, 0);
    const liveFileIndexes = new Set(livePageItems.map(item => parseInt(item.dataset.fileIndex)).filter(Number.isFinite));
    const liveFiles = liveFileIndexes.size || mergeFiles.length;
    if (mergeCountBtn)   mergeCountBtn.textContent  = liveFiles;
    if (mergeFilesText)  mergeFilesText.textContent  = `files (${livePages} pages)`;
    if (mergeTotalPages) mergeTotalPages.textContent = `Total: ${livePages} pages from ${liveFiles} files`;
    mergeBtn.disabled = liveFiles < 2 || livePages < 1;
    mergeBtn.onclick = executeMerge;
}

function getMergeTotalPages() { return getMergeDOMTotalPages() || mergeFiles.reduce((s, f) => s + f.numPages, 0); }
function getMergeDOMTotalPages() { return document.querySelectorAll('#pageGrid .page-item:not(.add-page-item)').length; }

// ─── Preview ───────────────────────────────────────────────────────────────────
function getMergePageInfoFromDOM(globalIndex) {
    const item = document.querySelector(`#pageGrid .page-item:not(.add-page-item)[data-page="${globalIndex}"]`);
    if (!item) return null;
    const fileIndex = parseInt(item.dataset.fileIndex);
    const pageNum   = parseInt(item.dataset.pageNum);
    const pageKey   = item.dataset.pageKey;
    const fileData  = mergeFiles.find(f => f.fileIndex === fileIndex);
    if (!fileData) return null;
    return { fileData, pageNum, pageKey };
}

window.openMergePreview = async function(fileIndex, pageNum) {
    let globalIndex = -1;
    document.querySelectorAll('#pageGrid .page-item:not(.add-page-item)').forEach(el => {
        if (globalIndex < 0 && parseInt(el.dataset.fileIndex) === fileIndex && parseInt(el.dataset.pageNum) === pageNum) {
            globalIndex = parseInt(el.dataset.page);
        }
    });
    if (globalIndex >= 0) openMergePreviewByIndex(globalIndex);
};

async function openMergePreviewByIndex(globalIndex) {
    const info = getMergePageInfoFromDOM(globalIndex);
    if (!info) return;

    mergePreviewGlobalIndex = globalIndex;

    const modal = document.getElementById('previewModal');
    modal?.classList.add('active');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const pg = await info.fileData.document.getPage(info.pageNum);
    const vp = pg.getViewport({ scale: 1 });
    currentMergePreviewScale = getMergePreviewFitScale(vp.width, vp.height);

    await renderMergePreview();
}

async function renderMergePreview() {
    const info = getMergePageInfoFromDOM(mergePreviewGlobalIndex);
    if (!info) return;

    const wrapper = document.getElementById('previewCanvasWrapper');
    wrapper.innerHTML = '';

    const page     = await info.fileData.document.getPage(info.pageNum);
    const rotation = mergePageRotations.get(info.pageKey) || 0;
    const canvas   = document.createElement('canvas');
    const ctx      = canvas.getContext('2d');
    const viewport = page.getViewport({ scale: currentMergePreviewScale, rotation });
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    wrapper.appendChild(canvas);

    const zoomEl = document.getElementById('previewZoomLevel');
    if (zoomEl) zoomEl.textContent = Math.round(currentMergePreviewScale * 100) + '%';
    updateMergePreviewNavUI();
}

function updateMergePreviewNavUI() {
    const total   = getMergeDOMTotalPages();
    const counter = document.getElementById('previewPageCounter');
    const prevBtn = document.getElementById('previewPrevBtn');
    const nextBtn = document.getElementById('previewNextBtn');
    if (counter) counter.textContent = `${mergePreviewGlobalIndex + 1} / ${total}`;
    if (prevBtn) prevBtn.disabled = mergePreviewGlobalIndex <= 0;
    if (nextBtn) nextBtn.disabled = mergePreviewGlobalIndex >= total - 1;
}

// ─── Preview dispatchers ──────────────────────────────────────────────────────
window.zoomPreview = function(delta) {
    if (window.activeTool === 'split') { window.splitZoomPreview?.(delta); return; }
    currentMergePreviewScale = Math.max(0.3, Math.min(5, currentMergePreviewScale + delta));
    renderMergePreview();
};

window.fitPreview = function() {
    if (window.activeTool === 'split') { window.splitFitPreview?.(); return; }
    openMergePreviewByIndex(mergePreviewGlobalIndex);
};

window.navigatePreview = function(delta) {
    if (window.activeTool === 'split') { window.splitNavigatePreview?.(delta); return; }
    const newIdx = mergePreviewGlobalIndex + delta;
    if (newIdx < 0 || newIdx >= getMergeDOMTotalPages()) return;
    openMergePreviewByIndex(newIdx);
};

window.rotatePreview = async function(degrees) {
    if (window.activeTool === 'split') { window.splitRotatePreview?.(degrees); return; }
    const info = getMergePageInfoFromDOM(mergePreviewGlobalIndex);
    if (!info) return;
    const gridItem = document.querySelector(`#pageGrid .page-item[data-page="${mergePreviewGlobalIndex}"]`);
    if (gridItem) await rotateMergePageItem(gridItem, info.fileData.document, info.pageNum, info.pageKey, degrees);
    else { const c = mergePageRotations.get(info.pageKey) || 0; mergePageRotations.set(info.pageKey, ((c + degrees) + 360) % 360); }
    await renderMergePreview();
};

window.deletePreviewPage = function() {
    if (window.activeTool === 'split') { window.splitDeletePreviewPage?.(); return; }
    const idx = mergePreviewGlobalIndex;
    window.closePreview({ target: { classList: { contains: () => true } } });
    deleteMergePage(idx);
};

window.closePreview = function(event) {
    if (!event || event.target.classList.contains('preview-modal') || event.target.classList.contains('preview-close')) {
        const modal = document.getElementById('previewModal');
        if (modal) modal.classList.remove('active');
    }
};

// ─── File management ──────────────────────────────────────────────────────────
window.removeMergeFile = function(index, event) {
    if (event) event.stopPropagation();
    const fileName = mergeFiles[index].fileName;
    showConfirm('Remove File', `Remove "${fileName}" from the merge list?`, () => {
        mergeFiles.splice(index, 1);
        if (!mergeFiles.length) resetMergeState();
        else rebuildMergePageGrid();
        updateMergeFileList();
        updateMergeButton();
        showNotification('File removed', 'success');
        showToast('File removed!', 'info');
    }); 
};

window.addMoreMergeFiles = function() { document.getElementById('fileInput').click(); };

window.toggleMergeNamePrefixInput = function(checked) {
    const input = document.getElementById('mergeNamePrefixInput');
    if (!input) return;
    input.disabled = !checked;
    if (checked) input.focus();
};

function getMergeOutputFilename() {
    const baseName = mergeFiles[0]?.fileName?.replace(/\.pdf$/i, '') || 'merged';
    const prefixEnabled = document.getElementById('mergeNamePrefixToggle')?.checked === true;
    const rawPrefix = prefixEnabled ? (document.getElementById('mergeNamePrefixInput')?.value || '') : '';
    const prefix = rawPrefix.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
    return prefix ? `${prefix}_${baseName}.pdf` : `${baseName}_merged.pdf`;
}

window.clearAllMergeFiles = function() {
    if (!mergeFiles.length) return;
    showConfirm('Clear All Files', 'Remove all files from the merge list?', () => {
        resetMergeState(); showNotification('All files cleared', 'success'); showToast('Selected files cleared!', 'success');
    });
};

// ─── Execute Merge (client-side via pdf-lib) ───────────────────────────────────
function ensureMergeFolderInput() {
    let input = document.getElementById('mergeFolderInput');
    if (input) return input;
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'mergeFolderInput';
    input.accept = '.pdf,application/pdf';
    input.multiple = true;
    input.webkitdirectory = true;
    input.directory = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.setAttribute('multiple', '');
    input.className = 'file-input';
    input.style.display = 'none';
    input.addEventListener('change', handleMergeFolderUpload);
    document.body.appendChild(input);
    return input;
}

function getMergeFolderModal() {
    let modal = document.getElementById('mergeFolderModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'mergeFolderModal';
    modal.className = 'merge-folder-modal';
    modal.innerHTML = `
        <div class="merge-folder-dialog">
            <div class="merge-folder-header">
                <div>
                    <h3><i class="fa fa-folder-open"></i> Merge by Folders</h3>
                    <p>Add folders in the exact order you want their matching PDFs merged.</p>
                </div>
                <button type="button" class="merge-folder-close" onclick="closeMergeFolderMode()" title="Close"><i class="fa fa-times"></i></button>
            </div>
            <div class="merge-folder-body">
                <div id="mergeFolderDropZone" class="merge-folder-drop-zone">
                    <div class="merge-folder-drop-icon"><i class="fa fa-cloud-upload"></i></div>
                    <strong>Drop main folders here</strong>
                    <span>Each dropped main folder becomes Folder 1, Folder 2, and so on. Course subfolders stay nested under that folder.</span>
                </div>
                <div class="merge-folder-actions">
                    <button type="button" class="btn btn-secondary" onclick="chooseMergeFolder()"><i class="fa fa-folder-open"></i> Browse Folder</button>
                    <button type="button" class="btn btn-secondary" onclick="clearMergeFolders()"><i class="fa fa-trash-o"></i> Clear</button>
                </div>
                <div class="merge-folder-help">
                    Matching uses the course and student name in the PDF filename. Suffixes like <code>_Annex-B</code>, <code>_Annex-D</code>, and <code>_Annex-F</code> are ignored. Browser folder browsing may show Chrome's security prompt; drag-and-drop uses this app modal flow.
                </div>
                <div id="mergeFolderList" class="merge-folder-list"></div>
                <div id="mergeFolderSummary" class="merge-folder-summary"></div>
            </div>
            <div class="merge-folder-footer">
                <button type="button" class="btn btn-secondary" onclick="closeMergeFolderMode()">Cancel</button>
                <button type="button" class="btn btn-primary" id="mergeFolderExecuteBtn" onclick="reviewMergeFolderMode()" disabled>
                    <i class="fa fa-compress"></i> Merge Matching PDFs
                </button>
            </div>
        </div>`;
    modal.addEventListener('click', event => {
        if (event.target === modal) closeMergeFolderMode();
    });
    document.body.appendChild(modal);
    installMergeFolderDropZone(modal);
    return modal;
}

function getMergeFolderName(file) {
    const rel = getMergeFileRelativePath(file);
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    return parts.length > 1 ? parts[0] : 'Selected folder';
}

function getMergeFileRelativePath(file) {
    return file.webkitRelativePath || file.relativePath || file._mergeRelativePath || file.name || '';
}

function getMergeRelativeParts(file) {
    const rel = getMergeFileRelativePath(file);
    return rel.split(/[\\/]+/).filter(Boolean);
}

function inferMergeFolderSourceDepth(files) {
    const partsList = files.map(getMergeRelativeParts).filter(parts => parts.length > 2);
    if (!partsList.length) return 0;
    const topFolders = new Set(partsList.map(parts => parts[0]));
    const secondFolders = new Set(partsList.map(parts => parts[1]).filter(Boolean));
    return topFolders.size === 1 && secondFolders.size > 1 ? 1 : 0;
}

function getMergeFolderKey(folderName) {
    return (folderName || 'Selected folder').trim().toLowerCase();
}

function getMergeEntrySubfolder(parts, sourceDepth) {
    if (parts.length <= sourceDepth + 2) return '';
    return parts.slice(sourceDepth + 1, -1).join('/');
}

function normalizeMergeSubfolder(subfolder) {
    return (subfolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function setMergeDroppedFilePath(file, relativePath) {
    try {
        Object.defineProperty(file, '_mergeRelativePath', {
            value: relativePath,
            configurable: true
        });
    } catch (err) {
        file._mergeRelativePath = relativePath;
    }
    return file;
}

function getMergeBaseName(fileName) {
    let key = (fileName || '').replace(/\.pdf$/i, '').trim();
    key = key.replace(/_(annex[-\s]?[a-z]|curriculum|stamped|merged)$/i, '');
    key = key.replace(/\s*-\s*(annex[-\s]?[a-z]|curriculum|stamped|merged)$/i, '');
    key = key.replace(/\s+/g, ' ').trim();
    return key;
}

function getMergeGroupKey(fileName) {
    return getMergeBaseName(fileName).toLowerCase();
}

function getSafeMergeFolderFilename(baseName, usedNames, folderPath = '') {
    const clean = (baseName || 'merged')
        .replace(/\.pdf$/i, '')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[-_.]+|[-_.]+$/g, '') || 'merged';
    let name = `${clean}.pdf`;
    let i = 2;
    const makeKey = value => `${folderPath || ''}/${value}`.toLowerCase();
    while (usedNames.has(makeKey(name))) {
        name = `${clean} (${i}).pdf`;
        i++;
    }
    usedNames.add(makeKey(name));
    return name;
}

function buildMergeFolderGroups() {
    const groups = new Map();
    mergeFolderSources.forEach((source, sourceIndex) => {
        source.files.forEach(entry => {
            const key = `${entry.subfolder.toLowerCase()}::${getMergeGroupKey(entry.originalName)}`;
            if (!key) return;
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    displayName: getMergeBaseName(entry.originalName),
                    subfolder: entry.subfolder,
                    sources: new Map()
                });
            }
            const group = groups.get(key);
            if (!group.sources.has(sourceIndex)) group.sources.set(sourceIndex, entry);
        });
    });
    return Array.from(groups.values())
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function analyzeMergeFolderGroups() {
    const groups = buildMergeFolderGroups();
    const completeGroups = groups.filter(group => group.sources.size === mergeFolderSources.length);
    const skippedGroups = groups.filter(group => group.sources.size !== mergeFolderSources.length);
    const skippedFiles = [];

    skippedGroups.forEach(group => {
        const present = [];
        const missing = [];
        mergeFolderSources.forEach((source, index) => {
            if (group.sources.has(index)) present.push(source.name);
            else missing.push(source.name);
        });
        group.sources.forEach((entry, sourceIndex) => {
            skippedFiles.push({
                folder: mergeFolderSources[sourceIndex]?.name || `Folder ${sourceIndex + 1}`,
                subfolder: group.subfolder,
                filename: entry.originalName,
                outputName: getMergeBaseName(entry.originalName),
                missing
            });
        });
        group.presentFolders = present;
        group.missingFolders = missing;
    });

    return { groups, completeGroups, skippedGroups, skippedFiles };
}

function getMergeSourceSubfolderRows(source) {
    const counts = new Map();
    source.files.forEach(entry => {
        const label = entry.subfolder || '(root)';
        counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count }));
}

function renderMergeFolderList() {
    const list = document.getElementById('mergeFolderList');
    const summary = document.getElementById('mergeFolderSummary');
    const btn = document.getElementById('mergeFolderExecuteBtn');
    if (!list || !summary) return;

    if (!mergeFolderSources.length) {
        list.innerHTML = `
            <div class="merge-folder-empty">
                <i class="fa fa-folder-o"></i>
                <span>No folders added yet</span>
            </div>`;
        summary.textContent = 'Add at least 2 folders to merge matching filenames.';
    } else {
        list.innerHTML = mergeFolderSources.map((source, index) => `
            <div class="merge-folder-row" draggable="true" data-folder-index="${index}">
                <div class="merge-folder-order" title="Drag to reorder"><i class="fa fa-bars"></i><span>${index + 1}</span></div>
                <div class="merge-folder-details">
                    <strong>${escapeHtml(source.name)}</strong>
                    <span>${source.files.length} PDF${source.files.length === 1 ? '' : 's'} from ${getMergeSourceSubfolderRows(source).length} subfolder${getMergeSourceSubfolderRows(source).length === 1 ? '' : 's'}</span>
                    <div class="merge-folder-subfolders">
                        ${getMergeSourceSubfolderRows(source).slice(0, 8).map(row => `
                            <div class="merge-folder-subfolder">
                                <i class="fa fa-folder-o"></i>
                                <span>${escapeHtml(row.name)}</span>
                                <small>${row.count}</small>
                            </div>`).join('')}
                        ${getMergeSourceSubfolderRows(source).length > 8 ? `<div class="merge-folder-subfolder-more">+ ${getMergeSourceSubfolderRows(source).length - 8} more subfolders</div>` : ''}
                    </div>
                </div>
                <button type="button" class="merge-folder-remove" onclick="removeMergeFolderSource(${index})" title="Remove folder">
                    <i class="fa fa-trash-o"></i>
                </button>
            </div>`).join('');
        installMergeFolderRowDrag(list);
        const analysis = analyzeMergeFolderGroups();
        const skippedText = analysis.skippedFiles.length ? ` ${analysis.skippedFiles.length} unmatched PDF${analysis.skippedFiles.length === 1 ? '' : 's'} will be skipped unless matching files are added.` : '';
        summary.textContent = `${analysis.completeGroups.length} complete matching group${analysis.completeGroups.length === 1 ? '' : 's'} found across ${mergeFolderSources.length} folders.${skippedText}`;
    }
    if (btn) btn.disabled = mergeFolderSources.length < 2;
}

function installMergeFolderRowDrag(list) {
    let dragIndex = null;
    list.querySelectorAll('.merge-folder-row').forEach(row => {
        row.addEventListener('dragstart', event => {
            dragIndex = Number(row.dataset.folderIndex);
            row.classList.add('is-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(dragIndex));
            }
        });
        row.addEventListener('dragover', event => {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            row.classList.add('is-drop-target');
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('is-drop-target');
        });
        row.addEventListener('drop', event => {
            event.preventDefault();
            row.classList.remove('is-drop-target');
            const targetIndex = Number(row.dataset.folderIndex);
            const fromIndex = Number.isInteger(dragIndex) ? dragIndex : Number(event.dataTransfer?.getData('text/plain'));
            if (!Number.isInteger(fromIndex) || fromIndex === targetIndex) return;
            const [moved] = mergeFolderSources.splice(fromIndex, 1);
            mergeFolderSources.splice(targetIndex, 0, moved);
            renderMergeFolderList();
        });
        row.addEventListener('dragend', () => {
            dragIndex = null;
            list.querySelectorAll('.merge-folder-row').forEach(item => item.classList.remove('is-dragging', 'is-drop-target'));
        });
    });
}

window.openMergeFolderMode = function() {
    getMergeFolderModal().classList.add('active');
    ensureMergeFolderInput();
    renderMergeFolderList();
};

window.closeMergeFolderMode = function() {
    document.getElementById('mergeFolderModal')?.classList.remove('active');
};

window.chooseMergeFolder = function() {
    const input = ensureMergeFolderInput();
    input.value = '';
    input.click();
};

window.clearMergeFolders = function() {
    if (!mergeFolderSources.length) return;
    showConfirm('Clear Folders', 'Remove all selected merge folders?', () => {
        mergeFolderSources = [];
        renderMergeFolderList();
        showToast('Merge folders cleared.', 'info');
    });
};

window.removeMergeFolderSource = function(index) {
    mergeFolderSources.splice(index, 1);
    renderMergeFolderList();
};

function installMergeFolderDropZone(modal) {
    const dropZone = modal.querySelector('#mergeFolderDropZone');
    if (!dropZone || dropZone.dataset.installed === '1') return;
    dropZone.dataset.installed = '1';

    const setActive = active => dropZone.classList.toggle('is-dragging', active);

    ['dragenter', 'dragover'].forEach(type => {
        dropZone.addEventListener(type, event => {
            event.preventDefault();
            event.stopPropagation();
            setActive(true);
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        });
    });

    ['dragleave', 'dragend'].forEach(type => {
        dropZone.addEventListener(type, event => {
            event.preventDefault();
            event.stopPropagation();
            if (!dropZone.contains(event.relatedTarget)) setActive(false);
        });
    });

    dropZone.addEventListener('drop', async event => {
        event.preventDefault();
        event.stopPropagation();
        setActive(false);
        showProcessing('Reading dropped folders...');
        try {
            const files = await getMergeDroppedFolderFiles(event);
            hideProcessing();
            addMergeFolderFiles(files);
        } catch (err) {
            hideProcessing();
            showNotification('Could not read dropped folder: ' + err.message, 'error');
        }
    });
}

async function getMergeDroppedFolderFiles(event) {
    const items = Array.from(event.dataTransfer?.items || []);
    const entries = items
        .map(item => typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null)
        .filter(Boolean);

    if (entries.length) {
        const nested = await Promise.all(entries.map(entry => readMergeFileEntry(entry, '')));
        return nested.flat().filter(Boolean);
    }

    return Array.from(event.dataTransfer?.files || []).filter(Boolean);
}

function readMergeDirectoryEntries(reader) {
    return new Promise((resolve, reject) => {
        const entries = [];
        const readBatch = () => {
            reader.readEntries(batch => {
                if (!batch.length) {
                    resolve(entries);
                    return;
                }
                entries.push(...batch);
                readBatch();
            }, reject);
        };
        readBatch();
    });
}

async function readMergeFileEntry(entry, parentPath) {
    const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
        return new Promise((resolve, reject) => {
            entry.file(file => {
                resolve(setMergeDroppedFilePath(file, currentPath));
            }, reject);
        });
    }
    if (entry.isDirectory) {
        const children = await readMergeDirectoryEntries(entry.createReader());
        const nested = await Promise.all(children.map(child => readMergeFileEntry(child, currentPath)));
        return nested.flat();
    }
    return [];
}

function handleMergeFolderUpload(event) {
    const input = event.target;
    const files = Array.from(input.files || []).filter(file => {
        const name = file.name || '';
        return file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
    });
    if (!files.length) {
        showNotification('The selected folder has no PDF files.', 'warning');
        input.value = '';
        return;
    }

    addMergeFolderFiles(files);
    input.value = '';
}

function addMergeFolderFiles(files) {
    const pdfFiles = Array.from(files || []).filter(file => {
        const name = file.name || '';
        return file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
    });
    if (!pdfFiles.length) {
        showNotification('The selected folder has no PDF files.', 'warning');
        return;
    }

    const sourceDepth = 0;
    const folders = new Map();
    pdfFiles.forEach(file => {
        const parts = getMergeRelativeParts(file);
        const folderName = parts[sourceDepth] || getMergeFolderName(file);
        const key = getMergeFolderKey(folderName);
        if (!folders.has(key)) {
            folders.set(key, { key, name: folderName, files: [] });
        }
        folders.get(key).files.push({
            file,
            originalName: file.name,
            subfolder: normalizeMergeSubfolder(getMergeEntrySubfolder(parts, sourceDepth))
        });
    });

    let added = 0;
    let skipped = 0;
    folders.forEach(folder => {
        if (mergeFolderSources.some(source => source.key === folder.key)) {
            skipped += 1;
            return;
        }
        mergeFolderSources.push(folder);
        added += 1;
    });

    renderMergeFolderList();
    if (added) {
        showToast(`Added ${added} folder${added === 1 ? '' : 's'}${skipped ? ` (${skipped} duplicate skipped)` : ''}.`, 'success');
    } else {
        showNotification('The selected folder is already added.', 'warning');
    }
}

async function ensurePdfLibForMergeFolders() {
    if (window.PDFLib) return window.PDFLib;
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = window.PDF_LIB_SRC || `${window.PDF_MANAGER_BASE || 'PDF-file-manager-new'}/ScriptsJS/1.17.1-pdf-lib.min.js`;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load pdf-lib'));
        document.head.appendChild(s);
    });
    return window.PDFLib;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getMergeFolderConfirmModal() {
    let modal = document.getElementById('mergeFolderConfirmModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'mergeFolderConfirmModal';
    modal.className = 'merge-folder-modal merge-folder-confirm-modal';
    modal.innerHTML = `
        <div class="merge-folder-dialog merge-folder-confirm-dialog">
            <div class="merge-folder-header">
                <div>
                    <h3><i class="fa fa-check-circle"></i> Confirm Bulk Merge</h3>
                    <p>Review the folder order and output structure before generating the ZIP.</p>
                </div>
                <button type="button" class="merge-folder-close" onclick="closeMergeFolderConfirm()" title="Close"><i class="fa fa-times"></i></button>
            </div>
            <div class="merge-folder-body">
                <div id="mergeFolderConfirmSummary" class="merge-folder-confirm-summary"></div>
                <div id="mergeFolderConfirmList" class="merge-folder-confirm-list"></div>
            </div>
            <div class="merge-folder-footer">
                <button type="button" class="btn btn-secondary" onclick="closeMergeFolderConfirm()">Back</button>
                <button type="button" class="btn btn-primary" onclick="executeMergeFolderMode(true)">
                    <i class="fa fa-compress"></i> Confirm and Merge
                </button>
            </div>
        </div>`;
    modal.addEventListener('click', event => {
        if (event.target === modal) closeMergeFolderConfirm();
    });
    document.body.appendChild(modal);
    return modal;
}

window.closeMergeFolderConfirm = function() {
    document.getElementById('mergeFolderConfirmModal')?.classList.remove('active');
};

window.reviewMergeFolderMode = function() {
    if (mergeFolderSources.length < 2) {
        showNotification('Add at least 2 folders first.', 'warning');
        return;
    }
    const groups = buildMergeFolderGroups();
    const analysis = analyzeMergeFolderGroups();
    if (!analysis.completeGroups.length) {
        showNotification('No matching PDF filenames were found across the selected folders.', 'warning');
        return;
    }

    const modal = getMergeFolderConfirmModal();
    const summary = modal.querySelector('#mergeFolderConfirmSummary');
    const list = modal.querySelector('#mergeFolderConfirmList');
    const folderOrder = mergeFolderSources.map((source, index) => `${index + 1}. ${source.name}`).join(' -> ');
    summary.innerHTML = `
        <div><strong>${analysis.completeGroups.length}</strong> merged PDF${analysis.completeGroups.length === 1 ? '' : 's'} will be created.</div>
        <div><strong>Folder order:</strong> ${escapeHtml(folderOrder)}</div>
        <div><strong>ZIP structure:</strong> subfolders are preserved when present.</div>
        ${analysis.skippedFiles.length ? `<div class="merge-folder-warning"><i class="fa fa-warning"></i> ${analysis.skippedFiles.length} PDF${analysis.skippedFiles.length === 1 ? '' : 's'} do not have a match in every folder and will be skipped if you continue.</div>` : ''}`;
    const mergedRows = analysis.completeGroups.slice(0, 80).map(group => {
        const filename = getSafeMergeFolderFilename(group.displayName, new Set());
        const path = group.subfolder ? `${group.subfolder}/${filename}` : filename;
        return `
            <div class="merge-folder-confirm-row">
                <i class="fa fa-file-pdf-o"></i>
                <span>${escapeHtml(path)}</span>
                <small>${group.sources.size} source PDFs</small>
            </div>`;
    }).join('') + (analysis.completeGroups.length > 80 ? `<div class="merge-folder-confirm-more">+ ${analysis.completeGroups.length - 80} more outputs</div>` : '');
    const skippedRows = analysis.skippedFiles.length ? `
        <div class="merge-folder-skipped-title">Skipped PDFs</div>
        ${analysis.skippedFiles.slice(0, 120).map(item => `
            <div class="merge-folder-confirm-row merge-folder-skipped-row">
                <i class="fa fa-exclamation-triangle"></i>
                <span>${escapeHtml(`${item.folder}/${item.subfolder ? item.subfolder + '/' : ''}${item.filename}`)}</span>
                <small>Missing: ${escapeHtml(item.missing.join(', '))}</small>
            </div>`).join('')}
        ${analysis.skippedFiles.length > 120 ? `<div class="merge-folder-confirm-more">+ ${analysis.skippedFiles.length - 120} more skipped PDFs</div>` : ''}` : '';
    list.innerHTML = mergedRows + skippedRows;
    modal.classList.add('active');
};

window.executeMergeFolderMode = async function(confirmed = false) {
    if (!confirmed) {
        reviewMergeFolderMode();
        return;
    }
    if (mergeFolderSources.length < 2) {
        showNotification('Add at least 2 folders first.', 'warning');
        return;
    }
    const analysis = analyzeMergeFolderGroups();
    const groups = analysis.completeGroups;
    if (!groups.length) {
        showNotification('No matching PDF filenames were found across the selected folders.', 'warning');
        return;
    }

    setMergeFolderActionLoading(true);
    closeMergeFolderConfirm();
    showProgress('Merging folder PDFs...', 'Preparing matching groups...');
    try {
        const { PDFDocument } = await ensurePdfLibForMergeFolders();
        const outputs = [];
        const usedNames = new Set();

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            updateProgress(Math.round(5 + (80 * i / groups.length)), `Merging ${group.displayName}...`);
            const outDoc = await PDFDocument.create();

            for (let sourceIndex = 0; sourceIndex < mergeFolderSources.length; sourceIndex++) {
                const entry = group.sources.get(sourceIndex);
                if (!entry) continue;
                const srcDoc = await PDFDocument.load(await entry.file.arrayBuffer());
                const pages = await outDoc.copyPages(srcDoc, srcDoc.getPageIndices());
                pages.forEach(page => outDoc.addPage(page));
            }

            const bytes = await outDoc.save();
            const filename = getSafeMergeFolderFilename(group.displayName, usedNames, group.subfolder);
            outputs.push({
                filename,
                zipPath: group.subfolder ? `${group.subfolder}/${filename}` : filename,
                bytes
            });
        }

        updateProgress(90, outputs.length > 1 ? 'Creating ZIP...' : 'Preparing download...');
        if (outputs.length === 1) {
            downloadBlob(new Blob([outputs[0].bytes], { type: 'application/pdf' }), outputs[0].filename);
        } else {
            if (typeof JSZip === 'undefined') throw new Error('JSZip is not available.');
            const zip = new JSZip();
            outputs.forEach(output => zip.file(output.zipPath || output.filename, output.bytes));
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, 'folder_merged_pdfs.zip');
        }

        updateProgress(100, 'Done');
        await new Promise(r => setTimeout(r, 250));
        hideProgress();
        showNotification(`Created ${outputs.length} merged PDF${outputs.length === 1 ? '' : 's'} from folders.`, 'success');
        showToast(`Folder merge complete: ${outputs.length} output${outputs.length === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
        hideProgress();
        showNotification('Folder merge failed: ' + err.message, 'error');
        showToast('Folder merge failed.', 'error');
        console.error(err);
    } finally {
        setMergeFolderActionLoading(false);
    }
};
window.executeMerge = async function() {
    const livePageItemsForMerge = Array.from(document.querySelectorAll('#pageGrid .page-item:not(.add-page-item)'));
    const liveFileIndexesForMerge = new Set(livePageItemsForMerge.map(item => parseInt(item.dataset.fileIndex)).filter(Number.isFinite));
    if (liveFileIndexesForMerge.size < 2) { showNotification('Please add at least 2 PDF sources to merge.', 'warning'); return; }

    setMergeActionLoading(true);
    showProgress('Merging PDFs...', 'Building output…');
    try {
        if (!window.PDFLib) {
            updateProgress(5, 'Loading pdf-lib…');
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = window.PDF_LIB_SRC || `${window.PDF_MANAGER_BASE || 'PDF-file-manager-new'}/ScriptsJS/1.17.1-pdf-lib.min.js`;
                s.onload = resolve;
                s.onerror = () => reject(new Error('Failed to load pdf-lib'));
                document.head.appendChild(s);
            });
        }
        const { PDFDocument, degrees } = window.PDFLib;

        updateProgress(10, 'Loading source PDFs…');
        const srcDocs = new Map();
        for (const f of mergeFiles) {
            if (!srcDocs.has(f.fileIndex)) srcDocs.set(f.fileIndex, await PDFDocument.load(f.arrayBuffer));
        }

        updateProgress(20, 'Assembling pages…');
        const allPageItems = Array.from(document.querySelectorAll('#pageGrid .page-item:not(.add-page-item)'));
        const outDoc = await PDFDocument.create();

        for (let i = 0; i < allPageItems.length; i++) {
            const item      = allPageItems[i];
            const fileIndex = parseInt(item.dataset.fileIndex);
            const pageNum   = parseInt(item.dataset.pageNum);
            const pageKey   = item.dataset.pageKey;
            const srcDoc    = srcDocs.get(fileIndex);
            if (!srcDoc) continue;

            const [copied] = await outDoc.copyPages(srcDoc, [pageNum - 1]);
            outDoc.addPage(copied);

            const rot = mergePageRotations.get(pageKey);
            if (rot) {
                const pg = outDoc.getPages()[outDoc.getPageCount() - 1];
                pg.setRotation(degrees((pg.getRotation().angle + rot) % 360));
            }

            if (i % 10 === 0) updateProgress(20 + Math.round(65 * i / allPageItems.length), `Assembling page ${i + 1} of ${allPageItems.length}…`);
        }

        updateProgress(88, 'Saving PDF…');
        const pdfBytes = await outDoc.save();

        let binary = ''; const chunk = 8192;
        for (let i = 0; i < pdfBytes.length; i += chunk)
            binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));

        updateProgress(98, 'Preparing download…');
        await new Promise(r => setTimeout(r, 300));
        hideProgress();

        downloadFile(btoa(binary), getMergeOutputFilename());
        showNotification(`Successfully merged ${allPageItems.length} pages into 1 PDF!`, 'success');
        showToast('Successfully merged (' + allPageItems.length + ') pages into 1 PDF!', 'success');
    } catch (err) {
        hideProgress();
        showNotification('Merge failed: ' + err.message, 'error');
        showToast('Merge failed.', 'error');
        console.error(err);
    } finally {
        setMergeActionLoading(false);
    }
};

// ─── Route file input to merge when active ────────────────────────────────────
const originalHandleFileSelect = window.handleFileSelect;
window.handleFileSelect = function(event) {
    if (window.activeTool === 'merge') handleMergeFileSelect(event);
    else if (originalHandleFileSelect) originalHandleFileSelect(event);
};

// ─── Expose merge preview functions for HTML dispatcher ───────────────────────
// The inline script in index_enhanced.html runs LAST and calls these names.
window.mergeZoomPreview = function(delta) {
    currentMergePreviewScale = Math.max(0.3, Math.min(5, currentMergePreviewScale + delta));
    renderMergePreview();
};

window.mergeFitPreview = function() {
    openMergePreviewByIndex(mergePreviewGlobalIndex);
};

window.mergeNavigatePreview = function(delta) {
    const newIdx = mergePreviewGlobalIndex + delta;
    if (newIdx < 0 || newIdx >= getMergeDOMTotalPages()) return;
    openMergePreviewByIndex(newIdx);
};

window.mergeRotatePreview = async function(degrees) {
    const info = getMergePageInfoFromDOM(mergePreviewGlobalIndex);
    if (!info) return;
    const gridItem = document.querySelector(`#pageGrid .page-item[data-page="${mergePreviewGlobalIndex}"]`);
    if (gridItem) {
        await rotateMergePageItem(gridItem, info.fileData.document, info.pageNum, info.pageKey, degrees);
    } else {
        const cur = mergePageRotations.get(info.pageKey) || 0;
        mergePageRotations.set(info.pageKey, ((cur + degrees) + 360) % 360);
    }
    await renderMergePreview();
};

window.mergeDeletePreviewPage = function() {
    const idx = mergePreviewGlobalIndex;
    document.getElementById('previewModal').classList.remove('active');
    deleteMergePage(idx);
};


