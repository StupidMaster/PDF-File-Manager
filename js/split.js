pdfjsLib.GlobalWorkerOptions.workerSrc = `${window.PDF_MANAGER_BASE || '.'}/ScriptsJS/3.11.174-pdf.worker.min.js`;

        // State
        let pdfDocuments = [];
        let splitPoints = new Set();
        let currentFileIndex = 0;
        const fileColors = [
            'var(--file-color-1)', 'var(--file-color-2)', 'var(--file-color-3)', 
            'var(--file-color-4)', 'var(--file-color-5)', 'var(--file-color-6)', 
            'var(--file-color-7)', 'var(--file-color-8)'
        ];
        
        // Store rendered pages to prevent re-rendering
        let renderedPages = new Map();

        // Counter for generating unique pageKeys for duplicated pages
        let dupCounter = 0;

        // Page operation state
        let pageRotations = new Map();   // pageKey -> rotation degrees (0, 90, 180, 270)
        let deletedPages  = new Set();   // global page indices that have been deleted

        // Preview navigation state
        let previewGlobalIndex = 0;      // current global page index in preview

        

        // Mobile menu toggle
        function toggleMobileMenu() {
            const toolTabs = document.getElementById('toolTabs');
            const overlay  = document.getElementById('mobileOverlay');

            toolTabs.classList.toggle('show');
            overlay.classList.toggle('show');
        }

        // Close overlay — called when clicking the dark backdrop
        // Handles both tool-tabs panel AND left-panel dismissal
        function closeOverlay() {
            const toolTabs = document.getElementById('toolTabs');
            const overlay  = document.getElementById('mobileOverlay');
            const panel    = document.getElementById('leftPanel');
            const btn      = document.getElementById('collapseBtn');

            // Close tool-tabs if open
            if (toolTabs) toolTabs.classList.remove('show');

            // Close left panel if open on mobile
            if (panel && window.innerWidth <= 992 && !panel.classList.contains('collapsed')) {
                panel.classList.add('collapsed');
                if (btn) btn.innerHTML = '<i class="fa fa-angle-double-right" style="font-size:24px"></i>';
            }

            // Always hide overlay
            if (overlay) overlay.classList.remove('show');
        }

        // Toggle left panel - Improved for mobile
        function toggleLeftPanel() {
            const panel  = document.getElementById('leftPanel');
            const btn    = document.getElementById('collapseBtn');
            const overlay = document.getElementById('mobileOverlay');

            panel.classList.toggle('collapsed');

            if (window.innerWidth <= 992) {
                const isOpen = !panel.classList.contains('collapsed');

                // Sync the dark backdrop with panel open/close
                if (overlay) overlay.classList.toggle('show', isOpen);

                // Measure actual sticky header height and apply to panel
                const hdr = document.querySelector('.sticky-header-container');
                if (hdr && panel) {
                    const hdrH = hdr.getBoundingClientRect().height;
                    panel.style.top    = hdrH + 'px';
                    panel.style.height = 'calc(100vh - ' + hdrH + 'px)';
                }

                btn.innerHTML = isOpen
                    ? '<i class="fa fa-angle-double-left" style="font-size:24px"></i>'
                    : '<i class="fa fa-angle-double-right" style="font-size:24px"></i>';
            } else {
                btn.innerHTML = panel.classList.contains('collapsed')
                    ? '<i class="fa fa-angle-double-right" style="font-size:24px"></i>'
                    : '<i class="fa fa-angle-double-left" style="font-size:24px"></i>';
            }
        }

        // Handle window resize
        window.addEventListener('resize', function() {
            const panel = document.getElementById('leftPanel');
            const btn = document.getElementById('collapseBtn');
            
            if (window.innerWidth > 992) {
                // Desktop: Reset panel state
                panel.classList.remove('collapsed');
                btn.innerHTML = '<i class="fa fa-angle-double-left" style="font-size:24px"></i>';
            } else {
                // Mobile: Collapse by default
                panel.classList.add('collapsed');
                btn.innerHTML = '<i class="fa fa-angle-double-right" style="font-size:24px"></i>';
            }
        });

        // Initial check for mobile
        if (window.innerWidth <= 992) {
            const panel = document.getElementById('leftPanel');
            const btn = document.getElementById('collapseBtn');
            panel.classList.add('collapsed');
            btn.innerHTML = '<i class="fa fa-angle-double-right" style="font-size:24px"></i>';
        }

        // Confirmation Modal
        function showConfirm(title, message, onConfirm) {
            const modal = document.getElementById('confirmModal');
            const titleEl = document.getElementById('confirmTitle');
            const messageEl = document.getElementById('confirmMessage');
            const cancelBtn = document.getElementById('confirmCancelBtn');
            const okBtn = document.getElementById('confirmOkBtn');

            titleEl.textContent = title;
            messageEl.textContent = message;
            
            const newOkBtn = okBtn.cloneNode(true);
            const newCancelBtn = cancelBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            
            newCancelBtn.addEventListener('click', () => {
                modal.classList.remove('show');
            });
            
            newOkBtn.addEventListener('click', () => {
                modal.classList.remove('show');
                if (onConfirm) onConfirm();
            });

            modal.classList.add('show');
        }

        // Notification System
        function showNotification(message, type = 'info', title = null) {
            const modal = document.getElementById('notificationModal');
            const icon = document.getElementById('notificationIcon');
            const titleEl = document.getElementById('notificationTitle');
            const messageEl = document.getElementById('notificationMessage');

            const configs = {
                success: { icon: '<i class="fa fa-check-circle"></i>', title: 'Success', class: 'success' },
                error: { icon: '<i class="fa fa-times-circle"></i>', title: 'Error', class: 'error' },
                warning: { icon: '<i class="fa fa-exclamation-triangle"></i>', title: 'Warning', class: 'warning' },
                info: { icon: '<i class="fa fa-info-circle"></i>', title: 'Information', class: 'info' }
            };

            const config = configs[type] || configs.info;
            icon.innerHTML = config.icon;
            icon.className = 'notification-icon ' + config.class;
            titleEl.textContent = title || config.title;
            messageEl.textContent = message;

            modal.classList.add('show');
        }

        function closeNotification() {
            document.getElementById('notificationModal').classList.remove('show');
        }

        // Processing Overlay
        function showProcessing(message = 'Loading PDF...') {
            document.getElementById('processingTitle').textContent = message;
            document.getElementById('processingMessage').textContent = 'Please wait';
            document.getElementById('processingOverlay').classList.add('active');
        }

        function hideProcessing() {
            document.getElementById('processingOverlay').classList.remove('active');
        }

        // Handle multiple file selection
        async function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // LIMIT 1: Maximum number of files
    if (files.length > 20) {
        showNotification('Maximum 20 PDF files allowed at once.', 'error');
        event.target.value = '';
        return;
    }

    for (let file of files) {
        if (file.type !== 'application/pdf') {
            showNotification('Please select only PDF files.', 'error');
            event.target.value = '';
            return;
        }
        
        // LIMIT 2: Maximum file size (50MB per file)
        if (file.size > 50 * 1024 * 1024) {
            showNotification(`File "${file.name}" is too large. Maximum 50MB per file.`, 'error');
            event.target.value = '';
            return;
        }
    }
    
    // LIMIT 3: Maximum total size (100MB)
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 100 * 1024 * 1024) {
        showNotification('Total file size exceeds 100MB. Please upload fewer or smaller files.', 'error');
        event.target.value = '';
        return;
    }

    showProcessing('Preparing files...');

    try {
        const newPdfDocuments = [];
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
            
            newPdfDocuments.push({
                document: pdfDoc,
                arrayBuffer: arrayBuffer,
                fileIndex: currentFileIndex + i + 1,
                fileName: file.name,
                numPages: pdfDoc.numPages
            });
        }
        
        // LIMIT 4: Maximum total pages
        const currentTotalPages = pdfDocuments.reduce((sum, pdf) => sum + pdf.numPages, 0);
        const newTotalPages = newPdfDocuments.reduce((sum, pdf) => sum + pdf.numPages, 0);
        const combinedTotal = currentTotalPages + newTotalPages;
        
        if (combinedTotal > 500) {
            hideProcessing();
            showNotification(
                `Total pages would be ${combinedTotal}. Maximum 500 pages allowed.\nCurrent: ${currentTotalPages} pages\nNew files: ${newTotalPages} pages`,
                'error'
            );
            event.target.value = '';
            return;
        }
        
        // Add to pdfDocuments array
        currentFileIndex += files.length;
        pdfDocuments.push(...newPdfDocuments);

        hideProcessing();

        if (pdfDocuments.length > 0) {
            document.getElementById('uploadSection').classList.add('hidden');
            document.getElementById('pageContainer').classList.add('active');
            document.getElementById('splitControls').classList.add('show');
            
            await appendNewFiles(files.length);
            updateFileList();
            
            showNotification(`Successfully uploaded ${files.length} file(s)!`, 'success');
            showToast('Successfully uploaded (' + files.length + ') file(s)!', 'info');
        }
    } catch (error) {
        hideProcessing();
        showNotification('Error uploading files: ' + error.message, 'error');
        showToast('Error uploading files.', 'error');
    }

    event.target.value = '';
}

        // Append only new files without re-rendering existing pages
        async function appendNewFiles(fileCount) {
    const pageGrid = document.getElementById('pageGrid');
    
    const addButton = pageGrid.querySelector('.add-page-item');
    if (addButton && addButton.parentElement) {
        addButton.parentElement.remove();
    }

    let globalPageIndex = 0;
    for (let i = 0; i < pdfDocuments.length - fileCount; i++) {
        globalPageIndex += pdfDocuments[i].document.numPages;
    }

    const newFiles = pdfDocuments.slice(-fileCount);
    
    if (globalPageIndex > 0) {
        const allWrappers = Array.from(pageGrid.querySelectorAll('.page-item-wrapper'));
        const lastWrapper = allWrappers[globalPageIndex - 1];
        if (lastWrapper && !lastWrapper.classList.contains('split-point-wrapper')) {
            lastWrapper.classList.add('split-point-wrapper');
            const splitPoint = createSplitPoint(globalPageIndex - 1);
            lastWrapper.appendChild(splitPoint);
        }
    }

    // STEP 1: Create ALL skeletons first (all at 0%)
    const skeletonData = [];
    
    for (const pdfData of newFiles) {
        const { document: pdfDoc, fileIndex } = pdfData;

        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-item-wrapper';
            
            const skeleton = createSkeletonItem(globalPageIndex, getTotalPages());
            pageWrapper.appendChild(skeleton);
            
            if (globalPageIndex < getTotalPages() - 1) {
                pageWrapper.classList.add('split-point-wrapper');
                const splitPoint = createSplitPoint(globalPageIndex);
                pageWrapper.appendChild(splitPoint);
            }
            
            pageGrid.appendChild(pageWrapper);

            const pageKey = `${fileIndex}-${i}`;
            
            skeletonData.push({
                wrapper: pageWrapper,
                skeleton: skeleton,
                pdfDoc: pdfDoc,
                pageNum: i,
                fileIndex: fileIndex,
                globalPageIndex: globalPageIndex,
                pageKey: pageKey
            });

            globalPageIndex++;
        }
    }

    // Add "Add file" button at the end
    const addWrapper = document.createElement('div');
    addWrapper.className = 'page-item-wrapper';
    addWrapper.appendChild(createAddFileButton());
    pageGrid.appendChild(addWrapper);

    // STEP 2: Load pages ONE BY ONE sequentially
    for (const data of skeletonData) {
        await loadPageSequentially(
            data.wrapper, 
            data.skeleton, 
            data.pdfDoc, 
            data.pageNum, 
            data.fileIndex, 
            data.globalPageIndex, 
            data.pageKey
        );
    }

    updateSplitCount();
    applyGroupHighlights();
}

async function loadPageSequentially(wrapper, skeleton, pdfDoc, pageNum, fileIndex, globalPageIndex, pageKey) {
    try {
        const progressBar = skeleton.querySelector('.progress-bar-fill');
        const percentEl = skeleton.querySelector('.progress-percentage');
        const labelEl = skeleton.querySelector('.progress-label');
        
        // Update label to show loading
        if (labelEl) labelEl.textContent = `Loading page ${globalPageIndex + 1}...`;
        
        // Animate progress from 0 to 90%
        let progress = 0;
        const progressInterval = setInterval(() => {
            if (progress < 90) {
                progress += 15;
                if (progressBar) progressBar.style.width = progress + '%';
                if (percentEl) percentEl.textContent = progress + '%';
            }
        }, 80);

        // Render the actual page
        let pageItem;
        if (renderedPages.has(pageKey)) {
            pageItem = renderedPages.get(pageKey);
        } else {
            pageItem = await createPageItem(pdfDoc, pageNum, fileIndex, globalPageIndex);
            renderedPages.set(pageKey, pageItem);
        }
        
        clearInterval(progressInterval);
        
        // Complete to 100%
        if (progressBar) progressBar.style.width = '100%';
        if (percentEl) percentEl.textContent = '100%';
        if (labelEl) labelEl.textContent = 'Complete!';
        
        // Small delay to show completion
        await new Promise(r => setTimeout(r, 150));
        
        // Replace skeleton with actual page
        wrapper.replaceChild(pageItem, skeleton);
        
    } catch (error) {
        console.error('Error loading page:', error);
        const labelEl = skeleton.querySelector('.progress-label');
        if (labelEl) labelEl.textContent = 'Error loading page';
    }
}



        // Update file list in left panel
        function updateFileList() {
            const container = document.getElementById('filesContainer');
            const panelTitle = document.getElementById('panelTitle');
            
            panelTitle.innerHTML = `<i class="fa fa-folder-open"></i> Uploaded Files (${pdfDocuments.length})`;

            if (pdfDocuments.length === 0) {
                container.innerHTML = `
                    <div class="empty-files">
                        <div style="font-size:28px;margin-bottom:6px"><i class="fa fa-file-pdf-o"></i></div>
                        <span>No files uploaded yet</span>
                    </div>
                `;
                return;
            }

            let html = '';
            pdfDocuments.forEach((pdfData, index) => {
                const color = fileColors[(pdfData.fileIndex - 1) % fileColors.length];
                html += `
                    <div class="file-card" data-file-index="${pdfData.fileIndex}" onmouseenter="highlightFilePages(${pdfData.fileIndex})" onmouseleave="unhighlightFilePages(${pdfData.fileIndex})">
                        <div class="file-icon" style="color: ${color}"><i class="fa fa-file-pdf-o"></i></div>
                        <div class="file-info">
                            <div class="file-name">${pdfData.fileName}</div>
                            <div class="file-meta">
                                <span>${pdfData.numPages} pages</span>
                                <span class="file-pages" style="background: ${color}20; color: ${color}">File ${pdfData.fileIndex}</span>
                            </div>
                        </div>
                        <button class="file-remove" onclick="showRemoveConfirm(${index}, event)"><i class="fa fa-trash-o" style="font-size:20px;"></i></button>
                    </div>
                `;
            });

            container.innerHTML = html;
        }

        // Show remove confirmation modal
        function showRemoveConfirm(index, event) {
            event.stopPropagation();
            showConfirm(
                'Remove File',
                `Remove "${pdfDocuments[index].fileName}"?`,
                () => removeFile(index)
            );
        }

        // Show reset confirmation modal
        function showResetConfirm() {
            showConfirm(
                'Start Over',
                'Start over with new files? All current progress will be lost.',
                () => resetApp()
            );
        }

        // Highlight pages from specific file
        function highlightFilePages(fileIndex) {
            document.querySelectorAll(`.page-item[data-file-index="${fileIndex}"]`).forEach(page => {
                page.style.transform = 'scale(1.02)';
                page.style.boxShadow = '0 8px 24px var(--accent-color)';
                page.style.border = '2px solid var(--accent-color)';
            });
        }

        // Unhighlight pages from specific file
        function unhighlightFilePages(fileIndex) {
            document.querySelectorAll(`.page-item[data-file-index="${fileIndex}"]`).forEach(page => {
                page.style.transform = '';
                page.style.boxShadow = '';
                page.style.border = '';
            });
        }

        // Remove file without reloading
        // Remove file without reloading - UPDATED VERSION
// UPDATED: Remove file and rebuild grid
function removeFile(index) {
    const removedFile = pdfDocuments[index];
    const removedFileIndex = removedFile.fileIndex;
    
    pdfDocuments.splice(index, 1);
    
    document.querySelectorAll(`.page-item[data-file-index="${removedFileIndex}"]`).forEach(page => {
        const wrapper = page.closest('.page-item-wrapper');
        if (wrapper) wrapper.remove();
    });
    
    document.querySelectorAll(`.split-point[data-file-index="${removedFileIndex}"]`).forEach(split => {
        split.remove();
    });
    
    if (pdfDocuments.length === 0) {
        document.getElementById('uploadSection').classList.remove('hidden');
        document.getElementById('pageContainer').classList.remove('active');
        document.getElementById('splitControls').style.display = 'none';
        clearAllSplitPoints();
        renderedPages.clear();
        updateFileList();
        showNotification('File removed successfully', 'success');
        return;
    }
    
    rebuildPageGrid();
    updateFileList();
    showNotification('File removed successfully', 'success');
}

// NEW: Rebuild page grid with correct numbering
async function rebuildPageGrid() {
    const pageGrid = document.getElementById('pageGrid');
    pageGrid.innerHTML = '';
    splitPoints.clear();
    
    let globalPageIndex = 0;
    
    pdfDocuments.forEach((pdfData, index) => {
        pdfData.fileIndex = index + 1;
    });
    
    for (const pdfData of pdfDocuments) {
        const { document: pdfDoc, fileIndex } = pdfData;
        
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-item-wrapper';
            
            const pageKey = `${fileIndex}-${i}`;
            
            let pageItem;
            if (renderedPages.has(pageKey)) {
                pageItem = renderedPages.get(pageKey);
                pageItem.dataset.page = globalPageIndex;
                pageItem.dataset.fileIndex = fileIndex;
                
                const pageNumberEl = pageItem.querySelector('.page-number');
                if (pageNumberEl) pageNumberEl.textContent = globalPageIndex + 1;
                
                const fileBadge = pageItem.querySelector('.file-badge');
                if (fileBadge) {
                    fileBadge.textContent = `File ${fileIndex}`;
                    fileBadge.style.background = fileColors[(fileIndex - 1) % fileColors.length];
                }
                
                pageItem.className = `page-item file-${(fileIndex - 1) % 8 + 1}`;
            } else {
                pageItem = await createPageItem(pdfDoc, i, fileIndex, globalPageIndex);
                renderedPages.set(pageKey, pageItem);
            }
            
            pageWrapper.appendChild(pageItem);
            
            if (globalPageIndex < getTotalPages() - 1) {
                pageWrapper.classList.add('split-point-wrapper');
                const splitPoint = createSplitPoint(globalPageIndex);
                pageWrapper.appendChild(splitPoint);
            }
            
            pageGrid.appendChild(pageWrapper);
            globalPageIndex++;
        }
    }
    
    const addWrapper = document.createElement('div');
    addWrapper.className = 'page-item-wrapper';
    addWrapper.appendChild(createAddFileButton());
    pageGrid.appendChild(addWrapper);
    
    updateSplitCount();
}

// NEW FUNCTION: Rebuild entire page grid with correct numbering
async function rebuildPageGrid() {
    const pageGrid = document.getElementById('pageGrid');
    pageGrid.innerHTML = '';
    
    // Clear split points
    splitPoints.clear();
    
    let globalPageIndex = 0;
    
    // Renumber file indices
    pdfDocuments.forEach((pdfData, index) => {
        pdfData.fileIndex = index + 1;
    });
    
    // Rebuild all pages
    for (const pdfData of pdfDocuments) {
        const { document: pdfDoc, fileIndex } = pdfData;
        
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-item-wrapper';
            
            const pageKey = `${fileIndex}-${i}`;
            
            let pageItem;
            if (renderedPages.has(pageKey)) {
                pageItem = renderedPages.get(pageKey);
                // Update the page item's data attributes
                pageItem.dataset.page = globalPageIndex;
                pageItem.dataset.fileIndex = fileIndex;
                
                // Update page number
                const pageNumberEl = pageItem.querySelector('.page-number');
                if (pageNumberEl) {
                    pageNumberEl.textContent = globalPageIndex + 1;
                }
                
                // Update file badge
                const fileBadge = pageItem.querySelector('.file-badge');
                if (fileBadge) {
                    fileBadge.textContent = `File ${fileIndex}`;
                    fileBadge.style.background = fileColors[(fileIndex - 1) % fileColors.length];
                }
                
                // Update file color class
                pageItem.className = `page-item file-${(fileIndex - 1) % 8 + 1}`;
            } else {
                pageItem = await createPageItem(pdfDoc, i, fileIndex, globalPageIndex);
                renderedPages.set(pageKey, pageItem);
            }
            
            pageWrapper.appendChild(pageItem);
            
            // Add split point (except for last page)
            if (globalPageIndex < getTotalPages() - 1) {
                pageWrapper.classList.add('split-point-wrapper');
                const splitPoint = createSplitPoint(globalPageIndex);
                pageWrapper.appendChild(splitPoint);
            }
            
            pageGrid.appendChild(pageWrapper);
            globalPageIndex++;
        }
    }
    
    // Add "Add file" button
    const addWrapper = document.createElement('div');
    addWrapper.className = 'page-item-wrapper';
    addWrapper.appendChild(createAddFileButton());
    pageGrid.appendChild(addWrapper);
    
    updateSplitCount();
    applyGroupHighlights();
}

        // Reindex split points after removal
        function reindexSplitPoints() {
            const newSplitPoints = new Set();
            document.querySelectorAll('.split-point .scissor-btn.active').forEach(btn => {
                const splitPoint = btn.closest('.split-point');
                if (splitPoint) {
                    const afterPage = parseInt(splitPoint.dataset.splitAfter);
                    const pageExists = document.querySelector(`.page-item[data-page="${afterPage}"]`);
                    if (pageExists) {
                        newSplitPoints.add(afterPage);
                    }
                }
            });
            splitPoints = newSplitPoints;
            updateSplitCount();
        }

        // Load page asynchronously and cache it
        async function loadPageAsync(wrapper, skeleton, pdfDoc, pageNum, fileIndex, globalPageIndex, pageKey) {
    try {
        const progressBar = skeleton.querySelector('.progress-bar-fill');
        const percentEl = skeleton.querySelector('.progress-percentage');
        const labelEl = skeleton.querySelector('.progress-label');
        
        // Start loading animation
        if (labelEl) labelEl.textContent = `Loading page ${globalPageIndex + 1}...`;
        
        let progress = 0;
        const progressInterval = setInterval(() => {
            if (progress < 90) {
                progress += 10;
                if (progressBar) progressBar.style.width = progress + '%';
                if (percentEl) percentEl.textContent = progress + '%';
            }
        }, 50);

        let pageItem;
        if (renderedPages.has(pageKey)) {
            pageItem = renderedPages.get(pageKey);
        } else {
            pageItem = await createPageItem(pdfDoc, pageNum, fileIndex, globalPageIndex);
            renderedPages.set(pageKey, pageItem);
        }
        
        clearInterval(progressInterval);
        
        if (progressBar) progressBar.style.width = '100%';
        if (percentEl) percentEl.textContent = '100%';
        if (labelEl) labelEl.textContent = 'Complete!';
        
        await new Promise(r => setTimeout(r, 100));
        
        wrapper.replaceChild(pageItem, skeleton);
        
    } catch (error) {
        console.error('Error loading page:', error);
        const labelEl = skeleton.querySelector('.progress-label');
        if (labelEl) labelEl.textContent = 'Error loading page';
    }
}

        // Create skeleton with progress bar
function createSkeletonItem(pageIndex, totalPages) {
    const div = document.createElement('div');
    div.className = 'skeleton-item';
 
    // Page label shown while waiting
    const pageLabel = pageIndex != null
        ? `Page ${pageIndex + 1}${totalPages ? ' of ' + totalPages : ''}`
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

        // Create add file button
        function createAddFileButton() {
            const div = document.createElement('div');
            div.className = 'page-item add-page-item';
            div.onclick = () => document.getElementById('fileInput').click();
            
            div.innerHTML = `
                <div class="page-thumbnail">
                <div style="text-align:center;color:var(--text-secondary);font-size:12px;line-height:1.5;">
                <div style="font-size:28px;margin-bottom:6px;color:var(--accent-color);"><i class="fa fa-plus-circle"></i></div>
                    <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">Add PDF</div>
                </div>
                </div>
            `;
            
            return div;
        }

        // Create page item with file badge and hover action overlay
        async function createPageItem(pdfDoc, pageNum, fileIndex, globalPageIndex, overridePageKey = null) {
            const page = await pdfDoc.getPage(pageNum);
            const pageKey = overridePageKey || `${fileIndex}-${pageNum}`;
            
            const div = document.createElement('div');
            div.className = `page-item file-${(fileIndex - 1) % 8 + 1}`;
            div.dataset.page = globalPageIndex;
            div.dataset.fileIndex = fileIndex;
            div.dataset.pageNum = pageNum;
            div.dataset.pageKey = pageKey;

            const thumbnail = document.createElement('div');
            thumbnail.className = 'page-thumbnail';
            thumbnail.style.position = 'relative';
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            const rotation = pageRotations.get(pageKey) || 0;
            const viewport = page.getViewport({ scale: 0.5, rotation });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            await page.render({ canvasContext: context, viewport }).promise;
            thumbnail.appendChild(canvas);

            // Hover action overlay
            const overlay = document.createElement('div');
            overlay.className = 'page-hover-overlay';
            overlay.innerHTML = `
                <div class="page-hover-actions">
                    <button class="page-action-btn primary" title="Preview" data-action="preview"><i class="fa fa-eye"></i></button>
                    <button class="page-action-btn" title="Rotate Left" data-action="rotate-left"><i class="fa fa-rotate-left"></i></button>
                    <button class="page-action-btn" title="Rotate Right" data-action="rotate-right"><i class="fa fa-rotate-right"></i></button>
                    <button class="page-action-btn" title="Duplicate" data-action="duplicate"><i class="fa fa-copy"></i></button>
                    <button class="page-action-btn danger" title="Delete" data-action="delete"><i class="fa fa-trash-o"></i></button>
                </div>
            `;

            // Wire action buttons — stop propagation so page click (preview) isn't triggered by buttons
            overlay.querySelectorAll('.page-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const gIdx = parseInt(div.dataset.page);
                    const key  = div.dataset.pageKey;
                    if (action === 'preview')      openSplitPreview(gIdx), showToast('Previewing PDF page.', 'info');
                    if (action === 'rotate-left')  rotatePageItem(div, pdfDoc, pageNum, key, -90), showToast('Rotated to left side.', 'info');
                    if (action === 'rotate-right') rotatePageItem(div, pdfDoc, pageNum, key, 90), showToast('Rotated to right side.', 'info');
                    if (action === 'duplicate')    duplicateSplitPage(gIdx), showToast('Duplicating PDF page...', 'warning');
                    if (action === 'delete')       deleteSplitPage(gIdx);
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
            fileBadge.style.background = fileColors[(fileIndex - 1) % fileColors.length];
            fileBadge.style.color = 'white';

            footer.appendChild(pageNumber);
            footer.appendChild(fileBadge);

            div.appendChild(thumbnail);
            div.appendChild(footer);

            // No click handler on the card itself — preview only via the eye button

            return div;
        }

        // ============================================================
        // GROUP HIGHLIGHTING — color pages by output PDF group
        // ============================================================
        function applyGroupHighlights() {
            const sortedSplits = Array.from(splitPoints).sort((a, b) => a - b);
            const wrappers = Array.from(document.querySelectorAll('.page-item-wrapper'));

            let groupIndex = 0;

            wrappers.forEach(wrapper => {
                const pageItem = wrapper.querySelector('.page-item');
                if (!pageItem || wrapper.querySelector('.add-page-item')) {
                    wrapper.removeAttribute('data-group');
                    wrapper.removeAttribute('data-group-label');
                    return;
                }

                const globalIdx = parseInt(pageItem.dataset.page);
                if (isNaN(globalIdx)) return;

                // Advance group index when we pass a split point
                // A split point afterPage=N means split after page N (0-indexed)
                // So all pages up to and including N are in current group
                groupIndex = 0;
                for (const sp of sortedSplits) {
                    if (globalIdx > sp) groupIndex++;
                    else break;
                }

                const groupNum = groupIndex % 8;
                wrapper.dataset.group = groupNum;
                wrapper.dataset.groupLabel = `PDF ${groupIndex + 1}`;
            });
        }

        // ============================================================
        // ROTATE PAGE ITEM
        // ============================================================
        async function rotatePageItem(div, pdfDoc, pageNum, pageKey, delta) {
            const current = pageRotations.get(pageKey) || 0;
            const newRotation = ((current + delta) + 360) % 360;
            pageRotations.set(pageKey, newRotation);

            // Re-render canvas with new rotation
            try {
                const page = await pdfDoc.getPage(pageNum);
                const canvas = div.querySelector('canvas');
                if (!canvas) return;

                const viewport = page.getViewport({ scale: 0.5, rotation: newRotation });
                canvas.width  = viewport.width;
                canvas.height = viewport.height;

                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;

                // Invalidate the renderedPages cache so rebuild picks up new rotation
                renderedPages.delete(pageKey);
            } catch (err) {
                console.error('Rotate error:', err);
            }
        }

        // ============================================================
        // DUPLICATE SPLIT PAGE
        // ============================================================
        async function duplicateSplitPage(globalIndex) {
            const info = getPageInfoByGlobalIndex(globalIndex);
            if (!info) return;

            const sourceWrapper = document.querySelector(`.page-item-wrapper .page-item[data-page="${globalIndex}"]`)?.closest('.page-item-wrapper');
            if (!sourceWrapper) return;

            const pageGrid = document.getElementById('pageGrid');
            const allWrappers = Array.from(pageGrid.querySelectorAll('.page-item-wrapper'));
            const sourceIndex = allWrappers.indexOf(sourceWrapper);

            // Source page key (shared by original)
            const sourcePageKey = `${info.pdfData.fileIndex}-${info.pageNum}`;

            // Give the duplicate its own unique key so its rotation is independent
            dupCounter++;
            const dupPageKey = `${sourcePageKey}-dup${dupCounter}`;

            // Inherit current rotation of the source (copy the value, not the reference)
            const sourceRotation = pageRotations.get(sourcePageKey) || 0;
            if (sourceRotation) pageRotations.set(dupPageKey, sourceRotation);

            const newItem = await createPageItem(
                info.pdfData.document,
                info.pageNum,
                info.pdfData.fileIndex,
                globalIndex,
                dupPageKey   // unique key — rotations on this page won't affect original
            );

            // DUP badge
            newItem.title = 'Duplicate page';
            const dupBadge = document.createElement('div');
            dupBadge.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(138,43,226,0.85);color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;z-index:4;pointer-events:none;';
            dupBadge.textContent = 'DUP';
            newItem.style.position = 'relative';
            newItem.appendChild(dupBadge);

            const newWrapper = document.createElement('div');
            newWrapper.className = 'page-item-wrapper';
            newWrapper.appendChild(newItem);

            const nextSibling = allWrappers[sourceIndex + 1];
            if (nextSibling) {
                pageGrid.insertBefore(newWrapper, nextSibling);
            } else {
                pageGrid.appendChild(newWrapper);
            }

            renumberPageItems();

            syncScissorPoints();

            showNotification('Page duplicated', 'success');
            showToast('Page duplicated', 'info');
            applyGroupHighlights();
        }

        // ============================================================
        // DELETE SPLIT PAGE
        // ============================================================
        function deleteSplitPage(globalIndex) {
            showConfirm(
                'Delete Page',
                `Remove page ${globalIndex + 1} from the split view? This only affects the current session.`,
                () => {
                    const wrapper = document.querySelector(`.page-item[data-page="${globalIndex}"]`)?.closest('.page-item-wrapper');
                    if (wrapper) {
                        wrapper.remove();
                        deletedPages.add(globalIndex);
                    }
                    // Renumber remaining pages visually
                    renumberPageItems();
                    syncScissorPoints();   // add/remove scissors so last page never has one
                    rebuildSplitPointIndices();
                    updateSplitCount();
                    applyGroupHighlights();

                    // ── Remove file cards for files whose pages are all gone ──
                    const pageGrid = document.getElementById('pageGrid');
                    const remainingFileIndexes = new Set(
                        Array.from(pageGrid.querySelectorAll('.page-item:not(.add-page-item)'))
                            .map(pi => parseInt(pi.dataset.fileIndex))
                    );
                    pdfDocuments = pdfDocuments.filter(p => remainingFileIndexes.has(p.fileIndex));
                    updateFileList();

                    // If no pages remain, reset to upload view
                    if (pageGrid.querySelectorAll('.page-item:not(.add-page-item)').length === 0) {
                        document.getElementById('uploadSection').classList.remove('hidden');
                        document.getElementById('pageContainer').classList.remove('active');
                        document.getElementById('splitControls').classList.remove('show');
                    }

                    showNotification('Page removed', 'success');
                    showToast('Page removed from split view.', 'info');
                }
            );
        }

        // ── Ensure scissors exist on all real pages except the last ────────────
        // Call this after any DOM change that adds or removes page wrappers.
        function syncScissorPoints() {
            const pageGrid = document.getElementById('pageGrid');
            const allRealWrappers = Array.from(
                pageGrid.querySelectorAll('.page-item-wrapper:not(:has(.add-page-item))')
            );
            allRealWrappers.forEach((wrapper, idx) => {
                const isLast   = idx === allRealWrappers.length - 1;
                const hasSplit = !!wrapper.querySelector('.split-point');
                if (!isLast && !hasSplit) {
                    // Non-last page missing its scissor — add one
                    wrapper.classList.add('split-point-wrapper');
                    const pageItem = wrapper.querySelector('.page-item:not(.add-page-item)');
                    const afterPage = pageItem ? parseInt(pageItem.dataset.page) : idx;
                    wrapper.appendChild(createSplitPoint(afterPage));
                } else if (isLast && hasSplit) {
                    // Last page must never have a scissor
                    wrapper.querySelector('.split-point').remove();
                    wrapper.classList.remove('split-point-wrapper');
                }
            });
        }

        // Renumber page-number spans after a deletion or duplication
        function renumberPageItems() {
            let n = 1;
            document.querySelectorAll('.page-item:not(.add-page-item)').forEach(item => {
                const numEl = item.querySelector('.page-number');
                if (numEl) numEl.textContent = n;
                item.dataset.page = n - 1;
                n++;
            });
        }

        // Rebuild split-point data-split-after values based on DOM order
        // so they match the page items that precede them
        function rebuildSplitPointIndices() {
            const pageGrid = document.getElementById('pageGrid');
            const wrappers = Array.from(pageGrid.querySelectorAll('.page-item-wrapper'));
            const newSplitPoints = new Set();

            wrappers.forEach(wrapper => {
                const pageItem = wrapper.querySelector('.page-item:not(.add-page-item)');
                const splitPoint = wrapper.querySelector('.split-point');
                if (!pageItem || !splitPoint) return;

                const pageIdx = parseInt(pageItem.dataset.page);
                if (isNaN(pageIdx)) return;

                // Update data attribute to match correct page index
                const wasActive = splitPoint.querySelector('.scissor-btn')?.classList.contains('active');
                splitPoint.dataset.splitAfter = pageIdx;

                // Rewire click handlers with updated index
                const btn = splitPoint.querySelector('.scissor-btn');
                const line = splitPoint.querySelector('.split-line-horizontal');
                if (btn && line) {
                    const toggle = (e) => {
                        e.stopPropagation();
                        toggleSplitPoint(pageIdx, btn, line);
                    };
                    btn.onclick = toggle;
                    line.onclick = toggle;
                    splitPoint.onclick = (e) => { if (e.target === splitPoint) toggle(e); };

                    if (wasActive) newSplitPoints.add(pageIdx);
                }
            });

            splitPoints = newSplitPoints;
            updateSplitCount();
        }

        // Get total pages across all documents
        function getTotalPages() {
            return pdfDocuments.reduce((sum, pdfData) => sum + pdfData.document.numPages, 0);
        }

        // Get total pages from DOM — includes duplicates and respects deletions
        function getTotalDOMPages() {
            return document.querySelectorAll('.page-item:not(.add-page-item)').length;
        }

        // ============================================================
        // HELPER — get pdfData and local pageNum from global index
        // (original-file based — does NOT know about duplicates)
        // ============================================================
        function getPageInfoByGlobalIndex(globalIndex) {
            let offset = 0;
            for (const pdfData of pdfDocuments) {
                if (globalIndex < offset + pdfData.numPages) {
                    return { pdfData, pageNum: globalIndex - offset + 1 };
                }
                offset += pdfData.numPages;
            }
            return null;
        }

        // ============================================================
        // HELPER — get page info from DOM (handles duplicates correctly)
        // Returns { pdfData, pageNum, pageKey } or null
        // ============================================================
        function getPageInfoFromDOM(globalIndex) {
            const item = document.querySelector(`.page-item:not(.add-page-item)[data-page="${globalIndex}"]`);
            if (!item) return null;

            const fileIndex = parseInt(item.dataset.fileIndex);
            const pageNum   = parseInt(item.dataset.pageNum);
            const pageKey   = item.dataset.pageKey;

            const pdfData = pdfDocuments.find(p => p.fileIndex === fileIndex);
            if (!pdfData) return null;

            return { pdfData, pageNum, pageKey };
        }

        // ============================================================
        // ENHANCED PREVIEW — open by global page index
        // ============================================================
        let currentPreviewScale = 1.5;
        let currentPreviewPage  = null;
        let currentPreviewDoc   = null;

        async function openSplitPreview(globalIndex) {
            const info = getPageInfoFromDOM(globalIndex);
            if (!info) return;

            previewGlobalIndex = globalIndex;
            currentPreviewDoc  = info.pdfData.document;
            currentPreviewPage = info.pageNum;

            const modal = document.getElementById('previewModal');

            // Fit scale to screen
            const pg = await currentPreviewDoc.getPage(currentPreviewPage);
            const modalW = window.innerWidth  * 0.8;
            const modalH = window.innerHeight * 0.7;
            const vp = pg.getViewport({ scale: 1 });
            currentPreviewScale = Math.min(modalW / vp.width, modalH / vp.height) * 0.9;

            await renderSplitPreview();
            modal.classList.add('active');
        }

        // Keep backward compat for anything still calling showPreview
        async function showPreview(pdfDoc, pageNum) {
            // Find global index
            let g = 0;
            for (const pd of pdfDocuments) {
                if (pd.document === pdfDoc) {
                    await openSplitPreview(g + pageNum - 1);
                    return;
                }
                g += pd.numPages;
            }
        }

        async function renderSplitPreview() {
            if (!currentPreviewDoc || !currentPreviewPage) return;

            const wrapper = document.getElementById('previewCanvasWrapper');
            wrapper.innerHTML = '';

            const page = await currentPreviewDoc.getPage(currentPreviewPage);

            // Get the correct pageKey from DOM (handles duplicates with unique keys)
            const info = getPageInfoFromDOM(previewGlobalIndex);
            const pageKey = info ? info.pageKey : null;
            const rotation = (pageKey && pageRotations.get(pageKey)) || 0;

            const canvas  = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const viewport = page.getViewport({ scale: currentPreviewScale, rotation });
            canvas.width  = viewport.width;
            canvas.height = viewport.height;

            await page.render({ canvasContext: context, viewport }).promise;
            wrapper.appendChild(canvas);

            // Update zoom level
            const zoomLevel = document.getElementById('previewZoomLevel');
            if (zoomLevel) zoomLevel.textContent = Math.round(currentPreviewScale * 100) + '%';

            // Update page counter & nav buttons
            updatePreviewNavUI();
        }

        function updatePreviewNavUI() {
            const total = getTotalDOMPages();
            const counter = document.getElementById('previewPageCounter');
            const prevBtn = document.getElementById('previewPrevBtn');
            const nextBtn = document.getElementById('previewNextBtn');

            if (counter) counter.textContent = `${previewGlobalIndex + 1} / ${total}`;
            if (prevBtn) prevBtn.disabled = (previewGlobalIndex <= 0);
            if (nextBtn) nextBtn.disabled = (previewGlobalIndex >= total - 1);
        }

        async function navigatePreview(delta) {
            const total = getTotalDOMPages();
            const newIdx = previewGlobalIndex + delta;
            if (newIdx < 0 || newIdx >= total) return;

            const info = getPageInfoFromDOM(newIdx);
            if (!info) return;

            previewGlobalIndex = newIdx;
            currentPreviewDoc  = info.pdfData.document;
            currentPreviewPage = info.pageNum;

            // Re-fit scale for potentially different page size
            const pg = await currentPreviewDoc.getPage(currentPreviewPage);
            const modalW = window.innerWidth  * 0.8;
            const modalH = window.innerHeight * 0.7;
            const vp = pg.getViewport({ scale: 1 });
            currentPreviewScale = Math.min(modalW / vp.width, modalH / vp.height) * 0.9;

            await renderSplitPreview();
        }

        async function rotatePreview(degrees) {
            const info = getPageInfoFromDOM(previewGlobalIndex);
            if (!info) return;

            const pageKey = info.pageKey;

            // Update the thumbnail in grid
            const gridItem = document.querySelector(`.page-item[data-page="${previewGlobalIndex}"]`);
            if (gridItem) {
                await rotatePageItem(gridItem, info.pdfData.document, info.pageNum, pageKey, degrees);
            } else {
                const current = pageRotations.get(pageKey) || 0;
                pageRotations.set(pageKey, ((current + degrees) + 360) % 360);
            }
            await renderSplitPreview();
        }

        function deletePreviewPage() {
            const idx = previewGlobalIndex;
            closePreview();
            deleteSplitPage(idx);
        }

        // Exposed directly on window — merge.js's versions will call these when activeTool==='split'
        window.splitZoomPreview = function(delta) {
            currentPreviewScale = Math.max(0.3, Math.min(5, currentPreviewScale + delta));
            renderSplitPreview();
        };

        window.splitFitPreview = function() {
            openSplitPreview(previewGlobalIndex);
        };

        window.splitRotatePreview = async function(degrees) {
            const info = getPageInfoFromDOM(previewGlobalIndex);
            if (!info) return;
            const pageKey = info.pageKey;
            const gridItem = document.querySelector(`.page-item[data-page="${previewGlobalIndex}"]`);
            if (gridItem) {
                await rotatePageItem(gridItem, info.pdfData.document, info.pageNum, pageKey, degrees);
            } else {
                const current = pageRotations.get(pageKey) || 0;
                pageRotations.set(pageKey, ((current + degrees) + 360) % 360);
            }
            await renderSplitPreview();
        };

        window.splitNavigatePreview = async function(delta) {
            const total = getTotalDOMPages();
            const newIdx = previewGlobalIndex + delta;
            if (newIdx < 0 || newIdx >= total) return;
            const info = getPageInfoFromDOM(newIdx);
            if (!info) return;
            previewGlobalIndex = newIdx;
            currentPreviewDoc  = info.pdfData.document;
            currentPreviewPage = info.pageNum;
            await renderSplitPreview();
            updatePreviewNavUI();
        };

        window.splitDeletePreviewPage = function() {
            const idx = previewGlobalIndex;
            document.getElementById('previewModal').classList.remove('active');
            deleteSplitPage(idx);
        };

        window.splitClosePreview = function() {
            document.getElementById('previewModal').classList.remove('active');
        };



        // Create vertical split point indicator
        function createSplitPoint(afterPage) {
            const splitDiv = document.createElement('div');
            splitDiv.className = 'split-point';
            splitDiv.dataset.splitAfter = afterPage;

            const scissorBtn = document.createElement('div');
            scissorBtn.className = 'scissor-btn';
            
            const scissorIcon = document.createElement('span');
            scissorIcon.className = 'scissor-icon';
            scissorIcon.innerHTML = '<i class="fa fa-scissors" style="font-size:15px;"></i>';
            
            scissorBtn.appendChild(scissorIcon);

            const line = document.createElement('div');
            line.className = 'split-line-horizontal';

            // All three elements toggle the split point when clicked
            const toggle = (e) => {
                e.stopPropagation();
                toggleSplitPoint(afterPage, scissorBtn, line);
            };
            scissorBtn.onclick = toggle;
            line.onclick = toggle;
            splitDiv.onclick = (e) => {
                // Only fire if the click was on the splitDiv itself, not a child that already handled it
                if (e.target === splitDiv) toggle(e);
            };

            splitDiv.appendChild(scissorBtn);
            splitDiv.appendChild(line);

            return splitDiv;
        }

        // Toggle split point
        function toggleSplitPoint(afterPage, btn, line) {
            if (splitPoints.has(afterPage)) {
                splitPoints.delete(afterPage);
                btn.classList.remove('active');
                line.classList.remove('active');
            } else {
                splitPoints.add(afterPage);
                btn.classList.add('active');
                line.classList.add('active');
            }

            updateSplitCount();
            applyGroupHighlights();
        }

// Update split count
// Update split count - FIXED
function updateSplitCount() {
    const count = splitPoints.size + 1; // Number of resulting PDFs
    document.getElementById('splitCountBtn').textContent = count;

    const splitBtn        = document.getElementById('splitBtn');
    const clearAllBtn     = document.getElementById('clearAllBtn');
    const splitEveryChk   = document.getElementById('splitEveryCheckbox');
    const splitEveryInput = document.getElementById('splitEveryInput');

    // Split button — only enabled when at least one split point is active
    splitBtn.disabled = (splitPoints.size === 0);

    // Clear All button — only enabled when there are active split points
    if (clearAllBtn) clearAllBtn.disabled = (splitPoints.size === 0);

    // Split Every checkbox — only enabled when 2+ page thumbnails exist
    const domPageCount = document.querySelectorAll('.page-item:not(.add-page-item)').length;
    const splitEveryEnabled = domPageCount >= 2;
    if (splitEveryChk) {
        splitEveryChk.disabled = !splitEveryEnabled;

        // Show toast when user clicks the checkbox while it is disabled
        if (!splitEveryChk._disabledToastBound) {
            splitEveryChk._disabledToastBound = true;
            splitEveryChk.addEventListener('click', function (e) {
                if (this.disabled) {
                    e.preventDefault();
                    showToast('Upload a PDF with 2 or more pages first');
                }
            });
        }
    }
    if (splitEveryInput && !splitEveryChk?.checked) splitEveryInput.disabled = true;
}

        // Toggle "Split after every" checkbox
        function toggleSplitEvery() {
            const checkbox = document.getElementById('splitEveryCheckbox');
            const input = document.getElementById('splitEveryInput');
            
            input.disabled = !checkbox.checked;

            if (checkbox.checked) {
                showToast('Split Every enabled');
                applySplitEvery();
            } else {
                showToast('Split Every disabled');
                _clearSplitPointsOnly();
            }
        }

        // Apply "Split after every N pages"
function applySplitEvery() {
    const interval = parseInt(document.getElementById('splitEveryInput').value);
    if (!interval || interval < 1) return;

    // Use internal clear so checkbox state is preserved
    _clearSplitPointsOnly();

    // Count actual DOM pages (includes duplicates)
    const allPageItems = Array.from(document.querySelectorAll('.page-item:not(.add-page-item)'));
    const totalPages = allPageItems.length;
    
    for (let i = interval; i < totalPages; i += interval) {
        const splitAfterIndex = i - 1;
        splitPoints.add(splitAfterIndex);
        
        // Find the wrapper whose page-item has dataset.page === splitAfterIndex
        for (const wrapper of document.querySelectorAll('.page-item-wrapper')) {
            const pageItem = wrapper.querySelector('.page-item:not(.add-page-item)');
            if (pageItem && parseInt(pageItem.dataset.page) === splitAfterIndex) {
                const splitPoint = wrapper.querySelector('.split-point');
                if (splitPoint) {
                    const btn = splitPoint.querySelector('.scissor-btn');
                    const line = splitPoint.querySelector('.split-line-horizontal');
                    if (btn) btn.classList.add('active');
                    if (line) line.classList.add('active');
                }
                break;
            }
        }
    }
    
    updateSplitCount();
    applyGroupHighlights();
    
    console.log('Total DOM pages:', totalPages);
    console.log('Split points:', Array.from(splitPoints).sort((a,b) => a-b));
    console.log('Expected output PDFs:', splitPoints.size + 1);
}

        // Internal: clear split point state and DOM only, does NOT touch checkbox
        function _clearSplitPointsOnly() {
            splitPoints.clear();
            
            document.querySelectorAll('.scissor-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            document.querySelectorAll('.split-line-horizontal').forEach(line => {
                line.classList.remove('active');
            });

            updateSplitCount();
            applyGroupHighlights();
        }

        // Public "Clear All" button handler — also resets checkbox
        function clearAllSplitPoints() {
            _clearSplitPointsOnly();
            const splitEveryCheckbox = document.getElementById('splitEveryCheckbox');
            const splitEveryInput = document.getElementById('splitEveryInput');
            if (splitEveryCheckbox) splitEveryCheckbox.checked = false;
            if (splitEveryInput) splitEveryInput.disabled = true;
            showToast('All split points cleared', 'info');
        }

        // Execute split — fully client-side via pdf-lib (handles duplicates, rotations, deletions)
async function executeSplit() {
    if (splitPoints.size === 0) {
        showNotification('Please select at least one split point.', 'warning');
        return;
    }
    const outputCount = splitPoints.size + 1;
    if (outputCount > 200) {
        showNotification(`This would create ${outputCount} PDF files. Maximum 200 output files allowed.`, 'error');
        return;
    }
    if (pdfDocuments.length === 0) {
        showNotification('No PDF loaded.', 'error');
        return;
    }
    showProgress('Splitting PDF...', 'Building output files…');
    try {
        await performClientSideSplit();
    } catch (err) {
        hideProgress();
        showNotification('Split failed: ' + err.message, 'error');
        console.error(err);
    }
}

// Full client-side split using pdf-lib — respects DOM order, duplicates, deletions, rotations
async function performClientSideSplit() {
    // Load pdf-lib on demand
    if (!window.PDFLib) {
        updateProgress(5, 'Loading pdf-lib…');
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = window.PDF_LIB_SRC || `${window.PDF_MANAGER_BASE || '.'}/ScriptsJS/1.17.1-pdf-lib.min.js`;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load pdf-lib'));
            document.head.appendChild(script);
        });
    }
    const { PDFDocument, degrees } = window.PDFLib;

    // Load each source PDF into pdf-lib (keyed by fileIndex)
    updateProgress(10, 'Loading source PDFs…');
    const srcDocs = new Map();
    for (const pdfData of pdfDocuments) {
        if (!srcDocs.has(pdfData.fileIndex)) {
            const doc = await PDFDocument.load(pdfData.arrayBuffer);
            srcDocs.set(pdfData.fileIndex, doc);
        }
    }

    // Get current DOM page order (respects duplicates and deletions)
    const allPageItems = Array.from(document.querySelectorAll('.page-item:not(.add-page-item)'));

    // Group pages by split points
    const sortedSplits = Array.from(splitPoints).sort((a, b) => a - b);
    const groups = [];
    let groupStart = 0;
    for (const sp of sortedSplits) {
        groups.push(allPageItems.slice(groupStart, sp + 1));
        groupStart = sp + 1;
    }
    groups.push(allPageItems.slice(groupStart));

    // Build one output PDF per group
    updateProgress(20, 'Building output PDFs…');
    const outputFiles = [];

    for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        if (group.length === 0) continue;

        const outDoc = await PDFDocument.create();

        for (const item of group) {
            const fileIndex = parseInt(item.dataset.fileIndex);
            const pageNum   = parseInt(item.dataset.pageNum);  // 1-based
            const pageKey   = item.dataset.pageKey;

            const srcDoc = srcDocs.get(fileIndex);
            if (!srcDoc) continue;

            const [copiedPage] = await outDoc.copyPages(srcDoc, [pageNum - 1]);
            outDoc.addPage(copiedPage);

            // Apply rotation
            const rot = pageRotations.get(pageKey);
            if (rot) {
                const pg = outDoc.getPages()[outDoc.getPageCount() - 1];
                const currentRot = pg.getRotation().angle;
                pg.setRotation(degrees((currentRot + rot) % 360));
            }
        }

        const pdfBytes = await outDoc.save();

        // Encode to base64
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < pdfBytes.length; i += chunk) {
            binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
        }

        const baseName = pdfDocuments[0]?.fileName?.replace(/\.pdf$/i, '') || 'split';
        outputFiles.push({ filename: `${baseName}_part${gi + 1}.pdf`, content: btoa(binary) });

        updateProgress(20 + Math.round(75 * (gi + 1) / groups.length),
                       `Built ${gi + 1} of ${groups.length} PDFs…`);
    }

    // Download
    updateProgress(98, 'Preparing download…');
    await new Promise(r => setTimeout(r, 300));
    hideProgress();

    if (outputFiles.length > 1) {
        await downloadAsZip(outputFiles, 'split_pages.zip');
    } else if (outputFiles.length === 1) {
        downloadFile(outputFiles[0].content, outputFiles[0].filename);
    }

    showNotification(`Successfully split into ${outputFiles.length} PDF${outputFiles.length > 1 ? 's' : ''}!`, 'success');
    showToast('Successfully split into ' + outputFiles.length + ' PDF' + (outputFiles.length > 1 ? 's' : '') + '!', 'info');
}
        // Download single file
        function downloadFile(base64Content, filename) {
            const byteString = atob(base64Content);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: 'application/pdf' });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // Download multiple files as ZIP
        async function downloadAsZip(files, zipFilename) {
            const zip = new JSZip();
            
            for (const file of files) {
                const byteString = atob(file.content);
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                }
                zip.file(file.filename, ab);
            }
            
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // Reset app
        function resetApp() {
            location.reload();
        }

        // Handle split every input change
        document.getElementById('splitEveryInput').addEventListener('input', function() {
            if (document.getElementById('splitEveryCheckbox').checked) {
                applySplitEvery();
            }
        });

        // Handle drag and drop
        const uploadSection = document.getElementById('uploadSection');
        
        uploadSection.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadSection.style.borderColor = 'var(--accent-color)';
            uploadSection.style.background = 'var(--accent-light)';
        });

        uploadSection.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadSection.style.borderColor = '';
            uploadSection.style.background = '';
        });

        uploadSection.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadSection.style.borderColor = '';
            uploadSection.style.background = '';
            
            const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
            if (files.length > 0) {
                const event = { target: { files: files } };
                handleFileSelect(event);
            }
        });

        // Close with Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closePreview();
                closeNotification();
                document.getElementById('confirmModal').classList.remove('show');
                
                const toolTabs = document.getElementById('toolTabs');
                if (toolTabs.classList.contains('show')) {
                    toggleMobileMenu();
                }
            }
        });

        // Close notification when clicking outside
        document.getElementById('notificationModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeNotification();
            }
        });

        // Close confirmation when clicking outside
        document.getElementById('confirmModal').addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.remove('show');
            }
        });


        // Progress bar functions
function showProgress(title, message) {
    const overlay = document.getElementById('processingOverlay');
    const content = document.getElementById('processingContent');
    const spinner = document.getElementById('processingSpinner');
    const titleEl = document.getElementById('processingTitle');
    const messageEl = document.getElementById('processingMessage');
    const progressContainer = document.getElementById('progressContainer');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    content.classList.add('with-progress');
    progressContainer.style.display = 'block';
    spinner.style.display = 'none';
    
    updateProgress(0);
    overlay.classList.add('active');
}

function updateProgress(percentage, detail = '') {
    const fill = document.getElementById('progressBarFill');
    const percentageEl = document.getElementById('progressPercentage');
    const detailEl = document.getElementById('progressDetail');
    
    fill.style.width = percentage + '%';
    percentageEl.textContent = Math.round(percentage) + '%';
    
    if (detail) {
        detailEl.textContent = detail;
    }
}

function hideProgress() {
    const overlay = document.getElementById('processingOverlay');
    const content = document.getElementById('processingContent');
    const progressContainer = document.getElementById('progressContainer');
    const spinner = document.getElementById('processingSpinner');
    
    overlay.classList.remove('active');
    content.classList.remove('with-progress');
    progressContainer.style.display = 'none';
    spinner.style.display = 'block';
}

// Expose state for tab switching guard
Object.defineProperty(window, 'hasSplitFiles', {
    get: () => pdfDocuments.length > 0
});

window._splitHasFiles = function() {
    return pdfDocuments.length > 0;
};

// Data-only reset — clears split state without touching the UI.
// Called by index_enhanced.php when switching AWAY from split mode.
window.clearSplitState = function() {
    pdfDocuments      = [];
    splitPoints       = new Set();
    currentFileIndex  = 0;
    renderedPages     = new Map();
    pageRotations     = new Map();
    deletedPages      = new Set();
    dupCounter        = 0;
    previewGlobalIndex = 0;
};

// beforeunload is handled globally in common.js via window._unloadCheckers

// Initialize / reset split mode without page reload
window.initSplit = function() {
    // Reset all split state
    pdfDocuments = [];
    splitPoints = new Set();
    currentFileIndex = 0;
    renderedPages = new Map();
    pageRotations = new Map();
    deletedPages  = new Set();
    previewGlobalIndex = 0;
    dupCounter = 0;

    // Reset UI
    const uploadSection = document.getElementById('uploadSection');
    const pageContainer = document.getElementById('pageContainer');
    const pageGrid = document.getElementById('pageGrid');
    const splitControls = document.getElementById('splitControls');
    const mergeControls = document.getElementById('mergeControls');
    const splitBtn = document.getElementById('splitBtn');
    const splitCountBtn = document.getElementById('splitCountBtn');

    if (uploadSection) uploadSection.classList.remove('hidden');
    if (pageContainer) { pageContainer.classList.remove('active'); pageContainer.style.display = ''; }
    if (pageGrid) pageGrid.innerHTML = '';
    if (splitControls) splitControls.classList.remove('show');  // hide until file uploaded
    if (mergeControls) mergeControls.classList.remove('active');
    if (splitBtn) splitBtn.disabled = true;
    if (splitCountBtn) splitCountBtn.textContent = '1';

    // Reset split-every checkbox and Clear All button
    const splitEveryCheckbox = document.getElementById('splitEveryCheckbox');
    const splitEveryInput    = document.getElementById('splitEveryInput');
    const clearAllBtn        = document.getElementById('clearAllBtn');
    if (splitEveryCheckbox) { splitEveryCheckbox.checked = false; splitEveryCheckbox.disabled = true; }
    if (splitEveryInput)    { splitEveryInput.value = 1; splitEveryInput.disabled = true; }
    if (clearAllBtn)        clearAllBtn.disabled = true;

    // Reset left panel
    const panelTitle = document.getElementById('panelTitle');
    if (panelTitle) panelTitle.innerHTML = '<i class="fa fa-folder-open"></i> Uploaded Files (0)';

    const filesContainer = document.getElementById('filesContainer');
    if (filesContainer) {
        filesContainer.innerHTML = `
            <div class="empty-files">
                <div style="font-size:32px;margin-bottom:6px"><i class="fa fa-file-pdf-o"></i></div>
                <span>No files uploaded yet</span>
            </div>
        `;
    }

    // Reset title
    const titleSpan = document.querySelector('.title span');
    if (titleSpan) titleSpan.innerHTML = '<div><i class="fa fa-scissors"></i> Split PDF</div>';
};
