// js/stamp.js - PDF Stamp / Watermark Tool

(function () {
    'use strict';

    // ─── Init guard — suppresses toasts fired during initial UI restore ────────
    // Set to true only after renderStampUI() finishes, so switchStampMode()
    // called during init (to restore a saved mode) never shows a toast.
    let _stampModeReady = false;

    // ─── State ────────────────────────────────────────────────────────────────
    let stampPdfDoc       = null;
    let stampPdfBytes     = null;
    let stampFileName     = '';
    let stampTotalPages   = 0;
    let stampPreviewPage  = 1;
    let stampPreviewScale = 1.0;
    let stampPdfPaperSize = 'original';
    let stampUseCurrentPaperSizeForNewPdfs = false;
    let stampViewMode = 'single';
    let stampDocuments = [];
    let activeStampDocIndex = -1;
    let stampRenderToken = 0;
    let stampKeyboardShortcutsReady = false;

    // 'simple' | 'formatted'
    let stampMode = 'simple';

    // Simple stamp settings
    let stampSettings = {
        text: 'RECEIVED', color: '#c0392b', opacity: 0.55,
        fontSize: 52, fontFamily: 'Arial', bold: true, italic: false,
        border: true, borderWidth: 3, rotation: -30,
        positionX: 50, positionY: 50, applyPages: 'all', pageRange: '', pages: []
    };

    // Formatted (official box) stamp settings
    let fmtSettings = {
        title:       'PHOTOCOPY OF THE ORIGINAL\nCERTIFIED BY:\n',
        name:        'JOAN R. ESPINOZA, DBM, LPT, CHRA',
        subName:     'Registrar Director',
        institution: 'CRONASIA FOUNDATION COLLEGE, INC.',
        showDate: true, showTime: true,
        color: '#1a2a6c', opacity: 1.0,
        positionX: 50, positionY: 50,
        applyPages: 'all', pageRange: '',
        scale: 0.45,
        transparentBg: true
    };

    // Circular seal settings
    let sealSettings = {
        topText:      'CERTIFIED TRUE COPY',
        bottomText:   'FROM THE ORIGINAL',
        dateLabel:    'DATE',
        schoolName:   'CRONASIA FOUNDATION COLLEGE, INC.',
        schoolAbbrev: 'CFC',
        showDate:     true,
        color:        '#1a2a6c',
        opacity:      1.0,
        scale:        0.4,
        positionX:    50,
        positionY:    50,
        applyPages:   'all',
        pageRange:    ''
    };

    // Received/Released box stamp settings
    let recvSettings = {
        schoolName:     'CRONASIA FOUNDATION COLLEGE, INC.',
        officeName:     'Office of the College Registrar',
        stampType:      'RECEIVED',
        personnelName:  '\n\n\nELENITO GINETE DAVID',
        personnelDesig: 'Admission and Records Officer',
        showDate: true, showTime: true,
        color: '#1a2a6c', opacity: 1.0,
        positionX: 50, positionY: 50,
        applyPages: 'all', pageRange: '',
        scale: 0.50,
        transparentBg: true
    };

    // Drag state
    let isDragging = false, dragStartX = 0, dragStartY = 0,
        dragStartPosX = 0, dragStartPosY = 0;
    let stampOverlayRedrawFrame = null;
    let stampScrollUpdateFrame = null;

    // ─── Per-page overrides ───────────────────────────────────────────────────
    // pageOverrides[pageNum] = deep copy of settings for that page (if customized)
    // Reset whenever a new PDF is loaded.
    let pageOverrides = {};   // e.g. { 2: { positionX:30, positionY:70, ... }, 3: {...} }
    let pageOverrideActive = false;  // true when current page has the checkbox ticked

    // ─── Stamp-only mode (no PDF) ─────────────────────────────────────────────
    let stampOnlyMode = false;   // true when "Print Stamp Only" checkbox is checked
    let bwMode        = false;   // true when "Grayscale page" is checked
    let grayscaleOutputMode = 'normal';
    let stampOutputRenderProfile = 'fast';
    let stampOnlyLastSize = 'A4'; // remembers last paper size used this session

    // ─── Presets ──────────────────────────────────────────────────────────────
    const PRESETS = [
        { label: 'RECEIVED',            color: '#1a5276', text: 'RECEIVED' },
        { label: 'RELEASED',            color: '#1e8449', text: 'RELEASED' },
        { label: 'CERTIFIED TRUE COPY', color: '#6c3483', text: 'CERTIFIED TRUE COPY', fontSize: 36 },
        { label: 'APPROVED',            color: '#1a5276', text: 'APPROVED' },
        { label: 'REJECTED',            color: '#922b21', text: 'REJECTED' },
        { label: 'CONFIDENTIAL',        color: '#922b21', text: 'CONFIDENTIAL', fontSize: 42 },
        { label: 'DRAFT',               color: '#7f8c8d', text: 'DRAFT' },
        { label: 'PAID',                color: '#1e8449', text: 'PAID' },
        { label: 'VOID',                color: '#922b21', text: 'VOID' },
        { label: 'FOR REVIEW',          color: '#d35400', text: 'FOR REVIEW', fontSize: 42 },
    ];

    function escHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function cloneStampState() {
        return {
            stampSettings: deepClone(stampSettings),
            fmtSettings: deepClone(fmtSettings),
            sealSettings: deepClone(sealSettings),
            recvSettings: deepClone(recvSettings)
        };
    }

    function applyStampState(state) {
        if (!state) return;
        if (state.stampSettings) stampSettings = deepClone(state.stampSettings);
        if (state.fmtSettings) fmtSettings = deepClone(state.fmtSettings);
        if (state.sealSettings) sealSettings = deepClone(state.sealSettings);
        if (state.recvSettings) recvSettings = deepClone(state.recvSettings);
    }

    // ─── Persist settings to localStorage ────────────────────────────────────
    const LS_KEY_SIMPLE = 'stampSettings_v1';
    const LS_KEY_FMT    = 'fmtSettings_v1';
    const LS_KEY_MODE   = 'stampMode_v1';
    const LS_KEY_SEAL   = 'sealSettings_v1';
    const LS_KEY_RECV   = 'recvSettings_v1';
    const LS_KEY_META   = 'stampMetaSettings_v1';
    const PAPER_SIZE_KEYS = [
        'A4', 'Photo4x6', 'Photo5x7', 'A6', 'A5', 'B5', 'B6',
        'Photo3_5x5', 'Photo5x8', 'Photo8x10', 'Wide16x9',
        'Postcard100x148', 'Envelope10', 'EnvelopeDL', 'EnvelopeC6',
        'Letter', 'Long', 'IndianLegal', 'Legal', 'SixteenK', 'Short'
    ];

    function saveStampSettings() {
        try {
            localStorage.setItem(LS_KEY_SIMPLE, JSON.stringify(stampSettings));
            localStorage.setItem(LS_KEY_FMT,    JSON.stringify(fmtSettings));
            localStorage.setItem(LS_KEY_SEAL,   JSON.stringify(sealSettings));
            localStorage.setItem(LS_KEY_RECV,   JSON.stringify(recvSettings));
            localStorage.setItem(LS_KEY_MODE,   stampMode);
            localStorage.setItem(LS_KEY_META, JSON.stringify({
                stampPdfPaperSize,
                stampUseCurrentPaperSizeForNewPdfs,
                stampViewMode,
                stampPreviewScale,
                bwMode,
                grayscaleOutputMode,
                stampOutputRenderProfile
            }));
        } catch(e) {}
    }

    function loadStampSettings() {
        try {
            const s = localStorage.getItem(LS_KEY_SIMPLE);
            const f = localStorage.getItem(LS_KEY_FMT);
            const e = localStorage.getItem(LS_KEY_SEAL);
            const rv = localStorage.getItem(LS_KEY_RECV);
            const m = localStorage.getItem(LS_KEY_MODE);
            const metaRaw = localStorage.getItem(LS_KEY_META);
            if (s)  stampSettings = Object.assign(stampSettings, JSON.parse(s));
            if (f)  fmtSettings   = Object.assign(fmtSettings,   JSON.parse(f));
            if (e)  sealSettings  = Object.assign(sealSettings,  JSON.parse(e));
            if (rv) recvSettings  = Object.assign(recvSettings,  JSON.parse(rv));
            if (m)  stampMode     = m;
            if (metaRaw) {
                const meta = JSON.parse(metaRaw);
                const savedPaperSizes = ['original', ...PAPER_SIZE_KEYS];
                if (savedPaperSizes.includes(meta.stampPdfPaperSize)) stampPdfPaperSize = meta.stampPdfPaperSize;
                stampUseCurrentPaperSizeForNewPdfs = !!meta.stampUseCurrentPaperSizeForNewPdfs;
                if (['single', 'continuous', 'two-page', 'presentation'].includes(meta.stampViewMode)) stampViewMode = meta.stampViewMode;
                if (Number.isFinite(meta.stampPreviewScale)) stampPreviewScale = Math.min(Math.max(0.4, meta.stampPreviewScale), 3.0);
                bwMode = !!meta.bwMode;
                if (['normal', 'dark-xerox', 'high-contrast'].includes(meta.grayscaleOutputMode)) grayscaleOutputMode = meta.grayscaleOutputMode;
                if (['fast', 'balanced', 'high'].includes(meta.stampOutputRenderProfile)) stampOutputRenderProfile = meta.stampOutputRenderProfile;
            }
        } catch(e) {}
    }

    // Exposed so you can wire a "Reset to defaults" button if needed:
    // <button onclick="clearStampSettings(); initStamp()">Reset Settings</button>
    window.clearStampSettings = function () {
        localStorage.removeItem(LS_KEY_SIMPLE);
        localStorage.removeItem(LS_KEY_FMT);
        localStorage.removeItem(LS_KEY_SEAL);
        localStorage.removeItem(LS_KEY_RECV);
        localStorage.removeItem(LS_KEY_MODE);
        localStorage.removeItem(LS_KEY_META);
    };

    // ─── Init ─────────────────────────────────────────────────────────────────
    window.initStamp = function () {
        resetStampState();
        renderStampUI();
    };

    window._stampHasFile = function () {
        return !!stampPdfDoc || stampDocuments.length > 0 || !!window.stampHasPdf;
    };

    function resetStampState() {
        stampRenderToken++;
        stampPdfDoc = null; stampPdfBytes = null; stampFileName = '';
        stampTotalPages = 0; stampPreviewPage = 1; stampPreviewScale = 1.0; stampMode = 'simple';
        stampPdfPaperSize = 'original';
        stampUseCurrentPaperSizeForNewPdfs = false;
        stampDocuments = [];
        activeStampDocIndex = -1;
        bwMode = false;
        grayscaleOutputMode = 'normal';
        stampOutputRenderProfile = 'fast';
        window.stampHasPdf = false;

        // Start with hardcoded defaults ...
        stampSettings = {
            text: 'RECEIVED', color: '#c0392b', opacity: 0.55,
            fontSize: 52, fontFamily: 'Arial', bold: true, italic: false,
            border: true, borderWidth: 3, rotation: -30,
            positionX: 50, positionY: 50, applyPages: 'all', pageRange: '', pages: []
        };
        fmtSettings = {
            title: 'PHOTOCOPY OF THE ORIGINAL\nCERTIFIED BY:\n',
            name: 'JOAN R. ESPINOZA, DBM, LPT, CHRA',
            subName: 'Registrar Director',
            institution: 'CRONASIA FOUNDATION COLLEGE, INC.',
            showDate: true, showTime: true,
            color: '#1a2a6c', opacity: 1.0,
            positionX: 50, positionY: 50,
            applyPages: 'all', pageRange: '',
            scale: 0.45, transparentBg: true
        };

        sealSettings = {
            topText:      'CERTIFIED TRUE COPY',
            bottomText:   'FROM THE ORIGINAL',
            dateLabel:    'DATE',
            schoolName:   'CRONASIA FOUNDATION COLLEGE, INC.',
            schoolAbbrev: 'CFC',
            showDate:     true,
            color:        '#1a2a6c',
            opacity:      1.0,
            scale:        0.4,
            positionX:    50,
            positionY:    50,
            applyPages:   'all',
            pageRange:    ''
        };

        recvSettings = {
            schoolName:     'CRONASIA FOUNDATION COLLEGE, INC.',
            officeName:     'Office of the College Registrar',
            stampType:      'RECEIVED',
            personnelName:  '\n\n\nELENITO GINETE DAVID',
            personnelDesig: 'Admission and Records Officer',
            showDate: true, showTime: true,
            color: '#1a2a6c', opacity: 1.0,
            positionX: 50, positionY: 50,
            applyPages: 'all', pageRange: '',
            scale: 0.50,
            transparentBg: true
        };

        // ... then override with whatever was last saved
        loadStampSettings();
    }

    // ─── leaveStampMode — guarded with confirmation if file loaded ────────────
    window.leaveStampMode = function (onConfirmed) {
        function doLeave() {
            const p = document.getElementById('pageContainer');
            const u = document.getElementById('uploadSection');
            const s = document.getElementById('stampContainer');
            if (p) p.style.display = '';
            if (u) u.style.display = '';
            if (s) s.style.display = 'none';
            if (typeof onConfirmed === 'function') onConfirmed();
        }

        if (stampPdfDoc) {
            showConfirm(
                'Leave Stamp Mode',
                'You have a PDF loaded. Leaving will discard your current stamp session. Continue?',
                doLeave
            );
        } else {
            doLeave();
        }
    };

    // ─── Render UI ────────────────────────────────────────────────────────────
    function renderStampUI() {
        const container = document.getElementById('stampContainer');
        if (!container) return;

        // Measure the actual sticky header so the layout fills exactly the right height
        const hdr = document.querySelector('.sticky-header-container');
        if (hdr) {
            const hdrH = hdr.getBoundingClientRect().height;
            document.documentElement.style.setProperty('--stamp-header-h', hdrH + 'px');
        }

        container.innerHTML = `
        <div class="stamp-layout">

          <!-- LEFT panel -->
          <div class="stamp-controls-panel">

            <!-- Upload -->
            <div class="stamp-section">
              <div class="stamp-section-title"><i class="fa fa-file-pdf-o"></i> PDF File</div>

              <!-- Print Stamp Only toggle -->
              <label class="stamp-check" style="margin-bottom:8px;padding:8px;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;gap:8px"
                     title="Check this to preview and print the stamp without loading a PDF">
                <input type="checkbox" id="stampOnlyChk" onchange="toggleStampOnlyMode(this.checked); showToast(this.checked ? 'Stamp Only mode on' : 'Stamp Only mode off')">
                <i class="fa fa-print"></i> Stamp Only (no PDF)
              </label>

              <!-- PDF drop zone — hidden when stamp-only mode is active -->
              <div id="stampDropZoneWrap">
                <div class="stamp-upload-area" id="stampDropZone" onclick="document.getElementById('stampFileInput').click()">
                  <div id="stampUploadLabel">
                    <div style="font-size:28px;margin-bottom:6px"class="upload-icon"><i class="fa fa-cloud-upload"></i></div>
                    <div>Click or drag PDFs here</div>
                  </div>
                </div>
                <input type="file" id="stampFileInput" accept=".pdf" multiple style="display:none" onchange="handleStampFile(event)">
              </div>

              <div id="stampPdfPaperSection" style="display:none;margin-top:12px">
                <div class="stamp-section-title" style="margin-bottom:6px"><i class="fa fa-file-o"></i> Output Paper Size</div>
                <label class="stamp-check" style="margin-bottom:7px;font-size:12px;gap:6px;line-height:1.35;align-items:flex-start"
                       title="When checked, PDFs opened after this will start with the selected output paper size">
                  <input type="checkbox" id="stampUsePaperForNewPdfsChk" onchange="setStampUsePaperForNewPdfs(this.checked)">
                  <span>Use this paper size for newly opened PDFs</span>
                </label>
                <select id="stampPdfPaperSize" class="stamp-input" onchange="setStampPdfPaperSize(this.value)" style="width:100%">
                  <option value="original">Original PDF size</option>
                  <option value="Letter">Letter (8.5 x 11in)</option>
                  <option value="Legal">Legal (8.5 x 14in)</option>
                  <option value="Long">Long (8.5 x 13in)</option>
                  <option value="A4">A4 (210 x 297mm)</option>
                  <option value="A5">A5 (148 x 210mm)</option>
                </select>
                <div id="stampPdfPaperInfo" style="font-size:11px;color:var(--text-secondary);line-height:1.5;margin-top:6px">
                  The scanned page keeps its original physical size and is centered on the selected paper.
                </div>
              </div>
            </div>

            <!-- Mode Toggle -->
            <div class="stamp-section">
            <br>
              <div class="stamp-section-title"><i class="fa fa-tag"></i> Stamp Type</div>
              <div class="stamp-mode-toggle">
                <button id="modeSimpleBtn" class="stamp-mode-btn active" onclick="switchStampMode('simple')"><i class="fa fa-pencil"></i> Simple Text</button>
              </div>
              <div class="stamp-mode-toggle">
                <button id="modeFormattedBtn" class="stamp-mode-btn" onclick="switchStampMode('formatted')"><i class="fa fa-id-card-o"></i> Official Stamp</button>
              </div>
              <div class="stamp-mode-toggle">
                <button id="modeSealBtn" class="stamp-mode-btn" onclick="switchStampMode('seal')"><i class="fa fa-circle-o"></i> Round Seal</button>
              </div>
              <div class="stamp-mode-toggle">
                <button id="modeRecvBtn" class="stamp-mode-btn" onclick="switchStampMode('received')"><i class="fa fa-inbox"></i> Received / Released</button>
              </div>
            </div>

            <!-- ══════ SIMPLE CONTROLS ══════ -->
            <div id="simpleStampControls">

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-bolt"></i> Quick Presets</div>
                <div class="stamp-presets" id="stampPresets"></div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-pencil"></i> Stamp Text</div>
                <input class="stamp-input" id="stampText" type="text" value="${stampSettings.text}"
                       placeholder="Enter stamp text…" oninput="onStampSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-paint-brush"></i> Style</div>
                <div class="stamp-row">
                  <label class="stamp-label">Color</label>
                  <input type="color" id="stampColor" value="${stampSettings.color}" onchange="onStampSettingChange()"
                         style="width:44px;height:32px;border:none;cursor:pointer;background:none">
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Font Size</label>
                  <input class="stamp-input" id="stampFontSize" type="number" value="${stampSettings.fontSize}"
                         min="12" max="120" onchange="onStampSettingChange()" style="width:80px">
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Opacity</label>
                  <input type="range" id="stampOpacity" min="0.1" max="1" step="0.05"
                         value="${stampSettings.opacity}" oninput="onStampSettingChange()" style="flex:1">
                  <span id="stampOpacityVal" style="width:36px;text-align:right">${Math.round(stampSettings.opacity * 100)}%</span>
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Rotation</label>
                  <input type="range" id="stampRotation" min="-180" max="180" step="1"
                         value="${stampSettings.rotation}" oninput="syncRotationFromSlider()" style="flex:1">
                  <input type="number" id="stampRotationNum" min="-180" max="180" value="${stampSettings.rotation}"
                         onchange="syncRotationFromInput()" oninput="syncRotationFromInput()"
                         class="stamp-input" style="width:60px;text-align:center;padding:4px 6px">
                  <span style="font-size:12px;color:var(--text-secondary)">°</span>
                </div>
                <div class="stamp-row" style="gap:14px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="checkbox" id="stampBold" ${stampSettings.bold ? 'checked' : ''} onchange="onStampSettingChange(); showToast(this.checked ? 'Bold on' : 'Bold off')"> <b>Bold</b></label>
                  <label class="stamp-check"><input type="checkbox" id="stampItalic" ${stampSettings.italic ? 'checked' : ''} onchange="onStampSettingChange(); showToast(this.checked ? 'Italic on' : 'Italic off')"> <i>Italic</i></label>
                  <label class="stamp-check"><input type="checkbox" id="stampBorder" ${stampSettings.border ? 'checked' : ''} onchange="onStampSettingChange(); showToast(this.checked ? 'Border on' : 'Border off')"> Border</label>
                </div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-crosshairs"></i> Position <small style="font-weight:400;color:var(--text-secondary)">(or drag in preview)</small></div>
                <div class="stamp-row">
                  <label class="stamp-label">Horizontal</label>
                  <input type="range" id="stampPosX" min="5" max="95" value="${stampSettings.positionX}" oninput="onStampPositionChange()" style="flex:1">
                  <span id="stampPosXVal" style="width:36px;text-align:right">${stampSettings.positionX}%</span>
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Vertical</label>
                  <input type="range" id="stampPosY" min="5" max="95" value="${stampSettings.positionY}" oninput="onStampPositionChange()" style="flex:1">
                  <span id="stampPosYVal" style="width:36px;text-align:right">${stampSettings.positionY}%</span>
                </div>
                <label class="stamp-check" style="font-size:12px;margin-top:4px">
                  <input type="checkbox" onchange="document.getElementById('simplePosGrid').style.display=this.checked?'grid':'none'; showToast(this.checked ? 'Position shortcuts shown' : 'Position shortcuts hidden')">
                  Show position shortcuts
                </label>
                <div id="simplePosGrid" class="stamp-pos-grid" style="display:none">
                  ${makePosBtns('simple')}
                </div>
              </div>

              <div class="stamp-section stamp-apply-pages-section" id="simpleApplyPages" style="display:none">
              <br>
                <div class="stamp-section-title"><i class="fa fa-files-o"></i> Apply to Pages</div>
                <div class="stamp-row" style="gap:10px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="radio" name="stampPages" value="all" ${stampSettings.applyPages === 'all' ? 'checked' : ''} onchange="onStampPagesChange(this,'simple')"> All pages</label>
                  <label class="stamp-check"><input type="radio" name="stampPages" value="current" ${stampSettings.applyPages === 'current' ? 'checked' : ''} onchange="onStampPagesChange(this,'simple')"> Current only</label>
                  <label class="stamp-check"><input type="radio" name="stampPages" value="range" ${stampSettings.applyPages === 'range' ? 'checked' : ''} onchange="onStampPagesChange(this,'simple')"> Page range</label>
                </div>
                <div id="stampRangeRow" class="stamp-row" style="display:${stampSettings.applyPages === 'range' ? 'flex' : 'none'}">
                  <label class="stamp-label">Pages</label>
                  <input class="stamp-input" id="stampPageRange" type="text" value="${stampSettings.pageRange}" placeholder="e.g. 1,3,5-8" oninput="onStampSettingChange()" style="flex:1">
                </div>
              </div>

            </div><!-- end simpleStampControls -->

            <!-- ══════ FORMATTED CONTROLS ══════ -->
            <div id="formattedStampControls" style="display:none">

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-align-left"></i> Header Text</div>
                <textarea class="stamp-input" id="fmtTitle" rows="2" oninput="onFmtSettingChange()" style="resize:vertical">${fmtSettings.title}</textarea>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-user"></i> Signatory Name</div>
                <input class="stamp-input" id="fmtName" type="text" value="${fmtSettings.name}" oninput="onFmtSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-id-badge"></i> Position / Title</div>
                <input class="stamp-input" id="fmtSubName" type="text" value="${fmtSettings.subName}" oninput="onFmtSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-university"></i> Institution</div>
                <input class="stamp-input" id="fmtInstitution" type="text" value="${fmtSettings.institution}" oninput="onFmtSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-sliders"></i> Appearance</div>
                <div class="stamp-row">
                  <label class="stamp-label">Color</label>
                  <input type="color" id="fmtColor" value="${fmtSettings.color}" onchange="onFmtSettingChange()"
                         style="width:44px;height:32px;border:none;cursor:pointer;background:none">
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Opacity</label>
                  <input type="range" id="fmtOpacity" min="0.1" max="1" step="0.05"
                         value="${fmtSettings.opacity}" oninput="onFmtSettingChange()" style="flex:1">
                  <span id="fmtOpacityVal" style="width:36px;text-align:right">${Math.round(fmtSettings.opacity * 100)}%</span>
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Scale</label>
                  <input type="range" id="fmtScale" min="0.3" max="2.5" step="0.05"
                         value="${fmtSettings.scale}" oninput="onFmtSettingChange()" style="flex:1">
                  <input type="number" id="fmtScaleNum" min="5" max="250" step="5"
                         value="${Math.round(fmtSettings.scale * 100)}"
                         onchange="syncFmtScaleFromInput()" oninput="syncFmtScaleFromInput()"
                         class="stamp-input" style="width:60px;text-align:center;padding:4px 6px">
                  <span style="font-size:12px;color:var(--text-secondary)">%</span>
                </div>
                <div class="stamp-row" style="gap:14px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="checkbox" id="fmtShowDate" ${fmtSettings.showDate ? 'checked' : ''} onchange="onFmtSettingChange(); showToast(this.checked ? 'Date shown' : 'Date hidden')"> Show Date</label>
                  <label class="stamp-check"><input type="checkbox" id="fmtShowTime" ${fmtSettings.showTime ? 'checked' : ''} onchange="onFmtSettingChange(); showToast(this.checked ? 'Time shown' : 'Time hidden')"> Show Time</label>
                  <label class="stamp-check"><input type="checkbox" id="fmtTransparent" ${fmtSettings.transparentBg ? 'checked' : ''} onchange="onFmtSettingChange(); showToast(this.checked ? 'Transparent BG on' : 'Transparent BG off')"> Transparent BG</label>
                </div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-crosshairs"></i> Position <small style="font-weight:400;color:var(--text-secondary)">(or drag in preview)</small></div>
                <div class="stamp-row">
                  <label class="stamp-label">Horizontal</label>
                  <input type="range" id="fmtPosX" min="5" max="95" value="${fmtSettings.positionX}" oninput="onFmtPositionChange()" style="flex:1">
                  <span id="fmtPosXVal" style="width:36px;text-align:right">${fmtSettings.positionX}%</span>
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Vertical</label>
                  <input type="range" id="fmtPosY" min="5" max="95" value="${fmtSettings.positionY}" oninput="onFmtPositionChange()" style="flex:1">
                  <span id="fmtPosYVal" style="width:36px;text-align:right">${fmtSettings.positionY}%</span>
                </div>
                <label class="stamp-check" style="font-size:12px;margin-top:4px">
                  <input type="checkbox" onchange="document.getElementById('fmtPosGrid').style.display=this.checked?'grid':'none'; showToast(this.checked ? 'Position shortcuts shown' : 'Position shortcuts hidden')">
                  Show position shortcuts
                </label>
                <div id="fmtPosGrid" class="stamp-pos-grid" style="display:none">
                  ${makePosBtns('formatted')}
                </div>
              </div>

              <div class="stamp-section stamp-apply-pages-section" id="fmtApplyPages" style="display:none">
              <br>
                <div class="stamp-section-title"><i class="fa fa-files-o"></i> Apply to Pages</div>
                <div class="stamp-row" style="gap:10px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="radio" name="fmtPages" value="all" ${fmtSettings.applyPages === 'all' ? 'checked' : ''} onchange="onStampPagesChange(this,'formatted')"> All pages</label>
                  <label class="stamp-check"><input type="radio" name="fmtPages" value="current" ${fmtSettings.applyPages === 'current' ? 'checked' : ''} onchange="onStampPagesChange(this,'formatted')"> Current only</label>
                  <label class="stamp-check"><input type="radio" name="fmtPages" value="range" ${fmtSettings.applyPages === 'range' ? 'checked' : ''} onchange="onStampPagesChange(this,'formatted')"> Page range</label>
                </div>
                <div id="fmtRangeRow" class="stamp-row" style="display:${fmtSettings.applyPages === 'range' ? 'flex' : 'none'}">
                  <label class="stamp-label">Pages</label>
                  <input class="stamp-input" id="fmtPageRange" type="text" value="${fmtSettings.pageRange}" placeholder="e.g. 1,3,5-8" oninput="onFmtSettingChange()" style="flex:1">
                </div>
              </div>

            </div><!-- end formattedStampControls -->

            <!-- ══════ SEAL CONTROLS ══════ -->
            <div id="sealStampControls" style="display:none">

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-arrow-up"></i> Top Arc Text</div>
                <input class="stamp-input" id="sealTopText" type="text" value="${sealSettings.topText}" oninput="onSealSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-arrow-down"></i> Bottom Arc Text</div>
                <input class="stamp-input" id="sealBottomText" type="text" value="${sealSettings.bottomText}" oninput="onSealSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-font"></i> School Abbreviation</div>
                <input class="stamp-input" id="sealSchoolAbbrev" type="text" value="${sealSettings.schoolAbbrev}" oninput="onSealSettingChange()" placeholder="e.g. CFC">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-calendar"></i> Show Date</div>
                <div class="stamp-row" style="gap:14px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="checkbox" id="sealShowDate" ${sealSettings.showDate ? 'checked' : ''} onchange="onSealSettingChange(); showToast(this.checked ? 'Date shown' : 'Date hidden')"> Show current date above DATE line</label>
                </div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-sliders"></i> Appearance</div>
                <div class="stamp-row">
                  <label class="stamp-label">Color</label>
                  <input type="color" id="sealColor" value="${sealSettings.color}" onchange="onSealSettingChange()"
                         style="width:44px;height:32px;border:none;cursor:pointer;background:none">
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Opacity</label>
                  <input type="range" id="sealOpacity" min="0.1" max="1" step="0.05"
                         value="${sealSettings.opacity}" oninput="onSealSettingChange()" style="flex:1">
                  <span id="sealOpacityVal" style="width:36px;text-align:right">${Math.round(sealSettings.opacity * 100)}%</span>
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Scale</label>
                  <input type="range" id="sealScale" min="0.3" max="2.5" step="0.05"
                         value="${sealSettings.scale}" oninput="onSealSettingChange()" style="flex:1">
                  <input type="number" id="sealScaleNum" min="30" max="250" step="5"
                         value="${Math.round(sealSettings.scale * 100)}"
                         onchange="syncSealScaleFromInput()" oninput="syncSealScaleFromInput()"
                         class="stamp-input" style="width:60px;text-align:center;padding:4px 6px">
                  <span style="font-size:12px;color:var(--text-secondary)">%</span>
                </div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-crosshairs"></i> Position <small style="font-weight:400;color:var(--text-secondary)">(or drag in preview)</small></div>
                <div class="stamp-row">
                  <label class="stamp-label">Horizontal</label>
                  <input type="range" id="sealPosX" min="5" max="95" value="${sealSettings.positionX}" oninput="onSealPositionChange()" style="flex:1">
                  <span id="sealPosXVal" style="width:36px;text-align:right">${sealSettings.positionX}%</span>
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Vertical</label>
                  <input type="range" id="sealPosY" min="5" max="95" value="${sealSettings.positionY}" oninput="onSealPositionChange()" style="flex:1">
                  <span id="sealPosYVal" style="width:36px;text-align:right">${sealSettings.positionY}%</span>
                </div>
                <label class="stamp-check" style="font-size:12px;margin-top:4px">
                  <input type="checkbox" onchange="document.getElementById('sealPosGrid').style.display=this.checked?'grid':'none'; showToast(this.checked ? 'Position shortcuts shown' : 'Position shortcuts hidden')">
                  Show position shortcuts
                </label>
                <div id="sealPosGrid" class="stamp-pos-grid" style="display:none">
                  ${makePosBtns('seal')}
                </div>
              </div>

              <div class="stamp-section stamp-apply-pages-section" id="sealApplyPages" style="display:none">
              <br>
                <div class="stamp-section-title"><i class="fa fa-files-o"></i> Apply to Pages</div>
                <div class="stamp-row" style="gap:10px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="radio" name="sealPages" value="all" ${sealSettings.applyPages === 'all' ? 'checked' : ''} onchange="onStampPagesChange(this,'seal')"> All pages</label>
                  <label class="stamp-check"><input type="radio" name="sealPages" value="current" ${sealSettings.applyPages === 'current' ? 'checked' : ''} onchange="onStampPagesChange(this,'seal')"> Current only</label>
                  <label class="stamp-check"><input type="radio" name="sealPages" value="range" ${sealSettings.applyPages === 'range' ? 'checked' : ''} onchange="onStampPagesChange(this,'seal')"> Page range</label>
                </div>
                <div id="sealRangeRow" class="stamp-row" style="display:${sealSettings.applyPages === 'range' ? 'flex' : 'none'}">
                  <label class="stamp-label">Pages</label>
                  <input class="stamp-input" id="sealPageRange" type="text" value="${sealSettings.pageRange}" placeholder="e.g. 1,3,5-8" oninput="onSealSettingChange()" style="flex:1">
                </div>
              </div>

            </div><!-- end sealStampControls -->

            <!-- ══════ RECEIVED/RELEASED CONTROLS ══════ -->
            <div id="recvStampControls" style="display:none">

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-university"></i> School Name</div>
                <input class="stamp-input" id="recvSchoolName" type="text" value="${recvSettings.schoolName}" oninput="onRecvSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-building"></i> Office Name</div>
                <input class="stamp-input" id="recvOfficeName" type="text" value="${recvSettings.officeName}" oninput="onRecvSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-tag"></i> Stamp Type</div>
                <div style="display:flex;gap:8px;margin-bottom:6px">
                  <button class="stamp-preset-btn" style="border-color:#1a5276;color:#1a5276" onclick="document.getElementById('recvStampType').value='RECEIVED';onRecvSettingChange()">RECEIVED</button>
                  <button class="stamp-preset-btn" style="border-color:#1e8449;color:#1e8449" onclick="document.getElementById('recvStampType').value='RELEASED';onRecvSettingChange()">RELEASED</button>
                </div>
                <input class="stamp-input" id="recvStampType" type="text" value="${recvSettings.stampType}" oninput="onRecvSettingChange()" placeholder="e.g. RECEIVED">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-user"></i> Personnel Name</div>
                <input class="stamp-input" id="recvPersonnelName" type="text" value="${recvSettings.personnelName}" oninput="onRecvSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-id-badge"></i> Personnel Designation</div>
                <input class="stamp-input" id="recvPersonnelDesig" type="text" value="${recvSettings.personnelDesig}" oninput="onRecvSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-sliders"></i> Appearance</div>
                <div class="stamp-row">
                  <label class="stamp-label">Color</label>
                  <input type="color" id="recvColor" value="${recvSettings.color}" onchange="onRecvSettingChange()"
                         style="width:44px;height:32px;border:none;cursor:pointer;background:none">
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Opacity</label>
                  <input type="range" id="recvOpacity" min="0.1" max="1" step="0.05"
                         value="${recvSettings.opacity}" oninput="onRecvSettingChange()" style="flex:1">
                  <span id="recvOpacityVal" style="width:36px;text-align:right">${Math.round(recvSettings.opacity * 100)}%</span>
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Scale</label>
                  <input type="range" id="recvScale" min="0.2" max="2.5" step="0.05"
                         value="${recvSettings.scale}" oninput="onRecvSettingChange()" style="flex:1">
                  <input type="number" id="recvScaleNum" min="20" max="250" step="5"
                         value="${Math.round(recvSettings.scale * 100)}"
                         onchange="syncRecvScaleFromInput()" oninput="syncRecvScaleFromInput()"
                         class="stamp-input" style="width:60px;text-align:center;padding:4px 6px">
                  <span style="font-size:12px;color:var(--text-secondary)">%</span>
                </div>
                <div class="stamp-row" style="gap:14px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="checkbox" id="recvShowDate" ${recvSettings.showDate ? 'checked' : ''} onchange="onRecvSettingChange(); showToast(this.checked ? 'Date shown' : 'Date hidden')"> Show Date</label>
                  <label class="stamp-check"><input type="checkbox" id="recvShowTime" ${recvSettings.showTime ? 'checked' : ''} onchange="onRecvSettingChange(); showToast(this.checked ? 'Time shown' : 'Time hidden')"> Show Time</label>
                  <label class="stamp-check"><input type="checkbox" id="recvTransparent" ${recvSettings.transparentBg ? 'checked' : ''} onchange="onRecvSettingChange(); showToast(this.checked ? 'Transparent BG on' : 'Transparent BG off')"> Transparent BG</label>
                </div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title"><i class="fa fa-crosshairs"></i> Position <small style="font-weight:400;color:var(--text-secondary)">(or drag in preview)</small></div>
                <div class="stamp-row">
                  <label class="stamp-label">Horizontal</label>
                  <input type="range" id="recvPosX" min="5" max="95" value="${recvSettings.positionX}" oninput="onRecvPositionChange()" style="flex:1">
                  <span id="recvPosXVal" style="width:36px;text-align:right">${recvSettings.positionX}%</span>
                </div>
                <div class="stamp-row">
                  <label class="stamp-label">Vertical</label>
                  <input type="range" id="recvPosY" min="5" max="95" value="${recvSettings.positionY}" oninput="onRecvPositionChange()" style="flex:1">
                  <span id="recvPosYVal" style="width:36px;text-align:right">${recvSettings.positionY}%</span>
                </div>
                <label class="stamp-check" style="font-size:12px;margin-top:4px">
                  <input type="checkbox" onchange="document.getElementById('recvPosGrid').style.display=this.checked?'grid':'none'; showToast(this.checked ? 'Position shortcuts shown' : 'Position shortcuts hidden')">
                  Show position shortcuts
                </label>
                <div id="recvPosGrid" class="stamp-pos-grid" style="display:none">
                  ${makePosBtns('received')}
                </div>
              </div>

              <div class="stamp-section stamp-apply-pages-section" id="recvApplyPages" style="display:none">
              <br>
                <div class="stamp-section-title"><i class="fa fa-files-o"></i> Apply to Pages</div>
                <div class="stamp-row" style="gap:10px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="radio" name="recvPages" value="all" ${recvSettings.applyPages === 'all' ? 'checked' : ''} onchange="onStampPagesChange(this,'received')"> All pages</label>
                  <label class="stamp-check"><input type="radio" name="recvPages" value="current" ${recvSettings.applyPages === 'current' ? 'checked' : ''} onchange="onStampPagesChange(this,'received')"> Current only</label>
                  <label class="stamp-check"><input type="radio" name="recvPages" value="range" ${recvSettings.applyPages === 'range' ? 'checked' : ''} onchange="onStampPagesChange(this,'received')"> Page range</label>
                </div>
                <div id="recvRangeRow" class="stamp-row" style="display:${recvSettings.applyPages === 'range' ? 'flex' : 'none'}">
                  <label class="stamp-label">Pages</label>
                  <input class="stamp-input" id="recvPageRange" type="text" value="${recvSettings.pageRange}" placeholder="e.g. 1,3,5-8" oninput="onRecvSettingChange()" style="flex:1">
                </div>
              </div>

            </div><!-- end recvStampControls -->

            <!-- Grayscale PDF — only available in normal mode (PDF loaded), hidden in stamp-only mode -->
            <div id="grayscalePdfSection" class="stamp-section" style="padding-top:4px;display:none">
              <label class="stamp-check" style="padding:8px;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;gap:8px"
                     title="Convert the PDF pages to grayscale — stamp color is preserved">
                <input type="checkbox" id="bwModeChk" onchange="toggleBwMode(this.checked); showToast(this.checked ? 'Grayscale on' : 'Grayscale off')"> <i class="fa fa-adjust"></i> Grayscale PDF
              </label>
              <div id="grayscaleOutputControls" style="display:none;margin-top:8px">
                <label class="stamp-label" for="grayscaleOutputMode">Grayscale Output</label>
                <select id="grayscaleOutputMode" class="stamp-input" onchange="setGrayscaleOutputMode(this.value)" style="width:100%;margin-top:4px">
                  <option value="normal">Normal grayscale</option>
                  <option value="dark-xerox">Dark Xerox</option>
                  <option value="high-contrast">High contrast copy</option>
                </select>
              </div>
            </div>

            <div id="stampOutputQualitySection" class="stamp-section" style="padding-top:4px;display:none">
              <div class="stamp-section-title" style="margin-bottom:6px"><i class="fa fa-tachometer"></i> Output Render Quality</div>
              <select id="stampOutputRenderProfile" class="stamp-input" onchange="setStampOutputRenderProfile(this.value)" style="width:100%">
                <option value="fast">Fast print/download</option>
                <option value="balanced">Balanced</option>
                <option value="high">High quality</option>
              </select>
              <div style="font-size:11px;color:var(--text-secondary);line-height:1.45;margin-top:5px">
                Fast is quicker for many-page PDFs. High quality takes longer.
              </div>
            </div>

            <!-- Download / Print / Print Stamp Only -->
            <div class="stamp-section" style="padding-top:4px;display:flex;gap:8px;flex-wrap:wrap">
              <!-- Normal PDF buttons — visible in normal mode, hidden in stamp-only mode -->
              <button class="btn btn-primary stamp-apply-btn" id="stampApplyBtn" onclick="applyStampAndDownload()" disabled style="flex:1;text-align:center; justify-content: center;">
                <i class="fa fa-download"></i> Download
              </button>
              <button class="btn stamp-apply-btn stamp-print-btn" id="stampPrintBtn" onclick="applyStampAndPrint()" disabled style="flex:1;text-align:center; justify-content: center;">
                <i class="fa fa-print"></i> Print
              </button>
              <!-- Stamp-only print button — hidden in normal mode, visible+enabled in stamp-only mode -->
              <button class="btn stamp-apply-btn stamp-print-btn" id="stampPrintOnlyBtn" onclick="openPrintStampOnly()" disabled style="flex:1;width:100%;display:none;text-align:center; justify-content: center;">
                <i class="fa fa-print"></i> Print
              </button>
            </div>

          </div><!-- end stamp-controls-panel -->

          <!-- RIGHT: Preview -->
          <div class="stamp-preview-panel">
            <div class="stamp-doc-tabs-wrap" id="stampDocTabsWrap" style="display:none">
              <button class="stamp-doc-nav-btn" id="stampDocTabsPrev" onclick="scrollStampDocumentTabs(-1)" title="Previous tabs">
                <i class="fa fa-chevron-left"></i>
              </button>
              <div class="stamp-doc-tabs-viewport">
                <div class="stamp-doc-tabs" id="stampDocTabs"></div>
              </div>
              <button class="stamp-doc-nav-btn" id="stampDocTabsNext" onclick="scrollStampDocumentTabs(1)" title="Next tabs">
                <i class="fa fa-chevron-right"></i>
              </button>
            </div>
            <div class="stamp-preview-toolbar">
              <select id="stampViewModeSelect" class="stamp-view-mode-select" onchange="setStampViewMode(this.value)" title="Preview view mode">
                <option value="single">Load per page</option>
                <option value="continuous">Continuous Scrolling</option>
                <option value="two-page">Two-Page (Book / Magazine) View</option>
                <option value="presentation">Presentation / Full-Screen Mode</option>
              </select>
              <button id="stampPrevBtn" class="stamp-tool-btn" onclick="changeStampPreviewPage(-1)"><i class="fa fa-chevron-left"></i> Prev</button>
              <span id="stampPageIndicator">Page - / -</span>
              <input id="stampPageJumpInput" class="stamp-page-jump-input" type="number" min="1" value="1"
                     onchange="goToStampPreviewPage(this.value)"
                     onkeydown="if(event.key==='Enter'){event.preventDefault();goToStampPreviewPage(this.value)}"
                     title="Go to page">
              <button id="stampNextBtn" class="stamp-tool-btn" onclick="changeStampPreviewPage(1)">Next <i class="fa fa-chevron-right"></i></button>
              <span style="flex:1"></span>
              <!-- Orientation selector — only visible in stamp-only mode -->
              <select id="stampOnlyOrient" onchange="stampOnlyOrientChange(); showToast(this.value === 'landscape' ? 'Landscape orientation' : 'Portrait orientation')"
                      style="display:none;font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);cursor:pointer">
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
              <!-- Per-page override checkbox — only visible when PDF loaded & >1 page -->
              <label id="pageOverrideLabel" class="stamp-check" style="display:none;font-size:12px;gap:5px;white-space:nowrap;cursor:pointer"
                     title="When checked, settings on this page are independent from other pages">
                <input type="checkbox" id="pageOverrideChk" onchange="togglePageOverride(this.checked); showToast(this.checked ? 'Custom page override on' : 'Custom page override off')">
                Custom this page
              </label>
              <button class="stamp-tool-btn" onclick="changeStampZoom(-0.2)"><i class="fa fa-search-minus"></i></button>
              <span id="stampZoomLabel" style="min-width:44px;text-align:center">${Math.round(stampPreviewScale * 100)}%</span>
              <button class="stamp-tool-btn" onclick="changeStampZoom(0.2)"><i class="fa fa-search-plus"></i></button>
            </div>
            <div class="stamp-preview-scroll" id="stampPreviewScroll">
              <div class="stamp-preview-canvas-wrap" id="stampCanvasWrap" style="display:none">
                <canvas id="stampBaseCanvas"></canvas>
                <canvas id="stampOverlayCanvas"></canvas>
              </div>
              <div class="stamp-preview-empty" id="stampPreviewEmpty">
                <div style="font-size:48px;margin-bottom:12px"><i class="fa fa-pencil-square-o"></i></div>
                <div id="stampPreviewEmptyMsg">Upload a PDF to preview the stamp</div>
              </div>
            </div>
          </div>

        </div>`;

        buildPresets();
        setupStampDropZone();
        setupStampCanvasDropZone();
        setupStampKeyboardShortcuts();
        setupOverlayDrag();   // attach drag listeners once after DOM is built

        // Restore the saved mode tab (simple / formatted / seal / received)
        // _stampModeReady is still false here so the toast is suppressed
        if (stampMode === 'formatted' || stampMode === 'seal' || stampMode === 'received') {
            window.switchStampMode(stampMode);
        }

        // UI is fully built — from now on, mode switches fire toasts
        _stampModeReady = true;
    }

    function makePosBtns(mode) {
        const arrows = ['<i class="fa fa-arrow-up" style="transform:rotate(-45deg)"></i>','<i class="fa fa-arrow-up"></i>','<i class="fa fa-arrow-up" style="transform:rotate(45deg)"></i>','<i class="fa fa-arrow-left"></i>','<i class="fa fa-plus"></i>','<i class="fa fa-arrow-right"></i>','<i class="fa fa-arrow-down" style="transform:rotate(45deg)"></i>','<i class="fa fa-arrow-down"></i>','<i class="fa fa-arrow-down" style="transform:rotate(-45deg)"></i>'];
        const positions = [[20,20],[50,20],[80,20],[20,50],[50,50],[80,50],[20,80],[50,80],[80,80]];
        return arrows.map((a, i) =>
            `<button class="stamp-pos-btn" onclick="setStampPosition(${positions[i][0]},${positions[i][1]},'${mode}')">${a}</button>`
        ).join('');
    }

    // ─── Mode toggle ──────────────────────────────────────────────────────────
    window.switchStampMode = function (mode) {
        stampMode = mode;
        document.getElementById('simpleStampControls').style.display    = mode === 'simple'    ? '' : 'none';
        document.getElementById('formattedStampControls').style.display = mode === 'formatted' ? '' : 'none';
        document.getElementById('sealStampControls').style.display      = mode === 'seal'      ? '' : 'none';
        document.getElementById('recvStampControls').style.display      = mode === 'received'  ? '' : 'none';
        document.getElementById('modeSimpleBtn').classList.toggle('active',    mode === 'simple');
        document.getElementById('modeFormattedBtn').classList.toggle('active', mode === 'formatted');
        document.getElementById('modeSealBtn').classList.toggle('active',      mode === 'seal');
        document.getElementById('modeRecvBtn').classList.toggle('active',      mode === 'received');
        saveStampSettings();

        // Toast for stamp type switch — only after initial UI setup is complete
        if (_stampModeReady) {
            const modeLabels = { simple: 'Simple Text', formatted: 'Official Stamp', seal: 'Round Seal', received: 'Received / Released' };
            showToast('Stamp type: ' + (modeLabels[mode] || mode));
        }

        const modeOverlay = showStampPreviewLoading('Switching stamp type…');

        setTimeout(function () {
            if (stampOnlyMode) {
                loadSettingsIntoUI(null);
                renderStampOnlyPreview();
            } else {
                refreshOverlay();
            }
            if (modeOverlay) {
                modeOverlay.style.opacity = '0';
                setTimeout(() => modeOverlay.remove(), 200);
            }
        }, 220);
    };

    function showStampPreviewLoading(message) {
        const panel = document.querySelector('.stamp-preview-panel');
        if (!panel) return null;

        panel.querySelectorAll('.stamp-preview-busy-overlay').forEach(el => el.remove());
        const overlay = document.createElement('div');
        overlay.className = 'stamp-preview-busy-overlay';
        overlay.innerHTML = `
            <div class="stamp-preview-busy-spinner"></div>
            <div class="stamp-preview-busy-text">${message}</div>
        `;
        panel.appendChild(overlay);
        requestAnimationFrame(() => { overlay.style.opacity = '1'; });
        return overlay;
    }

    // ─── Presets ──────────────────────────────────────────────────────────────
    function buildPresets() {
        const c = document.getElementById('stampPresets');
        if (!c) return;
        c.innerHTML = PRESETS.map(p =>
            `<button class="stamp-preset-btn" style="border-color:${p.color};color:${p.color}"
                     onclick='applyPreset(${JSON.stringify(p)})'>${p.label}</button>`
        ).join('');
    }

    window.applyPreset = function (p) {
        const t = document.getElementById('stampText'),     cl = document.getElementById('stampColor'),
              s = document.getElementById('stampFontSize'), b  = document.getElementById('stampBold');
        if (t) t.value = p.text; if (cl) cl.value = p.color;
        const fs = p.fontSize || 52;
        if (s) s.value = fs; if (b) b.checked = true;
        // Only write to global settings when NOT on a custom page
        if (!isOnCustomPage()) {
            stampSettings.text = p.text; stampSettings.color = p.color;
            stampSettings.fontSize = fs; stampSettings.bold = true; stampSettings.border = true;
        }
        refreshOverlay();
    };

    // ─── Drop zone ────────────────────────────────────────────────────────────
    function setupStampDropZone() {
        const z = document.getElementById('stampDropZone');
        if (!z) return;
        z.addEventListener('dragover',  e => { e.preventDefault(); z.classList.add('drag-over'); });
        z.addEventListener('dragleave', () => z.classList.remove('drag-over'));
        z.addEventListener('drop', e => {
            e.preventDefault(); z.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files || []).filter(f => f.type === 'application/pdf');
            if (files.length) loadStampFiles(files);
        });
    }

    function getPdfFilesFromDragEvent(e) {
        return Array.from(e.dataTransfer?.files || []).filter(file =>
            file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
        );
    }

    function isPdfFileDrag(e) {
        const types = Array.from(e.dataTransfer?.types || []);
        return types.includes('Files');
    }

    function setupStampCanvasDropZone() {
        const scroll = document.getElementById('stampPreviewScroll');
        const panel = document.querySelector('.stamp-preview-panel');
        if (!scroll) return;
        let dragDepth = 0;

        const setDragOver = (active) => {
            scroll.classList.toggle('drag-over', active);
            if (panel) panel.classList.toggle('drag-over', active);
        };

        scroll.addEventListener('dragenter', e => {
            if (!isPdfFileDrag(e)) return;
            e.preventDefault();
            dragDepth++;
            setDragOver(true);
        });

        scroll.addEventListener('dragover', e => {
            if (!isPdfFileDrag(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
        });

        scroll.addEventListener('dragleave', e => {
            if (!isPdfFileDrag(e)) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) setDragOver(false);
        });

        scroll.addEventListener('drop', e => {
            if (!isPdfFileDrag(e)) return;
            e.preventDefault();
            dragDepth = 0;
            setDragOver(false);
            const files = getPdfFilesFromDragEvent(e);
            if (files.length) loadStampFiles(files);
            else showToast('Drop PDF files only', 'warning');
        });
    }

    window.handleStampFile = function (ev) {
        const files = Array.from(ev.target.files || []).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
        ev.target.value = '';
        if (files.length) loadStampFiles(files);
    };

    function loadStampFile(file) {
        stampFileName = file.name;
        const reader = new FileReader();
        reader.onload = async function (e) {
            stampPdfBytes = e.target.result.slice(0);
            try {
                stampPdfDoc      = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
                stampTotalPages  = stampPdfDoc.numPages;
                stampPreviewPage = 1;
                pageOverrides    = {};          // reset all per-page overrides
                pageOverrideActive = false;
                window.activeTool = 'stamp';
                window.stampHasPdf = true;

                // If stamp-only mode was active, turn it off since we now have a PDF
                if (stampOnlyMode) {
                    stampOnlyMode = false;
                    const chk = document.getElementById('stampOnlyChk');
                    if (chk) chk.checked = false;
                    const dropWrap = document.getElementById('stampDropZoneWrap');
                    if (dropWrap) dropWrap.style.display = '';
                    const printOnly = document.getElementById('stampPrintOnlyBtn');
                    if (printOnly) printOnly.disabled = true;
                }

                const lbl = document.getElementById('stampUploadLabel');
                if (lbl) lbl.innerHTML =
                    `<div style="font-size:15px;font-weight:600;word-break:break-all">${file.name}</div>
                     <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">${stampTotalPages} pages · ${formatFileSize(file.size)}</div>`;

                document.getElementById('stampApplyBtn').disabled = false;
                const printBtn = document.getElementById('stampPrintBtn');
                if (printBtn) printBtn.disabled = false;
                document.getElementById('stampPreviewEmpty').style.display = 'none';
                // Show Grayscale PDF option now that a PDF is loaded
                const graySection = document.getElementById('grayscalePdfSection');
                if (graySection) graySection.style.display = '';
                const paperSection = document.getElementById('stampPdfPaperSection');
                if (paperSection) paperSection.style.display = '';
                const paperSelect = document.getElementById('stampPdfPaperSize');
                if (paperSelect) paperSelect.value = stampPdfPaperSize;
                await renderStampPreviewPage();
            } catch (err) {
                showNotification('Could not read PDF: ' + err.message, 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function readStampDocument(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const bytes = e.target.result.slice(0);
                    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
                    resolve({
                        id: Date.now() + '_' + Math.random().toString(36).slice(2),
                        name: file.name,
                        size: file.size,
                        pdfBytes: bytes,
                        pdfDoc,
                        totalPages: pdfDoc.numPages,
                        previewPage: 1,
                        paperSize: stampUseCurrentPaperSizeForNewPdfs ? stampPdfPaperSize : 'original',
                        stampState: cloneStampState(),
                        pageOverrides: {},
                        pageOverrideActive: false
                    });
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(reader.error || new Error('Could not read PDF'));
            reader.readAsArrayBuffer(file);
        });
    }

    async function loadStampFiles(files) {
        showProcessing(files.length > 1 ? 'Loading PDFs...' : 'Loading PDF...');
        try {
            const loadedDocs = [];
            for (const file of files) loadedDocs.push(await readStampDocument(file));
            stampDocuments.push(...loadedDocs);
            window.activeTool = 'stamp';
            window.stampHasPdf = stampDocuments.length > 0;

            if (stampOnlyMode) {
                stampOnlyMode = false;
                const chk = document.getElementById('stampOnlyChk');
                if (chk) chk.checked = false;
                const dropWrap = document.getElementById('stampDropZoneWrap');
                if (dropWrap) dropWrap.style.display = '';
                const printOnly = document.getElementById('stampPrintOnlyBtn');
                if (printOnly) printOnly.disabled = true;
                const orientSel = document.getElementById('stampOnlyOrient');
                if (orientSel) orientSel.style.display = 'none';
            }

            const applyBtn = document.getElementById('stampApplyBtn');
            if (applyBtn) { applyBtn.disabled = false; applyBtn.style.display = ''; }
            const printBtn = document.getElementById('stampPrintBtn');
            if (printBtn) { printBtn.disabled = false; printBtn.style.display = ''; }
            const empty = document.getElementById('stampPreviewEmpty');
            if (empty) empty.style.display = 'none';
            const graySection = document.getElementById('grayscalePdfSection');
            if (graySection) graySection.style.display = '';
            const paperSection = document.getElementById('stampPdfPaperSection');
            if (paperSection) paperSection.style.display = '';
            const paperSelect = document.getElementById('stampPdfPaperSize');
            if (paperSelect) paperSelect.value = stampPdfPaperSize;
            const paperDefaultChk = document.getElementById('stampUsePaperForNewPdfsChk');
            if (paperDefaultChk) paperDefaultChk.checked = stampUseCurrentPaperSizeForNewPdfs;

            hideProcessing();
            await activateStampDocument(stampDocuments.length - 1);
            showToast(`Loaded ${loadedDocs.length} PDF${loadedDocs.length > 1 ? 's' : ''}`, 'success');
        } catch (err) {
            hideProcessing();
            showNotification('Could not read PDF: ' + err.message, 'error');
        }
    }

    window.loadSomsStampFiles = loadStampFiles;

    function saveActiveStampDocumentState() {
        if (activeStampDocIndex < 0 || !stampDocuments[activeStampDocIndex]) return;
        const doc = stampDocuments[activeStampDocIndex];
        doc.previewPage = stampPreviewPage;
        doc.paperSize = stampPdfPaperSize;
        doc.stampState = cloneStampState();
        doc.pageOverrides = pageOverrides;
        doc.pageOverrideActive = pageOverrideActive;
    }

    async function activateStampDocument(index) {
        if (index < 0 || index >= stampDocuments.length) return;
        saveActiveStampDocumentState();
        activeStampDocIndex = index;

        const doc = stampDocuments[index];
        stampPdfDoc = doc.pdfDoc;
        stampPdfBytes = doc.pdfBytes;
        stampFileName = doc.name;
        stampTotalPages = doc.totalPages;
        stampPreviewPage = doc.previewPage || 1;
        stampPdfPaperSize = doc.paperSize || 'original';
        if (!doc.stampState) doc.stampState = cloneStampState();
        applyStampState(doc.stampState);
        pageOverrides = doc.pageOverrides || {};
        pageOverrideActive = !!doc.pageOverrideActive;
        window.stampHasPdf = true;

        const paperSelect = document.getElementById('stampPdfPaperSize');
        if (paperSelect) paperSelect.value = stampPdfPaperSize;

        updateStampUploadLabel();
        renderStampDocumentTabs();
        await renderStampPreviewPage();
    }

    window.switchStampDocument = function (index) {
        activateStampDocument(index);
    };

    window.closeStampDocument = function (index, ev) {
        if (ev) ev.stopPropagation();
        if (index < 0 || index >= stampDocuments.length) return;
        stampRenderToken++;
        if (index === activeStampDocIndex) saveActiveStampDocumentState();
        stampDocuments.splice(index, 1);

        if (!stampDocuments.length) {
            activeStampDocIndex = -1;
            stampPdfDoc = null; stampPdfBytes = null; stampFileName = '';
            stampTotalPages = 0; stampPreviewPage = 1;
            pageOverrides = {}; pageOverrideActive = false;
            window.stampHasPdf = false;
            renderStampDocumentTabs();
            updateStampUploadLabel();

            const paperSection = document.getElementById('stampPdfPaperSection');
            if (paperSection) paperSection.style.display = 'none';
            const graySection = document.getElementById('grayscalePdfSection');
            if (graySection) graySection.style.display = 'none';
            const applyBtn = document.getElementById('stampApplyBtn');
            const printBtn = document.getElementById('stampPrintBtn');
            if (applyBtn) applyBtn.disabled = true;
            if (printBtn) printBtn.disabled = true;
            const emptyDiv = document.getElementById('stampPreviewEmpty');
            if (emptyDiv) emptyDiv.style.display = '';
            const ind = document.getElementById('stampPageIndicator');
            if (ind) ind.textContent = 'Page - / -';
            clearStampPreviewCanvas();
            updateStampPageControls();
            return;
        }

        activeStampDocIndex = -1;
        activateStampDocument(Math.min(index, stampDocuments.length - 1));
    };

    function setupStampKeyboardShortcuts() {
        if (stampKeyboardShortcutsReady) return;
        stampKeyboardShortcutsReady = true;

        document.addEventListener('keydown', e => {
            if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
            if ((e.key || '').toLowerCase() !== 'q') return;
            if (window.activeTool && window.activeTool !== 'stamp') return;
            if (stampOnlyMode || activeStampDocIndex < 0 || !stampDocuments.length) return;

            e.preventDefault();
            e.stopPropagation();
            window.closeStampDocument(activeStampDocIndex);
            showToast('Closed current PDF tab', 'info');
        }, true);
    }

    function updateStampUploadLabel() {
        const lbl = document.getElementById('stampUploadLabel');
        if (!lbl) return;

        if (!stampDocuments.length) {
            lbl.innerHTML = `
                <div style="font-size:28px;margin-bottom:6px"class="upload-icon"><i class="fa fa-cloud-upload"></i></div>
                <div>Click or drag PDFs here</div>`;
            return;
        }

        const activeDoc = stampDocuments[activeStampDocIndex] || stampDocuments[0];
        lbl.innerHTML = `
            <div style="font-size:15px;font-weight:600;word-break:break-all">${escHtml(activeDoc.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">
                ${activeDoc.totalPages} pages · ${formatFileSize(activeDoc.size)} · ${stampDocuments.length} PDF${stampDocuments.length > 1 ? 's' : ''} loaded
            </div>`;
    }

    function renderStampDocumentTabs() {
        const tabs = document.getElementById('stampDocTabs');
        const wrap = document.getElementById('stampDocTabsWrap');
        const viewport = document.querySelector('.stamp-doc-tabs-viewport');
        if (!tabs || !wrap) return;

        wrap.style.display = stampDocuments.length ? 'flex' : 'none';
        if (viewport && !viewport._stampTabsScrollBound) {
            viewport.addEventListener('scroll', updateStampTabNavButtons, { passive: true });
            viewport._stampTabsScrollBound = true;
        }
        tabs.innerHTML = stampDocuments.map((doc, idx) => `
            <button class="stamp-doc-tab ${idx === activeStampDocIndex ? 'active' : ''}" onclick="switchStampDocument(${idx})" title="${escHtml(doc.name)}">
                <span class="stamp-doc-tab-icon"><i class="fa fa-file-pdf-o"></i></span>
                <span class="stamp-doc-tab-title">${escHtml(doc.name)}</span>
                <span class="stamp-doc-tab-meta">${doc.totalPages}p</span>
                <span class="stamp-doc-tab-close" onclick="closeStampDocument(${idx}, event)" title="Close"><i class="fa fa-times"></i></span>
            </button>
        `).join('');
        requestAnimationFrame(function () {
            ensureActiveStampTabVisible();
            updateStampTabNavButtons();
        });
    }

    window.scrollStampDocumentTabs = function (direction) {
        const viewport = document.querySelector('.stamp-doc-tabs-viewport');
        if (!viewport) return;
        viewport.scrollBy({
            left: direction * Math.max(180, Math.round(viewport.clientWidth * 0.75)),
            behavior: 'smooth'
        });
        setTimeout(updateStampTabNavButtons, 220);
    };

    function ensureActiveStampTabVisible() {
        const viewport = document.querySelector('.stamp-doc-tabs-viewport');
        const activeTab = document.querySelector('.stamp-doc-tab.active');
        if (!viewport || !activeTab) return;

        const left = activeTab.offsetLeft;
        const right = left + activeTab.offsetWidth;
        if (left < viewport.scrollLeft) {
            viewport.scrollLeft = left;
        } else if (right > viewport.scrollLeft + viewport.clientWidth) {
            viewport.scrollLeft = right - viewport.clientWidth;
        }
    }

    function updateStampTabNavButtons() {
        const viewport = document.querySelector('.stamp-doc-tabs-viewport');
        const prev = document.getElementById('stampDocTabsPrev');
        const next = document.getElementById('stampDocTabsNext');
        if (!viewport || !prev || !next) return;

        const hasOverflow = viewport.scrollWidth > viewport.clientWidth + 2;
        prev.style.visibility = hasOverflow ? 'visible' : 'hidden';
        next.style.visibility = hasOverflow ? 'visible' : 'hidden';
        prev.disabled = !hasOverflow || viewport.scrollLeft <= 1;
        next.disabled = !hasOverflow || viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1;
    }

    // ─── Preview rendering ────────────────────────────────────────────────────
    window.setStampPdfPaperSize = function (sizeKey) {
        stampPdfPaperSize = PAGE_SIZES[sizeKey] ? sizeKey : 'original';
        if (activeStampDocIndex >= 0 && stampDocuments[activeStampDocIndex]) {
            stampDocuments[activeStampDocIndex].paperSize = stampPdfPaperSize;
        }
        saveStampSettings();
        if (stampPdfDoc) renderStampPreviewPage();
    };

    window.setStampUsePaperForNewPdfs = function (checked) {
        stampUseCurrentPaperSizeForNewPdfs = !!checked;
        const chk = document.getElementById('stampUsePaperForNewPdfsChk');
        if (chk) chk.checked = stampUseCurrentPaperSizeForNewPdfs;
        saveStampSettings();
        showToast(stampUseCurrentPaperSizeForNewPdfs
            ? 'New PDFs will use the selected output paper size'
            : 'New PDFs will use their original paper size', 'info');
    };

    function formatPageSizeInches(ptW, ptH) {
        return `${(ptW / 72).toFixed(2)} x ${(ptH / 72).toFixed(2)} in`;
    }

    function getStampOutputPageSize(sourcePtW, sourcePtH) {
        if (stampPdfPaperSize === 'original' || !PAGE_SIZES[stampPdfPaperSize]) {
            return {
                ptW: sourcePtW,
                ptH: sourcePtH,
                label: `Original (${formatPageSizeInches(sourcePtW, sourcePtH)})`
            };
        }

        const preset = PAGE_SIZES[stampPdfPaperSize];
        let ptW = preset.w;
        let ptH = preset.h;

        if ((sourcePtW > sourcePtH && ptW < ptH) || (sourcePtH > sourcePtW && ptW > ptH)) {
            [ptW, ptH] = [ptH, ptW];
        }

        return {
            ptW,
            ptH,
            label: `${preset.label} (${formatPageSizeInches(ptW, ptH)})`
        };
    }

    function updateStampPdfPaperInfo(sourcePtW, sourcePtH, outputSize) {
        const info = document.getElementById('stampPdfPaperInfo');
        if (!info) return;
        info.textContent = `Scan: ${formatPageSizeInches(sourcePtW, sourcePtH)}. Output paper: ${outputSize.label}. The scan is not resized.`;
    }

    window.setStampViewMode = function (mode) {
        const nextMode = ['single', 'continuous', 'two-page', 'presentation'].includes(mode) ? mode : 'single';
        if (stampViewMode === 'continuous' && nextMode !== 'continuous') {
            syncStampPreviewPageFromScroll();
        }
        stampViewMode = nextMode;
        const sel = document.getElementById('stampViewModeSelect');
        if (sel) sel.value = stampViewMode;
        saveStampSettings();
        if (stampViewMode === 'single' || stampViewMode === 'presentation') {
            stampRenderToken++;
            restoreSingleStampCanvas(true);
        }
        if (stampViewMode === 'presentation') {
            const panel = document.querySelector('.stamp-preview-panel');
            if (panel && panel.requestFullscreen && !document.fullscreenElement) {
                panel.requestFullscreen().catch(() => {});
            }
        }
        if (stampPdfDoc) renderStampPreviewPage();
    };

    async function renderStampPreviewPage() {
        if (!stampPdfDoc) return;
        const renderToken = ++stampRenderToken;
        if (stampViewMode === 'continuous') {
            await renderStampContinuousPreview(renderToken);
            return;
        }
        if (stampViewMode === 'two-page') {
            await renderStampTwoPagePreview(renderToken);
            return;
        }
        restoreSingleStampCanvas();
        const page     = await stampPdfDoc.getPage(stampPreviewPage);
        if (renderToken !== stampRenderToken || stampViewMode === 'continuous' || stampViewMode === 'two-page') return;
        const viewport = page.getViewport({ scale: stampPreviewScale });
        const sourceSize = page.getViewport({ scale: 1.0 });
        const outputSize = getStampOutputPageSize(sourceSize.width, sourceSize.height);
        const previewW = Math.round(outputSize.ptW * stampPreviewScale);
        const previewH = Math.round(outputSize.ptH * stampPreviewScale);
        const offsetX = Math.round((previewW - viewport.width) / 2);
        const offsetY = Math.round((previewH - viewport.height) / 2);

        const base = document.getElementById('stampBaseCanvas');
        const over = document.getElementById('stampOverlayCanvas');
        if (!base || !over) return;

        base.width  = over.width  = previewW;
        base.height = over.height = previewH;

        const baseCtx = base.getContext('2d');
        baseCtx.fillStyle = '#ffffff';
        baseCtx.fillRect(0, 0, previewW, previewH);
        await page.render({
            canvasContext: baseCtx,
            viewport,
            transform: [1, 0, 0, 1, offsetX, offsetY]
        }).promise;
        if (renderToken !== stampRenderToken || stampViewMode === 'continuous' || stampViewMode === 'two-page') return;

        // Grayscale page — applied to base canvas only; stamp overlay stays in color
        if (bwMode) applyGrayscaleToCanvas(base);

        updateStampPdfPaperInfo(sourceSize.width, sourceSize.height, outputSize);
        updateStampPageControls();
        document.getElementById('stampPageIndicator').textContent =
            `${stampViewMode === 'presentation' ? 'Presentation' : 'Page'} ${stampPreviewPage} / ${stampTotalPages} · ${outputSize.label}`;

        // Update Apply to Pages visibility based on page count
        const modes = [
            { sectionId: 'simpleApplyPages', rangeRowId: 'stampRangeRow' },
            { sectionId: 'fmtApplyPages',    rangeRowId: 'fmtRangeRow'   },
            { sectionId: 'sealApplyPages',   rangeRowId: 'sealRangeRow'  },
            { sectionId: 'recvApplyPages',   rangeRowId: 'recvRangeRow'  },
        ];
        modes.forEach(function(m) {
            const section  = document.getElementById(m.sectionId);
            const rangeRow = document.getElementById(m.rangeRowId);
            if (!section) return;
            if (stampTotalPages <= 1) {
                section.style.display = 'none';
            } else if (stampTotalPages === 2) {
                section.style.display = '';
                const rangeLbl = section.querySelector('input[value="range"]')?.closest('label');
                if (rangeLbl) rangeLbl.style.display = 'none';
                const rangeRadio = section.querySelector('input[value="range"]');
                if (rangeRadio && rangeRadio.checked) {
                    const allRadio = section.querySelector('input[value="all"]');
                    if (allRadio) { allRadio.checked = true; allRadio.dispatchEvent(new Event('change')); }
                }
                if (rangeRow) rangeRow.style.display = 'none';
            } else {
                section.style.display = '';
                const rangeLbl = section.querySelector('input[value="range"]')?.closest('label');
                if (rangeLbl) rangeLbl.style.display = '';
                const rangeRadio = section.querySelector('input[value="range"]');
                if (rangeRow) rangeRow.style.display = (rangeRadio && rangeRadio.checked) ? 'flex' : 'none';
            }
        });

        // Show per-page checkbox only when more than 1 page
        const lbl = document.getElementById('pageOverrideLabel');
        const chk = document.getElementById('pageOverrideChk');
        if (lbl && chk) {
            lbl.style.display = stampTotalPages > 1 ? 'flex' : 'none';
            const hasOverride = !!pageOverrides[stampPreviewPage];
            chk.checked = hasOverride;
            pageOverrideActive = hasOverride;
            // Highlight the label when override is active
            lbl.style.color = hasOverride ? 'var(--accent-color)' : '';
            lbl.style.fontWeight = hasOverride ? '700' : '';
        }

        // If this page has an override, temporarily load its settings into the UI
        if (pageOverrides[stampPreviewPage]) {
            loadSettingsIntoUI(pageOverrides[stampPreviewPage]);
        } else {
            // Restore global settings into UI
            loadSettingsIntoUI(null);
        }

        drawStampOverlay(over, previewW, previewH, stampPreviewPage);
    }

    async function renderStampContinuousPreview(renderToken) {
        const wrap = document.getElementById('stampCanvasWrap');
        const scroll = document.getElementById('stampPreviewScroll');
        if (!wrap || !scroll) return;
        if (renderToken !== stampRenderToken || stampViewMode !== 'continuous') return;

        scroll.onscroll = null;
        scroll.classList.add('continuous');
        scroll.style.flexDirection = 'column';
        wrap.style.setProperty('display', 'flex');
        wrap.style.setProperty('flex-direction', 'column', 'important');
        wrap.innerHTML = '';
        wrap.classList.remove('two-page');
        wrap.classList.add('continuous');

        let firstLabel = '';
        for (let pNum = 1; pNum <= stampTotalPages; pNum++) {
            const pair = await createRenderedStampPage(pNum);
            if (renderToken !== stampRenderToken || stampViewMode !== 'continuous') return;
            if (!firstLabel) firstLabel = pair.outputSize.label;
            const item = document.createElement('div');
            item.className = 'stamp-preview-page-item';
            item.dataset.pageNum = String(pNum);
            item.appendChild(pair.base);
            item.appendChild(pair.over);
            wrap.appendChild(item);
        }

        if (renderToken !== stampRenderToken || stampViewMode !== 'continuous') return;
        updateStampPdfPaperInfoForCurrent();
        document.getElementById('stampPageIndicator').textContent = `Continuous · ${stampTotalPages} pages · ${firstLabel}`;
        await updateStampPdfPaperInfoForCurrent();
        updateStampPageControls();
        scroll.onscroll = function () {
            if (stampViewMode !== 'continuous') return;
            if (stampScrollUpdateFrame) return;
            stampScrollUpdateFrame = requestAnimationFrame(function () {
                stampScrollUpdateFrame = null;
                syncStampPreviewPageFromScroll();
            });
        };
        requestAnimationFrame(function () {
            if (stampPreviewPage <= 1) {
                scroll.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            } else {
                scrollStampPreviewToPage(stampPreviewPage, 'auto');
            }
        });
    }

    async function renderStampTwoPagePreview(renderToken) {
        const wrap = document.getElementById('stampCanvasWrap');
        const scroll = document.getElementById('stampPreviewScroll');
        if (!wrap) return;
        if (renderToken !== stampRenderToken || stampViewMode !== 'two-page') return;

        if (scroll) {
            scroll.onscroll = null;
            scroll.classList.remove('continuous');
            scroll.style.flexDirection = '';
        }
        wrap.style.setProperty('display', 'flex');
        wrap.style.setProperty('flex-direction', 'row', 'important');
        wrap.innerHTML = '';
        wrap.classList.remove('continuous');
        wrap.classList.add('two-page');

        const spreadStart = getTwoPageSpreadStart(stampPreviewPage);
        const pageNums = [spreadStart];
        if (spreadStart < stampTotalPages) pageNums.push(spreadStart + 1);
        let label = '';

        for (const pNum of pageNums) {
            const pair = await createRenderedStampPage(pNum);
            if (renderToken !== stampRenderToken || stampViewMode !== 'two-page') return;
            label = label || pair.outputSize.label;
            const item = document.createElement('div');
            item.className = 'stamp-preview-page-item';
            item.dataset.pageNum = String(pNum);
            item.appendChild(pair.base);
            item.appendChild(pair.over);
            wrap.appendChild(item);
        }

        if (renderToken !== stampRenderToken || stampViewMode !== 'two-page') return;
        updateStampPdfPaperInfoForCurrent();
        document.getElementById('stampPageIndicator').textContent = `Pages ${pageNums.join(' - ')} / ${stampTotalPages} · ${label}`;
        await updateStampPdfPaperInfoForCurrent();
        updateStampPageControls();
    }

    function getTwoPageSpreadStart(pageNum) {
        let start = Math.max(1, parseInt(pageNum, 10) || 1);
        if (start > 1 && start % 2 === 0) start -= 1;
        if (start >= stampTotalPages && stampTotalPages > 1) start = stampTotalPages - 1;
        return Math.max(1, start);
    }

    async function createRenderedStampPage(pageNum) {
        const page = await stampPdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: stampPreviewScale });
        const sourceSize = page.getViewport({ scale: 1.0 });
        const outputSize = getStampOutputPageSize(sourceSize.width, sourceSize.height);
        const previewW = Math.round(outputSize.ptW * stampPreviewScale);
        const previewH = Math.round(outputSize.ptH * stampPreviewScale);
        const offsetX = Math.round((previewW - viewport.width) / 2);
        const offsetY = Math.round((previewH - viewport.height) / 2);

        const base = document.createElement('canvas');
        const over = document.createElement('canvas');
        base.width = over.width = previewW;
        base.height = over.height = previewH;

        const baseCtx = base.getContext('2d');
        baseCtx.fillStyle = '#ffffff';
        baseCtx.fillRect(0, 0, previewW, previewH);
        await page.render({
            canvasContext: baseCtx,
            viewport,
            transform: [1, 0, 0, 1, offsetX, offsetY]
        }).promise;
        if (bwMode) applyGrayscaleToCanvas(base);
        drawStampOverlay(over, previewW, previewH, pageNum);
        over.dataset.pageNum = String(pageNum);
        attachStampOverlayDrag(over, pageNum);

        return { base, over, outputSize };
    }

    async function updateStampPdfPaperInfoForCurrent() {
        const page = await stampPdfDoc.getPage(stampPreviewPage);
        const sourceSize = page.getViewport({ scale: 1.0 });
        updateStampPdfPaperInfo(sourceSize.width, sourceSize.height, getStampOutputPageSize(sourceSize.width, sourceSize.height));
    }

    function scrollStampPreviewToPage(pageNum, behavior = 'smooth') {
        const scroll = document.getElementById('stampPreviewScroll');
        const item = document.querySelector(`.stamp-preview-page-item[data-page-num="${pageNum}"]`);
        if (!scroll || !item) return;
        const scrollRect = scroll.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        scroll.scrollTo({
            top: scroll.scrollTop + itemRect.top - scrollRect.top - 12,
            left: stampViewMode === 'continuous' ? 0 : Math.max(0, scroll.scrollLeft + itemRect.left - scrollRect.left - 12),
            behavior
        });
    }

    function getVisibleContinuousPage() {
        const scroll = document.getElementById('stampPreviewScroll');
        if (!scroll || stampViewMode !== 'continuous') return stampPreviewPage;
        const scrollRect = scroll.getBoundingClientRect();
        let bestPage = stampPreviewPage;
        let bestDistance = Number.POSITIVE_INFINITY;
        document.querySelectorAll('.stamp-preview-page-item[data-page-num]').forEach(function (item) {
            const rect = item.getBoundingClientRect();
            if (rect.bottom < scrollRect.top || rect.top > scrollRect.bottom) return;
            const distance = Math.abs(rect.top - scrollRect.top - 12);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestPage = parseInt(item.dataset.pageNum, 10) || bestPage;
            }
        });
        return bestPage;
    }

    function syncStampPreviewPageFromScroll() {
        const visiblePage = getVisibleContinuousPage();
        if (!visiblePage || visiblePage === stampPreviewPage) {
            updateStampPageControls();
            return;
        }
        stampPreviewPage = visiblePage;
        saveActiveStampDocumentState();
        updateStampPageControls();
    }

    function updateStampPageControls() {
        updateGrayscaleOutputControls();
        updateStampOutputQualityControls();
        const viewModeSelect = document.getElementById('stampViewModeSelect');
        if (viewModeSelect) {
            viewModeSelect.value = stampViewMode;
            viewModeSelect.style.display = stampOnlyMode ? 'none' : '';
        }

        const bwChk = document.getElementById('bwModeChk');
        if (bwChk) bwChk.checked = bwMode;

        const paperDefaultChk = document.getElementById('stampUsePaperForNewPdfsChk');
        if (paperDefaultChk) paperDefaultChk.checked = stampUseCurrentPaperSizeForNewPdfs;

        const overrideLabel = document.getElementById('pageOverrideLabel');
        if (overrideLabel) overrideLabel.style.display = stampViewMode === 'continuous' ? 'none' : (stampTotalPages > 1 ? 'flex' : 'none');

        const prevBtn = document.getElementById('stampPrevBtn');
        const nextBtn = document.getElementById('stampNextBtn');
        if (prevBtn) prevBtn.disabled = !stampPdfDoc || stampPreviewPage <= 1;
        if (nextBtn) {
            const nextStep = stampViewMode === 'two-page' ? 2 : 1;
            nextBtn.disabled = !stampPdfDoc || stampPreviewPage + nextStep > stampTotalPages;
        }

        const input = document.getElementById('stampPageJumpInput');
        if (input) {
            input.style.display = stampPdfDoc && !stampOnlyMode ? '' : 'none';
            input.max = String(Math.max(1, stampTotalPages || 1));
            input.value = String(Math.max(1, stampPreviewPage || 1));
        }

        const indicator = document.getElementById('stampPageIndicator');
        if (indicator && stampViewMode === 'continuous') {
            indicator.textContent = `Page ${stampPreviewPage} / ${stampTotalPages} - Continuous`;
        }
    }

    function scheduleStampOverlayRedraw() {
        if (stampOverlayRedrawFrame) return;
        stampOverlayRedrawFrame = requestAnimationFrame(function () {
            stampOverlayRedrawFrame = null;
            redrawStampOverlaysOnly();
        });
    }

    function redrawStampOverlaysOnly() {
        if (stampViewMode === 'continuous' || stampViewMode === 'two-page') {
            document.querySelectorAll('.stamp-preview-page-item canvas:last-child').forEach(canvas => {
                const pageNum = parseInt(canvas.dataset.pageNum, 10) || stampPreviewPage;
                drawStampOverlay(canvas, canvas.width, canvas.height, pageNum);
            });
            return;
        }

        const canvas = document.getElementById('stampOverlayCanvas');
        if (canvas) drawStampOverlay(canvas, canvas.width, canvas.height, stampPreviewPage);
    }

    function restoreSingleStampCanvas(forceRebuild = false) {
        const wrap = document.getElementById('stampCanvasWrap');
        const scroll = document.getElementById('stampPreviewScroll');
        if (!wrap) return;
        wrap.style.display = 'inline-block';
        wrap.style.removeProperty('flex-direction');
        if (scroll) {
            scroll.onscroll = null;
            scroll.classList.remove('continuous');
            scroll.style.flexDirection = '';
        }
        wrap.classList.remove('continuous', 'two-page');
        if (forceRebuild || !document.getElementById('stampBaseCanvas')) {
            wrap.innerHTML = '<canvas id="stampBaseCanvas"></canvas><canvas id="stampOverlayCanvas"></canvas>';
            setupOverlayDrag();
        }
    }

    function clearStampPreviewCanvas() {
        const scroll = document.getElementById('stampPreviewScroll');
        if (scroll) {
            scroll.onscroll = null;
            scroll.scrollTop = 0;
            scroll.scrollLeft = 0;
            scroll.classList.remove('continuous', 'drag-over');
            scroll.style.flexDirection = '';
        }

        const panel = document.querySelector('.stamp-preview-panel');
        if (panel) panel.classList.remove('drag-over');

        const wrap = document.getElementById('stampCanvasWrap');
        if (!wrap) return;
        wrap.classList.remove('continuous', 'two-page');
        wrap.style.display = 'none';
        wrap.style.removeProperty('flex-direction');
        wrap.innerHTML = '<canvas id="stampBaseCanvas"></canvas><canvas id="stampOverlayCanvas"></canvas>';
        setupOverlayDrag();
    }

    function drawStampOverlay(canvas, w, h, pageNum = stampPreviewPage) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        // Use per-page override if this page has one.
        // When override exists, do NOT call readXxxSettings() — that would write
        // the custom page's UI values into the global settings object, contaminating
        // every other page. The override snapshot is fully self-contained.
        const ovr = pageOverrides[pageNum];

        if (stampMode === 'formatted') {
            if (ovr) {
                drawFormattedStamp(ctx, w, h, ovr, new Date());
            } else {
                readFmtSettings();
                drawFormattedStamp(ctx, w, h, fmtSettings, new Date());
            }
        } else if (stampMode === 'seal') {
            if (ovr) {
                drawCircularSeal(ctx, w, h, ovr, new Date());
            } else {
                readSealSettings();
                drawCircularSeal(ctx, w, h, sealSettings, new Date());
            }
        } else if (stampMode === 'received') {
            if (ovr) {
                drawReceivedStamp(ctx, w, h, ovr, new Date());
            } else {
                readRecvSettings();
                drawReceivedStamp(ctx, w, h, recvSettings, new Date());
            }
        } else {
            if (ovr) {
                drawSimpleStamp(ctx, w, h, ovr);
            } else {
                readStampSettings();
                drawSimpleStamp(ctx, w, h, stampSettings);
            }
        }
    }

    function refreshOverlay() {
        if (stampOnlyMode) {
            renderStampOnlyPreview();
            saveStampSettings();
            // Also refresh modal preview if open
            if (document.getElementById('printStampOnlyModal')) renderPsoPreview();
            return;
        }
        if (stampPdfDoc && (stampViewMode === 'continuous' || stampViewMode === 'two-page')) {
            renderStampPreviewPage();
            saveStampSettings();
            return;
        }
        const c = document.getElementById('stampOverlayCanvas');
        if (c && stampPdfDoc) {
            const chk = document.getElementById('pageOverrideChk');
            if (chk && chk.checked && pageOverrides[stampPreviewPage]) {
                saveCurrentPageOverride();
            }
            drawStampOverlay(c, c.width, c.height);
        }
        // Also refresh modal preview if open
        if (document.getElementById('printStampOnlyModal')) renderPsoPreview();
        saveStampSettings();
    }

    // ─── Stamp-Only Mode toggle ───────────────────────────────────────────────
    window.toggleStampOnlyMode = function (checked) {
        stampRenderToken++;
        // ── Show a brief loading overlay on the preview panel ─────────────────
        const previewScroll = document.getElementById('stampPreviewScroll');
        let loadingEl = showStampPreviewLoading(checked ? 'Loading stamp preview…' : 'Restoring…');
        if (previewScroll) {
            /*
            loadingEl = document.createElement('div');
            loadingEl.style.cssText = `
                position:absolute;inset:0;z-index:50;
                background:var(--bg-primary);
                display:flex;flex-direction:column;
                align-items:center;justify-content:center;
                gap:14px;opacity:0;
                transition:opacity 0.15s ease;
                pointer-events:all;
            `;
            loadingEl.innerHTML = `
                <div style="
                    width:36px;height:36px;border-radius:50%;
                    border:3px solid var(--border-color);
                    border-top-color:var(--accent-color);
                    animation:modeSpinAnim 0.7s linear infinite;
                "></div>
                <div style="font-size:13px;color:var(--text-secondary);font-weight:500">
                    ${checked ? 'Loading stamp preview…' : 'Restoring…'}
                </div>
            `;
            previewScroll.style.position = 'relative';
            previewScroll.appendChild(loadingEl);
            // Fade in
            requestAnimationFrame(() => { loadingEl.style.opacity = '1'; });
            */
        }

        // ── Do the actual work after a short delay so the overlay is visible ──
        setTimeout(function () {
            stampOnlyMode = checked;

            const dropWrap    = document.getElementById('stampDropZoneWrap');
            const applyBtn    = document.getElementById('stampApplyBtn');
            const printBtn    = document.getElementById('stampPrintBtn');
            const printOnly   = document.getElementById('stampPrintOnlyBtn');
            const emptyDiv    = document.getElementById('stampPreviewEmpty');
            const emptyMsg    = document.getElementById('stampPreviewEmptyMsg');
            const overrideLbl = document.getElementById('pageOverrideLabel');
            const paperSection = document.getElementById('stampPdfPaperSection');
            const docTabs = document.getElementById('stampDocTabsWrap');
            const viewModeSelect = document.getElementById('stampViewModeSelect');

            if (checked) {
                stampViewMode = 'single';
                if (viewModeSelect) {
                    viewModeSelect.value = 'single';
                    viewModeSelect.style.display = 'none';
                }
                if (dropWrap)    dropWrap.style.display        = 'none';
                if (paperSection) paperSection.style.display   = 'none';
                if (docTabs) docTabs.style.display             = 'none';
                if (applyBtn)  { applyBtn.disabled = true;  applyBtn.style.display  = 'none'; }
                if (printBtn)  { printBtn.disabled = true;  printBtn.style.display  = 'none'; }
                if (printOnly) { printOnly.disabled = false; printOnly.style.display = 'flex'; }
                if (overrideLbl) overrideLbl.style.display     = 'none';
                if (emptyMsg)    emptyMsg.textContent          = 'Adjust settings to preview the stamp';

                // Hide Prev/Next page buttons — no pages in stamp-only mode
                const prevBtn = document.getElementById('stampPrevBtn');
                const nextBtn = document.getElementById('stampNextBtn');
                const pageJump = document.getElementById('stampPageJumpInput');
                if (prevBtn) prevBtn.style.display = 'none';
                if (nextBtn) nextBtn.style.display = 'none';
                if (pageJump) pageJump.style.display = 'none';

                // Hide Grayscale PDF option in stamp-only mode
                const graySection = document.getElementById('grayscalePdfSection');
                if (graySection) graySection.style.display = 'none';

                // Show orientation dropdown
                const orientSel = document.getElementById('stampOnlyOrient');
                if (orientSel) orientSel.style.display = '';

                // Set default vertical position to 90% for portrait (initial orientation)
                const s0 = getActiveSettings();
                s0.positionY = 90;
                const sliderIds0 = { simple: 'stampPosY', formatted: 'fmtPosY', seal: 'sealPosY', received: 'recvPosY' };
                const valIds0    = { simple: 'stampPosYVal', formatted: 'fmtPosYVal', seal: 'sealPosYVal', received: 'recvPosYVal' };
                const sl0 = document.getElementById(sliderIds0[stampMode]);
                const vl0 = document.getElementById(valIds0[stampMode]);
                if (sl0) sl0.value = 90;
                if (vl0) vl0.textContent = '90%';

                // Hide Apply to Pages in all three modes
                ['simpleApplyPages','fmtApplyPages','sealApplyPages','recvApplyPages'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                });

                renderStampOnlyPreview();
            } else {
                if (dropWrap) dropWrap.style.display = '';

                const hasPdf = !!stampPdfDoc;
                if (applyBtn)  { applyBtn.disabled  = !hasPdf; applyBtn.style.display  = ''; }
                if (printBtn)  { printBtn.disabled  = !hasPdf; printBtn.style.display  = ''; }
                if (printOnly) { printOnly.disabled = true;    printOnly.style.display = 'none'; }
                if (emptyMsg)  emptyMsg.textContent = 'Upload a PDF to preview the stamp';

                // Restore Grayscale PDF option only if a PDF is loaded
                const graySection = document.getElementById('grayscalePdfSection');
                if (graySection) graySection.style.display = hasPdf ? '' : 'none';
                if (paperSection) paperSection.style.display = hasPdf ? '' : 'none';
                renderStampDocumentTabs();

                // Restore Prev/Next page buttons
                const prevBtn = document.getElementById('stampPrevBtn');
                const nextBtn = document.getElementById('stampNextBtn');
                const pageJump = document.getElementById('stampPageJumpInput');
                if (prevBtn) prevBtn.style.display = '';
                if (nextBtn) nextBtn.style.display = '';
                if (pageJump) pageJump.style.display = hasPdf ? '' : 'none';
                if (viewModeSelect) viewModeSelect.style.display = '';

                // Hide orientation dropdown
                const orientSel = document.getElementById('stampOnlyOrient');
                if (orientSel) orientSel.style.display = 'none';

                // Restore Apply to Pages — only show if PDF loaded with 2+ pages
                if (!hasPdf || stampTotalPages <= 1) {
                    ['simpleApplyPages','fmtApplyPages','sealApplyPages','recvApplyPages'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.style.display = 'none';
                    });
                }

                if (hasPdf) {
                    // Restore PDF preview — await it then force overlay redraw
                    renderStampPreviewPage().then(() => {
                        const over = document.getElementById('stampOverlayCanvas');
                        if (over && over.width > 0) {
                            drawStampOverlay(over, over.width, over.height);
                        }
                    });
                } else {
                    if (emptyDiv) emptyDiv.style.display = '';
                    const base = document.getElementById('stampBaseCanvas');
                    const over = document.getElementById('stampOverlayCanvas');
                    if (base) { base.width = 0; base.height = 0; }
                    if (over)  { over.width  = 0; over.height  = 0; }
                    const wrap = document.getElementById('stampCanvasWrap');
                    if (wrap) wrap.style.display = 'none';
                }
            }

            // ── Fade out and remove the loading overlay ────────────────────────
            if (loadingEl) {
                loadingEl.style.opacity = '0';
                setTimeout(() => { loadingEl.remove(); }, 200);
            }

        }, 250);
    };

    // Renders the stamp on a blank white canvas (no PDF) for stamp-only preview
    // ─── Print Stamp Only ─────────────────────────────────────────────────────
    // Page size presets in points (1 pt = 1/72 inch)
    const PAGE_SIZES = {
        'A4':     { w: 595.28,  h: 841.89,  label: 'A4 (210×297mm)' },
        'Letter': { w: 612,     h: 792,     label: 'Letter (8.5×11in)' },
        'Legal':  { w: 612,     h: 1008,    label: 'Legal (8.5×14in)' },
        'Long':   { w: 612,     h: 936,     label: 'Long (8.5×13in)' },
        'A5':     { w: 419.53,  h: 595.28,  label: 'A5 (148×210mm)' },
        'Short':  { w: 612,     h: 936,     label: 'Short (8.5×13in / Folio)' },
    };

    Object.assign(PAGE_SIZES, {
        'A4':             { w: 595.28, h: 841.89, label: 'A4 210 x 297 mm' },
        'Photo4x6':       { w: 288,    h: 432,    label: '10 x 15 cm (4 x 6 in)' },
        'Photo5x7':       { w: 360,    h: 504,    label: '13 x 18 cm (5 x 7 in)' },
        'A6':             { w: 297.64, h: 419.53, label: 'A6 105 x 148 mm' },
        'A5':             { w: 419.53, h: 595.28, label: 'A5 148 x 210 mm' },
        'B5':             { w: 515.91, h: 728.5,  label: 'B5 182 x 257 mm' },
        'B6':             { w: 362.83, h: 515.91, label: 'B6 128 x 182 mm' },
        'Photo3_5x5':     { w: 252,    h: 360,    label: '9 x 13 cm (3.5 x 5 in)' },
        'Photo5x8':       { w: 360,    h: 576,    label: '5 x 8 in (127 x 203 mm)' },
        'Photo8x10':      { w: 576,    h: 720,    label: '20 x 25 cm (8 x 10 in)' },
        'Wide16x9':       { w: 288,    h: 511.92, label: '16:9 wide (4 x 7.11 in)' },
        'Postcard100x148':{ w: 283.46, h: 419.53, label: '100 x 148 mm' },
        'Envelope10':     { w: 297.64, h: 683.15, label: 'Envelope #10 105 x 241 mm' },
        'EnvelopeDL':     { w: 311.81, h: 623.62, label: 'Envelope DL 110 x 220 mm' },
        'EnvelopeC6':     { w: 323.15, h: 459.21, label: 'Envelope C6 114 x 162 mm' },
        'Letter':         { w: 612,    h: 792,    label: 'Letter 8.5 x 11 in (216 x 279 mm)' },
        'Long':           { w: 612,    h: 936,    label: '8.5 x 13 in' },
        'IndianLegal':    { w: 609.45, h: 977.95, label: 'Indian-Legal 215 x 345 mm' },
        'Legal':          { w: 612,    h: 1008,   label: 'Legal 8.5 x 14 in (216 x 356 mm)' },
        'SixteenK':       { w: 552.76, h: 765.35, label: '16K 195 x 270 mm' },
        'Short':          { w: 612,    h: 936,    label: 'Short / Folio (8.5 x 13 in)' },
    });

    // Loading effect wrapper for orientation change
    window.stampOnlyOrientChange = function () {
        const overlay = showStampPreviewLoading('Updating orientation…');

        // Render after overlay is visible, then fade out
        setTimeout(function () {
            renderStampOnlyPreview();
            if (!overlay) return;
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 200);
        }, 200);
    };

    window.renderStampOnlyPreview = function renderStampOnlyPreview() {
        restoreSingleStampCanvas();
        // Read paper size from print modal if open, else use A4 default
        const sizeKey  = document.getElementById('psoPageSize')?.value || 'A4';
        const orient   = document.getElementById('stampOnlyOrient')?.value || 'portrait';
        const size     = PAGE_SIZES[sizeKey] || PAGE_SIZES['A4'];

        // Apply orientation — swap W/H for landscape
        let ptW = size.w, ptH = size.h;
        if (orient === 'landscape') { [ptW, ptH] = [ptH, ptW]; }

        const scale = stampPreviewScale;
        const cW = Math.round(ptW * scale);
        const cH = Math.round(ptH * scale);

        const base = document.getElementById('stampBaseCanvas');
        const over = document.getElementById('stampOverlayCanvas');
        const emptyDiv = document.getElementById('stampPreviewEmpty');

        if (!base || !over) return;

        base.width  = over.width  = cW;
        base.height = over.height = cH;

        // Draw white background on base canvas
        const bCtx = base.getContext('2d');
        bCtx.fillStyle = '#ffffff';
        bCtx.fillRect(0, 0, cW, cH);

        // Subtle page border so user can see paper edges
        bCtx.strokeStyle = '#cbd5e1';
        bCtx.lineWidth = 2;
        bCtx.strokeRect(1, 1, cW - 2, cH - 2);

        // Hide empty state
        if (emptyDiv) emptyDiv.style.display = 'none';

        // Update page indicator to show orientation
        const ind = document.getElementById('stampPageIndicator');
        if (ind) ind.textContent = orient === 'landscape' ? 'Preview · Landscape' : 'Preview · Portrait';

        // Draw stamp on overlay
        drawStampOverlay(over, cW, cH);
    }

    // ─── Per-page override helpers ────────────────────────────────────────────

    // Toggle override on/off for the current page
    // ─── Grayscale page mode ──────────────────────────────────────────────────
    window.toggleBwMode = function (checked) {
        bwMode = checked;
        updateGrayscaleOutputControls();
        saveStampSettings();
        renderStampPreviewPage();
    };

    window.setGrayscaleOutputMode = function (mode) {
        grayscaleOutputMode = ['normal', 'dark-xerox', 'high-contrast'].includes(mode) ? mode : 'normal';
        const select = document.getElementById('grayscaleOutputMode');
        if (select) select.value = grayscaleOutputMode;
        saveStampSettings();
        if (bwMode) renderStampPreviewPage();
    };

    function updateGrayscaleOutputControls() {
        const controls = document.getElementById('grayscaleOutputControls');
        const select = document.getElementById('grayscaleOutputMode');
        if (controls) controls.style.display = bwMode && !stampOnlyMode ? '' : 'none';
        if (select) select.value = grayscaleOutputMode;
    }

    window.setStampOutputRenderProfile = function (profile) {
        stampOutputRenderProfile = ['fast', 'balanced', 'high'].includes(profile) ? profile : 'fast';
        updateStampOutputQualityControls();
        saveStampSettings();
    };

    function updateStampOutputQualityControls() {
        const section = document.getElementById('stampOutputQualitySection');
        const select = document.getElementById('stampOutputRenderProfile');
        const visible = !!stampPdfDoc && !stampOnlyMode;
        if (section) section.style.display = visible ? '' : 'none';
        if (select) select.value = stampOutputRenderProfile;
    }

    function getStampOutputRenderSettings() {
        if (stampOutputRenderProfile === 'high') return { scale: 2.0, jpegQuality: 0.92 };
        if (stampOutputRenderProfile === 'balanced') return { scale: 1.5, jpegQuality: 0.88 };
        return { scale: 1.15, jpegQuality: 0.82 };
    }

    // Converts all pixels of a canvas to grayscale in-place.
    // Stamp is drawn AFTER this so it stays in full color.
    function applyGrayscaleToCanvas(canvas) {
        const ctx  = canvas.getContext('2d');
        const imgd = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d    = imgd.data;
        for (let i = 0; i < d.length; i += 4) {
            const g0 = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
            let g = g0;
            if (grayscaleOutputMode === 'dark-xerox') {
                g = (g0 - 128) * 1.55 + 100;
                if (g0 > 238) g = 255;
                else if (g0 < 222) g *= 0.72;
            } else if (grayscaleOutputMode === 'high-contrast') {
                g = (g0 - 128) * 1.9 + 128;
                if (g0 > 230) g = 255;
                else if (g0 < 180) g *= 0.55;
            }
            g = Math.max(0, Math.min(255, g));
            d[i] = d[i+1] = d[i+2] = g;
        }
        ctx.putImageData(imgd, 0, 0);
    }

    window.togglePageOverride = function (checked) {
        pageOverrideActive = checked;
        const lbl = document.getElementById('pageOverrideLabel');
        if (lbl) {
            lbl.style.color      = checked ? 'var(--accent-color)' : '';
            lbl.style.fontWeight = checked ? '700' : '';
        }
        if (checked) {
            // Snapshot current global settings as the starting point for this page
            saveCurrentPageOverride();
            showNotification(`Page ${stampPreviewPage} now has custom stamp settings.`, 'info');
        } else {
            // Remove override — revert to global settings
            delete pageOverrides[stampPreviewPage];
            loadSettingsIntoUI(null);   // restore global settings into UI controls
            refreshOverlay();
            showNotification(`Page ${stampPreviewPage} reverted to global settings.`, 'info');
        }
    };

    // Snapshot the current UI state into pageOverrides for the current page.
    // Reads DOM values directly into a fresh object — never writes to global
    // stampSettings / fmtSettings / sealSettings to avoid cross-page contamination.
    function saveCurrentPageOverride(pageNum = stampPreviewPage) {
        const g = id => document.getElementById(id);
        let snapshot;
        if (stampMode === 'formatted') {
            snapshot = {
                title:         g('fmtTitle')?.value         ?? fmtSettings.title,
                name:          g('fmtName')?.value          ?? fmtSettings.name,
                subName:       g('fmtSubName')?.value       ?? fmtSettings.subName,
                institution:   g('fmtInstitution')?.value   ?? fmtSettings.institution,
                color:         g('fmtColor')?.value         ?? fmtSettings.color,
                opacity:       parseFloat(g('fmtOpacity')?.value)   || fmtSettings.opacity,
                scale:         parseFloat(g('fmtScale')?.value)     || fmtSettings.scale,
                showDate:      g('fmtShowDate')?.checked    ?? fmtSettings.showDate,
                showTime:      g('fmtShowTime')?.checked    ?? fmtSettings.showTime,
                transparentBg: g('fmtTransparent')?.checked ?? fmtSettings.transparentBg,
                positionX:     parseInt(g('fmtPosX')?.value)        || fmtSettings.positionX,
                positionY:     parseInt(g('fmtPosY')?.value)        || fmtSettings.positionY,
                applyPages:    fmtSettings.applyPages,
                pageRange:     g('fmtPageRange')?.value     ?? fmtSettings.pageRange,
            };
        } else if (stampMode === 'seal') {
            snapshot = {
                topText:      g('sealTopText')?.value       ?? sealSettings.topText,
                bottomText:   g('sealBottomText')?.value    ?? sealSettings.bottomText,
                schoolName:   g('sealSchoolName')?.value    ?? sealSettings.schoolName,
                schoolAbbrev: g('sealSchoolAbbrev')?.value  ?? sealSettings.schoolAbbrev,
                showDate:     g('sealShowDate')?.checked    ?? sealSettings.showDate,
                color:        g('sealColor')?.value         ?? sealSettings.color,
                opacity:      parseFloat(g('sealOpacity')?.value)   || sealSettings.opacity,
                scale:        parseFloat(g('sealScale')?.value)     || sealSettings.scale,
                positionX:    parseInt(g('sealPosX')?.value)        || sealSettings.positionX,
                positionY:    parseInt(g('sealPosY')?.value)        || sealSettings.positionY,
                applyPages:   sealSettings.applyPages,
                pageRange:    g('sealPageRange')?.value     ?? sealSettings.pageRange,
            };
        } else if (stampMode === 'received') {
            snapshot = {
                schoolName:     g('recvSchoolName')?.value     ?? recvSettings.schoolName,
                officeName:     g('recvOfficeName')?.value     ?? recvSettings.officeName,
                stampType:      g('recvStampType')?.value      ?? recvSettings.stampType,
                personnelName:  g('recvPersonnelName')?.value  ?? recvSettings.personnelName,
                personnelDesig: g('recvPersonnelDesig')?.value ?? recvSettings.personnelDesig,
                showDate:       g('recvShowDate')?.checked     ?? recvSettings.showDate,
                showTime:       g('recvShowTime')?.checked     ?? recvSettings.showTime,
                transparentBg:  g('recvTransparent')?.checked  ?? recvSettings.transparentBg,
                color:          g('recvColor')?.value          ?? recvSettings.color,
                opacity:        parseFloat(g('recvOpacity')?.value)  || recvSettings.opacity,
                scale:          parseFloat(g('recvScale')?.value)    || recvSettings.scale,
                positionX:      parseInt(g('recvPosX')?.value)       || recvSettings.positionX,
                positionY:      parseInt(g('recvPosY')?.value)       || recvSettings.positionY,
                applyPages:     recvSettings.applyPages,
                pageRange:      g('recvPageRange')?.value      ?? recvSettings.pageRange,
            };
        } else {
            snapshot = {
                text:        g('stampText')?.value           ?? stampSettings.text,
                color:       g('stampColor')?.value          ?? stampSettings.color,
                fontSize:    parseInt(g('stampFontSize')?.value)     || stampSettings.fontSize,
                opacity:     parseFloat(g('stampOpacity')?.value)    || stampSettings.opacity,
                rotation:    parseInt(g('stampRotationNum')?.value
                             ?? g('stampRotation')?.value)           || stampSettings.rotation,
                bold:        g('stampBold')?.checked         ?? stampSettings.bold,
                italic:      g('stampItalic')?.checked       ?? stampSettings.italic,
                border:      g('stampBorder')?.checked       ?? stampSettings.border,
                borderWidth: stampSettings.borderWidth,
                fontFamily:  stampSettings.fontFamily,
                positionX:   parseInt(g('stampPosX')?.value)         || stampSettings.positionX,
                positionY:   parseInt(g('stampPosY')?.value)         || stampSettings.positionY,
                applyPages:  stampSettings.applyPages,
                pageRange:   g('stampPageRange')?.value      ?? stampSettings.pageRange,
            };
        }
        pageOverrides[pageNum] = snapshot;
    }

    // Load a settings object into the UI controls.
    // Pass null to reload global settings.
    function loadSettingsIntoUI(ovr) {
        const g = id => document.getElementById(id);
        if (stampMode === 'simple') {
            const s = ovr || stampSettings;
            if (g('stampText'))        g('stampText').value        = s.text        ?? stampSettings.text;
            if (g('stampColor'))       g('stampColor').value       = s.color       ?? stampSettings.color;
            if (g('stampFontSize'))    g('stampFontSize').value    = s.fontSize    ?? stampSettings.fontSize;
            if (g('stampOpacity'))   { g('stampOpacity').value     = s.opacity     ?? stampSettings.opacity;
                                       const opV = g('stampOpacityVal');
                                       if (opV) opV.textContent = Math.round((s.opacity ?? stampSettings.opacity) * 100) + '%'; }
            if (g('stampRotation'))    g('stampRotation').value    = s.rotation    ?? stampSettings.rotation;
            if (g('stampRotationNum')) g('stampRotationNum').value = s.rotation    ?? stampSettings.rotation;
            if (g('stampBold'))        g('stampBold').checked      = s.bold        ?? stampSettings.bold;
            if (g('stampItalic'))      g('stampItalic').checked    = s.italic      ?? stampSettings.italic;
            if (g('stampBorder'))      g('stampBorder').checked    = s.border      ?? stampSettings.border;
            if (g('stampPosX'))      { g('stampPosX').value        = s.positionX   ?? stampSettings.positionX;
                                       const xv = g('stampPosXVal'); if (xv) xv.textContent = (s.positionX ?? stampSettings.positionX) + '%'; }
            if (g('stampPosY'))      { g('stampPosY').value        = s.positionY   ?? stampSettings.positionY;
                                       const yv = g('stampPosYVal'); if (yv) yv.textContent = (s.positionY ?? stampSettings.positionY) + '%'; }
        } else if (stampMode === 'formatted') {
            const s = ovr || fmtSettings;
            if (g('fmtColor'))       g('fmtColor').value       = s.color       ?? fmtSettings.color;
            if (g('fmtOpacity'))   { g('fmtOpacity').value     = s.opacity     ?? fmtSettings.opacity;
                                     const opV = g('fmtOpacityVal');
                                     if (opV) opV.textContent = Math.round((s.opacity ?? fmtSettings.opacity) * 100) + '%'; }
            if (g('fmtScale'))     { g('fmtScale').value       = s.scale       ?? fmtSettings.scale;
                                     const sn = g('fmtScaleNum');
                                     if (sn) sn.value = Math.round((s.scale ?? fmtSettings.scale) * 100); }
            if (g('fmtPosX'))      { g('fmtPosX').value        = s.positionX   ?? fmtSettings.positionX;
                                     const xv = g('fmtPosXVal'); if (xv) xv.textContent = (s.positionX ?? fmtSettings.positionX) + '%'; }
            if (g('fmtPosY'))      { g('fmtPosY').value        = s.positionY   ?? fmtSettings.positionY;
                                     const yv = g('fmtPosYVal'); if (yv) yv.textContent = (s.positionY ?? fmtSettings.positionY) + '%'; }
        } else if (stampMode === 'seal') {
            const s = ovr || sealSettings;
            if (g('sealColor'))      g('sealColor').value       = s.color       ?? sealSettings.color;
            if (g('sealOpacity'))  { g('sealOpacity').value     = s.opacity     ?? sealSettings.opacity;
                                     const opV = g('sealOpacityVal');
                                     if (opV) opV.textContent = Math.round((s.opacity ?? sealSettings.opacity) * 100) + '%'; }
            if (g('sealScale'))    { g('sealScale').value       = s.scale       ?? sealSettings.scale;
                                     const sn = g('sealScaleNum');
                                     if (sn) sn.value = Math.round((s.scale ?? sealSettings.scale) * 100); }
            if (g('sealPosX'))     { g('sealPosX').value        = s.positionX   ?? sealSettings.positionX;
                                     const xv = g('sealPosXVal'); if (xv) xv.textContent = (s.positionX ?? sealSettings.positionX) + '%'; }
            if (g('sealPosY'))     { g('sealPosY').value        = s.positionY   ?? sealSettings.positionY;
                                     const yv = g('sealPosYVal'); if (yv) yv.textContent = (s.positionY ?? sealSettings.positionY) + '%'; }
        } else if (stampMode === 'received') {
            const s = ovr || recvSettings;
            if (g('recvSchoolName'))     g('recvSchoolName').value     = s.schoolName     ?? recvSettings.schoolName;
            if (g('recvOfficeName'))     g('recvOfficeName').value     = s.officeName     ?? recvSettings.officeName;
            if (g('recvStampType'))      g('recvStampType').value      = s.stampType      ?? recvSettings.stampType;
            if (g('recvPersonnelName'))  g('recvPersonnelName').value  = s.personnelName  ?? recvSettings.personnelName;
            if (g('recvPersonnelDesig')) g('recvPersonnelDesig').value = s.personnelDesig ?? recvSettings.personnelDesig;
            if (g('recvColor'))          g('recvColor').value          = s.color          ?? recvSettings.color;
            if (g('recvOpacity'))      { g('recvOpacity').value        = s.opacity        ?? recvSettings.opacity;
                                         const opV = g('recvOpacityVal');
                                         if (opV) opV.textContent = Math.round((s.opacity ?? recvSettings.opacity) * 100) + '%'; }
            if (g('recvScale'))        { g('recvScale').value          = s.scale          ?? recvSettings.scale;
                                         const sn = g('recvScaleNum');
                                         if (sn) sn.value = Math.round((s.scale ?? recvSettings.scale) * 100); }
            if (g('recvPosX'))         { g('recvPosX').value           = s.positionX      ?? recvSettings.positionX;
                                         const xv = g('recvPosXVal'); if (xv) xv.textContent = (s.positionX ?? recvSettings.positionX) + '%'; }
            if (g('recvPosY'))         { g('recvPosY').value           = s.positionY      ?? recvSettings.positionY;
                                         const yv = g('recvPosYVal'); if (yv) yv.textContent = (s.positionY ?? recvSettings.positionY) + '%'; }
        }
    }

    window.openPrintStampOnly = function () {
        const existing = document.getElementById('printStampOnlyModal');
        if (existing) existing.remove();

        const sizeOptions = Object.entries(PAGE_SIZES)
            .map(([k, v]) => `<option value="${k}" ${k === stampOnlyLastSize ? 'selected' : ''}>${v.label}</option>`).join('');

        const modal = document.createElement('div');
        modal.id = 'printStampOnlyModal';
        modal.style.cssText = `
            position:fixed;inset:0;z-index:9999;
            background:rgba(0,0,0,0.55);
            display:flex;align-items:center;justify-content:center;
            padding:16px;
        `;
        modal.innerHTML = `
          <div style="
            background:var(--bg-secondary);
            border:1px solid var(--border-color);
            border-radius:12px;
            padding:0;
            width:min(900px,99vw);
            max-height:92vh;
            box-shadow:var(--shadow-md);
            display:flex;flex-direction:column;
            overflow:hidden;
          ">
            <!-- Header -->
            <div style="padding:18px 24px 14px;border-bottom:1px solid var(--border-color);flex-shrink:0">
              <div style="font-size:16px;font-weight:700;color:var(--text-primary)"><i class="fa fa-print"></i> Print Stamp Only</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">
                Prints the stamp on a blank page — use this to stamp an already-printed document.
              </div>
            </div>

            <!-- Body: left settings + right preview -->
            <div style="display:flex;flex:1;min-height:0;overflow:hidden">

              <!-- LEFT: Settings -->
              <div style="
                flex:0 0 500px;
                display:flex;flex-direction:column;gap:14px;
                padding:18px 20px;
                overflow-y:auto;
                border-right:1px solid var(--border-color);
              ">
                <div style="display:flex;flex-direction:column;gap:8px">
                  <label style="font-size:12px;font-weight:600;color:var(--text-secondary)">Paper Size</label>
                  <select id="psoPageSize" class="stamp-input" style="width:100%">
                    ${sizeOptions}
                  </select>
                  <div style="font-size:11px;color:var(--text-secondary);line-height:1.45">
                    The printed PDF is created at this exact size. If Chrome still shows a different printer paper size, select the matching paper in the print dialog.
                  </div>
                </div>

                <div style="display:flex;flex-direction:column;gap:8px">
                  <label style="font-size:12px;font-weight:600;color:var(--text-secondary)">Orientation</label>
                  <div style="display:flex;gap:8px">
                    <label class="stamp-check" style="flex:1;padding:8px;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;">
                      <input type="radio" name="psoOrient" value="portrait" checked> Portrait
                    </label>
                    <label class="stamp-check" style="flex:1;padding:8px;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;">
                      <input type="radio" name="psoOrient" value="landscape"> Landscape
                    </label>
                  </div>
                </div>

                <!-- Paper feed guide -->
                <div id="psoFeedGuide" style="
                    background:var(--bg-tertiary);
                    border:1px solid var(--border-color);
                    border-radius:8px;
                    padding:12px 14px;
                    display:flex;flex-direction:column;gap:8px;
                ">
                  <div style="font-size:12px;font-weight:700;color:var(--text-primary)" id="psoFeedTitle">Portrait — How to Feed the Paper</div>
                  <div id="psoFeedSvg" style="width:100%;overflow-x:auto"></div>
                  <div style="font-size:11px;color:var(--text-secondary);line-height:1.6" id="psoFeedDesc"></div>
                </div>

                <div style="display:flex;flex-direction:column;gap:8px">
                  <label style="font-size:12px;font-weight:600;color:var(--text-secondary)">Copies to print</label>
                  <input type="number" id="psoCopies" class="stamp-input" value="1" min="1" max="99" style="width:80px">
                  <div style="font-size:11px;color:var(--text-secondary)">Prints this same stamp page multiple times.</div>
                </div>
              </div>

              <!-- RIGHT: Live preview -->
              <div style="
                flex:1;min-width:0;
                display:flex;flex-direction:column;
                background:#6b7280;
                position:relative;
              ">
                <div style="
                  font-size:11px;font-weight:600;
                  color:rgba(255,255,255,0.7);
                  padding:8px 12px;
                  background:rgba(0,0,0,0.25);
                  letter-spacing:0.4px;
                  flex-shrink:0;
                ">PREVIEW — updates as you adjust stamp settings</div>
                <div style="
                  flex:1;min-height:0;
                  overflow:auto;
                  display:flex;align-items:center;justify-content:center;
                  padding:16px;
                " id="psoPreviewScroll">
                  <div style="position:relative;display:inline-block;line-height:0;box-shadow:0 4px 24px rgba(0,0,0,0.4)">
                    <canvas id="psoBaseCanvas"></canvas>
                    <canvas id="psoOverlayCanvas" style="position:absolute;top:0;left:0"></canvas>
                  </div>
                </div>
              </div>

            </div>

            <!-- Footer buttons -->
            <div style="
              padding:14px 20px;
              border-top:1px solid var(--border-color);
              display:flex;gap:8px;
              flex-shrink:0;
            ">
              <button onclick="executePrintStampOnly()" class="btn btn-primary" style="flex:1;justify-content:center;"><i class="fa fa-print"></i> Print</button>
              <button onclick="document.getElementById('printStampOnlyModal').remove()" class="btn" style="flex:1;background:var(--bg-tertiary);border:1px solid var(--border-color);color:var(--text-primary);justify-content:center;">Cancel</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        // Restore orientation from toolbar
        const toolbarOrient = document.getElementById('stampOnlyOrient')?.value || 'portrait';
        const radioToCheck  = modal.querySelector(`input[name="psoOrient"][value="${toolbarOrient}"]`);
        if (radioToCheck) radioToCheck.checked = true;

        // Draw initial feed guide and preview
        updateFeedGuide(toolbarOrient);
        renderPsoPreview();

        // Orientation change → update toolbar, main preview, feed guide, modal preview
        modal.querySelectorAll('input[name="psoOrient"]').forEach(radio => {
            radio.addEventListener('change', function () {
                const orientSel = document.getElementById('stampOnlyOrient');
                if (orientSel) {
                    orientSel.value = this.value;
                    stampOnlyOrientChange();
                }
                updateFeedGuide(this.value);
                renderPsoPreview();
            });
        });

        // Paper size change → save as last used, update main + modal preview
        const pageSizeSelect = modal.querySelector('#psoPageSize');
        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', function () {
                stampOnlyLastSize = this.value;  // remember for next open
                renderStampOnlyPreview();
                renderPsoPreview();
            });
        }

        // Close on backdrop click
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });
    };

    // ─── Render the modal's own preview canvas ────────────────────────────────
    function renderPsoPreview() {
        const sizeKey = document.getElementById('psoPageSize')?.value || stampOnlyLastSize;
        const orient  = document.querySelector('input[name="psoOrient"]:checked')?.value || 'portrait';
        const size    = PAGE_SIZES[sizeKey] || PAGE_SIZES['A4'];

        let ptW = size.w, ptH = size.h;
        if (orient === 'landscape') { [ptW, ptH] = [ptH, ptW]; }

        // Scale to fit within the preview area (max ~340px on the short side)
        const maxDim = 340;
        const fitScale = Math.min(maxDim / ptW, maxDim / ptH, 0.6);
        const cW = Math.round(ptW * fitScale);
        const cH = Math.round(ptH * fitScale);

        const base = document.getElementById('psoBaseCanvas');
        const over = document.getElementById('psoOverlayCanvas');
        if (!base || !over) return;

        base.width  = over.width  = cW;
        base.height = over.height = cH;

        // White background + border
        const bCtx = base.getContext('2d');
        bCtx.fillStyle = '#ffffff';
        bCtx.fillRect(0, 0, cW, cH);
        bCtx.strokeStyle = '#cbd5e1';
        bCtx.lineWidth = 1.5;
        bCtx.strokeRect(1, 1, cW - 2, cH - 2);

        // Draw stamp overlay — reuse existing draw logic at the modal's scale
        drawStampOverlayOnCanvas(over, cW, cH);
    }

    // Draw the stamp onto any canvas at any size (used by both main preview and modal preview)
    function drawStampOverlayOnCanvas(canvas, w, h) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        const now = new Date();
        if (stampMode === 'formatted') {
            readFmtSettings();
            drawFormattedStamp(ctx, w, h, fmtSettings, now);
        } else if (stampMode === 'seal') {
            readSealSettings();
            drawCircularSeal(ctx, w, h, sealSettings, now);
        } else if (stampMode === 'received') {
            readRecvSettings();
            drawReceivedStamp(ctx, w, h, recvSettings, now);
        } else {
            readStampSettings();
            const ratio = w / 595;
            drawSimpleStamp(ctx, w, h, Object.assign({}, stampSettings, {
                fontSize:    stampSettings.fontSize    * ratio,
                borderWidth: stampSettings.borderWidth * ratio
            }));
        }
    }

    // ─── Paper feed guide diagram ─────────────────────────────────────────────
    // Based on the actual printer behavior:
    // 1. Original doc printed face-down → bottom of page exits first
    // 2. You flip the paper to re-feed
    // 3. Feed it face-up with BOTTOM edge going in first (because the flip
    //    means what was the top is now at the back)
    // 4. Stamp prints on the correct position on the output
    function updateFeedGuide(orient) {
        const svgEl   = document.getElementById('psoFeedSvg');
        const titleEl = document.getElementById('psoFeedTitle');
        const descEl  = document.getElementById('psoFeedDesc');
        if (!svgEl || !titleEl || !descEl) return;

        if (orient === 'portrait') {
            titleEl.textContent = 'Portrait — How to Feed the Paper';
            // Flow: printed doc (face-down, bottom first) → flip → feed face-up bottom first → output
            svgEl.innerHTML = `
<svg width="100%" viewBox="0 0 380 130" xmlns="http://www.w3.org/2000/svg"
     style="font-family:Arial,sans-serif;max-width:380px;display:block;margin:0 auto">

  <!-- STEP 1: Printed document comes out -->
  <text x="30" y="12" font-size="8" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">① Printed doc</text>
  <text x="30" y="21" font-size="7" fill="var(--text-secondary)" text-anchor="middle">(face-down)</text>
  <rect x="6" y="26" width="48" height="62" rx="3" fill="white" stroke="var(--accent-color)" stroke-width="1.5"/>
  <!-- wavy lines = text content -->
  <path d="M12 38 Q20 35 28 38 Q36 41 44 38" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M12 48 Q20 45 28 48 Q36 51 44 48" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M12 58 Q20 55 28 58 Q36 61 44 58" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <!-- Stamp position (bottom-right after flip = was top-right in preview) -->
  <circle cx="42" cy="76" r="6" fill="var(--accent-color)" opacity="0.35" stroke="var(--accent-color)" stroke-width="1.5"/>
  <text x="42" y="79" font-size="6" font-weight="700" fill="var(--accent-color)" text-anchor="middle">M</text>
  <text x="30" y="97" font-size="7" fill="var(--text-secondary)" text-anchor="middle">TOP</text>
  <line x1="6" x2="54" y1="93" y2="93" stroke="var(--border-color)" stroke-width="1" stroke-dasharray="2,2"/>
  <text x="30" y="107" font-size="7" fill="var(--text-secondary)" text-anchor="middle">BOTTOM</text>

  <!-- Arrow 1 -->
  <path d="M62 57 L78 57" stroke="var(--text-secondary)" stroke-width="1.5" fill="none"/>
  <path d="M75 53 L80 57 L75 61" fill="var(--text-secondary)"/>
  <text x="70" y="52" font-size="7" fill="var(--text-secondary)" text-anchor="middle">flip</text>
  <text x="70" y="44" font-size="7" fill="var(--text-secondary)" text-anchor="middle">↕</text>

  <!-- STEP 2: After flip — now face-up, stamp is at top-right, bottom edge first -->
  <text x="115" y="12" font-size="8" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">② After flip</text>
  <text x="115" y="21" font-size="7" fill="var(--text-secondary)" text-anchor="middle">(face-up)</text>
  <rect x="91" y="26" width="48" height="62" rx="3" fill="white" stroke="#22c55e" stroke-width="1.5"/>
  <path d="M97 38 Q105 35 113 38 Q121 41 129 38" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M97 48 Q105 45 113 48 Q121 51 129 48" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M97 58 Q105 55 113 58 Q121 61 129 58" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <!-- Stamp now at top-right after vertical flip -->
  <circle cx="127" cy="36" r="6" fill="var(--accent-color)" opacity="0.35" stroke="var(--accent-color)" stroke-width="1.5"/>
  <text x="127" y="39" font-size="6" font-weight="700" fill="var(--accent-color)" text-anchor="middle">M</text>
  <text x="115" y="97" font-size="7" fill="#22c55e" font-weight="700" text-anchor="middle">BOTTOM → in</text>
  <line x1="91" x2="139" y1="93" y2="93" stroke="#22c55e" stroke-width="1.5"/>
  <text x="115" y="107" font-size="7" fill="var(--text-secondary)" text-anchor="middle">TOP (back)</text>

  <!-- Arrow 2 -->
  <path d="M147 57 L163 57" stroke="var(--text-secondary)" stroke-width="1.5" fill="none"/>
  <path d="M160 53 L165 57 L160 61" fill="var(--text-secondary)"/>
  <text x="155" y="52" font-size="7" fill="var(--text-secondary)" text-anchor="middle">feed</text>

  <!-- STEP 3: Feeding into printer (rotated so bottom goes in first) -->
  <text x="200" y="12" font-size="8" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">③ Feed into printer</text>
  <!-- Printer body -->
  <rect x="174" y="70" width="52" height="22" rx="4" fill="var(--bg-secondary)" stroke="var(--border-color)" stroke-width="1.5"/>
  <rect x="182" y="75" width="36" height="4" rx="2" fill="var(--border-color)"/>
  <!-- Paper above printer, bottom edge first (paper flipped — bottom now at bottom of diagram) -->
  <rect x="182" y="26" width="36" height="48" rx="2" fill="white" stroke="#22c55e" stroke-width="1.5"/>
  <path d="M188 36 Q196 33 204 36 Q212 39 218 36" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M188 46 Q196 43 204 46 Q212 49 218 46" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M188 56 Q196 53 204 56 Q212 59 218 56" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <circle cx="217" cy="32" r="5" fill="var(--accent-color)" opacity="0.35" stroke="var(--accent-color)" stroke-width="1.5"/>
  <text x="217" y="35" font-size="5" font-weight="700" fill="var(--accent-color)" text-anchor="middle">M</text>
  <!-- BOTTOM label at bottom of paper (goes in first) -->
  <line x1="182" x2="218" y1="71" y2="71" stroke="#22c55e" stroke-width="1.5"/>
  <text x="200" y="69" font-size="6" font-weight="700" fill="#22c55e" text-anchor="middle">BOTTOM first ↓</text>
  <!-- Arrow into printer -->
  <path d="M200 90 L200 100" stroke="var(--accent-color)" stroke-width="1.5" stroke-dasharray="3,2"/>
  <path d="M196 98 L200 103 L204 98" fill="var(--accent-color)"/>

  <!-- Arrow 3 -->
  <path d="M232 57 L248 57" stroke="var(--text-secondary)" stroke-width="1.5" fill="none"/>
  <path d="M245 53 L250 57 L245 61" fill="var(--text-secondary)"/>

  <!-- STEP 4: Output with stamp in correct position -->
  <text x="315" y="12" font-size="8" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">④ Output ✓</text>
  <text x="315" y="21" font-size="7" fill="#22c55e" text-anchor="middle">Stamp correct!</text>
  <rect x="291" y="26" width="48" height="62" rx="3" fill="white" stroke="#22c55e" stroke-width="2"/>
  <path d="M297 38 Q305 35 313 38 Q321 41 329 38" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M297 48 Q305 45 313 48 Q321 51 329 48" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M297 58 Q305 55 313 58 Q321 61 329 58" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <!-- Stamp at correct position (where you placed it in preview) -->
  <circle cx="332" cy="38" r="7" fill="var(--accent-color)" opacity="0.5" stroke="var(--accent-color)" stroke-width="1.5"/>
  <text x="332" y="41" font-size="7" font-weight="700" fill="white" text-anchor="middle">M</text>
  <text x="315" y="97" font-size="7" fill="var(--text-secondary)" text-anchor="middle">TOP</text>
  <text x="315" y="107" font-size="7" fill="var(--text-secondary)" text-anchor="middle">BOTTOM</text>
</svg>`;
            descEl.innerHTML =
                `<strong>Step-by-step:</strong><br>
                ① Your original document was printed <em>face-down</em>, bottom edge coming out first.<br>
                ② Flip it vertically (top-to-bottom) so it's now <em>face-up</em>. The stamp position is now at the top-right.<br>
                ③ Feed the paper into the printer <strong>face-up</strong> with the <strong>BOTTOM edge going in first</strong>.<br>
                ④ The stamp prints exactly where you placed it in the preview. ✅`;

        } else {
            titleEl.textContent = 'Landscape — How to Feed the Paper';
            svgEl.innerHTML = `
<svg width="100%" viewBox="0 0 380 140" xmlns="http://www.w3.org/2000/svg"
     style="font-family:Arial,sans-serif;max-width:380px;display:block;margin:0 auto">

  <!-- STEP 1: Printed landscape doc face-down -->
  <text x="36" y="12" font-size="8" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">① Printed doc</text>
  <text x="36" y="21" font-size="7" fill="var(--text-secondary)" text-anchor="middle">(face-down)</text>
  <rect x="4" y="28" width="64" height="44" rx="3" fill="white" stroke="var(--accent-color)" stroke-width="1.5"/>
  <path d="M10 40 Q22 37 34 40 Q46 43 58 40" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M10 50 Q22 47 34 50 Q46 53 58 50" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M10 60 Q22 57 34 60 Q46 63 58 60" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <circle cx="60" cy="40" r="6" fill="var(--accent-color)" opacity="0.35" stroke="var(--accent-color)" stroke-width="1.5"/>
  <text x="60" y="43" font-size="6" font-weight="700" fill="var(--accent-color)" text-anchor="middle">M</text>
  <text x="36" y="83" font-size="7" fill="var(--text-secondary)" text-anchor="middle">LEFT — RIGHT</text>

  <!-- Arrow 1 — rotate CCW -->
  <path d="M76 50 L90 50" stroke="var(--text-secondary)" stroke-width="1.5" fill="none"/>
  <path d="M87 46 L92 50 L87 54" fill="var(--text-secondary)"/>
  <text x="83" y="45" font-size="7" fill="var(--text-secondary)" text-anchor="middle">↺ CCW</text>

  <!-- STEP 2: After 90° CCW rotation — now portrait, face-up -->
  <text x="122" y="12" font-size="8" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">② Rotate 90° CCW</text>
  <text x="122" y="21" font-size="7" fill="var(--text-secondary)" text-anchor="middle">(face-up, portrait)</text>
  <rect x="98" y="18" width="48" height="66" rx="3" fill="white" stroke="#22c55e" stroke-width="1.5"/>
  <path d="M104 30 Q112 27 120 30 Q128 33 136 30" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M104 42 Q112 39 120 42 Q128 45 136 42" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M104 54 Q112 51 120 54 Q128 57 136 54" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <circle cx="136" cy="72" r="6" fill="var(--accent-color)" opacity="0.35" stroke="var(--accent-color)" stroke-width="1.5"/>
  <text x="136" y="75" font-size="6" font-weight="700" fill="var(--accent-color)" text-anchor="middle">M</text>
  <line x1="98" x2="146" y1="84" y2="84" stroke="#22c55e" stroke-width="1.5"/>
  <text x="122" y="94" font-size="7" fill="#22c55e" font-weight="700" text-anchor="middle">BOTTOM → in first</text>

  <!-- Arrow 2 -->
  <path d="M155 50 L169 50" stroke="var(--text-secondary)" stroke-width="1.5" fill="none"/>
  <path d="M166 46 L171 50 L166 54" fill="var(--text-secondary)"/>
  <text x="162" y="45" font-size="7" fill="var(--text-secondary)" text-anchor="middle">feed</text>

  <!-- STEP 3: Feed portrait into printer — BOTTOM edge first -->
  <text x="210" y="12" font-size="8" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">③ Feed into printer</text>
  <rect x="178" y="60" width="64" height="22" rx="4" fill="var(--bg-secondary)" stroke="var(--border-color)" stroke-width="1.5"/>
  <rect x="186" y="65" width="48" height="4" rx="2" fill="var(--border-color)"/>
  <text x="210" y="75" font-size="6" fill="var(--text-secondary)" text-anchor="middle">PRINTER</text>
  <rect x="186" y="16" width="48" height="46" rx="2" fill="white" stroke="#22c55e" stroke-width="1.5"/>
  <path d="M192 26 Q200 23 208 26 Q216 29 224 26" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M192 36 Q200 33 208 36 Q216 39 224 36" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M192 46 Q200 43 208 46 Q216 49 224 46" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <circle cx="224" cy="54" r="5" fill="var(--accent-color)" opacity="0.35" stroke="var(--accent-color)" stroke-width="1.5"/>
  <text x="224" y="57" font-size="5" font-weight="700" fill="var(--accent-color)" text-anchor="middle">M</text>
  <line x1="186" x2="234" y1="62" y2="62" stroke="#22c55e" stroke-width="1.5"/>
  <text x="210" y="60" font-size="6" font-weight="700" fill="#22c55e" text-anchor="middle">BOTTOM ↓</text>
  <path d="M210 82 L210 90" stroke="var(--accent-color)" stroke-width="1.5" stroke-dasharray="3,2"/>
  <path d="M206 88 L210 93 L214 88" fill="var(--accent-color)"/>

  <!-- Arrow 3 -->
  <path d="M246 50 L260 50" stroke="var(--text-secondary)" stroke-width="1.5" fill="none"/>
  <path d="M257 46 L262 50 L257 54" fill="var(--text-secondary)"/>

  <!-- STEP 4: Output — landscape, stamp correct -->
  <text x="316" y="12" font-size="8" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">④ Output ✓</text>
  <text x="316" y="21" font-size="7" fill="#22c55e" text-anchor="middle">Stamp correct!</text>
  <rect x="284" y="28" width="64" height="44" rx="3" fill="white" stroke="#22c55e" stroke-width="2"/>
  <path d="M290 40 Q302 37 314 40 Q326 43 338 40" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M290 50 Q302 47 314 50 Q326 53 338 50" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <path d="M290 60 Q302 57 314 60 Q326 63 338 60" stroke="var(--border-color)" stroke-width="1.5" fill="none"/>
  <circle cx="340" cy="40" r="7" fill="var(--accent-color)" opacity="0.5" stroke="var(--accent-color)" stroke-width="1.5"/>
  <text x="340" y="43" font-size="7" font-weight="700" fill="white" text-anchor="middle">M</text>
  <text x="316" y="82" font-size="7" fill="var(--text-secondary)" text-anchor="middle">LEFT — RIGHT</text>
</svg>`;
            descEl.innerHTML =
                `<strong>Step-by-step (Landscape):</strong><br>
                ① Your original document was printed <em>face-down</em> in landscape.<br>
                ② <strong>Rotate it 90° counter-clockwise</strong> — it becomes portrait-shaped, now face-up.<br>
                ③ Feed <strong>face-up</strong> into the printer with the <strong>BOTTOM edge going in first</strong>.<br>
                ④ The stamp prints exactly where you placed it in the preview. ✅`;
        }
    }

    function getPrintHelperPaperSize(sizeKey) {
        const paperSizes = {
            A4: 'A4 210 x 297 mm',
            Photo4x6: '10 x 15 cm (4 x 6 in)',
            Photo5x7: '13 x 18 cm (5 x 7 in)',
            A6: 'A6 105 x 148 mm',
            A5: 'A5 148 x 210 mm',
            B5: 'B5 182 x 257 mm',
            B6: 'B6 128 x 182 mm',
            Photo3_5x5: '9 x 13 cm (3.5 x 5 in)',
            Photo5x8: '5 x 8 in (127 x 203 mm)',
            Photo8x10: '20 x 25 cm (8 x 10 in)',
            Wide16x9: '16:9 wide (4 x 7.11 in)',
            Postcard100x148: '100 x 148 mm',
            Envelope10: 'Envelope #10 105 x 241 mm',
            EnvelopeDL: 'Envelope DL 110 x 220 mm',
            EnvelopeC6: 'Envelope C6 114 x 162 mm',
            Letter: 'Letter 8.5 x 11 in (216 x 279 mm)',
            Long: '8.5 x 13 in',
            IndianLegal: 'Indian-Legal 215 x 345 mm',
            Legal: 'Legal 8.5 x 14 in (216 x 356 mm)',
            SixteenK: '16K 195 x 270 mm',
            Short: '8.5 x 13 in'
        };
        return paperSizes[sizeKey] || sizeKey || 'A4';
    }

    async function printPdfWithLocalHelper(pdfBase64, options) {
        const response = await fetch('http://127.0.0.1:9100/print', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBase64, options })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) {
            const message = result.error || `Print helper returned HTTP ${response.status}`;
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return result;
    }

    function printPdfInBrowser(pdfBlob) {
        const blobUrl = URL.createObjectURL(pdfBlob);

        const old = document.getElementById('stampPrintFrame');
        if (old) old.remove();

        const iframe = document.createElement('iframe');
        iframe.id = 'stampPrintFrame';
        iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:-1;opacity:0;';
        iframe.src = blobUrl;
        document.body.appendChild(iframe);

        iframe.onload = function () {
            setTimeout(function () {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
                setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
            }, 500);
        };
    }

    const STAMPED_HELPER_PAGE_LIMIT = 150;

    function downloadAndBrowserPrintStampedPdf(job, reason) {
        const filename = typeof getStampedFilename === 'function' ? getStampedFilename() : 'stamped.pdf';
        const rawBase64 = String(job.b64 || '').replace(/^data:application\/pdf;base64,/, '');
        if (rawBase64) downloadFile(rawBase64, filename);
        printPdfInBrowser(job.blob);
        showNotification(`${reason} Downloaded the stamped PDF and opened browser print instead.`, 'warning');
    }

    async function fetchLocalPrintPrinters() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch('http://127.0.0.1:9100/printers', { signal: controller.signal });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.ok === false) {
                throw new Error(result.error || `Print helper returned HTTP ${response.status}`);
            }
            return result;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    function getPrintHelperErrorMessage(error) {
        if (error.status === 413 || /too large|maximum request size/i.test(error.message || '')) {
            return `${error.message} Try printing a smaller page range, or restart the helper after raising PDF_PRINT_HELPER_MAX_BODY_MB.`;
        }
        return error.name === 'AbortError' || error.message === 'Failed to fetch'
            ? 'Local print helper is not running. Start it with npm run print-helper.'
            : (error.message || 'Local print helper could not print');
    }

    function getStampedPrintPaperOptions() {
        return Object.entries(PAGE_SIZES)
            .map(([key, size]) => `<option value="${key}">${size.label}</option>`)
            .join('');
    }

    function inferStampedPrintPaperKey() {
        if (stampPdfPaperSize && stampPdfPaperSize !== 'original' && PAGE_SIZES[stampPdfPaperSize]) {
            return stampPdfPaperSize;
        }

        const doc = stampDocuments[activeStampDocIndex];
        const pageInfo = doc?.pageSizes?.[stampPreviewPage] || doc?.pageSizes?.[1];
        if (!pageInfo) return 'Letter';

        const width = pageInfo.width || pageInfo.w || 0;
        const height = pageInfo.height || pageInfo.h || 0;
        const shortSide = Math.min(width, height);
        const longSide = Math.max(width, height);
        let bestKey = 'Letter';
        let bestDelta = Number.POSITIVE_INFINITY;

        Object.entries(PAGE_SIZES).forEach(([key, size]) => {
            const delta = Math.abs(Math.min(size.w, size.h) - shortSide) + Math.abs(Math.max(size.w, size.h) - longSide);
            if (delta < bestDelta) {
                bestDelta = delta;
                bestKey = key;
            }
        });

        return bestDelta <= 36 ? bestKey : 'Letter';
    }

    function closeStampedPdfPrintModal() {
        const modal = document.getElementById('stampedPdfPrintModal');
        if (!modal) return;
        modal.remove();
    }

    function getStampedPdfModalPageRange(modal) {
        const mode = modal.querySelector('input[name="stampedPrintRange"]:checked')?.value || 'all';
        if (mode === 'all') return '';
        if (mode === 'current') return String(stampPreviewPage);
        return (modal.querySelector('#stampedPrintPages')?.value || '').trim();
    }

    function getStampedPdfModalPreviewPages(modal) {
        const total = stampTotalPages || 1;
        const range = getStampedPdfModalPageRange(modal);
        let pages = range ? parsePageRange(range, total) : Array.from({ length: total }, (_, i) => i + 1);
        const subset = modal.querySelector('#stampedPrintSubset')?.value;
        if (subset === 'odd') pages = pages.filter(page => page % 2 === 1);
        if (subset === 'even') pages = pages.filter(page => page % 2 === 0);
        return pages.length ? pages : [Math.min(Math.max(1, stampPreviewPage || 1), total)];
    }

    function updateStampedPdfModalChoiceStyles(modal) {
        modal.querySelectorAll('[data-print-choice]').forEach(label => {
            const input = label.querySelector('input');
            const checked = input?.checked;
            label.style.color = checked ? '#ffffff' : '#a9adb5';
            label.style.fontWeight = checked ? '700' : '400';
            label.style.background = 'transparent';
            label.style.borderColor = 'transparent';
        });
    }

    function scheduleStampedPdfModalPreview(modal, resetIndex = false) {
        if (!modal) return;
        if (resetIndex) modal._previewIndex = 0;
        const stage = modal.querySelector('#stampedPrintPreviewStage');
        if (stage) {
            stage.innerHTML = `
                <div style="display:grid;gap:10px;justify-items:center;color:#d9dde5;">
                    <div style="width:28px;height:28px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:stampPrintSpin .8s linear infinite;"></div>
                    <div>Applying settings...</div>
                </div>`;
        }
        clearTimeout(modal._previewTimer);
        modal._previewTimer = setTimeout(() => renderStampedPdfModalPreview(modal), 80);
    }

    async function getStampedPdfModalDoc(modal) {
        if (modal._previewDoc) return modal._previewDoc;
        const job = modal._printJob;
        const bytes = job?.bytes || Uint8Array.from(atob(job.b64), c => c.charCodeAt(0));
        modal._previewDoc = await pdfjsLib.getDocument({ data: bytes.slice ? bytes.slice() : bytes }).promise;
        return modal._previewDoc;
    }

    function getStampedPdfModalPaper(modal) {
        const paperKey = modal.querySelector('#stampedPrintPaperSize')?.value || inferStampedPrintPaperKey();
        const paper = PAGE_SIZES[paperKey] || PAGE_SIZES.Letter;
        let paperW = paper.w;
        let paperH = paper.h;
        const orientation = modal.querySelector('input[name="stampedPrintOrientation"]:checked')?.value || 'portrait';
        if ((orientation === 'landscape' && paperW < paperH) || (orientation === 'portrait' && paperW > paperH)) {
            [paperW, paperH] = [paperH, paperW];
        }
        return { paperKey, paperW, paperH, orientation };
    }

    async function buildStampedPdfModalPrintPdf(modal) {
        const pdfDoc = await getStampedPdfModalDoc(modal);
        const pages = getStampedPdfModalPreviewPages(modal);
        const { paperW, paperH } = getStampedPdfModalPaper(modal);
        const scaleMode = modal.querySelector('input[name="stampedPrintScale"]:checked')?.value || 'fit';
        const zoom = Math.max(10, Math.min(400, parseInt(modal.querySelector('#stampedPrintZoom')?.value, 10) || 100));
        const shouldGrayscale = modal.querySelector('#stampedPrintGrayscale')?.checked === true;
        const renderScale = pages.length > 150 ? 1.05 : (pages.length > 60 ? 1.25 : 1.75);
        const printJpegQuality = pages.length > 150 ? 0.78 : (pages.length > 60 ? 0.84 : 0.92);
        const pdfPages = [];

        for (let i = 0; i < pages.length; i++) {
            const pageNum = pages[i];
            updateProgress((i / Math.max(1, pages.length)) * 82, `Preparing page ${i + 1}/${pages.length}`);

            const page = await pdfDoc.getPage(pageNum);
            const source = page.getViewport({ scale: 1 });
            let pagePointScale = Math.min((paperW * 0.96) / source.width, (paperH * 0.96) / source.height);
            if (scaleMode === 'noscale') pagePointScale = 1;
            if (scaleMode === 'shrink') pagePointScale = zoom / 100;

            const viewport = page.getViewport({ scale: pagePointScale * renderScale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(paperW * renderScale);
            canvas.height = Math.ceil(paperH * renderScale);

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const offsetX = Math.round((canvas.width - viewport.width) / 2);
            const offsetY = Math.round((canvas.height - viewport.height) / 2);
            await page.render({
                canvasContext: ctx,
                viewport,
                transform: [1, 0, 0, 1, offsetX, offsetY]
            }).promise;

            if (shouldGrayscale) applyGrayscaleToCanvas(canvas);

            pdfPages.push({
                dataUrl: canvas.toDataURL('image/jpeg', printJpegQuality),
                canvasW: canvas.width,
                canvasH: canvas.height,
                ptW: paperW,
                ptH: paperH
            });
        }

        updateProgress(90, 'Building print PDF...');
        await new Promise(resolve => setTimeout(resolve, 20));
        return uint8ToBase64(buildPDFFromImages(pdfPages));
    }

    async function renderStampedPdfModalPreview(modal) {
        const stage = modal.querySelector('#stampedPrintPreviewStage');
        const countEl = modal.querySelector('#stampedPrintPreviewCount');
        const prevBtn = modal.querySelector('#stampedPrintPreviewPrev');
        const nextBtn = modal.querySelector('#stampedPrintPreviewNext');
        if (!stage) return;

        updateStampedPdfModalChoiceStyles(modal);
        const pages = getStampedPdfModalPreviewPages(modal);
        modal._previewPages = pages;
        modal._previewIndex = Math.min(Math.max(0, modal._previewIndex || 0), pages.length - 1);
        const pageNum = pages[modal._previewIndex];
        if (countEl) countEl.textContent = `${modal._previewIndex + 1}/${pages.length}`;
        if (prevBtn) prevBtn.disabled = modal._previewIndex <= 0;
        if (nextBtn) nextBtn.disabled = modal._previewIndex >= pages.length - 1;

        stage.innerHTML = `
            <div style="display:grid;gap:10px;justify-items:center;color:#d9dde5;">
                <div style="width:28px;height:28px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:stampPrintSpin .8s linear infinite;"></div>
                <div>Rendering preview...</div>
            </div>`;

        try {
            const pdfDoc = await getStampedPdfModalDoc(modal);
            const page = await pdfDoc.getPage(pageNum);
            const source = page.getViewport({ scale: 1 });
            const { paperW, paperH } = getStampedPdfModalPaper(modal);

            const rect = stage.getBoundingClientRect();
            const displayScale = Math.min((rect.width - 52) / paperW, (rect.height - 82) / paperH, 1.08);
            const safeDisplayScale = Math.max(0.25, displayScale);
            const scaleMode = modal.querySelector('input[name="stampedPrintScale"]:checked')?.value || 'fit';
            const zoom = Math.max(10, Math.min(400, parseInt(modal.querySelector('#stampedPrintZoom')?.value, 10) || 100));
            let pagePointScale = Math.min((paperW * 0.96) / source.width, (paperH * 0.96) / source.height);
            if (scaleMode === 'noscale') pagePointScale = 1;
            if (scaleMode === 'shrink') pagePointScale = zoom / 100;

            const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
            const renderViewport = page.getViewport({ scale: pagePointScale * safeDisplayScale * dpr });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(renderViewport.width);
            canvas.height = Math.ceil(renderViewport.height);
            canvas.style.width = `${source.width * pagePointScale * safeDisplayScale}px`;
            canvas.style.height = `${source.height * pagePointScale * safeDisplayScale}px`;
            canvas.style.filter = modal.querySelector('#stampedPrintGrayscale')?.checked ? 'grayscale(1) contrast(1.08)' : 'none';
            canvas.style.boxShadow = '0 1px 2px rgba(0,0,0,.22)';
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;

            const sheet = document.createElement('div');
            sheet.style.cssText = `width:${paperW * safeDisplayScale}px;height:${paperH * safeDisplayScale}px;background:#fff;box-shadow:0 10px 28px rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;overflow:hidden;`;
            sheet.appendChild(canvas);
            stage.innerHTML = '';
            stage.appendChild(sheet);
        } catch (error) {
            console.error('Could not render print preview', error);
            stage.innerHTML = '<div style="color:#ffb4ab;">Preview failed to render.</div>';
        }
    }

    async function loadStampedPdfModalPrinters(modal) {
        const printerSelect = modal.querySelector('#stampedPrintPrinter');
        if (!printerSelect) return;
        printerSelect.innerHTML = '<option value="">Loading printers...</option>';

        try {
            const result = await fetchLocalPrintPrinters();
            const printers = Array.isArray(result.printers) ? result.printers : [];
            if (!printers.length) {
                printerSelect.innerHTML = '<option value="">Default printer</option>';
                return;
            }

            printerSelect.innerHTML = printers.map(printer => {
                const name = printer.name || printer.deviceId || '';
                const selected = result.defaultPrinter && name === result.defaultPrinter.name ? ' selected' : '';
                return `<option value="${String(name).replace(/"/g, '&quot;')}"${selected}>${name}</option>`;
            }).join('');
        } catch (error) {
            printerSelect.innerHTML = '<option value="">Local helper unavailable</option>';
            console.warn('Could not load local printers', error);
        }
    }

    async function openSystemPrintPreferences() {
        const modal = document.getElementById('stampedPdfPrintModal');
        const batchModal = document.getElementById('stampedPdfBatchModal');
        const printer = modal?.querySelector('#stampedPrintPrinter')?.value || '';
        const prefsBtn = batchModal?.querySelector('#stampedBatchPrefs') || modal?.querySelector('#stampedPrintPrefs');
        const prefsStatusTargets = [
            modal?.querySelector('#stampedPrintPrefsStatus'),
            batchModal?.querySelector('#stampedBatchPrefsStatus')
        ].filter(Boolean);
        const originalText = prefsBtn ? prefsBtn.innerHTML : '';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        if (prefsBtn) {
            prefsBtn.disabled = true;
            prefsBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Opening...';
        }
        prefsStatusTargets.forEach(status => {
            status.textContent = 'Opening printer preferences...';
        });
        try {
            const response = await fetch('http://127.0.0.1:9100/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ printer }),
                signal: controller.signal
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.ok === false) {
                throw new Error(result.error || `Print helper returned HTTP ${response.status}`);
            }
            modal._driverPreferencesActive = true;
            modal._driverPreferencesPending = true;
            if (batchModal) batchModal._driverPreferencesPending = true;
            const label = result.method === 'printui-properties' ? 'printer properties' : 'printing preferences';
            prefsStatusTargets.forEach(status => {
                status.innerHTML = `Using Windows ${label}. Close it, then click <button type="button" onclick="finishSystemPrintPreferences()" style="height:22px;margin-left:6px;background:#2b2b2b;color:#fff;border:1px solid #666;border-radius:3px;cursor:pointer;">Done</button>`;
            });
        } catch (error) {
            console.warn('Could not open printer preferences', error);
            prefsStatusTargets.forEach(status => {
                status.textContent = 'Could not open preferences.';
            });
            showNotification(getPrintHelperErrorMessage(error), 'warning');
        } finally {
            clearTimeout(timeoutId);
            if (prefsBtn) {
                prefsBtn.disabled = false;
                prefsBtn.innerHTML = originalText || 'Preference...';
            }
        }
    }

    window.finishSystemPrintPreferences = function () {
        const modal = document.getElementById('stampedPdfPrintModal');
        const batchModal = document.getElementById('stampedPdfBatchModal');
        if (modal) modal._driverPreferencesPending = false;
        if (batchModal) batchModal._driverPreferencesPending = false;
        [
            modal?.querySelector('#stampedPrintPrefsStatus'),
            batchModal?.querySelector('#stampedBatchPrefsStatus')
        ].filter(Boolean).forEach(status => {
            status.textContent = 'Closed. This print will use the web app settings shown here.';
        });
    };

    function closeStampedPrintPreferences() {
        document.getElementById('stampedPrintPrefsModal')?.remove();
    }

    function openStampedPrintPreferences() {
        const printModal = document.getElementById('stampedPdfPrintModal');
        if (!printModal) return;
        closeStampedPrintPreferences();

        const printerName = printModal.querySelector('#stampedPrintPrinter')?.value || 'Default Printer';
        const paperKey = printModal.querySelector('#stampedPrintPaperSize')?.value || inferStampedPrintPaperKey();
        const orient = printModal.querySelector('input[name="stampedPrintOrientation"]:checked')?.value || 'portrait';
        const copies = printModal.querySelector('#stampedPrintCopies')?.value || '1';
        const collate = printModal.querySelector('#stampedPrintCollate')?.checked;
        const grayscale = printModal.querySelector('#stampedPrintGrayscale')?.checked;
        const duplex = printModal.querySelector('#stampedPrintDuplex')?.checked;

        const prefs = document.createElement('div');
        prefs.id = 'stampedPrintPrefsModal';
        prefs.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;padding:18px;';
        prefs.innerHTML = `
            <style>
                #stampedPrintPrefsModal button { cursor:pointer; }
                #stampedPrintPrefsModal button:hover { filter:brightness(1.08); }
                #stampedPrintPrefsModal select,
                #stampedPrintPrefsModal input[type="number"] {
                    box-sizing:border-box;
                    background:#ffffff;
                    color:#111;
                    border:1px solid #aaa;
                    height:24px;
                    padding:1px 6px;
                }
            </style>
            <div style="width:570px;background:#f0f0f0;color:#111;border:1px solid #777;box-shadow:0 16px 44px rgba(0,0,0,.45);font-family:Segoe UI,Arial,sans-serif;font-size:12px;">
                <div style="height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;background:#fff;border-bottom:1px solid #c8c8c8;">
                    <div><i class="fa fa-print"></i> ${printerName || 'Printer'} Properties</div>
                    <button type="button" onclick="closeStampedPrintPreferences()" style="border:0;background:transparent;font-size:18px;line-height:1;">&times;</button>
                </div>
                <div style="display:flex;gap:2px;padding:8px 8px 0;background:#f0f0f0;">
                    <div style="padding:5px 14px;background:#fff;border:1px solid #bbb;border-bottom:0;">Main</div>
                    <div style="padding:5px 14px;border:1px solid #ccc;background:#eee;">More Options</div>
                    <div style="padding:5px 14px;border:1px solid #ccc;background:#eee;">Maintenance</div>
                </div>
                <div style="margin:0 8px 8px;padding:12px;background:#fff;border:1px solid #bbb;display:grid;grid-template-columns:210px 1fr;gap:14px;">
                    <div>
                        <div style="font-weight:700;margin-bottom:8px;">Printing Presets</div>
                        <button type="button" style="width:100%;height:24px;background:#f6f6f6;border:1px solid #bbb;border-radius:2px;margin-bottom:8px;">Add/Remove Presets...</button>
                        <div style="height:238px;border:1px solid #aaa;background:#fff;overflow:hidden;">
                            ${['Document - Fast','Document - Standard Quality','Document - High Quality','Document - 2-Up','Document - Fast Grayscale','Document - Grayscale','Form-9','forParallelDraft','A4ParallelDraft','InstrumentA-B','InstrumentC'].map((name, index) => `
                                <div style="height:20px;display:flex;align-items:center;gap:5px;padding:0 7px;${index === 1 ? 'background:#e8f0fe;' : ''}">
                                    <i class="fa fa-file-text-o" style="color:${index >= 7 ? '#d32f2f' : '#6a6a6a'};"></i>${name}
                                </div>`).join('')}
                        </div>
                        <div style="height:98px;border:1px solid #aaa;border-top:0;display:grid;grid-template-columns:1fr 1fr;align-items:center;justify-items:center;background:#fafafa;">
                            <div style="width:70px;height:80px;border:2px solid #333;background:#fff;display:flex;align-items:center;justify-content:center;">
                                <div style="width:42px;height:46px;border-top:4px solid #1683ff;border-bottom:8px solid #f5cc2f;background:linear-gradient(90deg,#1683ff 0 33%,#f44336 33% 66%,#2db84d 66%);"></div>
                            </div>
                            <div style="font-size:28px;color:#333;"><i class="fa fa-print"></i></div>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:88px 1fr;gap:9px 8px;align-content:start;">
                        <label>Document Size</label>
                        <select id="prefsPaperSize">${getStampedPrintPaperOptions()}</select>
                        <label>Orientation</label>
                        <div style="display:flex;gap:26px;align-items:center;">
                            <label><input type="radio" name="prefsOrient" value="portrait"${orient === 'portrait' ? ' checked' : ''}> Portrait</label>
                            <label><input type="radio" name="prefsOrient" value="landscape"${orient === 'landscape' ? ' checked' : ''}> Landscape</label>
                        </div>
                        <label>Paper Type</label>
                        <select><option>Plain paper</option><option>Photo Paper</option><option>Envelope</option></select>
                        <label>Quality</label>
                        <select><option>Standard</option><option>High</option><option>Draft</option></select>
                        <label>Color</label>
                        <div style="display:flex;gap:24px;align-items:center;">
                            <label><input type="radio" name="prefsColor" value="color"${!grayscale ? ' checked' : ''}> Color</label>
                            <label><input type="radio" name="prefsColor" value="grayscale"${grayscale ? ' checked' : ''}> Grayscale</label>
                        </div>
                        <label>2-Sided Printing</label>
                        <select id="prefsDuplex"><option value="off">Off</option><option value="duplex">On</option></select>
                        <div></div>
                        <button type="button" style="width:106px;height:24px;background:#f6f6f6;border:1px solid #bbb;border-radius:3px;">Settings...</button>
                        <label>Multi-Page</label>
                        <div style="display:flex;gap:8px;">
                            <select style="width:86px;"><option>Off</option><option>2-Up</option><option>4-Up</option></select>
                            <button type="button" disabled style="height:24px;width:118px;border:1px solid #ccc;background:#eee;color:#999;border-radius:3px;">Layout Order...</button>
                        </div>
                        <label>Copies</label>
                        <div style="display:flex;gap:16px;align-items:center;">
                            <input id="prefsCopies" type="number" min="1" max="99" value="${copies}" style="width:58px;">
                            <label><input id="prefsCollate" type="checkbox"${collate ? ' checked' : ''}> Collate</label>
                        </div>
                        <label>Quiet Mode</label>
                        <select><option>On</option><option>Off</option></select>
                        <div></div>
                        <label><input type="checkbox"> Print Preview</label>
                        <div></div>
                        <label><input type="checkbox"> Job Arranger Lite</label>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;padding:0 10px 10px;">
                    <button type="button" style="height:28px;width:104px;background:#f6f6f6;border:1px solid #bbb;border-radius:3px;">Show Settings</button>
                    <button type="button" style="height:28px;width:104px;background:#f6f6f6;border:1px solid #bbb;border-radius:3px;">Restore Defaults</button>
                    <button type="button" style="height:28px;width:96px;background:#f6f6f6;border:1px solid #bbb;border-radius:3px;">Ink Levels</button>
                    <span style="flex:1"></span>
                    <button type="button" id="prefsOk" style="height:28px;width:74px;background:#eaf3ff;border:1px solid #2277cc;border-radius:3px;">OK</button>
                    <button type="button" onclick="closeStampedPrintPreferences()" style="height:28px;width:74px;background:#f6f6f6;border:1px solid #bbb;border-radius:3px;">Cancel</button>
                    <button type="button" style="height:28px;width:74px;background:#f6f6f6;border:1px solid #bbb;border-radius:3px;">Help</button>
                </div>
            </div>`;

        document.body.appendChild(prefs);
        prefs.querySelector('#prefsPaperSize').value = paperKey;
        prefs.querySelector('#prefsDuplex').value = duplex ? 'duplex' : 'off';
        prefs.querySelector('#prefsOk').addEventListener('click', () => {
            const nextPaper = prefs.querySelector('#prefsPaperSize')?.value;
            const nextOrient = prefs.querySelector('input[name="prefsOrient"]:checked')?.value;
            const nextCopies = prefs.querySelector('#prefsCopies')?.value;
            const nextColor = prefs.querySelector('input[name="prefsColor"]:checked')?.value;
            const nextDuplex = prefs.querySelector('#prefsDuplex')?.value === 'duplex';
            const paperSelect = printModal.querySelector('#stampedPrintPaperSize');
            if (paperSelect && nextPaper) paperSelect.value = nextPaper;
            const orientRadio = printModal.querySelector(`input[name="stampedPrintOrientation"][value="${nextOrient}"]`);
            if (orientRadio) orientRadio.checked = true;
            const copiesInput = printModal.querySelector('#stampedPrintCopies');
            if (copiesInput) copiesInput.value = nextCopies || '1';
            const collateInput = printModal.querySelector('#stampedPrintCollate');
            if (collateInput) collateInput.checked = prefs.querySelector('#prefsCollate')?.checked === true;
            const grayscaleInput = printModal.querySelector('#stampedPrintGrayscale');
            if (grayscaleInput) grayscaleInput.checked = nextColor === 'grayscale';
            const duplexInput = printModal.querySelector('#stampedPrintDuplex');
            if (duplexInput) duplexInput.checked = nextDuplex;
            closeStampedPrintPreferences();
            scheduleStampedPdfModalPreview(printModal, false);
        });
    }

    window.closeStampedPrintPreferences = closeStampedPrintPreferences;

    function openStampedPdfPrintModal(printJob) {
        closeStampedPdfPrintModal();

        const currentPaperKey = inferStampedPrintPaperKey();
        const currentPaper = PAGE_SIZES[currentPaperKey] || PAGE_SIZES.Letter;
        const defaultOrientation = currentPaper.w > currentPaper.h ? 'landscape' : 'portrait';
        const total = stampTotalPages || 1;
        const current = Math.min(Math.max(1, stampPreviewPage || 1), total);

        const modal = document.createElement('div');
        modal.id = 'stampedPdfPrintModal';
        modal._printJob = printJob;
        modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <style>
                #stampedPdfPrintModal button { cursor:pointer; transition:filter .12s ease, background-color .12s ease, border-color .12s ease; }
                #stampedPdfPrintModal button:hover:not(:disabled) { filter:brightness(1.16); border-color:#777 !important; }
                #stampedPdfPrintModal button:disabled { opacity:.45; cursor:not-allowed; }
                #stampedPdfPrintModal select,
                #stampedPdfPrintModal input[type="text"],
                #stampedPdfPrintModal input[type="number"] { box-sizing:border-box; min-width:0; }
                #stampedPdfPrintModal .print-soft-button:hover { background:#3a3a3a !important; }
                #stampedPdfPrintModal .print-danger-button:hover { background:#ff5d5d !important; }
                #stampedPdfPrintModal .print-choice { white-space:nowrap; }
                @keyframes stampPrintSpin { to { transform:rotate(360deg); } }
            </style>
            <div style="width:min(1140px,calc(100vw - 28px));height:min(760px,calc(100vh - 28px));background:#202124;color:#f5f5f5;border:1px solid #3a3a3a;border-radius:8px;box-shadow:0 18px 50px rgba(0,0,0,.45);display:grid;grid-template-rows:34px 1fr;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-bottom:1px solid #343434;">
                    <strong><i class="fa fa-print"></i> Print Stamped PDF</strong>
                    <button type="button" onclick="closeStampedPdfPrintModal()" style="background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;">&times;</button>
                </div>
                <div style="display:grid;grid-template-columns:440px minmax(0,1fr);min-height:0;">
                    <div style="padding:20px;border-right:1px solid #343434;overflow-y:auto;overflow-x:hidden;">
                        <div style="display:grid;grid-template-columns:82px minmax(0,1fr) 110px;gap:8px;align-items:center;margin-bottom:10px;">
                            <label>Printer</label>
                            <select id="stampedPrintPrinter" style="height:28px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;"></select>
                            <button type="button" id="stampedPrintPrefs" class="print-soft-button" style="height:28px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;">Preference...</button>
                        </div>
                        <div id="stampedPrintPrefsStatus" style="min-height:16px;margin:-4px 0 8px 90px;color:#aeb4bd;font-size:12px;"></div>
                        <div style="display:grid;grid-template-columns:82px 90px 1fr;gap:8px;align-items:center;margin-bottom:12px;">
                            <label>Copies</label>
                            <input id="stampedPrintCopies" type="number" min="1" max="99" value="1" style="height:28px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;padding:0 6px;">
                            <label style="display:flex;align-items:center;gap:8px;"><input id="stampedPrintCollate" type="checkbox"> Collate</label>
                        </div>
                        <label style="display:flex;align-items:center;gap:8px;margin:8px 0 14px;"><input id="stampedPrintGrayscale" type="checkbox"> Grayscale</label>
                        <hr style="border:0;border-top:1px solid #343434;margin:0 0 16px;">
                        <div style="display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;margin-bottom:12px;">
                            <div>Range</div>
                            <div style="display:grid;gap:8px;">
                                <label class="print-choice" data-print-choice style="border:1px solid transparent;border-radius:4px;padding:3px 6px;"><input type="radio" name="stampedPrintRange" value="all" checked> All pages</label>
                                <label class="print-choice" data-print-choice style="border:1px solid transparent;border-radius:4px;padding:3px 6px;"><input type="radio" name="stampedPrintRange" value="current"> Current page (${current} / ${total})</label>
                                <label class="print-choice" data-print-choice style="border:1px solid transparent;border-radius:4px;padding:3px 6px;"><input type="radio" name="stampedPrintRange" value="selected"> Selected pages</label>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <input id="stampedPrintPages" type="text" value="1-${total}" disabled style="flex:1;height:28px;background:#2b2b2b;color:#fff;border:1px solid #444;border-radius:3px;padding:0 8px;">
                                    <span>/ ${total}</span>
                                </div>
                                <small style="color:#bbb;">e.g. 1,8,9-12</small>
                                <select id="stampedPrintSubset" style="height:28px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;">
                                    <option value="">All pages in range</option>
                                    <option value="odd">Odd pages only</option>
                                    <option value="even">Even pages only</option>
                                </select>
                            </div>
                        </div>
                        <hr style="border:0;border-top:1px solid #343434;margin:0 0 16px;">
                        <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;"><input id="stampedPrintDuplex" type="checkbox"> Print on both sides</label>
                        <div style="display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;align-items:center;margin-bottom:14px;">
                            <label>PaperSize</label>
                            <select id="stampedPrintPaperSize" style="height:28px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;">${getStampedPrintPaperOptions()}</select>
                        </div>
                        <div style="display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;margin-bottom:14px;">
                            <div>Orientation</div>
                            <div style="display:flex;gap:28px;">
                                <label class="print-choice" data-print-choice style="border:1px solid transparent;border-radius:4px;padding:3px 6px;"><input type="radio" name="stampedPrintOrientation" value="portrait"${defaultOrientation === 'portrait' ? ' checked' : ''}> Portrait</label>
                                <label class="print-choice" data-print-choice style="border:1px solid transparent;border-radius:4px;padding:3px 6px;"><input type="radio" name="stampedPrintOrientation" value="landscape"${defaultOrientation === 'landscape' ? ' checked' : ''}> Landscape</label>
                            </div>
                        </div>
                        <div style="display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;">
                            <div>Page Sizing</div>
                            <div style="display:grid;gap:8px;">
                                <label class="print-choice" data-print-choice style="border:1px solid transparent;border-radius:4px;padding:3px 6px;"><input type="radio" name="stampedPrintScale" value="fit" checked> Fit Page</label>
                                <label class="print-choice" data-print-choice style="border:1px solid transparent;border-radius:4px;padding:3px 6px;"><input type="radio" name="stampedPrintScale" value="noscale"> Actual Size</label>
                                <label class="print-choice" data-print-choice style="display:flex;align-items:center;gap:8px;border:1px solid transparent;border-radius:4px;padding:3px 6px;"><input type="radio" name="stampedPrintScale" value="shrink"> Zoom <input id="stampedPrintZoom" type="number" min="10" max="400" value="100" style="width:64px;height:26px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;" disabled> %</label>
                            </div>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-rows:30px 1fr 54px;min-width:0;background:#596371;">
                        <label style="height:30px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#343840;color:#dfe5ee;font-size:13px;"><input id="stampedPrintComments" type="checkbox" checked> Print Comments</label>
                        <div id="stampedPrintPreviewStage" style="display:flex;align-items:center;justify-content:center;overflow:hidden;padding:18px;background:#747e8c;">
                            <div style="color:#d9dde5;">Rendering preview...</div>
                        </div>
                        <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:10px 14px;background:#202124;border-top:1px solid #343434;">
                            <button type="button" id="stampedPrintPreviewPrev" class="print-soft-button" style="width:32px;height:32px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;"><i class="fa fa-chevron-left"></i></button>
                            <span id="stampedPrintPreviewCount" style="min-width:74px;height:30px;display:inline-flex;align-items:center;justify-content:center;background:#2b2b2b;border-radius:4px;font-weight:700;">1/1</span>
                            <button type="button" id="stampedPrintPreviewNext" class="print-soft-button" style="width:32px;height:32px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;margin-right:auto;"><i class="fa fa-chevron-right"></i></button>
                            <button type="button" class="print-soft-button" onclick="closeStampedPdfPrintModal()" style="min-width:90px;height:32px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;">Cancel</button>
                            <button type="button" onclick="printStampedPdfClassic()" style="min-width:110px;height:32px;background:transparent;color:#ff6f61;border:0;">Classic Mode</button>
                            <button type="button" class="print-soft-button" onclick="openStampedPdfBatchPrint()" style="min-width:92px;height:32px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;">Batch Print</button>
                            <button type="button" id="stampedPrintSubmitBtn" class="print-danger-button" onclick="executeStampedPdfModalPrint()" style="min-width:90px;height:32px;background:#ef5350;color:#fff;border:0;border-radius:3px;"><i class="fa fa-print"></i> Print</button>
                        </div>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(modal);
        modal.querySelector('#stampedPrintPaperSize').value = currentPaperKey;
        modal.querySelectorAll('input[name="stampedPrintRange"]').forEach(input => {
            input.addEventListener('change', () => {
                const selected = modal.querySelector('input[name="stampedPrintRange"]:checked')?.value === 'selected';
                modal.querySelector('#stampedPrintPages').disabled = !selected;
                scheduleStampedPdfModalPreview(modal, true);
            });
        });
        modal.querySelectorAll('input[name="stampedPrintScale"]').forEach(input => {
            input.addEventListener('change', () => {
                modal.querySelector('#stampedPrintZoom').disabled = input.value !== 'shrink' || !input.checked;
                scheduleStampedPdfModalPreview(modal, false);
            });
        });
        modal.querySelectorAll('input[name="stampedPrintOrientation"]').forEach(input => {
            input.addEventListener('change', () => {
                modal._driverPreferencesActive = false;
                const prefsStatus = modal.querySelector('#stampedPrintPrefsStatus');
                if (prefsStatus) prefsStatus.textContent = '';
                scheduleStampedPdfModalPreview(modal, false);
            });
        });
        ['stampedPrintPages', 'stampedPrintSubset', 'stampedPrintPaperSize', 'stampedPrintGrayscale', 'stampedPrintDuplex', 'stampedPrintZoom'].forEach(id => {
            const el = modal.querySelector(`#${id}`);
            if (!el) return;
            const resetDriverPrefs = () => {
                if (['stampedPrintPaperSize', 'stampedPrintGrayscale', 'stampedPrintDuplex'].includes(id)) {
                    modal._driverPreferencesActive = false;
                    const prefsStatus = modal.querySelector('#stampedPrintPrefsStatus');
                    if (prefsStatus) prefsStatus.textContent = '';
                }
            };
            el.addEventListener('input', () => {
                resetDriverPrefs();
                scheduleStampedPdfModalPreview(modal, id === 'stampedPrintPages' || id === 'stampedPrintSubset');
            });
            el.addEventListener('change', () => {
                resetDriverPrefs();
                scheduleStampedPdfModalPreview(modal, id === 'stampedPrintPages' || id === 'stampedPrintSubset');
            });
        });
        modal.querySelector('#stampedPrintPreviewPrev').addEventListener('click', () => {
            modal._previewIndex = Math.max(0, (modal._previewIndex || 0) - 1);
            scheduleStampedPdfModalPreview(modal, false);
        });
        modal.querySelector('#stampedPrintPreviewNext').addEventListener('click', () => {
            const max = Math.max(0, (modal._previewPages?.length || 1) - 1);
            modal._previewIndex = Math.min(max, (modal._previewIndex || 0) + 1);
            scheduleStampedPdfModalPreview(modal, false);
        });
        modal.querySelector('#stampedPrintPrefs').addEventListener('click', () => {
            openSystemPrintPreferences();
        });
        loadStampedPdfModalPrinters(modal);
        scheduleStampedPdfModalPreview(modal, true);
    }

    window.closeStampedPdfPrintModal = closeStampedPdfPrintModal;

    window.printStampedPdfClassic = function () {
        const modal = document.getElementById('stampedPdfPrintModal');
        const job = modal?._printJob;
        if (!job) return;
        if (modal._driverPreferencesPending) {
            showNotification('Close Printing Preferences, then click Done before printing.', 'warning');
            return;
        }
        printPdfInBrowser(job.blob);
    };

    function setStampedPrintButtonLoading(modal, loading, label = 'Printing...') {
        const button = modal?.querySelector('#stampedPrintSubmitBtn');
        if (!button) return;
        if (loading) {
            if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<i class="fa fa-spinner fa-spin"></i> ${label}`;
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalHtml || '<i class="fa fa-print"></i> Print';
            delete button.dataset.originalHtml;
        }
    }

    function getStampedPdfModalPrintOptions(modal, includePages = true, includeOrientation = true) {
        const paperKey = modal.querySelector('#stampedPrintPaperSize')?.value || 'Letter';
        const pages = includePages ? getStampedPdfModalPageRange(modal) : '';
        const options = {
            printer: modal.querySelector('#stampedPrintPrinter')?.value || undefined,
            copies: Math.max(1, Math.min(99, parseInt(modal.querySelector('#stampedPrintCopies')?.value, 10) || 1)),
            scale: includePages ? (modal.querySelector('input[name="stampedPrintScale"]:checked')?.value || 'fit') : 'fit'
        };
        options.paperSize = getPrintHelperPaperSize(paperKey);
        if (includeOrientation) options.orientation = modal.querySelector('input[name="stampedPrintOrientation"]:checked')?.value || 'portrait';
        options.monochrome = modal.querySelector('#stampedPrintGrayscale')?.checked === true;
        if (pages) options.pages = pages;
        const subset = includePages ? modal.querySelector('#stampedPrintSubset')?.value : '';
        if (subset) options.subset = subset;
        if (modal.querySelector('#stampedPrintDuplex')?.checked) options.side = 'duplex';
        return options;
    }

    function ensurePrintPreferencesReady(modal) {
        if (modal?._driverPreferencesPending) {
            showNotification('Close Printing Preferences, then click Done before printing.', 'warning');
            return false;
        }
        return true;
    }

    function closeStampedPdfBatchModal() {
        document.getElementById('stampedPdfBatchModal')?.remove();
    }

    function renderStampedPdfBatchList(batchModal) {
        const list = batchModal.querySelector('#stampedBatchFileList');
        const count = batchModal.querySelector('#stampedBatchCount');
        const files = batchModal._batchFiles || [];
        if (count) count.textContent = String(files.length);
        list.innerHTML = files.map((file, index) => `
            <button type="button" data-batch-index="${index}" style="width:100%;min-height:44px;display:grid;grid-template-columns:26px 1fr auto;gap:8px;align-items:center;text-align:left;background:${index === (batchModal._batchIndex || 0) ? '#000' : '#1f1f1f'};color:#fff;border:0;border-bottom:1px solid #2e2e2e;padding:7px 9px;cursor:pointer;">
                <span style="width:22px;height:22px;border-radius:3px;background:#ef5350;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">PDF</span>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${file.name}</span>
                <span style="color:#ff6b6b;white-space:nowrap;">${file.pages} pages</span>
            </button>`).join('');
        list.querySelectorAll('[data-batch-index]').forEach(btn => {
            btn.addEventListener('click', () => {
                batchModal._batchIndex = parseInt(btn.dataset.batchIndex, 10) || 0;
                batchModal._batchPage = 1;
                renderStampedPdfBatchList(batchModal);
                renderStampedPdfBatchPreview(batchModal);
            });
        });
    }

    async function renderStampedPdfBatchPreview(batchModal) {
        const stage = batchModal.querySelector('#stampedBatchPreviewStage');
        const count = batchModal.querySelector('#stampedBatchPreviewCount');
        const file = batchModal._batchFiles?.[batchModal._batchIndex || 0];
        if (!stage || !file) return;
        const pageNum = Math.min(Math.max(1, batchModal._batchPage || 1), file.pages || 1);
        batchModal._batchPage = pageNum;
        if (count) count.textContent = `${pageNum}/${file.pages || 1}`;
        stage.innerHTML = '<div style="color:#d9dde5;">Rendering preview...</div>';
        try {
            if (!file.pdfDoc) {
                file.pdfDoc = await pdfjsLib.getDocument({ data: file.bytes.slice() }).promise;
            }
            const page = await file.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1 });
            const rect = stage.getBoundingClientRect();
            const scale = Math.max(0.2, Math.min((rect.width - 54) / viewport.width, (rect.height - 54) / viewport.height, 1.25));
            const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
            const renderViewport = page.getViewport({ scale: scale * dpr });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(renderViewport.width);
            canvas.height = Math.ceil(renderViewport.height);
            canvas.style.width = `${viewport.width * scale}px`;
            canvas.style.height = `${viewport.height * scale}px`;
            canvas.style.background = '#fff';
            canvas.style.boxShadow = '0 10px 28px rgba(0,0,0,.42)';
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;
            stage.innerHTML = '';
            stage.appendChild(canvas);
        } catch (error) {
            console.error('Could not render batch preview', error);
            stage.innerHTML = '<div style="color:#ffb4ab;">Preview failed to render.</div>';
        }
    }

    async function addStampedBatchFiles(batchModal, files) {
        for (const file of Array.from(files || [])) {
            if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) continue;
            const bytes = new Uint8Array(await file.arrayBuffer());
            const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
            batchModal._batchFiles.push({
                name: file.name,
                pages: pdfDoc.numPages || 1,
                bytes,
                b64: uint8ToBase64(bytes),
                pdfDoc
            });
        }
        renderStampedPdfBatchList(batchModal);
        renderStampedPdfBatchPreview(batchModal);
    }

    function openStampedPdfBatchPrint() {
        const printModal = document.getElementById('stampedPdfPrintModal');
        const currentJob = printModal?._printJob;
        if (!printModal || !currentJob) return;
        closeStampedPdfBatchModal();

        const batchModal = document.createElement('div');
        batchModal.id = 'stampedPdfBatchModal';
        batchModal._batchIndex = 0;
        batchModal._batchPage = 1;
        batchModal._batchFiles = [{
            name: `${typeof getStampedFilename === 'function' ? getStampedFilename() : 'Stamped PDF'}`,
            pages: stampTotalPages || 1,
            bytes: currentJob.bytes || Uint8Array.from(atob(currentJob.b64), c => c.charCodeAt(0)),
            b64: currentJob.b64,
            stampedCurrent: true
        }];
        batchModal.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.52);display:flex;align-items:center;justify-content:center;padding:18px;';
        batchModal.innerHTML = `
            <style>
                #stampedPdfBatchModal button { cursor:pointer; transition:filter .12s ease, background-color .12s ease; }
                #stampedPdfBatchModal button:hover:not(:disabled) { filter:brightness(1.16); }
            </style>
            <div style="width:min(1040px,calc(100vw - 24px));height:min(720px,calc(100vh - 24px));background:#1d1d1d;color:#fff;border:1px solid #333;border-radius:7px;box-shadow:0 18px 50px rgba(0,0,0,.5);display:grid;grid-template-columns:180px 1fr 390px;grid-template-rows:32px 1fr 64px;overflow:hidden;">
                <div style="grid-column:1 / 4;display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#202124;border-bottom:1px solid #333;">
                    <strong><i class="fa fa-print"></i> Batch Print</strong>
                    <button type="button" onclick="closeStampedPdfBatchModal()" style="background:transparent;border:0;color:#fff;font-size:22px;">&times;</button>
                </div>
                <div style="background:#181818;border-right:1px solid #2b2b2b;overflow:hidden;display:grid;grid-template-rows:58px 1fr;">
                    <div style="padding:12px;">
                        <button type="button" id="stampedBatchAddBtn" style="width:100%;height:34px;background:#303030;color:#fff;border:1px solid #555;border-radius:3px;"><i class="fa fa-plus"></i> Add PDF Files</button>
                        <input id="stampedBatchFileInput" type="file" accept="application/pdf,.pdf" multiple hidden>
                    </div>
                    <div id="stampedBatchFileList" style="overflow:auto;"></div>
                </div>
                <div style="padding:20px;border-right:1px solid #333;overflow:auto;">
                    <div style="display:grid;grid-template-columns:80px minmax(0,1fr) 110px;gap:8px;align-items:center;margin-bottom:12px;">
                        <label>Printer</label>
                        <select disabled style="height:28px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;"><option>${printModal.querySelector('#stampedPrintPrinter')?.value || 'Default printer'}</option></select>
                        <button type="button" id="stampedBatchPrefs" onclick="openSystemPrintPreferences()" style="height:28px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;">Preference...</button>
                    </div>
                    <div id="stampedBatchPrefsStatus" style="min-height:16px;margin:-4px 0 10px 88px;color:#aeb4bd;font-size:12px;"></div>
                    <p style="color:#bbb;line-height:1.5;margin:0 0 14px;">Batch Print uses the printer, paper, orientation, copies, grayscale, duplex, and sizing settings from the main print window. Added PDFs print as full documents.</p>
                    <hr style="border:0;border-top:1px solid #333;margin:0 0 14px;">
                    <div style="color:#ddd;">Files in queue: <strong id="stampedBatchCount">1</strong></div>
                </div>
                <div style="display:grid;grid-template-rows:30px 1fr 54px;background:#596371;">
                    <label style="height:30px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#343840;color:#dfe5ee;font-size:13px;"><input type="checkbox" checked> Print Comments</label>
                    <div id="stampedBatchPreviewStage" style="display:flex;align-items:center;justify-content:center;overflow:hidden;padding:18px;background:#747e8c;"></div>
                    <div style="display:flex;align-items:center;justify-content:center;gap:10px;background:#202124;border-top:1px solid #333;">
                        <button type="button" id="stampedBatchPrev" style="width:32px;height:32px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;"><i class="fa fa-chevron-left"></i></button>
                        <span id="stampedBatchPreviewCount" style="min-width:74px;height:30px;display:inline-flex;align-items:center;justify-content:center;background:#2b2b2b;border-radius:4px;font-weight:700;">1/1</span>
                        <button type="button" id="stampedBatchNext" style="width:32px;height:32px;background:#2b2b2b;color:#fff;border:1px solid #555;border-radius:3px;"><i class="fa fa-chevron-right"></i></button>
                    </div>
                </div>
                <div style="grid-column:1 / 4;display:flex;align-items:center;justify-content:space-between;padding:12px;background:#181818;border-top:1px solid #333;">
                    <button type="button" onclick="closeStampedPdfBatchModal()" style="min-width:120px;height:34px;background:#303030;color:#fff;border:1px solid #555;border-radius:3px;">Cancel</button>
                    <button type="button" onclick="executeStampedPdfBatchPrint()" style="min-width:120px;height:34px;background:#ef5350;color:#fff;border:0;border-radius:3px;">Print</button>
                </div>
            </div>`;
        document.body.appendChild(batchModal);
        window.closeStampedPdfBatchModal = closeStampedPdfBatchModal;
        renderStampedPdfBatchList(batchModal);
        renderStampedPdfBatchPreview(batchModal);
        batchModal.querySelector('#stampedBatchAddBtn').addEventListener('click', () => batchModal.querySelector('#stampedBatchFileInput').click());
        batchModal.querySelector('#stampedBatchFileInput').addEventListener('change', e => addStampedBatchFiles(batchModal, e.target.files));
        batchModal.querySelector('#stampedBatchPrev').addEventListener('click', () => {
            batchModal._batchPage = Math.max(1, (batchModal._batchPage || 1) - 1);
            renderStampedPdfBatchPreview(batchModal);
        });
        batchModal.querySelector('#stampedBatchNext').addEventListener('click', () => {
            const file = batchModal._batchFiles[batchModal._batchIndex || 0];
            batchModal._batchPage = Math.min(file?.pages || 1, (batchModal._batchPage || 1) + 1);
            renderStampedPdfBatchPreview(batchModal);
        });
    }

    window.closeStampedPdfBatchModal = closeStampedPdfBatchModal;
    window.openStampedPdfBatchPrint = openStampedPdfBatchPrint;

    window.executeStampedPdfBatchPrint = async function () {
        const batchModal = document.getElementById('stampedPdfBatchModal');
        const printModal = document.getElementById('stampedPdfPrintModal');
        if (!batchModal || !printModal) return;
        if (!ensurePrintPreferencesReady(printModal)) return;
        const files = batchModal._batchFiles || [];
        try {
            showProgress('Preparing batch print...', 'Stamping queued PDF files');
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                updateProgress((i / Math.max(1, files.length)) * 90, `Preparing ${file.name}`);
                const b64 = file.stampedCurrent
                    ? file.b64
                    : await buildStampedPDFForDocument(
                        file.pdfDoc,
                        file.pages,
                        Array.from({ length: file.pages }, (_, pageIndex) => pageIndex + 1),
                        false
                    );
                await printPdfWithLocalHelper(b64, getStampedPdfModalPrintOptions(printModal, file.stampedCurrent === true));
            }
            updateProgress(100, 'Batch print sent');
            showNotification(`Sent ${files.length} PDF file(s) to printer.`, 'success');
            closeStampedPdfBatchModal();
            closeStampedPdfPrintModal();
        } catch (error) {
            console.warn('Batch print failed.', error);
            showNotification(getPrintHelperErrorMessage(error), 'warning');
        } finally {
            hideProgress();
        }
    };

    window.executeStampedPdfModalPrint = async function () {
        const modal = document.getElementById('stampedPdfPrintModal');
        const job = modal?._printJob;
        if (!modal || !job) return;
        if (!ensurePrintPreferencesReady(modal)) return;

        try {
            const printPages = getStampedPdfModalPreviewPages(modal);
            if (printPages.length > STAMPED_HELPER_PAGE_LIMIT) {
                downloadAndBrowserPrintStampedPdf(
                    job,
                    `This print job has ${printPages.length} pages, which is too heavy for direct local printing.`
                );
                closeStampedPdfPrintModal();
                return;
            }

            setStampedPrintButtonLoading(modal, true, 'Preparing...');
            showProgress('Preparing print...', 'Applying print settings');
            const printB64 = await buildStampedPdfModalPrintPdf(modal);
            setStampedPrintButtonLoading(modal, true, 'Printing...');
            updateProgress(96, 'Sending to printer...');
            await printPdfWithLocalHelper(printB64, getStampedPdfModalPrintOptions(modal, false, false));
            updateProgress(100, 'Sent to printer');
            showNotification('Sent directly to printer.', 'success');
            closeStampedPdfPrintModal();
        } catch (error) {
            console.warn('Local print helper failed.', error);
            showNotification(getPrintHelperErrorMessage(error), 'warning');
        } finally {
            hideProgress();
            setStampedPrintButtonLoading(modal, false);
        }
    };

    window.executePrintStampOnly = async function () {
        const sizeKey    = document.getElementById('psoPageSize')?.value || 'A4';
        const orient     = document.querySelector('input[name="psoOrient"]:checked')?.value || 'portrait';
        const copies  = Math.max(1, Math.min(99, parseInt(document.getElementById('psoCopies')?.value) || 1));

        let { w: ptW, h: ptH } = PAGE_SIZES[sizeKey];
        if (orient === 'landscape') { [ptW, ptH] = [ptH, ptW]; }

        const SCALE  = 2.0;
        const cW     = Math.round(ptW * SCALE);
        const cH     = Math.round(ptH * SCALE);
        const canvas = document.createElement('canvas');
        canvas.width  = cW;
        canvas.height = cH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cW, cH);

        const now = new Date();

        if (stampMode === 'formatted') readFmtSettings();
        else if (stampMode === 'seal') readSealSettings();
        else if (stampMode === 'received') readRecvSettings();
        else readStampSettings();

        // Draw stamp exactly as shown in preview — no rotation.
        // What you see in the canvas is what prints.
        drawStampOnCanvas(ctx, cW, cH, now);

        document.getElementById('printStampOnlyModal')?.remove();

        // ── Build a PDF with the exact MediaBox matching the chosen paper size ─
        // Chrome reads the PDF MediaBox to set the paper size in the print dialog.
        // This is more reliable than @page CSS for paper size detection.
        const dataUrl  = canvas.toDataURL('image/jpeg', 0.95);
        const pdfPages = [{ dataUrl, canvasW: cW, canvasH: cH, ptW, ptH }];
        const pdfBytes = buildPDFFromImages(pdfPages);
        const b64      = uint8ToBase64(pdfBytes);
        const pdfBlob  = new Blob(
            [Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))],
            { type: 'application/pdf' }
        );

        try {
            await printPdfWithLocalHelper(b64, {
                paperSize: getPrintHelperPaperSize(sizeKey),
                monochrome: false,
                scale: 'noscale',
                copies
            });
            showNotification('Sent directly to printer.', 'success');
            return;
        } catch (error) {
            console.warn('Local print helper failed; falling back to browser print.', error);
            const helperMessage = error.name === 'AbortError' || error.message === 'Failed to fetch'
                ? 'Local print helper is not running. Start it with npm run print-helper.'
                : (error.message || 'Local print helper could not print');
            showNotification(helperMessage + ' Opening browser print instead.', 'warning');
        }

        printPdfInBrowser(pdfBlob);
    };

    // Draw the stamp at its configured positionX/Y
    function drawStampOnCanvas(ctx, w, h, dateObj) {
        if (stampMode === 'formatted') drawFormattedStamp(ctx, w, h, fmtSettings, dateObj);
        else if (stampMode === 'seal') drawCircularSeal(ctx, w, h, sealSettings, dateObj);
        else if (stampMode === 'received') drawReceivedStamp(ctx, w, h, recvSettings, dateObj);
        else {
            const ratio = w / 595;
            const s2 = Object.assign({}, stampSettings, {
                fontSize: stampSettings.fontSize * ratio,
                borderWidth: stampSettings.borderWidth * ratio
            });
            drawSimpleStamp(ctx, w, h, s2);
        }
    }

    // Draw the stamp at an explicit posX/posY (for tiling)
    function drawStampOnCanvasAt(ctx, w, h, dateObj, posX, posY) {
        if (stampMode === 'formatted') {
            drawFormattedStamp(ctx, w, h, Object.assign({}, fmtSettings, { positionX: posX, positionY: posY }), dateObj);
        } else if (stampMode === 'seal') {
            drawCircularSeal(ctx, w, h, Object.assign({}, sealSettings, { positionX: posX, positionY: posY }), dateObj);
        } else if (stampMode === 'received') {
            drawReceivedStamp(ctx, w, h, Object.assign({}, recvSettings, { positionX: posX, positionY: posY }), dateObj);
        } else {
            const ratio = w / 595;
            const s2 = Object.assign({}, stampSettings, {
                positionX: posX, positionY: posY,
                fontSize: stampSettings.fontSize * ratio,
                borderWidth: stampSettings.borderWidth * ratio
            });
            drawSimpleStamp(ctx, w, h, s2);
        }
    }
    function setupOverlayDrag() {
        const canvas = document.getElementById('stampOverlayCanvas');
        if (!canvas) return;
        attachStampOverlayDrag(canvas, function () { return stampPreviewPage; });
    }

    function attachStampOverlayDrag(canvas, pageNumOrGetter) {
        if (!canvas || canvas._stampDragBound) return;
        canvas._stampDragBound = true;
        canvas.style.cursor = 'crosshair';

        const getPageNum = () => typeof pageNumOrGetter === 'function' ? pageNumOrGetter() : pageNumOrGetter;

        // Mouse
        canvas.addEventListener('mousedown', function (e) {
            if (!stampPdfDoc && !stampOnlyMode) return;
            const dragPageNum = getPageNum() || stampPreviewPage;
            if (!stampOnlyMode && dragPageNum !== stampPreviewPage) {
                stampPreviewPage = dragPageNum;
                updateStampPageControls();
            }
            if (!stampOnlyMode && isCustomToggleChecked() && !pageOverrides[dragPageNum]) {
                saveCurrentPageOverride(dragPageNum);
            }
            const pos = getCanvasPos(e, canvas);
            isDragging = true;
            dragStartX = pos.x; dragStartY = pos.y;
            // Use page override if active, else global settings
            const hasPageOverride = !!pageOverrides[dragPageNum];
            const ovr = hasPageOverride ? pageOverrides[dragPageNum] : null;
            const globalS = stampMode === 'formatted' ? fmtSettings
                          : stampMode === 'seal'       ? sealSettings
                          : stampMode === 'received'   ? recvSettings
                          : stampSettings;
            const s = ovr ? Object.assign({}, globalS, ovr) : globalS;
            dragStartPosX = s.positionX; dragStartPosY = s.positionY;
            canvas.style.cursor = 'grabbing';
        });

        canvas.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            const pos  = getCanvasPos(e, canvas);
            const newX = Math.min(95, Math.max(5, dragStartPosX + ((pos.x - dragStartX) / canvas.width)  * 100));
            const newY = Math.min(95, Math.max(5, dragStartPosY + ((pos.y - dragStartY) / canvas.height) * 100));
            const dragPageNum = getPageNum() || stampPreviewPage;
            if (!stampOnlyMode && (pageOverrides[dragPageNum] || isCustomToggleChecked())) {
                stampPreviewPage = dragPageNum;
            }
            setStampPosition(Math.round(newX), Math.round(newY), stampMode, { skipRefresh: true, pageNum: dragPageNum });
            scheduleStampOverlayRedraw();
        });

        canvas.addEventListener('mouseup',    stopDrag);
        canvas.addEventListener('mouseleave', stopDrag);

        // Touch
        canvas.addEventListener('touchstart', function (e) {
            e.preventDefault();
            const t = e.touches[0];
            canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY }));
        }, { passive: false });

        canvas.addEventListener('touchmove', function (e) {
            e.preventDefault();
            const t = e.touches[0];
            canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY }));
        }, { passive: false });

        canvas.addEventListener('touchend', stopDrag);

        function stopDrag() {
            if (isDragging) {
                saveStampSettings();
                saveActiveStampDocumentState();
            }
            isDragging = false;
            canvas.style.cursor = 'crosshair';
        }
    }

    function getCanvasPos(e, canvas) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (canvas.width  / r.width),
            y: (e.clientY - r.top)  * (canvas.height / r.height)
        };
    }

    // ─── Simple stamp drawing ─────────────────────────────────────────────────
    function drawSimpleStamp(ctx, w, h, s) {
        const x = (s.positionX / 100) * w;
        const y = (s.positionY / 100) * h;

        ctx.save();
        ctx.globalAlpha = s.opacity;
        ctx.translate(x, y);
        ctx.rotate((s.rotation * Math.PI) / 180);

        ctx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.fontSize}px ${s.fontFamily}`;
        ctx.fillStyle = s.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

        if (s.border) {
            const m = ctx.measureText(s.text);
            const boxW = Math.max(m.width + 22, s.fontSize * 2.6);
            const boxH = s.fontSize + 18;
            roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 6);
            ctx.strokeStyle = s.color; ctx.lineWidth = s.borderWidth; ctx.stroke();
        }
        ctx.fillText(s.text, 0, 0);
        ctx.restore();

        // drag dot
        ctx.save(); ctx.globalAlpha = 0.2; ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // ─── Formatted stamp drawing ──────────────────────────────────────────────
    function drawFormattedStamp(ctx, w, h, s, dateObj) {
        const shortSide  = Math.min(w, h);
        const sc         = s.scale * (shortSide / 600);

        const cx = (s.positionX / 100) * w;
        const cy = (s.positionY / 100) * h;
        const bW = 340 * sc, bH = 180 * sc;
        const bX = cx - bW / 2, bY = cy - bH / 2;
        const clr = s.color;

        ctx.save();
        ctx.globalAlpha = s.opacity;

        if (!s.transparentBg) {
            ctx.fillStyle = '#ffffff';
            roundRect(ctx, bX, bY, bW, bH, 6 * sc);
            ctx.fill();
        }

        ctx.strokeStyle = clr;
        ctx.lineWidth   = 2.5 * sc;
        roundRect(ctx, bX, bY, bW, bH, 2 * sc); ctx.stroke();
        ctx.lineWidth = 1 * sc;
        roundRect(ctx, bX + 4*sc, bY + 4*sc, bW - 8*sc, bH - 8*sc, 1 * sc); ctx.stroke();

        ctx.fillStyle = clr; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

        let curY = bY + 14 * sc + 10 * sc;

        const titleFs = 13 * sc;
        ctx.font = `bold ${titleFs}px Arial`;
        for (const line of s.title.split('\n')) {
            ctx.fillText(line.trim(), cx, curY);
            curY += titleFs * 1.35;
        }
        curY += 4 * sc;

        const nameFs = 13 * sc;
        ctx.font = `bold ${nameFs}px Arial`;
        ctx.fillText(s.name, cx, curY);
        const nW = ctx.measureText(s.name).width;
        ctx.beginPath();
        ctx.moveTo(cx - nW / 2, curY + nameFs * 0.65);
        ctx.lineTo(cx + nW / 2, curY + nameFs * 0.65);
        ctx.lineWidth = 1.2 * sc; ctx.strokeStyle = clr; ctx.stroke();
        curY += nameFs * 1.5;

        ctx.font = `bold ${12 * sc}px Arial`;
        ctx.fillText(s.subName, cx, curY); curY += 12 * sc * 1.4;

        ctx.font = `bold ${12 * sc}px Arial`;
        ctx.fillText(s.institution, cx, curY); curY += 12 * sc * 1.7;

        if (s.showDate || s.showTime) {
            const dtFs    = 11 * sc;
            const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            ctx.font = `bold ${dtFs}px Arial`;
            ctx.lineWidth = 1 * sc; ctx.strokeStyle = clr;

            if (s.showDate && s.showTime) {
                const lx = bX + bW * 0.35, rx = bX + bW * 0.73;
                ctx.fillText(dateStr, lx, curY); ctx.fillText(timeStr, rx, curY);
                curY += dtFs * 1.15;
                const dW = ctx.measureText(dateStr).width + 6 * sc;
                const tW = ctx.measureText(timeStr).width + 6 * sc;
                ctx.beginPath();
                ctx.moveTo(lx - dW / 2, curY); ctx.lineTo(lx + dW / 2, curY);
                ctx.moveTo(rx - tW / 2, curY); ctx.lineTo(rx + tW / 2, curY);
                ctx.stroke();
                curY += dtFs * 1.0;
                ctx.font = `bold ${10 * sc}px Arial`;
                ctx.fillText('Date', lx, curY); ctx.fillText('Time', rx, curY);
            } else if (s.showDate) {
                ctx.fillText(dateStr, cx, curY);
            } else {
                ctx.fillText(timeStr, cx, curY);
            }
        }

        ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ─── Read settings from DOM ───────────────────────────────────────────────
    function readStampSettings() {
        const g = id => document.getElementById(id);
        stampSettings.text      = (g('stampText')?.value || 'STAMP').toUpperCase();
        stampSettings.color     =  g('stampColor')?.value       || '#c0392b';
        stampSettings.fontSize  =  parseInt(g('stampFontSize')?.value)  || 52;
        stampSettings.opacity   =  parseFloat(g('stampOpacity')?.value) || 0.55;
        stampSettings.rotation  =  parseInt(g('stampRotationNum')?.value ?? g('stampRotation')?.value) || 0;
        stampSettings.bold      =  g('stampBold')?.checked      ?? true;
        stampSettings.italic    =  g('stampItalic')?.checked    ?? false;
        stampSettings.border    =  g('stampBorder')?.checked    ?? true;
        stampSettings.positionX =  parseInt(g('stampPosX')?.value)  || 50;
        stampSettings.positionY =  parseInt(g('stampPosY')?.value)  || 50;
        stampSettings.pageRange =  g('stampPageRange')?.value  || '';
    }

    function readFmtSettings() {
        const g = id => document.getElementById(id);
        fmtSettings.title         =  g('fmtTitle')?.value        || '';
        fmtSettings.name          =  g('fmtName')?.value         || '';
        fmtSettings.subName       =  g('fmtSubName')?.value      || '';
        fmtSettings.institution   =  g('fmtInstitution')?.value  || '';
        fmtSettings.color         =  g('fmtColor')?.value        || '#1a2a6c';
        fmtSettings.opacity       =  parseFloat(g('fmtOpacity')?.value)  || 1.0;
        fmtSettings.scale         =  parseFloat(g('fmtScale')?.value)    || 0.45;
        fmtSettings.showDate      =  g('fmtShowDate')?.checked   ?? true;
        fmtSettings.showTime      =  g('fmtShowTime')?.checked   ?? true;
        fmtSettings.transparentBg =  g('fmtTransparent')?.checked ?? true;
        fmtSettings.positionX     =  parseInt(g('fmtPosX')?.value)       || 50;
        fmtSettings.positionY     =  parseInt(g('fmtPosY')?.value)       || 50;
        fmtSettings.pageRange     =  g('fmtPageRange')?.value    || '';
    }

    function readSealSettings() {
        const g = id => document.getElementById(id);
        sealSettings.topText      =  g('sealTopText')?.value      || 'CERTIFIED TRUE COPY';
        sealSettings.bottomText   =  g('sealBottomText')?.value   || 'FROM THE ORIGINAL';
        sealSettings.schoolName   =  g('sealSchoolName')?.value   || '';
        sealSettings.schoolAbbrev =  g('sealSchoolAbbrev')?.value || '';
        sealSettings.showDate     =  g('sealShowDate')?.checked   ?? true;
        sealSettings.color        =  g('sealColor')?.value        || '#1a2a6c';
        sealSettings.opacity      =  parseFloat(g('sealOpacity')?.value) || 1.0;
        sealSettings.scale        =  parseFloat(g('sealScale')?.value)   || 1.0;
        sealSettings.positionX    =  parseInt(g('sealPosX')?.value)      || 50;
        sealSettings.positionY    =  parseInt(g('sealPosY')?.value)      || 50;
        sealSettings.pageRange    =  g('sealPageRange')?.value    || '';
    }

    function readRecvSettings() {
        const g = id => document.getElementById(id);
        recvSettings.schoolName     =  g('recvSchoolName')?.value     || '';
        recvSettings.officeName     =  g('recvOfficeName')?.value     || '';
        recvSettings.stampType      =  g('recvStampType')?.value      || 'RECEIVED';
        recvSettings.personnelName  =  g('recvPersonnelName')?.value  || '';
        recvSettings.personnelDesig =  g('recvPersonnelDesig')?.value || '';
        recvSettings.showDate       =  g('recvShowDate')?.checked     ?? true;
        recvSettings.showTime       =  g('recvShowTime')?.checked     ?? true;
        recvSettings.transparentBg  =  g('recvTransparent')?.checked  ?? true;
        recvSettings.color          =  g('recvColor')?.value          || '#1a2a6c';
        recvSettings.opacity        =  parseFloat(g('recvOpacity')?.value)  || 1.0;
        recvSettings.scale          =  parseFloat(g('recvScale')?.value)    || 0.50;
        recvSettings.positionX      =  parseInt(g('recvPosX')?.value)       || 50;
        recvSettings.positionY      =  parseInt(g('recvPosY')?.value)       || 50;
        recvSettings.pageRange      =  g('recvPageRange')?.value      || '';
    }

    // ─── Received stamp event callbacks ───────────────────────────────────────
    window.onRecvSettingChange = function () {
        const op = document.getElementById('recvOpacity'), opV = document.getElementById('recvOpacityVal');
        if (op && opV) opV.textContent = Math.round(op.value * 100) + '%';
        const sc = document.getElementById('recvScale'), sn = document.getElementById('recvScaleNum');
        if (sc && sn && document.activeElement !== sn) sn.value = Math.round(sc.value * 100);
        refreshOverlay();
    };

    window.syncRecvScaleFromInput = function () {
        const sn = document.getElementById('recvScaleNum'), sl = document.getElementById('recvScale');
        let v = Math.min(250, Math.max(20, parseInt(sn.value) || 45));
        sn.value = v;
        if (sl) sl.value = v / 100;
        if (!isOnCustomPage()) recvSettings.scale = v / 100;
        refreshOverlay();
    };

    window.onRecvPositionChange = function () {
        const x = parseInt(document.getElementById('recvPosX')?.value) || 50;
        const y = parseInt(document.getElementById('recvPosY')?.value) || 50;
        const xv = document.getElementById('recvPosXVal'), yv = document.getElementById('recvPosYVal');
        if (xv) xv.textContent = x + '%'; if (yv) yv.textContent = y + '%';
        if (!isOnCustomPage()) { recvSettings.positionX = x; recvSettings.positionY = y; }
        refreshOverlay();
    };

    // ─── Received / Released box stamp drawing ────────────────────────────────
    // Layout (matching the photo):
    //   ┌─────────────────────────────────┐
    //   │  SCHOOL NAME (bold)             │
    //   │  Office Name                    │
    //   │                                 │
    //   │        RECEIVED                 │  ← large bold stamp type
    //   │                                 │
    //   │   PERSONNEL NAME (bold, uline)  │
    //   │   Personnel Designation         │
    //   │   Date | Time                   │
    //   └─────────────────────────────────┘
    function drawReceivedStamp(ctx, w, h, s, dateObj) {
        const shortSide = Math.min(w, h);
        const sc        = s.scale * (shortSide / 600);

        const cx = (s.positionX / 100) * w;
        const cy = (s.positionY / 100) * h;

        // Box dimensions — wider than tall to match the photo aspect ratio
        const bW = 420 * sc;
        const bH = 220 * sc;
        const bX = cx - bW / 2;
        const bY = cy - bH / 2;
        const clr = s.color;
        const pad = 14 * sc;

        ctx.save();
        ctx.globalAlpha = s.opacity;

        // Background
        if (!s.transparentBg) {
            ctx.fillStyle = '#ffffff';
            roundRect(ctx, bX, bY, bW, bH, 4 * sc);
            ctx.fill();
        }

        // Outer border
        ctx.strokeStyle = clr;
        ctx.lineWidth   = 2.5 * sc;
        roundRect(ctx, bX, bY, bW, bH, 2 * sc);
        ctx.stroke();

        // Inner border (tight inset)
        ctx.lineWidth = 1 * sc;
        roundRect(ctx, bX + 4 * sc, bY + 4 * sc, bW - 8 * sc, bH - 8 * sc, 1 * sc);
        ctx.stroke();

        ctx.fillStyle    = clr;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        let curY = bY + pad + 8 * sc;

        // ── School Name (bold, larger) ────────────────────────────────────────
        // const schoolFs = 14 * sc;
        const schoolFs = 17 * sc;
        ctx.font = `bold ${schoolFs}px Arial`;
        ctx.fillText(s.schoolName, cx, curY);
        curY += schoolFs * 1.4;

        // ── Office Name ───────────────────────────────────────────────────────
        // const officeFs = 11.5 * sc;
        const officeFs = 15 * sc;
        ctx.font = `${officeFs}px Arial`;
        ctx.fillText(s.officeName, cx, curY);
        curY += officeFs * 1.5;

        // ── Stamp Type (large bold center text) ───────────────────────────────
        // const typeFs = 38 * sc;
        const typeFs = 70 * sc;

        ctx.font = `900 ${typeFs}px Arial`;
        ctx.fillText(s.stampType, cx, curY + typeFs * 0.3);
        curY += typeFs * 1.1;

        // ── Personnel Name (bold, underlined) ─────────────────────────────────
        // const nameFs = 13 * sc;
        const nameFs = 19 * sc;
        ctx.font = `700 ${nameFs}px Arial`;
        ctx.fillText(s.personnelName, cx, curY);
        // underline
        const nW = ctx.measureText(s.personnelName).width;
        ctx.beginPath();
        ctx.moveTo(cx - nW / 2, curY + nameFs * 0.65);
        ctx.lineTo(cx + nW / 2, curY + nameFs * 0.65);
        ctx.lineWidth   = 1.2 * sc;
        ctx.strokeStyle = clr;
        ctx.stroke();
        curY += nameFs * 1.5;

        // ── Personnel Designation ─────────────────────────────────────────────
        // const desigFs = 11 * sc;
        const desigFs = 15 * sc;
        ctx.font = `${desigFs}px Arial`;
        ctx.fillText(s.personnelDesig, cx, curY);
        curY += desigFs * 1.4;

        // ── Date / Time ───────────────────────────────────────────────────────
        if (s.showDate || s.showTime) {
            // const dtFs    = 11 * sc;
            const dtFs    = 15 * sc;
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            ctx.font = `${dtFs}px Arial`;

            let dtLine = '';
            if (s.showDate && s.showTime) dtLine = `${dateStr}  |  ${timeStr}`;
            else if (s.showDate)          dtLine = dateStr;
            else                          dtLine = timeStr;

            ctx.fillText(dtLine, cx, curY);
        }

        ctx.restore();

        // Drag dot
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle   = clr;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // ─── Seal event callbacks ─────────────────────────────────────────────────
    // ─── Helper: is current page a custom-override page? ─────────────────────
    // Use this instead of checking pageOverrideActive (which can be stale).
    function isOnCustomPage() {
        const chk = document.getElementById('pageOverrideChk');
        return !!(chk && chk.checked && pageOverrides[stampPreviewPage]);
    }

    function isCustomToggleChecked() {
        return !!document.getElementById('pageOverrideChk')?.checked;
    }

    window.onSealSettingChange = function () {
        const op = document.getElementById('sealOpacity'), opV = document.getElementById('sealOpacityVal');
        if (op && opV) opV.textContent = Math.round(op.value * 100) + '%';
        const sc = document.getElementById('sealScale'), sn = document.getElementById('sealScaleNum');
        if (sc && sn && document.activeElement !== sn) sn.value = Math.round(sc.value * 100);
        refreshOverlay();
    };

    window.syncSealScaleFromInput = function () {
        const sn = document.getElementById('sealScaleNum'), sl = document.getElementById('sealScale');
        let v = Math.min(250, Math.max(30, parseInt(sn.value) || 100));
        sn.value = v;
        if (sl) sl.value = v / 100;
        if (!isOnCustomPage()) sealSettings.scale = v / 100;
        refreshOverlay();
    };

    window.onSealPositionChange = function () {
        const x = parseInt(document.getElementById('sealPosX')?.value) || 50;
        const y = parseInt(document.getElementById('sealPosY')?.value) || 50;
        const xv = document.getElementById('sealPosXVal'), yv = document.getElementById('sealPosYVal');
        if (xv) xv.textContent = x + '%'; if (yv) yv.textContent = y + '%';
        if (!isOnCustomPage()) { sealSettings.positionX = x; sealSettings.positionY = y; }
        refreshOverlay();
    };

    // ─── Circular seal drawing ────────────────────────────────────────────────
    // Layout (matching physical stamp photo):
    //
    //   [CERTIFIED TRUE COPY curved along top arc]
    //
    //      Mar. 14, 2026      ← date value above line 1
    //   ─────────────────     ← line 1
    //        DATE             ← date label below line 1
    //
    //        CFC              ← school abbrev above line 2
    //   ─────────────────     ← line 2
    //   NAME OF SCHOOL        ← full school name below line 2
    //
    //   [FROM THE ORIGINAL curved along bottom arc]
    //
    function drawCircularSeal(ctx, w, h, s, dateObj) {
        const shortSide = Math.min(w, h);
        const r         = s.scale * (shortSide / 4.5);
        const cx        = (s.positionX / 100) * w;
        const cy        = (s.positionY / 100) * h;
        const clr       = s.color;

        ctx.save();
        ctx.globalAlpha = s.opacity;

        // ── Double circle border ──────────────────────────────────────────────
        const outerR = r;
        const innerR = r * 0.78;

        ctx.strokeStyle = clr;
        ctx.lineWidth   = r * 0.04;
        ctx.beginPath(); ctx.arc(cx, cy, outerR, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI * 2); ctx.stroke();

        // ── Arc text (between the two rings) ──────────────────────────────────
        const arcR      = (outerR + innerR) / 2;
        const topFontSz = r * 0.18;
        ctx.font         = `bold ${topFontSz}px Arial`;
        ctx.fillStyle    = clr;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        drawArcText(ctx, s.topText,    cx, cy, arcR, topFontSz, true);
        drawArcText(ctx, s.bottomText, cx, cy, arcR, topFontSz, false);

        // ── Decorative dots at 3 o'clock and 9 o'clock ───────────────────────
        const dotR = r * 0.04;
        [0, Math.PI].forEach(angle => {
            const dx = cx + arcR * Math.cos(angle);
            const dy = cy + arcR * Math.sin(angle);
            ctx.beginPath(); ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
            ctx.fillStyle = clr; ctx.fill();
        });

        // ── Inner two-section layout ──────────────────────────────────────────
        const lineLen    = innerR * 1.55;
        const lineWeight = r * 0.025;

        // Font size for editable values (date, school abbreviation) above the lines
        // ↓ Change the multiplier to adjust: e.g. r * 0.18 = bigger, r * 0.12 = smaller
        const valFontSz  = r * 0.18;

        // Font size for fixed labels "DATE" and "NAME OF SCHOOL" below the lines
        // ↓ Change the multiplier to adjust: e.g. r * 0.16 = bigger, r * 0.10 = smaller
        // const lblFontSz  = r * 0.120;
        const lblFontSz  = r * 0.120;

        // Centre the two-section block around cy
        const sectionH = r * 0.38;
        const line1Y   = cy - sectionH * 0.30;
        const line2Y   = cy + sectionH * 0.90;

        ctx.strokeStyle  = clr;
        ctx.lineWidth    = lineWeight;
        ctx.fillStyle    = clr;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        // ── Section 1: Date ───────────────────────────────────────────────────
        // Editable: date value sits above line 1
        ctx.font = `bold ${valFontSz}px Arial`;
        if (s.showDate) {
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            .replace(/([A-Za-z]{3})/, '$1.');
            ctx.fillText(dateStr, cx, line1Y - valFontSz * 0.90);
        }

        // Line 1
        ctx.beginPath();
        ctx.moveTo(cx - lineLen / 2, line1Y);
        ctx.lineTo(cx + lineLen / 2, line1Y);
        ctx.stroke();

        // Fixed label "DATE" below line 1 — not editable
        // ↓ To change font size of "DATE", adjust lblFontSz multiplier above
        ctx.font = `bold ${lblFontSz}px Arial`;
        ctx.fillText('DATE', cx, line1Y + lblFontSz * 0.9);

        // ── Section 2: School ─────────────────────────────────────────────────
        // Editable: school abbreviation above line 2
        ctx.font = `bold ${valFontSz}px Arial`;
        ctx.fillText(s.schoolAbbrev, cx, line2Y - valFontSz * 0.75);

        // Line 2
        ctx.beginPath();
        ctx.moveTo(cx - lineLen / 2, line2Y);
        ctx.lineTo(cx + lineLen / 2, line2Y);
        ctx.stroke();

        // Fixed label "NAME OF SCHOOL" below line 2 — not editable
        // ↓ To change font size of "NAME OF SCHOOL", adjust lblFontSz multiplier above
        ctx.font = `bold ${lblFontSz}px Arial`;
        ctx.fillText('NAME OF SCHOOL', cx, line2Y + lblFontSz * 0.9);

        // ── Drag dot ──────────────────────────────────────────────────────────
        ctx.restore();
        ctx.save(); ctx.globalAlpha = 0.2; ctx.fillStyle = clr;
        ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // Draws text curved along an arc (top = clockwise, bottom = counter-clockwise)
    function drawArcText(ctx, text, cx, cy, radius, fontSize, isTop) {
        ctx.save();
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle   = ctx.fillStyle;   // inherit
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';

        const chars    = text.split('');
        const totalLen = chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0);
        // Angular span of the text
        const totalAngle = totalLen / radius;

        // Top arc: text from roughly -150° to -30° (centred on top = -90° = -π/2)
        // Bottom arc: text from roughly 30° to 150° (centred on bottom = 90° = π/2)
        const startAngle = isTop
            ? -Math.PI / 2 - totalAngle / 2
            :  Math.PI / 2 + totalAngle / 2;

        let angle = startAngle;
        for (const ch of chars) {
            const chW       = ctx.measureText(ch).width;
            const charAngle = angle + (isTop ? chW / radius / 2 : -chW / radius / 2);
            ctx.save();
            ctx.translate(cx + radius * Math.cos(charAngle), cy + radius * Math.sin(charAngle));
            ctx.rotate(charAngle + (isTop ? Math.PI / 2 : -Math.PI / 2));
            ctx.fillText(ch, 0, 0);
            ctx.restore();
            angle += isTop ? chW / radius : -chW / radius;
        }
        ctx.restore();
    }
    window.onStampSettingChange = function () {
        const op = document.getElementById('stampOpacity'), opV = document.getElementById('stampOpacityVal');
        if (op && opV) opV.textContent = Math.round(op.value * 100) + '%';
        refreshOverlay();
    };

    window.syncRotationFromSlider = function () {
        const sl = document.getElementById('stampRotation'), num = document.getElementById('stampRotationNum');
        if (num) num.value = sl.value;
        if (!isOnCustomPage()) stampSettings.rotation = parseInt(sl.value);
        refreshOverlay();
    };

    window.syncRotationFromInput = function () {
        const num = document.getElementById('stampRotationNum'), sl = document.getElementById('stampRotation');
        let v = Math.min(180, Math.max(-180, parseInt(num.value) || 0));
        num.value = v; if (sl) sl.value = v;
        if (!isOnCustomPage()) stampSettings.rotation = v;
        refreshOverlay();
    };

    window.onStampPositionChange = function () {
        const x = parseInt(document.getElementById('stampPosX')?.value) || 50;
        const y = parseInt(document.getElementById('stampPosY')?.value) || 50;
        const xv = document.getElementById('stampPosXVal'), yv = document.getElementById('stampPosYVal');
        if (xv) xv.textContent = x + '%'; if (yv) yv.textContent = y + '%';
        if (!isOnCustomPage()) { stampSettings.positionX = x; stampSettings.positionY = y; }
        refreshOverlay();
    };

    window.onFmtSettingChange = function () {
        const op = document.getElementById('fmtOpacity'), opV = document.getElementById('fmtOpacityVal');
        const sc = document.getElementById('fmtScale'),   scV = document.getElementById('fmtScaleVal');
        const sn = document.getElementById('fmtScaleNum');
        if (op && opV) opV.textContent = Math.round(op.value * 100) + '%';
        if (sc) {
            const pct = Math.round(sc.value * 100);
            if (scV) scV.textContent = pct + '%';
            if (sn && document.activeElement !== sn) sn.value = pct;
        }
        refreshOverlay();
    };

    window.syncFmtScaleFromInput = function () {
        const sn = document.getElementById('fmtScaleNum'), sl = document.getElementById('fmtScale');
        const scV = document.getElementById('fmtScaleVal');
        let v = Math.min(250, Math.max(30, parseInt(sn.value) || 100));
        sn.value = v;
        const fv = v / 100;
        if (sl)  sl.value = fv;
        if (scV) scV.textContent = v + '%';
        if (!isOnCustomPage()) fmtSettings.scale = fv;
        refreshOverlay();
    };

    window.onFmtPositionChange = function () {
        const x = parseInt(document.getElementById('fmtPosX')?.value) || 50;
        const y = parseInt(document.getElementById('fmtPosY')?.value) || 50;
        const xv = document.getElementById('fmtPosXVal'), yv = document.getElementById('fmtPosYVal');
        if (xv) xv.textContent = x + '%'; if (yv) yv.textContent = y + '%';
        if (!isOnCustomPage()) { fmtSettings.positionX = x; fmtSettings.positionY = y; }
        refreshOverlay();
    };

    window.onStampPagesChange = function (radio, mode) {
        if (mode === 'simple') {
            stampSettings.applyPages = radio.value;
            const r = document.getElementById('stampRangeRow');
            if (r) r.style.display = radio.value === 'range' ? 'flex' : 'none';
        } else if (mode === 'formatted') {
            fmtSettings.applyPages = radio.value;
            const r = document.getElementById('fmtRangeRow');
            if (r) r.style.display = radio.value === 'range' ? 'flex' : 'none';
        } else if (mode === 'received') {
            recvSettings.applyPages = radio.value;
            const r = document.getElementById('recvRangeRow');
            if (r) r.style.display = radio.value === 'range' ? 'flex' : 'none';
        } else {
            sealSettings.applyPages = radio.value;
            const r = document.getElementById('sealRangeRow');
            if (r) r.style.display = radio.value === 'range' ? 'flex' : 'none';
        }
    };

    window.setStampPosition = function (x, y, mode, options = {}) {
        const isFmt  = (mode === 'formatted');
        const isSeal = (mode === 'seal');
        const isRecv = (mode === 'received');
        const pfx    = isFmt ? 'fmt' : (isSeal ? 'seal' : (isRecv ? 'recv' : 'stamp'));
        const targetPage = options.pageNum || stampPreviewPage;
        if (!stampOnlyMode && pageOverrides[targetPage]) {
            pageOverrides[targetPage].positionX = x;
            pageOverrides[targetPage].positionY = y;
        } else if (!isOnCustomPage()) {
            const s = isFmt ? fmtSettings : (isSeal ? sealSettings : (isRecv ? recvSettings : stampSettings));
            s.positionX = x; s.positionY = y;
        }
        const px = document.getElementById(pfx + 'PosX'),   py = document.getElementById(pfx + 'PosY');
        const xv = document.getElementById(pfx + 'PosXVal'), yv = document.getElementById(pfx + 'PosYVal');
        if (px) px.value = x; if (py) py.value = y;
        if (xv) xv.textContent = x + '%'; if (yv) yv.textContent = y + '%';
        if (options.skipRefresh) return;
        saveActiveStampDocumentState();
        refreshOverlay();
    };

    window.changeStampPreviewPage = async function (d) {
        if (stampOnlyMode) return;   // no PDF pages in stamp-only mode
        if (!stampPdfDoc) return;
        if (stampViewMode === 'continuous') syncStampPreviewPageFromScroll();
        const step = stampViewMode === 'two-page' ? d * 2 : d;
        if (stampViewMode === 'two-page') {
            stampPreviewPage = getTwoPageSpreadStart(stampPreviewPage + step);
        } else {
            stampPreviewPage = Math.min(Math.max(1, stampPreviewPage + step), stampTotalPages);
        }
        saveActiveStampDocumentState();
        if (stampViewMode === 'continuous') {
            updateStampPageControls();
            scrollStampPreviewToPage(stampPreviewPage);
            return;
        }
        await renderStampPreviewPage();
    };

    window.goToStampPreviewPage = async function (pageValue) {
        if (stampOnlyMode || !stampPdfDoc) return;
        const page = Math.min(Math.max(1, parseInt(pageValue, 10) || 1), stampTotalPages);
        stampPreviewPage = stampViewMode === 'two-page' ? getTwoPageSpreadStart(page) : page;
        saveActiveStampDocumentState();
        if (stampViewMode === 'continuous') {
            updateStampPageControls();
            scrollStampPreviewToPage(stampPreviewPage);
            return;
        }
        await renderStampPreviewPage();
    };

    window.changeStampZoom = function (d) {
        stampPreviewScale = Math.min(Math.max(0.4, stampPreviewScale + d), 3.0);
        const lbl = document.getElementById('stampZoomLabel');
        if (lbl) lbl.textContent = Math.round(stampPreviewScale * 100) + '%';
        saveStampSettings();
        if (stampOnlyMode) {
            renderStampOnlyPreview();
        } else {
            renderStampPreviewPage();
        }
    };

    // ─── Download ─────────────────────────────────────────────────────────────
    window.applyStampAndDownload = async function () {
        if (!stampPdfBytes) { showNotification('Please upload a PDF first.', 'warning'); return; }
        if (stampMode === 'formatted') readFmtSettings();
        else if (stampMode === 'seal') readSealSettings();
        else if (stampMode === 'received') readRecvSettings();
        else readStampSettings();
        const active = getActiveSettings();
        const pages  = resolvePages(active);
        if (!pages.length) { showNotification('No valid pages selected.', 'warning'); return; }

        saveActiveStampDocumentState();
        showProgress('Stamping PDF…', 'Applying stamp to pages');
        try {
            const b64 = await buildStampedPDF(pages);
            downloadFile(b64, getStampedFilename());
            showNotification('Stamped PDF downloaded successfully!', 'success');
        } catch (err) {
            showNotification('Error: ' + err.message, 'error'); console.error(err);
        } finally {
            hideProgress();
        }
    };

    // ─── Print ────────────────────────────────────────────────────────────────
    window.applyStampAndPrint = async function () {
        if (!stampPdfBytes) { showNotification('Please upload a PDF first.', 'warning'); return; }
        if (stampMode === 'formatted') readFmtSettings();
        else if (stampMode === 'seal') readSealSettings();
        else if (stampMode === 'received') readRecvSettings();
        else readStampSettings();
        const active = getActiveSettings();
        const pages  = resolvePages(active);
        if (!pages.length) { showNotification('No valid pages selected.', 'warning'); return; }

        saveActiveStampDocumentState();
        showProgress('Preparing print…', 'Rendering stamped pages');
        try {
            const b64      = await buildStampedPDF(pages);
            const pdfBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
            openStampedPdfPrintModal({ b64, blob, bytes: pdfBytes });

        } catch (err) {
            showNotification('Error: ' + err.message, 'error'); console.error(err);
        } finally {
            hideProgress();
        }
    };

    function resolvePages(s) {
        if (!stampPdfDoc) return [];
        if (s.applyPages === 'all')     return Array.from({ length: stampTotalPages }, (_, i) => i + 1);
        if (s.applyPages === 'current') return [stampPreviewPage];
        return parsePageRange(s.pageRange, stampTotalPages);
    }

    function getActiveSettings() {
        if (stampMode === 'formatted') return fmtSettings;
        if (stampMode === 'seal')      return sealSettings;
        if (stampMode === 'received')  return recvSettings;
        return stampSettings;
    }

    function parsePageRange(str, total) {
        const pages = new Set();
        for (const part of str.split(',')) {
            const t = part.trim();
            if (t.includes('-')) {
                const [a, b] = t.split('-').map(Number);
                for (let i = Math.max(1, a); i <= Math.min(total, b); i++) pages.add(i);
            } else { const n = parseInt(t); if (n >= 1 && n <= total) pages.add(n); }
        }
        return [...pages].sort((a, b) => a - b);
    }

    function getStampedFilename() { return stampFileName.replace(/\.pdf$/i, '') + '_stamped.pdf'; }

    // ─── Build stamped PDF ────────────────────────────────────────────────────
    async function buildStampedPDF(stampedPageNums) {
        return buildStampedPDFForDocument(stampPdfDoc, stampTotalPages, stampedPageNums, true);
    }

    async function buildStampedPDFForDocument(pdfDoc, totalPages, stampedPageNums, usePageOverrides = false) {
        const stampSet  = new Set(stampedPageNums), now = new Date();
        const renderSettings = getStampOutputRenderSettings();
        const RENDER_SCALE = renderSettings.scale;
        const JPEG_QUALITY = renderSettings.jpegQuality;
        updateProgress(0, 'Preparing pages…');
        const pages = [];

        for (let pNum = 1; pNum <= totalPages; pNum++) {
            updateProgress((pNum / totalPages) * 70, `Rendering page ${pNum}/${totalPages}…`);
            const page = await pdfDoc.getPage(pNum);

            const vpReal   = page.getViewport({ scale: 1.0 });
            const ptW      = vpReal.width;
            const ptH      = vpReal.height;
            const outputSize = getStampOutputPageSize(ptW, ptH);

            const vpHigh   = page.getViewport({ scale: RENDER_SCALE });
            const canvas   = document.createElement('canvas');
            canvas.width   = Math.round(outputSize.ptW * RENDER_SCALE);
            canvas.height  = Math.round(outputSize.ptH * RENDER_SCALE);
            const ctx      = canvas.getContext('2d');
            ctx.fillStyle  = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
                canvasContext: ctx,
                viewport: vpHigh,
                transform: [
                    1, 0, 0, 1,
                    Math.round((canvas.width - vpHigh.width) / 2),
                    Math.round((canvas.height - vpHigh.height) / 2)
                ]
            }).promise;

            // Grayscale page — stamp is drawn after so it stays in color
            if (bwMode) applyGrayscaleToCanvas(canvas);

            if (stampSet.has(pNum)) {
                // Use per-page override settings if they exist, otherwise global
                const ovr = usePageOverrides ? pageOverrides[pNum] : null;
                if (stampMode === 'formatted') {
                    const s = ovr ? Object.assign({}, fmtSettings, ovr) : fmtSettings;
                    drawFormattedStamp(ctx, canvas.width, canvas.height, s, now);
                } else if (stampMode === 'seal') {
                    const s = ovr ? Object.assign({}, sealSettings, ovr) : sealSettings;
                    drawCircularSeal(ctx, canvas.width, canvas.height, s, now);
                } else if (stampMode === 'received') {
                    const s = ovr ? Object.assign({}, recvSettings, ovr) : recvSettings;
                    drawReceivedStamp(ctx, canvas.width, canvas.height, s, now);
                } else {
                    const base = ovr ? Object.assign({}, stampSettings, ovr) : stampSettings;
                    const ratio = canvas.width / 595;
                    const s2    = Object.assign({}, base, {
                        fontSize:    base.fontSize    * ratio,
                        borderWidth: base.borderWidth * ratio
                    });
                    drawSimpleStamp(ctx, canvas.width, canvas.height, s2);
                }
            }

            pages.push({
                dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
                canvasW: canvas.width,
                canvasH: canvas.height,
                ptW: outputSize.ptW,
                ptH: outputSize.ptH
            });
        }

        updateProgress(75, 'Building PDF…');
        await new Promise(r => setTimeout(r, 30));

        const pdfBytes = buildPDFFromImages(pages);

        updateProgress(95, 'Encoding…');
        await new Promise(r => setTimeout(r, 30));

        const result = uint8ToBase64(pdfBytes);

        updateProgress(100, 'Done!');
        await new Promise(r => setTimeout(r, 200));

        return result;
    }

    function uint8ToBase64(bytes) {
        const CHUNK = 8192;
        let binary  = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        return btoa(binary);
    }

    // ─── Minimal PDF builder from JPEG images ────────────────────────────────
    function buildPDFFromImages(pages) {
        const enc = new TextEncoder(), hdr = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';

        const imgBufs = pages.map(p => {
            const raw = atob(p.dataUrl.split(',')[1]);
            const buf = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
            return buf;
        });

        const objs = [{ id: 1, str: `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` }];
        let nid = 3; const pids = [], idata = [];

        for (let i = 0; i < pages.length; i++) {
            const imgId = nid++, pageId = nid++;
            pids.push(pageId);
            idata.push({
                imgId, pageId, buf: imgBufs[i],
                imgW: pages[i].canvasW, imgH: pages[i].canvasH,
                ptW:  pages[i].ptW,    ptH:  pages[i].ptH
            });
        }

        objs.push({ id: 2, str: `2 0 obj\n<< /Type /Pages /Kids [${pids.map(id => id + ' 0 R').join(' ')}] /Count ${pages.length} >>\nendobj\n` });

        for (const d of idata) {
            objs.push({ id: d.imgId, buf: d.buf, meta: {
                header: `${d.imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(d.imgW)} /Height ${Math.round(d.imgH)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${d.buf.length} >>\nstream\n`,
                footer: `\nendstream\nendobj\n`
            }});

            const cs  = `q ${d.ptW.toFixed(2)} 0 0 ${d.ptH.toFixed(2)} 0 0 cm /Im${d.imgId} Do Q`;
            const cid = nid++;
            objs.push({ id: cid, str: `${cid} 0 obj\n<< /Length ${cs.length} >>\nstream\n${cs}\nendstream\nendobj\n` });
            const pageBox = `[0 0 ${d.ptW.toFixed(2)} ${d.ptH.toFixed(2)}]`;
            objs.push({ id: d.pageId, str: `${d.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox ${pageBox} /CropBox ${pageBox} /TrimBox ${pageBox} /BleedBox ${pageBox} /Resources << /XObject << /Im${d.imgId} ${d.imgId} 0 R >> >> /Contents ${cid} 0 R >>\nendobj\n` });
        }

        objs.sort((a, b) => a.id - b.id);

        const parts = [enc.encode(hdr)]; let off = hdr.length; const xref = {};
        for (const o of objs) {
            xref[o.id] = off;
            if (o.str) {
                const c = enc.encode(o.str); parts.push(c); off += c.length;
            } else if (o.buf && o.meta) {
                const h2 = enc.encode(o.meta.header), f2 = enc.encode(o.meta.footer);
                parts.push(h2, o.buf, f2); off += h2.length + o.buf.length + f2.length;
            }
        }

        const maxId = Math.max(...Object.keys(xref).map(Number));
        let xs = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
        for (let i = 1; i <= maxId; i++) {
            xs += (xref[i] !== undefined ? String(xref[i]).padStart(10, '0') : '0000000000') + ' 00000 n \n';
        }
        parts.push(enc.encode(xs + `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF\n`));

        const total = parts.reduce((acc, p) => acc + p.length, 0);
        const out   = new Uint8Array(total); let pos = 0;
        for (const p of parts) { out.set(p, pos); pos += p.length; }
        return out;
    }

})();
