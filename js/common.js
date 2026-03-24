// js/common.js - Common utilities and initialization

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Format number with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Mobile menu toggle
function toggleMobileMenu() {
    const toolTabs = document.getElementById('toolTabs');
    const overlay = document.getElementById('mobileOverlay');
    
    if (toolTabs && overlay) {
        toolTabs.classList.toggle('show');
        overlay.classList.toggle('show');
    }
}

// Theme toggle
function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    const themeIcon = document.getElementById('themeIcon');
    const themeText = document.getElementById('themeText');
    
    if (themeIcon) themeIcon.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    if (themeText) themeText.textContent = newTheme === 'dark' ? 'Light' : 'Dark';
}

// Load saved theme
(function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        const themeIcon = document.getElementById('themeIcon');
        const themeText = document.getElementById('themeText');
        if (themeIcon) themeIcon.textContent = '☀️';
        if (themeText) themeText.textContent = 'Light';
    }
})();

// Notification system
function showNotification(message, type = 'info', title = null) {
    const modal = document.getElementById('notificationModal');
    const icon = document.getElementById('notificationIcon');
    const titleEl = document.getElementById('notificationTitle');
    const messageEl = document.getElementById('notificationMessage');

    if (!modal) return;

    const configs = {
        success: { icon: '✅', title: 'Success', class: 'success' },
        error: { icon: '❌', title: 'Error', class: 'error' },
        warning: { icon: '⚠️', title: 'Warning', class: 'warning' },
        info: { icon: 'ℹ️', title: 'Information', class: 'info' }
    };

    const config = configs[type] || configs.info;
    if (icon) {
        icon.textContent = config.icon;
        icon.className = 'notification-icon ' + config.class;
    }
    if (titleEl) titleEl.textContent = title || config.title;
    if (messageEl) messageEl.textContent = message;

    modal.classList.add('show');
}

function closeNotification() {
    const modal = document.getElementById('notificationModal');
    if (modal) modal.classList.remove('show');
}

// Progress bar functions
function showProgress(title, message) {
    const overlay = document.getElementById('processingOverlay');
    const content = document.getElementById('processingContent');
    const spinner = document.getElementById('processingSpinner');
    const titleEl = document.getElementById('processingTitle');
    const messageEl = document.getElementById('processingMessage');
    const progressContainer = document.getElementById('progressContainer');
    
    if (!overlay) return;
    
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    
    if (content) content.classList.add('with-progress');
    if (progressContainer) progressContainer.style.display = 'block';
    if (spinner) spinner.style.display = 'none';
    
    updateProgress(0);
    overlay.classList.add('active');
}

function updateProgress(percentage, detail = '') {
    const fill = document.getElementById('progressBarFill');
    const percentageEl = document.getElementById('progressPercentage');
    const detailEl = document.getElementById('progressDetail');
    
    if (fill) fill.style.width = percentage + '%';
    if (percentageEl) percentageEl.textContent = Math.round(percentage) + '%';
    if (detail && detailEl) detailEl.textContent = detail;
}

function hideProgress() {
    const overlay = document.getElementById('processingOverlay');
    const content = document.getElementById('processingContent');
    const progressContainer = document.getElementById('progressContainer');
    const spinner = document.getElementById('processingSpinner');
    
    if (overlay) overlay.classList.remove('active');
    if (content) content.classList.remove('with-progress');
    if (progressContainer) progressContainer.style.display = 'none';
    if (spinner) spinner.style.display = 'block';
}

function showProcessing(message = 'Processing...') {
    const overlay = document.getElementById('processingOverlay');
    const titleEl = document.getElementById('processingTitle');
    const messageEl = document.getElementById('processingMessage');
    
    if (!overlay) return;
    
    if (titleEl) titleEl.textContent = message;
    if (messageEl) messageEl.textContent = 'Please wait';
    overlay.classList.add('active');
}

function hideProcessing() {
    const overlay = document.getElementById('processingOverlay');
    if (overlay) overlay.classList.remove('active');
}

// Download file helper
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

// Close modals with Escape key / confirm with Space
document.addEventListener('keydown', function(e) {

    const confirmModal      = document.getElementById('confirmModal');
    const notificationModal = document.getElementById('notificationModal');
    const confirmOpen       = confirmModal      && confirmModal.classList.contains('show');
    const notifOpen         = notificationModal && notificationModal.classList.contains('show');

    // ── Escape = Cancel / Close ───────────────────────────────────────────────
    if (e.key === 'Escape') {
        if (confirmOpen) {
            e.preventDefault();
            // Click Cancel button so its event handler runs cleanly
            const cancelBtn = document.getElementById('confirmCancelBtn');
            if (cancelBtn) cancelBtn.click();
            else confirmModal.classList.remove('show');
        } else if (notifOpen) {
            e.preventDefault();
            closeNotification();
        } else {
            const toolTabs = document.getElementById('toolTabs');
            if (toolTabs && toolTabs.classList.contains('show')) {
                toggleMobileMenu();
            }
        }
    }

    // ── Space = OK / Confirm ──────────────────────────────────────────────────
    if (e.key === ' ') {
        // Don't hijack Space if user is typing in a text input/textarea
        const el  = document.activeElement;
        const tag = el && el.tagName;
        const type = el && el.type && el.type.toLowerCase();
        const isTextInput = (tag === 'TEXTAREA') ||
                            (tag === 'INPUT' && type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit') ||
                            (tag === 'SELECT');
        if (isTextInput) return;

        if (confirmOpen) {
            e.preventDefault();
            const okBtn = document.getElementById('confirmOkBtn');
            if (okBtn) okBtn.click();
        } else if (notifOpen) {
            e.preventDefault();
            closeNotification();
        }
    }

    // Ctrl+Shift+ArrowRight — next stamp preview page
    if (e.key === 'ArrowRight') {
        const tool = window.activeTool || 'split';
        if (tool === 'stamp' && typeof window.changeStampPreviewPage === 'function') {
            e.preventDefault();
            window.changeStampPreviewPage(1);
        }
    }

    // Ctrl+Shift+ArrowLeft — previous stamp preview page
    if (e.key === 'ArrowLeft') {
        const tool = window.activeTool || 'split';
        if (tool === 'stamp' && typeof window.changeStampPreviewPage === 'function') {
            e.preventDefault();
            window.changeStampPreviewPage(-1);
        }
    }


    // Ctrl+Shift+ArrowRight — next stamp preview page
    if (e.key === 'ArrowUp') {
        const tool = window.activeTool || 'split';
        if (tool === 'stamp' && typeof window.changeStampZoom === 'function') {
            e.preventDefault();
            window.changeStampZoom(0.2);
        }
    }

    // Ctrl+Shift+ArrowLeft — previous stamp preview page
    if (e.key === 'ArrowDown') {
        const tool = window.activeTool || 'split';
        if (tool === 'stamp' && typeof window.changeStampZoom === 'function') {
            e.preventDefault();
            window.changeStampZoom(-0.2);
        }
    }

    


    // Ctrl+Shift+Z -- switch to Split
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'Z') {
        e.preventDefault();
        switchToSplit();
    }
    // Ctrl+Shift+X -- switch to Merge
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'X') {
        e.preventDefault();
        switchToMerge();
    }
    // Ctrl+Shift+P -- toggle left panel
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'C') {
        e.preventDefault();
        switchToStamp();
    }

    // Ctrl+Shift+P -- toggle left panel
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'P') {
        e.preventDefault();
        toggleLeftPanel();
    }

    // Ctrl+Shift+L -- toggle dark/light theme (all modes)
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'L') {
        e.preventDefault();
        toggleTheme();
    }

    // Ctrl+Shift+O -- open file
    //   Split/Merge: clicks #fileInput
    //   Stamp:       clicks #stampFileInput
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'O') {
        e.preventDefault();
        const tool = window.activeTool || 'split';
        if (tool === 'stamp') {
            const stampInput = document.getElementById('stampFileInput');
            if (stampInput) stampInput.click();
        } else {
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.click();
        }
    }

    // Ctrl+Shift+S -- execute primary action for active tool
    //   Split: executeSplit()          (only if splitBtn enabled)
    //   Merge: executeMerge()          (only if mergeBtn enabled)
    //   Stamp: applyStampAndDownload() (only if stampApplyBtn enabled)
    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'S') {
        e.preventDefault();
        const tool = window.activeTool || 'split';
        if (tool === 'split') {
            const btn = document.getElementById('splitBtn');
            if (btn && !btn.disabled) executeSplit();
        } else if (tool === 'merge') {
            const btn = document.getElementById('mergeBtn');
            if (btn && !btn.disabled) executeMerge();
        } else if (tool === 'stamp') {
            const btn = document.getElementById('stampApplyBtn');
            if (btn && !btn.disabled && typeof applyStampAndDownload === 'function') {
                applyStampAndDownload();
            }
        }
    }

    if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'P') {
    e.preventDefault();
    const tool = window.activeTool || 'split';
    if (tool === 'stamp') {
        const printBtn     = document.getElementById('stampPrintBtn');
        const printOnlyBtn = document.getElementById('stampPrintOnlyBtn');
        const modal        = document.getElementById('printStampOnlyModal');

        if (modal) {
            // Modal is already open — second press executes print directly
            if (typeof executePrintStampOnly === 'function') executePrintStampOnly();

        } else if (printBtn && !printBtn.disabled) {
            // Normal mode — PDF loaded, print with stamp
            if (typeof applyStampAndPrint === 'function') applyStampAndPrint();

        } else if (printOnlyBtn && !printOnlyBtn.disabled) {
            // Stamp-only mode — open modal to confirm settings first
            if (typeof openPrintStampOnly === 'function') openPrintStampOnly();
        }
    }
}

if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'M') {
    e.preventDefault();
    const tool = window.activeTool || 'split';
    if (tool === 'stamp') {
        const chk = document.getElementById('stampOnlyChk');
        if (chk) {
            chk.checked = !chk.checked;
            toggleStampOnlyMode(chk.checked);
        }
    }
}

});

// Close notification when clicking outside
const notificationModal = document.getElementById('notificationModal');
if (notificationModal) {
    notificationModal.addEventListener('click', function(e) {
        if (e.target === this) {
            closeNotification();
        }
    });
}

// Confirmation Modal helper
function showConfirm(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const okBtn = document.getElementById('confirmOkBtn');

    if (!modal) return;

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    
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

// Reset app
function resetApp() {
    location.reload();
}