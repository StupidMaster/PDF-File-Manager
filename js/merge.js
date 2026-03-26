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

Object.defineProperty(window, 'hasMergeFiles', { get: () => mergeFiles.length > 0 });

// ─── Init / Reset ─────────────────────────────────────────────────────────────
window.initMerge = function() {
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
    if (pageGrid) pageGrid.innerHTML = '';
    if (uploadSection) uploadSection.classList.remove('hidden');

    updateMergeFileList();
    updateMergeButton();
}

window.resetMerge = function() {
    showConfirm('Start New Merge', 'Clear all files and start a new merge? This cannot be undone.',
        () => { resetMergeState(); showNotification('Ready for new merge', 'success'); });
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
            if (f.type !== 'application/pdf') { showNotification('Please select only PDF files.', 'error'); event.target.value = ''; return; }
            if (f.size > 50 * 1024 * 1024)   { showNotification(`"${f.name}" exceeds 50MB.`, 'error'); event.target.value = ''; return; }
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

            // Phase 2: render each page sequentially into its skeleton
            for (const d of skeletonQueue) {
                await loadMergePageSequentially(d.wrapper, d.skeleton, d.pdfDoc, d.pageNum, d.fileIndex, 0, d.pageKey);
            }

            renumberMergePageItems();
            rebuildMergePageOrder();
            refreshMergeAddBetweenButtons();
            updateMergeFileList();
            updateMergeButton();
            showNotification(`Inserted ${inserted.reduce((s, f) => s + f.numPages, 0)} page(s)`, 'success');
        } catch (err) {
            hideProcessing();
            showNotification('Insert failed: ' + err.message, 'error');
        }
        event.target.value = '';
        return; // ← done, don't fall through to normal append flow
    }

    // ── Normal append mode ────────────────────────────────────────────────────
    const files = Array.from(event.target.files);
    if (!files.length) return;

    if (files.length > 20) { showNotification('Maximum 20 PDF files allowed at once.', 'error'); event.target.value = ''; return; }
    for (const f of files) {
        if (f.type !== 'application/pdf') { showNotification('Please select only PDF files.', 'error'); event.target.value = ''; return; }
        if (f.size > 50 * 1024 * 1024) { showNotification(`File "${f.name}" is too large. Maximum 50MB.`, 'error'); event.target.value = ''; return; }
    }
    if (files.reduce((s, f) => s + f.size, 0) > 100 * 1024 * 1024) {
        showNotification('Total file size exceeds 100MB.', 'error'); event.target.value = ''; return;
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
        }
    } catch (err) {
        hideProcessing();
        showNotification('Error uploading files: ' + err.message, 'error');
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

    for (const d of skeletonData) {
        await loadMergePageSequentially(d.wrapper, d.skeleton, d.pdfDoc, d.pageNum, d.fileIndex, d.globalPageIndex, d.pageKey);
    }

    refreshMergeAddBetweenButtons();
    updateMergeButton();
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
        await new Promise(r => setTimeout(r, 150));
        wrapper.replaceChild(pageItem, skeleton);
    } catch (err) {
        console.error('Error loading merge page:', err);
        const labelEl = skeleton.querySelector('.progress-label');
        if (labelEl) labelEl.textContent = 'Error loading page';
    }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function createMergeSkeletonItem() {
    const div = document.createElement('div');
    div.className = 'skeleton-item';
    div.innerHTML = `
        <div class="skeleton-thumbnail">
            <div class="page-progress-loader">
                <div class="progress-bar-container">
                    <div class="progress-bar-fill"></div>
                    <div class="progress-percentage">0%</div>
                </div>
                <div class="progress-label">Waiting...</div>
            </div>
        </div>
        <div class="skeleton-footer"></div>`;
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
    const viewport = page.getViewport({ scale: 0.5, rotation });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    thumbnail.appendChild(canvas);

    // Hover overlay — identical structure to split.js
    const overlay = document.createElement('div');
    overlay.className = 'page-hover-overlay';
    overlay.innerHTML = `
        <div class="page-hover-actions">
            <button class="page-action-btn primary" title="Preview"      data-action="preview">👁</button>
            <button class="page-action-btn"         title="Rotate Left"  data-action="rotate-left">↺</button>
            <button class="page-action-btn"         title="Rotate Right" data-action="rotate-right">↻</button>
            <button class="page-action-btn"         title="Duplicate"    data-action="duplicate">⧉</button>
            <button class="page-action-btn danger"  title="Delete"       data-action="delete">🗑</button>
        </div>`;

    overlay.querySelectorAll('.page-action-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const gIdx = parseInt(div.dataset.page);
            const key  = div.dataset.pageKey;
            switch (btn.dataset.action) {
                case 'preview':      openMergePreviewByIndex(gIdx); break;
                case 'rotate-left':  rotateMergePageItem(div, pdfDoc, pageNum, key, -90); break;
                case 'rotate-right': rotateMergePageItem(div, pdfDoc, pageNum, key, 90); break;
                case 'duplicate':    duplicateMergePage(gIdx); break;
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
                <div style="font-size:32px;margin-bottom:8px;">+</div>Add PDF
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
        <button class="merge-add-btn" title="Insert here">＋</button>
        <div class="merge-add-tooltip" style="display:none;">
            <button class="merge-add-option" data-action="blank">📄 Add blank page</button>
            <button class="merge-add-option" data-action="document">📁 Add document</button>
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

    // Close tooltip on outside click
    document.addEventListener('click', () => { tooltip.style.display = 'none'; }, { capture: false });

    return btn;
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
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
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
    } catch (err) {
        hideProcessing();
        showNotification('Failed to insert blank page: ' + err.message, 'error');
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
        const viewport = page.getViewport({ scale: 0.5, rotation: newRot });
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
    const dupKey = `${sourceKey}-dup${mergeDupCounter}`;
    const sourceRot = mergePageRotations.get(sourceKey) || 0;
    if (sourceRot) mergePageRotations.set(dupKey, sourceRot);

    const sourceIndex = allWrappers.indexOf(sourceWrapper);
    const newItem = await createMergePageItem(fileData.document, pageNum, fileIndex, globalIndex, dupKey);

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
    showNotification('Page duplicated', 'success');
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
        refreshMergeAddBetweenButtons();
        updateMergeButton();
        showNotification('Page removed', 'success');
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

    // Skip re-render if nothing changed
    if (_mergeDropTarget &&
        _mergeDropTarget.wrapperIndex === wrapperIndex &&
        _mergeDropTarget.side === side) return;

    _clearMergeDropIndicators();
    _mergeDropTarget = { wrapperIndex, side };

    if (side === 'center') {
        wrapper.classList.add('drop-swap');
    } else if (side === 'left') {
        wrapper.classList.add('drop-insert-before');
        // Animate the card itself (and the one before it) to show space opening
        wrapper.classList.add('push-right');
        const prev = pageWrappers[wrapperIndex - 1];
        if (prev && !prev.querySelector('.dragging')) {
            // no extra push on previous needed; the gap indicator is enough
        }
    } else { // right
        wrapper.classList.add('drop-insert-after');
        const next = pageWrappers[wrapperIndex + 1];
        if (next && !next.querySelector('.dragging')) {
            next.classList.add('push-right');
        }
    }
};

window.handleMergePageDrop = function(event, _unused) {
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const side   = _getMergeDropSide(event, target);
    _clearMergeDropIndicators();

    if (!mergeDraggedPageData) return;

    // Always derive positions from the live DOM — never use stale indices
    const pageWrappers  = _getMergePageWrappers();
    const fromWrapper   = mergeDraggedPageData.element.closest('.page-item-wrapper');
    const targetWrapper = target.closest('.page-item-wrapper');
    if (!fromWrapper || !targetWrapper) return;

    const fromPos   = pageWrappers.indexOf(fromWrapper);
    const targetPos = pageWrappers.indexOf(targetWrapper);
    if (fromPos === -1 || targetPos === -1) return;

    if (side === 'center') {
        // SWAP: exchange the two wrappers
        if (fromPos !== targetPos) swapMergePagesByPos(fromPos, targetPos, pageWrappers);
    } else {
        // INSERT: remove from source, splice into target position
        let insertPos = targetPos;
        if (side === 'right') insertPos += 1;
        if (fromPos !== insertPos && fromPos !== insertPos - 1) {
            insertMergePageByPos(fromPos, insertPos, pageWrappers);
        }
    }
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
    pageGrid.innerHTML = '';
    mergePageOrder = [];
    mergeFiles.forEach((f, i) => { f.fileIndex = i + 1; });

    let globalPageIndex = 0;
    for (const fileData of mergeFiles) {
        const { document: pdfDoc, fileIndex } = fileData;
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-item-wrapper';
            const pageKey = `${fileIndex}-${i}`;
            mergePageOrder.push({ fileIndex, pageNum: i, globalIndex: globalPageIndex, pageKey });
            pageWrapper.appendChild(await createMergePageItem(pdfDoc, i, fileIndex, globalPageIndex, pageKey));
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

    const total = mergeFiles.reduce((s, f) => s + f.numPages, 0);
    if (mergeCountBtn)   mergeCountBtn.textContent  = mergeFiles.length;
    if (mergeFilesText)  mergeFilesText.textContent  = `files (${total} pages)`;
    if (mergeTotalPages) mergeTotalPages.textContent = `Total: ${total} pages from ${mergeFiles.length} files`;
    mergeBtn.disabled = mergeFiles.length < 2;
    mergeBtn.onclick = executeMerge;
}

function getMergeTotalPages() { return mergeFiles.reduce((s, f) => s + f.numPages, 0); }
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
    const pg = await info.fileData.document.getPage(info.pageNum);
    const vp = pg.getViewport({ scale: 1 });
    currentMergePreviewScale = Math.min(window.innerWidth * 0.8 / vp.width, window.innerHeight * 0.7 / vp.height) * 0.9;

    await renderMergePreview();
    modal.classList.add('active');
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
    });
};

window.addMoreMergeFiles = function() { document.getElementById('fileInput').click(); };

window.clearAllMergeFiles = function() {
    if (!mergeFiles.length) return;
    showConfirm('Clear All Files', 'Remove all files from the merge list?', () => {
        resetMergeState(); showNotification('All files cleared', 'success');
    });
};

// ─── Execute Merge (client-side via pdf-lib) ───────────────────────────────────
window.executeMerge = async function() {
    if (mergeFiles.length < 2) { showNotification('Please add at least 2 PDF files to merge.', 'warning'); return; }

    showProgress('Merging PDFs...', 'Building output…');
    try {
        if (!window.PDFLib) {
            updateProgress(5, 'Loading pdf-lib…');
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
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

        const baseName = mergeFiles[0]?.fileName?.replace(/\.pdf$/i, '') || 'merged';
        downloadFile(btoa(binary), `${baseName}_merged.pdf`);
        showNotification(`Successfully merged ${allPageItems.length} pages into 1 PDF!`, 'success');
    } catch (err) {
        hideProgress();
        showNotification('Merge failed: ' + err.message, 'error');
        console.error(err);
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