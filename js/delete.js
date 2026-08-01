// js/delete.js — Delete Pages Mode
// UI mirrors Merge mode: left panel file list, page grid with thumbnails,
// checkbox multi-select (matching the screenshot), hover overlay actions,
// toolbar with Select All / rotate / delete selected.

(function () {
    'use strict';

    // ─── State ────────────────────────────────────────────────────────────────
    let deleteFile        = null;   // single PDF file
    let deleteFileName    = '';
    let deletePdfDoc      = null;   // pdfjs document
    let deleteArrayBuffer = null;
    let deletePageRotations = new Map();  // pageNum (1-based) → degrees
    let deleteSelectedPages    = new Set();  // 1-based page numbers selected via checkbox / thumbnail click
    let immediatelyDeletedPages = new Set(); // 1-based page numbers removed from DOM via the trash icon
    let deletePreviewScale  = 1.5;
    let deletePreviewPage   = 1;    // 1-based
    let _deletePendingInsertAfterPos = null;  // position for between-page insert
    let insertedDeletedCount = 0;   // inserted pages removed via their trash button

    // Unload guard
    if (window._unloadCheckers) window._unloadCheckers.push(() => !!deleteFile);

    // ─── Expose helpers ───────────────────────────────────────────────────────
    window.clearDeleteState = function () {
        deleteFile = null; deleteFileName = ''; deletePdfDoc = null;
        deleteArrayBuffer = null; deletePageRotations.clear();
        deleteSelectedPages.clear(); immediatelyDeletedPages.clear();
        deletePreviewPage = 1;
        window._deleteInsertedPages = [];
        window._deleteInsertMode = false;
        _deletePendingInsertAfterPos = null;
        insertedDeletedCount = 0;
    };
    window._deleteHasFile = function () { return !!deleteFile; };

    function resetDeleteGridLayout() {
        const pageGrid = document.getElementById('pageGrid');
        if (!pageGrid) return;
        pageGrid.style.cssText = '';
    }

    function getDeletePreviewFitScale(pageWidth, pageHeight) {
        const wrapper = document.getElementById('previewCanvasWrapper');
        const rect = wrapper?.getBoundingClientRect();
        const availableWidth = Math.max(240, (rect?.width || window.innerWidth * 0.92) - 28);
        const availableHeight = Math.max(240, (rect?.height || window.innerHeight * 0.82) - 28);
        return Math.max(0.3, Math.min(5, Math.min(availableWidth / pageWidth, availableHeight / pageHeight) * 0.98));
    }

    // ─── Init ─────────────────────────────────────────────────────────────────
    window.initDelete = function () {
        clearDeleteState();
        // Left panel
        const panelTitle = document.getElementById('panelTitle');
        if (panelTitle) panelTitle.innerHTML = '<i class="fa fa-file-pdf-o"></i> Loaded File';
        updateDeleteFileList();
        // Main area: show upload, hide page grid
        const uploadSection = document.getElementById('uploadSection');
        const pageContainer = document.getElementById('pageContainer');
        const pageGrid      = document.getElementById('pageGrid');
        if (uploadSection) { uploadSection.classList.remove('hidden'); uploadSection.style.display = ''; }
        if (pageContainer) { pageContainer.classList.remove('active'); pageContainer.style.display = ''; }
        if (pageGrid)      { pageGrid.innerHTML = ''; resetDeleteGridLayout(); }
        // Controls bar
        const splitControls = document.getElementById('splitControls');
        const mergeControls = document.getElementById('mergeControls');
        const deleteControls = document.getElementById('deleteControls');
        if (splitControls) { splitControls.classList.remove('show'); splitControls.classList.remove('active'); }
        if (mergeControls) mergeControls.classList.remove('active');
        if (deleteControls) deleteControls.classList.remove('active');
        // Title
        const titleSpan = document.querySelector('.title span');
        if (titleSpan) titleSpan.innerHTML = '<i class="fa fa-trash-o"></i> Delete Pages';
        // Route file input
        _routeFileInput();
    };

    // ─── Route fileInput → handleDeleteFileSelect ─────────────────────────────
    function _routeFileInput() {
        const input = document.getElementById('fileInput');
        if (!input) return;
        // handled by the global router in index_enhanced.php
    }
    // ─── File select handler (called by global router) ────────────────────────
    window.handleDeleteFileSelect = async function (event) {
        // ── Insert-at-position mode (triggered by the between-page + button) ──
        if (window._deleteInsertMode) {
            window._deleteInsertMode = false;
            const insertAfterPos          = _deletePendingInsertAfterPos ?? -1;
            _deletePendingInsertAfterPos  = null;

            const files = Array.from(event.target.files);
            event.target.value = '';
            if (!files.length) return;

            const file = files[0];
            if (file.type !== 'application/pdf') {
                showNotification('Please select a PDF file.', 'error'); return;
            }
            if (file.size > 50 * 1024 * 1024) {
                showNotification('File is too large. Maximum 50MB.', 'error'); return;
            }

            showProcessing('Inserting document…');
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc      = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

                hideProcessing();

                const pageGrid    = document.getElementById('pageGrid');
                const allWrappers = _getDeletePageWrappers();
                let   refWrapper  = allWrappers[insertAfterPos];

                // Insert all pages of the new PDF as full-featured cards (with checkbox, overlay, between-buttons)
                if (!window._deleteInsertedPages) window._deleteInsertedPages = [];

                for (let p = 1; p <= pdfDoc.numPages; p++) {
                    const newWrapper = document.createElement('div');
                    newWrapper.className = 'page-item-wrapper';

                    const skeleton = _createDeleteSkeleton(p, pdfDoc.numPages);
                    newWrapper.appendChild(skeleton);

                    if (refWrapper && refWrapper.nextSibling) {
                        pageGrid.insertBefore(newWrapper, refWrapper.nextSibling);
                    } else {
                        pageGrid.appendChild(newWrapper);
                    }
                    refWrapper = newWrapper;

                    // Build the full page card (same as _createInsertedPageCard)
                    const pageItem = await _createInsertedPageCard(pdfDoc, p, arrayBuffer, file.name, newWrapper, false);
                    newWrapper.replaceChild(pageItem, skeleton);

                    window._deleteInsertedPages.push({
                        wrapper: newWrapper,
                        pdfDoc,
                        pageNum: p,
                        arrayBuffer,
                        isBlank: false
                    });
                }

                _refreshDeleteAddBetweenButtons();
                _appendDeleteAddFileButton();
                _renumberDeleteInsertedPages();
                updateDeleteFileList();
                showNotification(`Inserted ${pdfDoc.numPages} page(s) from "${file.name}"`, 'success');
                showToast(`Inserted ${pdfDoc.numPages} page(s)!`, 'success');
            } catch (err) {
                hideProcessing();
                showNotification('Insert failed: ' + err.message, 'error');
            }
            return; // don't fall through to normal load flow
        }

        // ── Normal load (first file open) ─────────────────────────────────────
        const files = Array.from(event.target.files);
        event.target.value = '';
        if (!files.length) return;
        const file = files[0];
        if (file.type !== 'application/pdf') {
            showNotification('Please select a PDF file.', 'error'); return;
        }
        if (file.size > 50 * 1024 * 1024) {
            showNotification('File is too large. Maximum 50MB.', 'error'); return;
        }
        await _loadDeleteFile(file);
    };

    // Drop on upload section
    window.handleDeleteDrop = async function (e) {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!file || file.type !== 'application/pdf') {
            showNotification('Please drop a PDF file.', 'warning'); return;
        }
        if (file.size > 50 * 1024 * 1024) {
            showNotification('File is too large. Maximum 50MB.', 'error'); return;
        }
        await _loadDeleteFile(file);
    };

    async function _loadDeleteFile(file) {
        showProcessing('Loading PDF…');
        try {
            const ab  = await file.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data: ab.slice(0) }).promise;

            deleteFile        = file;
            deleteFileName    = file.name;
            deleteArrayBuffer = ab;
            deletePdfDoc      = doc;
            deletePageRotations.clear();
            deleteSelectedPages.clear();
            immediatelyDeletedPages.clear();
            window._deleteInsertedPages = [];
            insertedDeletedCount = 0;

            hideProcessing();

            // Switch UI
            const uploadSection = document.getElementById('uploadSection');
            const pageContainer = document.getElementById('pageContainer');
            const deleteControls = document.getElementById('deleteControls');
            if (uploadSection) uploadSection.classList.add('hidden');
            if (pageContainer) { pageContainer.classList.add('active'); pageContainer.style.display = ''; }
            if (deleteControls) deleteControls.classList.add('active');

            updateDeleteFileList();
            await _renderDeleteGrid();
            _updateDeleteToolbar();
            _refreshDeleteAddBetweenButtons();
            _appendDeleteAddFileButton();
            showToast('PDF loaded — select pages to delete', 'success');
        } catch (err) {
            hideProcessing();
            showNotification('Error loading PDF: ' + err.message, 'error');
        }
    }

    // ─── Left panel file list ─────────────────────────────────────────────────
    function updateDeleteFileList() {
        const container  = document.getElementById('filesContainer');
        const panelTitle = document.getElementById('panelTitle');
        if (panelTitle) panelTitle.innerHTML = '<i class="fa fa-file-pdf-o"></i> Loaded File';
        if (!container) return;

        if (!deleteFile) {
            container.innerHTML = `
                <div class="empty-files">
                    <div style="font-size:32px;margin-bottom:6px"><i class="fa fa-file-pdf-o"></i></div>
                    <span>No file loaded yet</span>
                </div>`;
            return;
        }

        const color = 'var(--file-color-1)';
        const selectedCount  = deleteSelectedPages.size;
        const deletedCount   = immediatelyDeletedPages.size;
        const totalToRemove  = selectedCount + deletedCount;
        const totalPages     = deletePdfDoc ? deletePdfDoc.numPages : 0;
        const insertedCount  = window._deleteInsertedPages ? window._deleteInsertedPages.filter(e => document.body.contains(e.wrapper)).length : 0;
        const willRemain     = (totalPages - totalToRemove) + insertedCount;

        container.innerHTML = `
            <div class="file-card">
                <div class="file-icon" style="color:${color}">
                    <div style="font-size:28px;margin-bottom:6px"><i class="fa fa-file-pdf-o"></i></div>
                </div>
                <div class="file-info">
                    <div class="file-name">${escHtml(deleteFile.name)}</div>
                    <div class="file-meta">
                        <span>${totalPages} pages</span>
                        <span class="file-pages" style="background:rgba(239,68,68,0.12);color:#ef4444">
                            ${totalToRemove > 0 ? totalToRemove + ' to remove' : 'none selected'}
                        </span>
                    </div>
                </div>
                <button class="file-remove" onclick="deleteLoadNewFile()" title="Load different file">
                    <i class="fa fa-folder-open-o" style="font-size:18px;"></i>
                </button>
            </div>

            ${totalPages > 0 ? `
            <div style="margin-top:12px;padding:10px;border-radius:8px;background:var(--bg-tertiary);
                        border:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                    <span><i class="fa fa-files-o"></i> Original pages</span>
                    <strong style="color:var(--text-primary)">${totalPages}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                    <span><i class="fa fa-check-square-o" style="color:#ef4444"></i> Selected</span>
                    <strong style="color:#ef4444">${selectedCount}</strong>
                </div>
                ${deletedCount > 0 ? `
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                    <span><i class="fa fa-trash-o" style="color:#f97316"></i> Removed</span>
                    <strong style="color:#f97316">${deletedCount}</strong>
                </div>` : ''}
                ${insertedCount > 0 ? `
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                    <span><i class="fa fa-plus-circle" style="color:#3b82f6"></i> Inserted</span>
                    <strong style="color:#3b82f6">${insertedCount}</strong>
                </div>` : ''}
                <div style="display:flex;justify-content:space-between">
                    <span><i class="fa fa-file-o" style="color:#22c55e"></i> Will remain</span>
                    <strong style="color:#22c55e">${Math.max(0, willRemain)}</strong>
                </div>
            </div>` : ''}

            <div style="margin-top:10px">
                <button class="btn btn-secondary" onclick="deleteLoadNewFile()"
                        style="width:100%;justify-content:center;font-size:12px">
                    <i class="fa fa-folder-open-o"></i> Load different file
                </button>
            </div>`;
    }

    window.deleteLoadNewFile = function () {
        if (!deleteFile) { document.getElementById('fileInput').click(); return; }
        showConfirm('Load New File',
            'Loading a new file will clear your current selection. Continue?',
            () => {
                clearDeleteState();
                const pageContainer = document.getElementById('pageContainer');
                const pageGrid      = document.getElementById('pageGrid');
                const uploadSection = document.getElementById('uploadSection');
                const deleteControls = document.getElementById('deleteControls');
                if (pageContainer) { pageContainer.classList.remove('active'); }
                if (pageGrid)      { pageGrid.innerHTML = ''; resetDeleteGridLayout(); }
                if (uploadSection) uploadSection.classList.remove('hidden');
                if (deleteControls) deleteControls.classList.remove('active');
                updateDeleteFileList();
                _updateDeleteToolbar();
                document.getElementById('fileInput').click();
            });
    };

    // ─── Render page grid ─────────────────────────────────────────────────────
    async function _renderDeleteGrid() {
        const pageGrid = document.getElementById('pageGrid');
        if (!pageGrid || !deletePdfDoc) return;
        resetDeleteGridLayout();
        pageGrid.innerHTML = '';

        const totalPages = deletePdfDoc.numPages;
        const skeletons  = [];

        for (let p = 1; p <= totalPages; p++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'page-item-wrapper';
            const skeleton = _createDeleteSkeleton(p, totalPages);
            wrapper.appendChild(skeleton);
            pageGrid.appendChild(wrapper);
            skeletons.push({ wrapper, skeleton, pageNum: p });
        }

        for (const { wrapper, skeleton, pageNum } of skeletons) {
            await _loadDeletePageInto(wrapper, skeleton, pageNum);
        }
    }

    function _createDeleteSkeleton(pageNum, total) {
        const div = document.createElement('div');
        div.className = 'skeleton-item';
        div.innerHTML = `
            <div class="skeleton-thumbnail">
                <div class="page-progress-loader">
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill"></div>
                        <div class="progress-percentage">0%</div>
                    </div>
                    <div class="progress-label">Loading page ${pageNum}…</div>
                </div>
            </div>
            <div class="skeleton-footer"></div>`;
        return div;
    }

    async function _loadDeletePageInto(wrapper, skeleton, pageNum) {
        try {
            const progressBar = skeleton.querySelector('.progress-bar-fill');
            const percentEl   = skeleton.querySelector('.progress-percentage');
            let progress = 0;
            const iv = setInterval(() => {
                if (progress < 90) {
                    progress += 15;
                    if (progressBar) progressBar.style.width = progress + '%';
                    if (percentEl)   percentEl.textContent   = progress + '%';
                }
            }, 80);

            const pageItem = await _createDeletePageItem(pageNum);

            clearInterval(iv);
            if (progressBar) progressBar.style.width  = '100%';
            if (percentEl)   percentEl.textContent     = '100%';
            await new Promise(r => setTimeout(r, 120));
            wrapper.replaceChild(pageItem, skeleton);
        } catch (err) {
            console.error('Delete page load error:', err);
        }
    }

    async function _createDeletePageItem(pageNum) {
        const page     = await deletePdfDoc.getPage(pageNum);
        const rotation = deletePageRotations.get(pageNum) || 0;
        const viewport = page.getViewport({ scale: 0.5, rotation });

        const div = document.createElement('div');
        div.className      = 'page-item file-1';
        div.dataset.page   = pageNum - 1;   // 0-based for parity with split/merge
        div.dataset.pageNum = pageNum;        // 1-based actual page
        if (deleteSelectedPages.has(pageNum)) div.classList.add('delete-selected');

        // ── Checkbox (top-left) ───────────────────────────────────────────────
        const chkWrap = document.createElement('div');
        chkWrap.className = 'delete-checkbox-wrap';
        const chkInput = document.createElement('input');
        chkInput.type = 'checkbox';
        chkInput.className = 'delete-page-checkbox';
        chkInput.dataset.page = pageNum;
        chkInput.checked = deleteSelectedPages.has(pageNum);
        chkInput.style.pointerEvents = 'none'; // chkWrap handles all clicks
        chkWrap.appendChild(chkInput);

        // Clicking anywhere in the checkbox zone toggles it — stop propagation
        // so the card-level click handler doesn't also fire
        chkWrap.addEventListener('click', e => {
            e.stopPropagation();
            const nowChecked = !deleteSelectedPages.has(pageNum);
            chkInput.checked = nowChecked;
            _togglePageSelection(pageNum, nowChecked, div);
        });

        // ── Thumbnail canvas ──────────────────────────────────────────────────
        const thumbnail = document.createElement('div');
        thumbnail.className = 'page-thumbnail';
        thumbnail.style.position = 'relative';

        const canvas  = document.createElement('canvas');
        const ctx     = canvas.getContext('2d');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        canvas.style.pointerEvents = 'none'; // let clicks fall through to the card div
        await page.render({ canvasContext: ctx, viewport }).promise;
        thumbnail.appendChild(canvas);

        // ── Hover overlay (preview / rotate-left / rotate-right / delete) ─────
        const overlay = document.createElement('div');
        overlay.className = 'page-hover-overlay';
        overlay.innerHTML = `
            <div class="page-hover-actions">
                <button class="page-action-btn primary" title="Preview"      data-action="preview"><i class="fa fa-eye"></i></button>
                <button class="page-action-btn"         title="Rotate Left"  data-action="rotate-left"><i class="fa fa-rotate-left"></i></button>
                <button class="page-action-btn"         title="Rotate Right" data-action="rotate-right"><i class="fa fa-rotate-right"></i></button>
                <button class="page-action-btn danger"  title="Delete this page" data-action="toggle-delete">
                    <i class="fa fa-trash-o"></i>
                </button>
            </div>`;

        overlay.querySelectorAll('.page-action-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                switch (btn.dataset.action) {
                    case 'preview':
                        _openDeletePreview(pageNum);
                        showToast('Previewing page ' + pageNum, 'info');
                        break;
                    case 'rotate-left':
                        await _rotateDeletePage(div, pageNum, -90);
                        showToast('Rotated left', 'info');
                        break;
                    case 'rotate-right':
                        await _rotateDeletePage(div, pageNum, 90);
                        showToast('Rotated right', 'info');
                        break;
                    case 'toggle-delete': {
                        _immediateDeletePage(pageNum, div);
                        break;
                    }
                }
            });
        });

        thumbnail.appendChild(overlay);

        // ── Footer: page number ───────────────────────────────────────────────
        const footer = document.createElement('div');
        footer.className = 'page-footer';
        const pageNumSpan = document.createElement('span');
        pageNumSpan.className   = 'page-number';
        pageNumSpan.textContent = pageNum;
        footer.appendChild(pageNumSpan);

        // ── Deletion badge (shows when selected) ──────────────────────────────
        const delBadge = document.createElement('span');
        delBadge.className = 'delete-badge';
        delBadge.innerHTML = '<i class="fa fa-trash-o"></i> Delete';
        delBadge.style.cssText = `
            display:none;background:rgba(239,68,68,0.9);color:#fff;
            font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;
            pointer-events:none;`;
        footer.appendChild(delBadge);

        div.appendChild(chkWrap);
        div.appendChild(thumbnail);
        div.appendChild(footer);

        // Click anywhere on the card (except action overlay buttons) → select / deselect
        div.addEventListener('click', e => {
            if (e.target.closest('.page-hover-overlay')) return;
            const nowChecked = !deleteSelectedPages.has(pageNum);
            _togglePageSelection(pageNum, nowChecked, div);
            showToast(nowChecked ? 'Page marked for deletion' : 'Page unmarked', nowChecked ? 'warning' : 'info');
        });

        return div;
    }

    // ─── Immediate single-page delete (via trash icon) ────────────────────────
    function _immediateDeletePage(pageNum, divEl) {
        // Track as immediately deleted (used in executeDeletePages)
        immediatelyDeletedPages.add(pageNum);
        // Remove from "selected" set too if it was there
        deleteSelectedPages.delete(pageNum);

        // Animate out then remove the wrapper from DOM
        const wrapper = divEl.closest('.page-item-wrapper');
        if (wrapper) {
            wrapper.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
            wrapper.style.opacity    = '0';
            wrapper.style.transform  = 'scale(0.92)';
            setTimeout(() => wrapper.remove(), 200);
        }

        updateDeleteFileList();
        _updateDeleteToolbar();
        _refreshDeleteAddBetweenButtons();
        _appendDeleteAddFileButton();
        showToast('Page deleted', 'warning');

        // If no real pages remain in the grid, reset to upload view
        setTimeout(() => {
            const remaining = document.querySelectorAll('#pageGrid .page-item[data-page-num]').length;
            if (remaining === 0) {
                const uploadSection  = document.getElementById('uploadSection');
                const pageContainer  = document.getElementById('pageContainer');
                const deleteControls = document.getElementById('deleteControls');
                if (uploadSection)  uploadSection.classList.remove('hidden');
                if (pageContainer)  pageContainer.classList.remove('active');
                if (deleteControls) deleteControls.classList.remove('active');
                clearDeleteState();
                updateDeleteFileList();
                _updateDeleteToolbar();
            }
        }, 250);
    }


    function _togglePageSelection(pageNum, selected, divEl) {
        if (selected) {
            deleteSelectedPages.add(pageNum);
            divEl.classList.add('delete-selected');
        } else {
            deleteSelectedPages.delete(pageNum);
            divEl.classList.remove('delete-selected');
        }

        // Sync checkbox
        const chk = divEl.querySelector(`.delete-page-checkbox[data-page="${pageNum}"]`);
        if (chk) chk.checked = selected;

        // Sync badge
        const badge = divEl.querySelector('.delete-badge');
        if (badge) badge.style.display = selected ? '' : 'none';

        updateDeleteFileList();
        _updateDeleteToolbar();
    }

    // ─── Toolbar state ────────────────────────────────────────────────────────
    function _updateDeleteToolbar() {
        const selectAllChk  = document.getElementById('deleteSelectAllChk');
        const deleteBtn     = document.getElementById('deleteExecuteBtn');   // "Delete Selected"
        const savePdfBtn    = document.getElementById('deleteSavePdfBtn');   // "Save PDF"
        const selCountEl    = document.getElementById('deleteSelCount');
        const totalPages    = deletePdfDoc ? deletePdfDoc.numPages : 0;
        const selCount      = deleteSelectedPages.size;
        const immCount      = immediatelyDeletedPages.size;
        const totalToDelete = selCount + immCount;
        const visiblePages  = totalPages - immCount;  // real pages still in the grid

        // Select-all checkbox state (only counts real pages, not inserted)
        if (selectAllChk) {
            selectAllChk.checked       = visiblePages > 0 && selCount === visiblePages;
            selectAllChk.indeterminate = selCount > 0 && selCount < visiblePages;
        }

        // Status label
        if (selCountEl) {
            if (totalToDelete === 0 && insertedDeletedCount === 0) {
                selCountEl.textContent = 'Select pages to delete';
            } else {
                const parts = [];
                if (selCount > 0)            parts.push(`${selCount} selected`);
                if (immCount > 0)            parts.push(`${immCount} removed`);
                if (insertedDeletedCount > 0) parts.push(`${insertedDeletedCount} inserted removed`);
                selCountEl.textContent = parts.join(', ');
            }
        }

        // "Delete Selected" — enabled when real pages are checked AND at least one would remain
        if (deleteBtn) deleteBtn.disabled = selCount === 0 || selCount >= visiblePages;

        // "Save PDF" — enabled when:
        //   • at least one real page was trashed (immCount > 0), OR
        //   • at least one inserted/blank page was trashed (insertedDeletedCount > 0)
        // In both cases the output is different from the original, so saving makes sense.
        const anyDeleted = immCount > 0 || insertedDeletedCount > 0;
        const wouldLeaveNothing = immCount >= totalPages && insertedDeletedCount === 0;
        if (savePdfBtn) savePdfBtn.disabled = !anyDeleted || wouldLeaveNothing;
    }

    // ─── Select All / None ────────────────────────────────────────────────────
    window.deleteToggleSelectAll = function (checked) {
        if (!deletePdfDoc) return;
        deleteSelectedPages.clear();
        if (checked) {
            // Only select pages still visible in the grid (not immediately deleted)
            for (let p = 1; p <= deletePdfDoc.numPages; p++) {
                if (!immediatelyDeletedPages.has(p)) deleteSelectedPages.add(p);
            }
        }
        // Sync all page-item divs
        document.querySelectorAll('#pageGrid .page-item[data-page-num]').forEach(div => {
            const pn = parseInt(div.dataset.pageNum);
            if (checked) div.classList.add('delete-selected');
            else         div.classList.remove('delete-selected');
            const chk = div.querySelector('.delete-page-checkbox');
            if (chk) chk.checked = checked;
            const badge = div.querySelector('.delete-badge');
            if (badge) badge.style.display = checked ? '' : 'none';
        });
        // Also handle via data-page-num attribute (set on inner elements)
        document.querySelectorAll('#pageGrid .delete-page-checkbox').forEach(chk => {
            chk.checked = checked;
            const pn  = parseInt(chk.dataset.page);
            const div = chk.closest('.page-item');
            if (!div) return;
            if (checked) { div.classList.add('delete-selected'); deleteSelectedPages.add(pn); }
            else         { div.classList.remove('delete-selected'); }
            const badge = div.querySelector('.delete-badge');
            if (badge) badge.style.display = checked ? '' : 'none';
        });
        updateDeleteFileList();
        _updateDeleteToolbar();
    };

    // ─── Rotate a single page ─────────────────────────────────────────────────
    async function _rotateDeletePage(div, pageNum, delta) {
        const current = deletePageRotations.get(pageNum) || 0;
        const next    = ((current + delta) + 360) % 360;
        deletePageRotations.set(pageNum, next);

        const page     = await deletePdfDoc.getPage(pageNum);
        const canvas   = div.querySelector('canvas');
        if (!canvas) return;
        const viewport = page.getViewport({ scale: 0.5, rotation: next });
        canvas.width   = viewport.width;
        canvas.height  = viewport.height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
    }

    // ─── Preview ──────────────────────────────────────────────────────────────
    async function _openDeletePreview(pageNum) {
        if (!deletePdfDoc) return;
        deletePreviewPage = pageNum;
        const modal = document.getElementById('previewModal');
        modal?.classList.add('active');
        await new Promise(resolve => requestAnimationFrame(resolve));
        const page   = await deletePdfDoc.getPage(pageNum);
        const vp     = page.getViewport({ scale: 1 });
        deletePreviewScale = getDeletePreviewFitScale(vp.width, vp.height);
        await _renderDeletePreview();
    }

    async function _renderDeletePreview() {
        if (!deletePdfDoc) return;
        const wrapper = document.getElementById('previewCanvasWrapper');
        if (!wrapper) return;
        wrapper.innerHTML = '';

        const page     = await deletePdfDoc.getPage(deletePreviewPage);
        const rotation = deletePageRotations.get(deletePreviewPage) || 0;
        const canvas   = document.createElement('canvas');
        const ctx      = canvas.getContext('2d');
        const viewport = page.getViewport({ scale: deletePreviewScale, rotation });
        canvas.width   = viewport.width;
        canvas.height  = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        wrapper.appendChild(canvas);

        const zoomEl = document.getElementById('previewZoomLevel');
        if (zoomEl) zoomEl.textContent = Math.round(deletePreviewScale * 100) + '%';

        const total   = deletePdfDoc.numPages;
        const counter = document.getElementById('previewPageCounter');
        const prevBtn = document.getElementById('previewPrevBtn');
        const nextBtn = document.getElementById('previewNextBtn');
        if (counter) counter.textContent = `${deletePreviewPage} / ${total}`;
        if (prevBtn) prevBtn.disabled = deletePreviewPage <= 1;
        if (nextBtn) nextBtn.disabled = deletePreviewPage >= total;
    }

    // Wire preview modal controls when delete mode is active
    window.zoomPreview = window.zoomPreview || function(){};
    window.fitPreview  = window.fitPreview  || function(){};
    window.navigatePreview   = window.navigatePreview   || function(){};
    window.rotatePreview     = window.rotatePreview     || function(){};
    window.deletePreviewPage = window.deletePreviewPage || function(){};
    window.closePreview      = window.closePreview      || function(){};

    // Override dispatchers to handle delete mode
    const _origZoom      = window.zoomPreview;
    const _origFit       = window.fitPreview;
    const _origNav       = window.navigatePreview;
    const _origRotate    = window.rotatePreview;
    const _origDelPage   = window.deletePreviewPage;
    const _origClose     = window.closePreview;

    window.zoomPreview = function(delta) {
        if (window.activeTool !== 'delete') return _origZoom?.(delta);
        deletePreviewScale = Math.max(0.3, Math.min(5, deletePreviewScale + delta));
        _renderDeletePreview();
    };
    window.fitPreview = function() {
        if (window.activeTool !== 'delete') return _origFit?.();
        _openDeletePreview(deletePreviewPage);
    };
    window.navigatePreview = function(delta) {
        if (window.activeTool !== 'delete') return _origNav?.(delta);
        const next = deletePreviewPage + delta;
        if (!deletePdfDoc || next < 1 || next > deletePdfDoc.numPages) return;
        deletePreviewPage = next;
        _renderDeletePreview();
    };
    window.rotatePreview = async function(degrees) {
        if (window.activeTool !== 'delete') return _origRotate?.(degrees);
        const div = document.querySelector(`#pageGrid .page-item[data-page-num="${deletePreviewPage}"]`);
        if (div) await _rotateDeletePage(div, deletePreviewPage, degrees);
        else {
            const c = deletePageRotations.get(deletePreviewPage) || 0;
            deletePageRotations.set(deletePreviewPage, ((c + degrees) + 360) % 360);
        }
        _renderDeletePreview();
    };
    window.deletePreviewPage = function() {
        if (window.activeTool !== 'delete') return _origDelPage?.();
        const pn = deletePreviewPage;
        document.getElementById('previewModal')?.classList.remove('active');
        // Mark the page for deletion instead of instantly deleting
        const div = _getPageDiv(pn);
        if (div) _togglePageSelection(pn, !deleteSelectedPages.has(pn), div);
    };
    window.closePreview = function(event) {
        if (window.activeTool !== 'delete') return _origClose?.(event);
        if (!event || event.target.classList.contains('preview-modal') ||
            event.target.classList.contains('preview-close')) {
            document.getElementById('previewModal')?.classList.remove('active');
        }
    };

    function _getPageDiv(pageNum) {
        return document.querySelector(`#pageGrid .page-item .delete-page-checkbox[data-page="${pageNum}"]`)?.closest('.page-item') || null;
    }

    // ─── Trailing "Add PDF" button at end of grid (same as Split/Merge) ──────
    function _createDeleteAddFileButton() {
        const div = document.createElement('div');
        div.className = 'page-item add-page-item';
        div.onclick = () => {
            window._deleteInsertMode = true;
            _deletePendingInsertAfterPos = _getDeletePageWrappers().length - 1;
            document.getElementById('fileInput').click();
        };
        div.innerHTML = `
            <div class="page-thumbnail">
                <div style="text-align:center;color:var(--text-secondary);font-size:12px;line-height:1.5;">
                <div style="font-size:28px;margin-bottom:6px;color:var(--accent-color);"><i class="fa fa-plus-circle"></i></div>
                    <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">Add PDF</div>
                </div>
            </div>`;
        return div;
    }

    function _appendDeleteAddFileButton() {
        // Remove any existing trailing add-file wrapper first
        const old = document.querySelector('#pageGrid .page-item-wrapper:has(.add-page-item)');
        if (old) old.remove();
        const pageGrid = document.getElementById('pageGrid');
        if (!pageGrid) return;
        const addWrapper = document.createElement('div');
        addWrapper.className = 'page-item-wrapper';
        addWrapper.appendChild(_createDeleteAddFileButton());
        pageGrid.appendChild(addWrapper);
    }
    function _createDeleteAddBetweenButton() {
        const btn = document.createElement('div');
        btn.className = 'delete-add-between merge-add-between';
        btn.innerHTML = `
            <div class="merge-add-line"></div>
            <button class="merge-add-btn" title="Insert here"><i class="fa fa-plus"></i></button>
            <div class="merge-add-tooltip" style="display:none;">
                <button class="merge-add-option" data-action="blank"><i class="fa fa-file-o"></i> Add blank page</button>
                <button class="merge-add-option" data-action="document"><i class="fa fa-folder-open"></i> Add document</button>
            </div>`;

        const addBtn  = btn.querySelector('.merge-add-btn');
        const tooltip = btn.querySelector('.merge-add-tooltip');
        document.body.appendChild(tooltip);

        addBtn.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('.merge-add-tooltip').forEach(t => {
                if (t !== tooltip) t.style.display = 'none';
            });
            const isOpen = tooltip.style.display !== 'none';
            if (isOpen) { tooltip.style.display = 'none'; return; }

            tooltip.style.display = 'flex';
            tooltip.style.top  = '-9999px';
            tooltip.style.left = '-9999px';

            const btnRect = addBtn.getBoundingClientRect();
            const ttW     = tooltip.offsetWidth;
            const ttH     = tooltip.offsetHeight;
            const margin  = 6;

            let top  = btnRect.bottom + margin;
            let left = btnRect.left + btnRect.width / 2 - ttW / 2;

            if (left + ttW > window.innerWidth - margin)  left = window.innerWidth - ttW - margin;
            if (left < margin)                             left = margin;
            if (top  + ttH > window.innerHeight - margin) top  = btnRect.top - ttH - margin;

            tooltip.style.top  = top  + 'px';
            tooltip.style.left = left + 'px';
        });

        tooltip.querySelectorAll('.merge-add-option').forEach(opt => {
            opt.addEventListener('click', e => {
                e.stopPropagation();
                tooltip.style.display = 'none';
                const action = opt.dataset.action;
                // Determine insertion point: which wrapper this button is attached to
                const wrapperEl   = btn.closest('.page-item-wrapper');
                const allWrappers = _getDeletePageWrappers();
                const insertAfter = allWrappers.indexOf(wrapperEl);

                if (action === 'blank') {
                    _insertDeleteBlankPage(insertAfter);
                } else {
                    _insertDeleteDocumentAt(insertAfter);
                }
            });
        });

        document.addEventListener('click', () => { tooltip.style.display = 'none'; }, { capture: false });
        return btn;
    }

    function _getDeletePageWrappers() {
        // Return all page-item-wrapper elements that contain a rendered page card
        // (real pages AND inserted blank/pdf pages) — skips skeleton-only and add-page-item wrappers
        return Array.from(document.querySelectorAll('#pageGrid .page-item-wrapper')).filter(w =>
            w.querySelector('.page-item') && !w.querySelector('.add-page-item')
        );
    }

    function _attachDeleteAddBetween(wrapper) {
        const existing = wrapper.querySelector('.delete-add-between');
        if (existing) existing.remove();
        const btn = _createDeleteAddBetweenButton();
        wrapper.appendChild(btn);
    }

    function _refreshDeleteAddBetweenButtons() {
        document.querySelectorAll('.delete-add-between').forEach(b => b.remove());
        // Also clean up orphan tooltips from delete-add buttons
        _getDeletePageWrappers().forEach(w => _attachDeleteAddBetween(w));
    }

    // Insert a blank page into the delete grid at a given position
    async function _insertDeleteBlankPage(insertAfterPos) {
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
            const blankBuffer = blankUint8.buffer.slice(blankUint8.byteOffset, blankUint8.byteOffset + blankUint8.byteLength);
            const blankPdfDoc = await pdfjsLib.getDocument({ data: blankUint8.slice(0) }).promise;

            hideProcessing();

            const pageGrid    = document.getElementById('pageGrid');
            const allWrappers = _getDeletePageWrappers();
            const refWrapper  = allWrappers[insertAfterPos];

            const newWrapper = document.createElement('div');
            newWrapper.className = 'page-item-wrapper';
            const skeleton = _createDeleteSkeleton(0, 0);
            newWrapper.appendChild(skeleton);

            if (refWrapper && refWrapper.nextSibling) {
                pageGrid.insertBefore(newWrapper, refWrapper.nextSibling);
            } else {
                pageGrid.appendChild(newWrapper);
            }

            // Build full-featured card (with checkbox, overlay, between-buttons)
            const pageItem = await _createInsertedPageCard(blankPdfDoc, 1, blankBuffer, null, newWrapper, true);
            newWrapper.replaceChild(pageItem, skeleton);

            if (!window._deleteInsertedPages) window._deleteInsertedPages = [];
            window._deleteInsertedPages.push({ wrapper: newWrapper, arrayBuffer: blankBuffer, isBlank: true });

            _refreshDeleteAddBetweenButtons();
            _appendDeleteAddFileButton();
            _renumberDeleteInsertedPages();
            updateDeleteFileList();
            showNotification('Blank page inserted', 'success');
            showToast('Blank page inserted!', 'success');
        } catch (err) {
            hideProcessing();
            showNotification('Failed to insert blank page: ' + err.message, 'error');
        }
    }

    // ─── Shared card builder for inserted pages (blank or from PDF) ───────────
    // Produces a full page-item card identical in behaviour to real pages:
    //   • Checkbox (top-left) that marks the inserted page for deletion
    //   • Thumbnail canvas
    //   • Hover overlay: Preview | Rotate-Left | Rotate-Right | Trash
    //   • Footer with sequential page number
    //   • Source badge (BLANK or filename)
    async function _createInsertedPageCard(pdfDoc, pageNum, arrayBuffer, fileName, wrapperEl, isBlank) {
        // Per-card rotation state (independent of the main deletePageRotations map)
        let cardRotation = 0;

        const page     = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 0.5, rotation: cardRotation });

        const div = document.createElement('div');
        div.className = 'page-item file-1';
        if (isBlank) {
            div.dataset.insertedBlank = 'true';
        } else {
            div.dataset.insertedPdf  = 'true';
            div.dataset.insertedFile = escHtml(fileName);
        }

        // ── Checkbox ──────────────────────────────────────────────────────────
        const chkWrap = document.createElement('div');
        chkWrap.className = 'delete-checkbox-wrap';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'delete-page-checkbox';
        chk.style.pointerEvents = 'none'; // chkWrap handles all clicks
        chkWrap.appendChild(chk);

        // Clicking anywhere in the checkbox zone toggles it — stop propagation
        chkWrap.addEventListener('click', e => {
            e.stopPropagation();
            const nowChecked = !chk.checked;
            chk.checked = nowChecked;
            _toggleInsertedSelection(nowChecked, div);
        });

        // ── Thumbnail ─────────────────────────────────────────────────────────
        const thumbnail = document.createElement('div');
        thumbnail.className = 'page-thumbnail';
        thumbnail.style.position = 'relative';

        const canvas = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        canvas.style.pointerEvents = 'none'; // let clicks fall through to the card div
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        thumbnail.appendChild(canvas);

        // Source badge
        const badge = document.createElement('div');
        badge.style.cssText = 'position:absolute;top:4px;left:4px;color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;z-index:4;pointer-events:none;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        if (isBlank) {
            badge.style.background = 'rgba(100,100,100,0.82)';
            badge.textContent = 'BLANK';
        } else {
            badge.style.background = 'rgba(25,118,210,0.85)';
            badge.textContent = fileName.replace(/\.pdf$/i, '');
        }
        thumbnail.appendChild(badge);

        // ── Hover overlay: Preview | Rotate-L | Rotate-R | Trash ─────────────
        const overlay = document.createElement('div');
        overlay.className = 'page-hover-overlay';
        overlay.innerHTML = `
            <div class="page-hover-actions">
                <button class="page-action-btn primary" title="Preview"      data-action="preview"><i class="fa fa-eye"></i></button>
                <button class="page-action-btn"         title="Rotate Left"  data-action="rotate-left"><i class="fa fa-rotate-left"></i></button>
                <button class="page-action-btn"         title="Rotate Right" data-action="rotate-right"><i class="fa fa-rotate-right"></i></button>
                <button class="page-action-btn danger"  title="Remove this page" data-action="remove">
                    <i class="fa fa-trash-o"></i>
                </button>
            </div>`;

        overlay.querySelectorAll('.page-action-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                switch (btn.dataset.action) {
                    case 'preview': {
                        // Render a preview in the preview modal
                        const modal2 = document.getElementById('previewModal');
                        modal2?.classList.add('active');
                        await new Promise(resolve => requestAnimationFrame(resolve));
                        const vp0 = (await pdfDoc.getPage(pageNum)).getViewport({ scale: 1 });
                        const scale = getDeletePreviewFitScale(vp0.width, vp0.height);
                        const wrapper2 = document.getElementById('previewCanvasWrapper');
                        if (wrapper2) {
                            wrapper2.innerHTML = '';
                            const pg2  = await pdfDoc.getPage(pageNum);
                            const vp2  = pg2.getViewport({ scale, rotation: cardRotation });
                            const c2   = document.createElement('canvas');
                            c2.width   = vp2.width;
                            c2.height  = vp2.height;
                            await pg2.render({ canvasContext: c2.getContext('2d'), viewport: vp2 }).promise;
                            wrapper2.appendChild(c2);
                            const zoomEl = document.getElementById('previewZoomLevel');
                            if (zoomEl) zoomEl.textContent = Math.round(scale * 100) + '%';
                            const counter = document.getElementById('previewPageCounter');
                            if (counter) counter.textContent = `${pageNum} / ${pdfDoc.numPages}`;
                            const prevBtn = document.getElementById('previewPrevBtn');
                            const nextBtn = document.getElementById('previewNextBtn');
                            if (prevBtn) prevBtn.disabled = true;
                            if (nextBtn) nextBtn.disabled = true;
                        }
                        document.getElementById('previewModal')?.classList.add('active');
                        showToast('Previewing inserted page', 'info');
                        break;
                    }
                    case 'rotate-left':
                    case 'rotate-right': {
                        const delta = btn.dataset.action === 'rotate-left' ? -90 : 90;
                        cardRotation = ((cardRotation + delta) + 360) % 360;
                        const pg3  = await pdfDoc.getPage(pageNum);
                        const vp3  = pg3.getViewport({ scale: 0.5, rotation: cardRotation });
                        canvas.width  = vp3.width;
                        canvas.height = vp3.height;
                        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
                        await pg3.render({ canvasContext: canvas.getContext('2d'), viewport: vp3 }).promise;
                        showToast('Rotated ' + (btn.dataset.action === 'rotate-left' ? 'left' : 'right'), 'info');
                        break;
                    }
                    case 'remove': {
                        wrapperEl.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
                        wrapperEl.style.opacity    = '0';
                        wrapperEl.style.transform  = 'scale(0.92)';
                        setTimeout(() => {
                            // Remove from _deleteInsertedPages tracking
                            if (window._deleteInsertedPages) {
                                window._deleteInsertedPages = window._deleteInsertedPages.filter(e => e.wrapper !== wrapperEl);
                            }
                            insertedDeletedCount++;
                            wrapperEl.remove();
                            _refreshDeleteAddBetweenButtons();
                            _appendDeleteAddFileButton();
                            _renumberDeleteInsertedPages();
                            updateDeleteFileList();
                            _updateDeleteToolbar();
                        }, 200);
                        showToast(isBlank ? 'Blank page removed' : 'Inserted page removed', 'info');
                        break;
                    }
                }
            });
        });
        thumbnail.appendChild(overlay);

        // ── Footer ────────────────────────────────────────────────────────────
        const footer = document.createElement('div');
        footer.className = 'page-footer';
        const numSpan = document.createElement('span');
        numSpan.className   = 'page-number';
        numSpan.textContent = '—';
        footer.appendChild(numSpan);

        // Deletion badge (shown when checkbox is ticked)
        const delBadge = document.createElement('span');
        delBadge.className = 'delete-badge';
        delBadge.innerHTML = '<i class="fa fa-trash-o"></i> Delete';
        delBadge.style.cssText = 'display:none;background:rgba(239,68,68,0.9);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;pointer-events:none;';
        footer.appendChild(delBadge);

        div.appendChild(chkWrap);
        div.appendChild(thumbnail);
        div.appendChild(footer);

        // Click anywhere on the card (except action overlay buttons) → toggle selection
        div.addEventListener('click', e => {
            if (e.target.closest('.page-hover-overlay')) return;
            const nowChecked = !chk.checked;
            chk.checked = nowChecked;
            _toggleInsertedSelection(nowChecked, div);
            showToast(nowChecked ? 'Page marked for deletion' : 'Page unmarked', nowChecked ? 'warning' : 'info');
        });

        return div;
    }

    // Toggle selection state on an inserted card (mirrors _togglePageSelection for real pages)
    function _toggleInsertedSelection(selected, divEl) {
        const chk   = divEl.querySelector('.delete-page-checkbox');
        const badge = divEl.querySelector('.delete-badge');
        if (selected) {
            divEl.classList.add('delete-selected');
        } else {
            divEl.classList.remove('delete-selected');
        }
        if (chk)   chk.checked          = selected;
        if (badge) badge.style.display   = selected ? '' : 'none';
    }

    // Insert a PDF document into the delete grid at a given position
    function _insertDeleteDocumentAt(insertAfterPos) {
        _deletePendingInsertAfterPos = insertAfterPos;
        window._deleteInsertMode = true;
        document.getElementById('fileInput').click();
    }

    // Renumber all visible page cards sequentially in DOM order
    function _renumberDeleteInsertedPages() {
        let num = 1;
        document.querySelectorAll('#pageGrid .page-item-wrapper').forEach(w => {
            const span = w.querySelector('.page-number');
            if (span) { span.textContent = num; num++; }
        });
    }

    // ─── "Delete Selected" button — removes selected pages from the grid ─────
    window.deleteSelectedFromGrid = function () {
        if (!deleteSelectedPages.size) return;
        // Snapshot so iterating is safe while we mutate the set inside _immediateDeletePage
        const pages = Array.from(deleteSelectedPages);
        for (const pn of pages) {
            const chk = document.querySelector(`#pageGrid .delete-page-checkbox[data-page="${pn}"]`);
            const div = chk ? chk.closest('.page-item') : null;
            if (div) _immediateDeletePage(pn, div);
        }
        setTimeout(() => { _refreshDeleteAddBetweenButtons(); _appendDeleteAddFileButton(); }, 250);
    };


    window.executeDeletePages = async function () {
        if (!deletePdfDoc || !deleteArrayBuffer) {
            showNotification('Please load a PDF first.', 'warning'); return;
        }
        // Save PDF acts on:
        //  • Real pages removed via trash icon (immediatelyDeletedPages)
        //  • Inserted/blank pages removed via their trash button (insertedDeletedCount > 0)
        // Checked/selected pages are NOT included — they must be confirmed with "Delete Selected" first.
        const allToDelete = new Set([...immediatelyDeletedPages]);
        const hasAnythingToSave = allToDelete.size > 0 || insertedDeletedCount > 0;
        if (!hasAnythingToSave) {
            showNotification('No pages have been removed yet. Use the trash icon or "Delete Selected" button first.', 'warning'); return;
        }
        if (allToDelete.size === deletePdfDoc.numPages) {
            showNotification('You cannot delete all pages. At least one page must remain.', 'warning'); return;
        }

        showProgress('Deleting Pages…', 'Building output PDF…');
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
            updateProgress(15, 'Loading source PDF…');
            const srcDoc = await PDFDocument.load(deleteArrayBuffer);

            updateProgress(30, 'Building output page order…');

            // Walk the DOM in order to determine the final page sequence.
            // - Real page-items (data-page-num) → include if not in allToDelete
            // - Inserted blank/PDF items (data-inserted-blank / data-inserted-pdf) → always include
            const outDoc = await PDFDocument.create();
            const allWrappers = Array.from(document.querySelectorAll('#pageGrid .page-item-wrapper'));
            const insertedMap = new Map(); // wrapper element → inserted page entry

            if (window._deleteInsertedPages) {
                for (const entry of window._deleteInsertedPages) {
                    insertedMap.set(entry.wrapper, entry);
                }
            }

            let processedCount = 0;
            const totalVisible = allWrappers.length;

            for (let wi = 0; wi < allWrappers.length; wi++) {
                const wrapper = allWrappers[wi];

                // ── Inserted blank or PDF page ────────────────────────────────
                if (insertedMap.has(wrapper)) {
                    const entry = insertedMap.get(wrapper);
                    if (entry.isBlank) {
                        // Blank page — already an ArrayBuffer with one A4 page
                        const blankSrc  = await PDFDocument.load(entry.arrayBuffer);
                        const [blankPg] = await outDoc.copyPages(blankSrc, [0]);
                        outDoc.addPage(blankPg);
                    } else {
                        // Inserted PDF page
                        const insertedSrc = await PDFDocument.load(entry.arrayBuffer);
                        const [pg]        = await outDoc.copyPages(insertedSrc, [entry.pageNum - 1]);
                        outDoc.addPage(pg);
                    }
                    processedCount++;
                    if (processedCount % 3 === 0)
                        updateProgress(30 + Math.round(55 * processedCount / totalVisible), `Processing page ${processedCount}…`);
                    continue;
                }

                // ── Real PDF page ─────────────────────────────────────────────
                const realDiv = wrapper.querySelector('.page-item[data-page-num]');
                if (!realDiv) continue;
                const pageNum = parseInt(realDiv.dataset.pageNum);
                if (allToDelete.has(pageNum)) continue; // skip deleted pages

                const [copied] = await outDoc.copyPages(srcDoc, [pageNum - 1]);
                outDoc.addPage(copied);

                // Apply any UI rotation
                const rot = deletePageRotations.get(pageNum);
                if (rot) {
                    const pg = outDoc.getPages()[outDoc.getPageCount() - 1];
                    pg.setRotation(degrees((pg.getRotation().angle + rot) % 360));
                }

                processedCount++;
                if (processedCount % 3 === 0)
                    updateProgress(30 + Math.round(55 * processedCount / totalVisible), `Processing page ${processedCount}…`);
            }

            updateProgress(88, 'Saving PDF…');
            const pdfBytes = await outDoc.save();

            let binary = '';
            const chunk = 8192;
            for (let i = 0; i < pdfBytes.length; i += chunk)
                binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));

            updateProgress(98, 'Preparing download…');
            await new Promise(r => setTimeout(r, 300));
            hideProgress();

            const deleted  = allToDelete.size;
            const remained = outDoc.getPageCount();
            const baseName = deleteFileName.replace(/\.pdf$/i, '');
            downloadFile(btoa(binary), `${baseName}_pages_deleted.pdf`);

            showNotification(
                `Done! Deleted ${deleted} page${deleted > 1 ? 's' : ''}, ${remained} page${remained > 1 ? 's' : ''} in output.`,
                'success'
            );
            showToast(`Deleted ${deleted} page${deleted > 1 ? 's' : ''}!`, 'success');
        } catch (err) {
            hideProgress();
            showNotification('Delete failed: ' + err.message, 'error');
            showToast('Delete failed.', 'error');
            console.error(err);
        }
    };

    // ─── Toolbar: rotate selected pages ──────────────────────────────────────
    window.rotateSelectedDeletePages = async function (delta) {
        if (!deletePdfDoc || !deleteSelectedPages.size) {
            showToast('Select pages first', 'warning'); return;
        }
        for (const pn of deleteSelectedPages) {
            const div = _getPageDiv(pn);
            if (div) await _rotateDeletePage(div, pn, delta);
            else {
                const c = deletePageRotations.get(pn) || 0;
                deletePageRotations.set(pn, ((c + delta) + 360) % 360);
            }
        }
        showToast(`Rotated ${deleteSelectedPages.size} page(s)`, 'info');
    };

    // ─── initDelete re-exposes window.handleFileSelect ────────────────────────
    // The global router in index_enhanced.php calls window.handleFileSelect.
    // We intercept only when activeTool === 'delete' or when in delete insert mode.
    const _origHandleFileSelect = window.handleFileSelect;
    window.handleFileSelect = function (event) {
        if (window.activeTool === 'delete' || window._deleteInsertMode) {
            window.handleDeleteFileSelect(event);
        } else if (_origHandleFileSelect) {
            _origHandleFileSelect(event);
        }
    };

    // ─── escHtml helper ───────────────────────────────────────────────────────
    function escHtml(s) {
        return String(s).replace(/[&<>"']/g, c =>
            ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    }

})();
