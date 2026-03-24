// js/stamp.js - PDF Stamp / Watermark Tool

(function () {
    'use strict';

    // ─── State ────────────────────────────────────────────────────────────────
    let stampPdfDoc       = null;
    let stampPdfBytes     = null;
    let stampFileName     = '';
    let stampTotalPages   = 0;
    let stampPreviewPage  = 1;
    let stampPreviewScale = 1.0;

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
        name:        'JOAN R. ESPINOZA, MBM, LPT, CHRA',
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

    // Drag state
    let isDragging = false, dragStartX = 0, dragStartY = 0,
        dragStartPosX = 0, dragStartPosY = 0;

    // ─── Per-page overrides ───────────────────────────────────────────────────
    // pageOverrides[pageNum] = deep copy of settings for that page (if customized)
    // Reset whenever a new PDF is loaded.
    let pageOverrides = {};   // e.g. { 2: { positionX:30, positionY:70, ... }, 3: {...} }
    let pageOverrideActive = false;  // true when current page has the checkbox ticked

    // ─── Stamp-only mode (no PDF) ─────────────────────────────────────────────
    let stampOnlyMode = false;   // true when "Print Stamp Only" checkbox is checked
    let bwMode        = false;   // true when "Grayscale page" is checked
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

    // ─── Persist settings to localStorage ────────────────────────────────────
    const LS_KEY_SIMPLE = 'stampSettings_v1';
    const LS_KEY_FMT    = 'fmtSettings_v1';
    const LS_KEY_MODE   = 'stampMode_v1';
    const LS_KEY_SEAL   = 'sealSettings_v1';

    function saveStampSettings() {
        try {
            localStorage.setItem(LS_KEY_SIMPLE, JSON.stringify(stampSettings));
            localStorage.setItem(LS_KEY_FMT,    JSON.stringify(fmtSettings));
            localStorage.setItem(LS_KEY_SEAL,   JSON.stringify(sealSettings));
            localStorage.setItem(LS_KEY_MODE,   stampMode);
        } catch(e) {}
    }

    function loadStampSettings() {
        try {
            const s = localStorage.getItem(LS_KEY_SIMPLE);
            const f = localStorage.getItem(LS_KEY_FMT);
            const e = localStorage.getItem(LS_KEY_SEAL);
            const m = localStorage.getItem(LS_KEY_MODE);
            if (s) stampSettings = Object.assign(stampSettings, JSON.parse(s));
            if (f) fmtSettings   = Object.assign(fmtSettings,   JSON.parse(f));
            if (e) sealSettings  = Object.assign(sealSettings,  JSON.parse(e));
            if (m) stampMode     = m;
        } catch(e) {}
    }

    // Exposed so you can wire a "Reset to defaults" button if needed:
    // <button onclick="clearStampSettings(); initStamp()">Reset Settings</button>
    window.clearStampSettings = function () {
        localStorage.removeItem(LS_KEY_SIMPLE);
        localStorage.removeItem(LS_KEY_FMT);
        localStorage.removeItem(LS_KEY_SEAL);
        localStorage.removeItem(LS_KEY_MODE);
    };

    // ─── Init ─────────────────────────────────────────────────────────────────
    window.initStamp = function () {
        resetStampState();
        renderStampUI();
    };

    function resetStampState() {
        stampPdfDoc = null; stampPdfBytes = null; stampFileName = '';
        stampTotalPages = 0; stampPreviewPage = 1; stampPreviewScale = 1.0; stampMode = 'simple';
        bwMode = false;
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
            name: 'JOAN R. ESPINOZA, MBM, LPT, CHRA',
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
              <div class="stamp-section-title">📄 PDF File</div>

              <!-- Print Stamp Only toggle -->
              <label class="stamp-check" style="margin-bottom:8px;padding:8px;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;gap:8px"
                     title="Check this to preview and print the stamp without loading a PDF">
                <input type="checkbox" id="stampOnlyChk" onchange="toggleStampOnlyMode(this.checked)">
                🖨️ Stamp Only (no PDF)
              </label>

              <!-- PDF drop zone — hidden when stamp-only mode is active -->
              <div id="stampDropZoneWrap">
                <div class="stamp-upload-area" id="stampDropZone" onclick="document.getElementById('stampFileInput').click()">
                  <div id="stampUploadLabel">
                    <div style="font-size:28px;margin-bottom:6px">📄</div>
                    <div>Click or drag a PDF here</div>
                  </div>
                </div>
                <input type="file" id="stampFileInput" accept=".pdf" style="display:none" onchange="handleStampFile(event)">
              </div>
            </div>

            <!-- Mode Toggle -->
            <div class="stamp-section">
            <br>
              <div class="stamp-section-title">🔖 Stamp Type</div>
              <div class="stamp-mode-toggle">
                <button id="modeSimpleBtn" class="stamp-mode-btn active" onclick="switchStampMode('simple')">✏️ Simple Text</button>
              </div>
              <div class="stamp-mode-toggle">
                <button id="modeFormattedBtn" class="stamp-mode-btn" onclick="switchStampMode('formatted')">📋 Official Stamp</button>
              </div>
              <div class="stamp-mode-toggle">
                <button id="modeSealBtn" class="stamp-mode-btn" onclick="switchStampMode('seal')">🔵 Round Seal</button>
              </div>
            </div>

            <!-- ══════ SIMPLE CONTROLS ══════ -->
            <div id="simpleStampControls">

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">⚡ Quick Presets</div>
                <div class="stamp-presets" id="stampPresets"></div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">✏️ Stamp Text</div>
                <input class="stamp-input" id="stampText" type="text" value="${stampSettings.text}"
                       placeholder="Enter stamp text…" oninput="onStampSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">🎨 Style</div>
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
                  <label class="stamp-check"><input type="checkbox" id="stampBold" ${stampSettings.bold ? 'checked' : ''} onchange="onStampSettingChange(); showToast(this.checked ? '✅ Bold enabled' : '❌ Bold disabled')"> <b>Bold</b></label>
                  <label class="stamp-check"><input type="checkbox" id="stampItalic" ${stampSettings.italic ? 'checked' : ''} onchange="onStampSettingChange(); showToast(this.checked ? '✅ Italic enabled' : '❌ Italic disabled')"> <i>Italic</i></label>
                  <label class="stamp-check"><input type="checkbox" id="stampBorder" ${stampSettings.border ? 'checked' : ''} onchange="onStampSettingChange(); showToast(this.checked ? '✅ Border enabled' : '❌ Border disabled')"> Border</label>
                </div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">📍 Position <small style="font-weight:400;color:var(--text-secondary)">(or drag in preview)</small></div>
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
                  <input type="checkbox" onchange="document.getElementById('simplePosGrid').style.display=this.checked?'grid':'none'; showToast(this.checked ? '📍 Position shortcuts shown' : '📍 Position shortcuts hidden')">
                  Show position shortcuts
                </label>
                <div id="simplePosGrid" class="stamp-pos-grid" style="display:none">
                  ${makePosBtns('simple')}
                </div>
              </div>

              <div class="stamp-section stamp-apply-pages-section" id="simpleApplyPages" style="display:none">
              <br>
                <div class="stamp-section-title">📋 Apply to Pages</div>
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
                <div class="stamp-section-title">📝 Header Text</div>
                <textarea class="stamp-input" id="fmtTitle" rows="2" oninput="onFmtSettingChange()" style="resize:vertical">${fmtSettings.title}</textarea>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">👤 Signatory Name</div>
                <input class="stamp-input" id="fmtName" type="text" value="${fmtSettings.name}" oninput="onFmtSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">🏷️ Position / Title</div>
                <input class="stamp-input" id="fmtSubName" type="text" value="${fmtSettings.subName}" oninput="onFmtSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">🏫 Institution</div>
                <input class="stamp-input" id="fmtInstitution" type="text" value="${fmtSettings.institution}" oninput="onFmtSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">🎨 Appearance</div>
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
                  <label class="stamp-check"><input type="checkbox" id="fmtShowDate" ${fmtSettings.showDate ? 'checked' : ''} onchange="onFmtSettingChange(); showToast(this.checked ? '📅 Date shown' : '📅 Date hidden')"> Show Date</label>
                  <label class="stamp-check"><input type="checkbox" id="fmtShowTime" ${fmtSettings.showTime ? 'checked' : ''} onchange="onFmtSettingChange(); showToast(this.checked ? '🕐 Time shown' : '🕐 Time hidden')"> Show Time</label>
                  <label class="stamp-check"><input type="checkbox" id="fmtTransparent" ${fmtSettings.transparentBg ? 'checked' : ''} onchange="onFmtSettingChange(); showToast(this.checked ? '🪟 Transparent BG on' : '🪟 Transparent BG off')"> Transparent BG</label>
                  <label class="stamp-check" title="Convert the PDF page to grayscale — stamp color is preserved">
                    <input type="checkbox" id="bwModeChk" onchange="toggleBwMode(this.checked)"> Grayscale PDF
                  </label>
                </div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">📍 Position <small style="font-weight:400;color:var(--text-secondary)">(or drag in preview)</small></div>
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
                  <input type="checkbox" onchange="document.getElementById('fmtPosGrid').style.display=this.checked?'grid':'none'; showToast(this.checked ? '📍 Position shortcuts shown' : '📍 Position shortcuts hidden')">
                  Show position shortcuts
                </label>
                <div id="fmtPosGrid" class="stamp-pos-grid" style="display:none">
                  ${makePosBtns('formatted')}
                </div>
              </div>

              <div class="stamp-section stamp-apply-pages-section" id="fmtApplyPages" style="display:none">
              <br>
                <div class="stamp-section-title">📋 Apply to Pages</div>
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
                <div class="stamp-section-title">⬆️ Top Arc Text</div>
                <input class="stamp-input" id="sealTopText" type="text" value="${sealSettings.topText}" oninput="onSealSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">⬇️ Bottom Arc Text</div>
                <input class="stamp-input" id="sealBottomText" type="text" value="${sealSettings.bottomText}" oninput="onSealSettingChange()">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">🔤 School Abbreviation</div>
                <input class="stamp-input" id="sealSchoolAbbrev" type="text" value="${sealSettings.schoolAbbrev}" oninput="onSealSettingChange()" placeholder="e.g. CFC">
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">📅 Show Date</div>
                <div class="stamp-row" style="gap:14px;flex-wrap:wrap">
                  <label class="stamp-check"><input type="checkbox" id="sealShowDate" ${sealSettings.showDate ? 'checked' : ''} onchange="onSealSettingChange(); showToast(this.checked ? '📅 Date shown' : '📅 Date hidden')"> Show current date above DATE line</label>
                </div>
              </div>

              <div class="stamp-section">
              <br>
                <div class="stamp-section-title">🎨 Appearance</div>
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
                <div class="stamp-section-title">📍 Position <small style="font-weight:400;color:var(--text-secondary)">(or drag in preview)</small></div>
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
                  <input type="checkbox" onchange="document.getElementById('sealPosGrid').style.display=this.checked?'grid':'none'; showToast(this.checked ? '📍 Position shortcuts shown' : '📍 Position shortcuts hidden')">
                  Show position shortcuts
                </label>
                <div id="sealPosGrid" class="stamp-pos-grid" style="display:none">
                  ${makePosBtns('seal')}
                </div>
              </div>

              <div class="stamp-section stamp-apply-pages-section" id="sealApplyPages" style="display:none">
              <br>
                <div class="stamp-section-title">📋 Apply to Pages</div>
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

            <!-- Download / Print / Print Stamp Only -->
            <div class="stamp-section" style="padding-top:4px;display:flex;gap:8px;flex-wrap:wrap">
              <!-- Normal PDF buttons — visible in normal mode, hidden in stamp-only mode -->
              <button class="btn btn-primary stamp-apply-btn" id="stampApplyBtn" onclick="applyStampAndDownload()" disabled style="flex:1;text-align:center; justify-content: center;">
                ⬇️ Download
              </button>
              <button class="btn stamp-apply-btn stamp-print-btn" id="stampPrintBtn" onclick="applyStampAndPrint()" disabled style="flex:1;text-align:center; justify-content: center;">
                🖨️ Print
              </button>
              <!-- Stamp-only print button — hidden in normal mode, visible+enabled in stamp-only mode -->
              <button class="btn stamp-apply-btn stamp-print-btn" id="stampPrintOnlyBtn" onclick="openPrintStampOnly()" disabled style="flex:1;width:100%;display:none;text-align:center; justify-content: center;">
                🖨️ Print
              </button>
            </div>

          </div><!-- end stamp-controls-panel -->

          <!-- RIGHT: Preview -->
          <div class="stamp-preview-panel">
            <div class="stamp-preview-toolbar">
              <button class="stamp-tool-btn" onclick="changeStampPreviewPage(-1)">◀ Prev</button>
              <span id="stampPageIndicator">Page - / -</span>
              <button class="stamp-tool-btn" onclick="changeStampPreviewPage(1)">Next ▶</button>
              <span style="flex:1"></span>
              <!-- Orientation selector — only visible in stamp-only mode -->
              <select id="stampOnlyOrient" onchange="stampOnlyOrientChange()"
                      style="display:none;font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);cursor:pointer">
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
              <!-- Per-page override checkbox — only visible when PDF loaded & >1 page -->
              <label id="pageOverrideLabel" class="stamp-check" style="display:none;font-size:12px;gap:5px;white-space:nowrap;cursor:pointer"
                     title="When checked, settings on this page are independent from other pages">
                <input type="checkbox" id="pageOverrideChk" onchange="togglePageOverride(this.checked)">
                Custom this page
              </label>
              <button class="stamp-tool-btn" onclick="changeStampZoom(-0.2)">−</button>
              <span id="stampZoomLabel" style="min-width:44px;text-align:center">${Math.round(stampPreviewScale * 100)}%</span>
              <button class="stamp-tool-btn" onclick="changeStampZoom(0.2)">+</button>
            </div>
            <div class="stamp-preview-scroll" id="stampPreviewScroll">
              <div class="stamp-preview-canvas-wrap" id="stampCanvasWrap">
                <canvas id="stampBaseCanvas"></canvas>
                <canvas id="stampOverlayCanvas"></canvas>
              </div>
              <div class="stamp-preview-empty" id="stampPreviewEmpty">
                <div style="font-size:48px;margin-bottom:12px">🖋️</div>
                <div id="stampPreviewEmptyMsg">Upload a PDF to preview the stamp</div>
              </div>
            </div>
          </div>

        </div>`;

        buildPresets();
        setupStampDropZone();
        setupOverlayDrag();   // attach drag listeners once after DOM is built

        // Restore the saved mode tab (simple / formatted / seal)
        if (stampMode === 'formatted' || stampMode === 'seal') {
            window.switchStampMode(stampMode);
        }
    }

    function makePosBtns(mode) {
        const arrows = ['↖','↑','↗','←','✛','→','↙','↓','↘'];
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
        document.getElementById('modeSimpleBtn').classList.toggle('active',    mode === 'simple');
        document.getElementById('modeFormattedBtn').classList.toggle('active', mode === 'formatted');
        document.getElementById('modeSealBtn').classList.toggle('active',      mode === 'seal');
        saveStampSettings();
        if (stampOnlyMode) {
            renderStampOnlyPreview();
        } else {
            refreshOverlay();
        }
    };

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
            const f = e.dataTransfer.files[0];
            if (f && f.type === 'application/pdf') loadStampFile(f);
        });
    }

    window.handleStampFile = function (ev) {
        const f = ev.target.files[0];
        if (f) loadStampFile(f);
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
                await renderStampPreviewPage();
            } catch (err) {
                showNotification('Could not read PDF: ' + err.message, 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    // ─── Preview rendering ────────────────────────────────────────────────────
    async function renderStampPreviewPage() {
        if (!stampPdfDoc) return;
        const page     = await stampPdfDoc.getPage(stampPreviewPage);
        const viewport = page.getViewport({ scale: stampPreviewScale });

        const base = document.getElementById('stampBaseCanvas');
        const over = document.getElementById('stampOverlayCanvas');
        if (!base || !over) return;

        base.width  = over.width  = viewport.width;
        base.height = over.height = viewport.height;

        await page.render({ canvasContext: base.getContext('2d'), viewport }).promise;

        // Grayscale page — applied to base canvas only; stamp overlay stays in color
        if (bwMode) applyGrayscaleToCanvas(base);

        document.getElementById('stampPageIndicator').textContent = `Page ${stampPreviewPage} / ${stampTotalPages}`;

        // Update Apply to Pages visibility based on page count
        const modes = [
            { sectionId: 'simpleApplyPages', rangeRowId: 'stampRangeRow' },
            { sectionId: 'fmtApplyPages',    rangeRowId: 'fmtRangeRow'   },
            { sectionId: 'sealApplyPages',   rangeRowId: 'sealRangeRow'  },
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

        drawStampOverlay(over, viewport.width, viewport.height);
    }

    function drawStampOverlay(canvas, w, h) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        // Use per-page override if this page has one.
        // When override exists, do NOT call readXxxSettings() — that would write
        // the custom page's UI values into the global settings object, contaminating
        // every other page. The override snapshot is fully self-contained.
        const ovr = pageOverrides[stampPreviewPage];

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
        showToast(checked ? '🖨️ Stamp-only mode enabled' : '📄 Stamp-only mode disabled');
        // ── Show a brief loading overlay on the preview panel ─────────────────
        const previewScroll = document.getElementById('stampPreviewScroll');
        let loadingEl = null;
        if (previewScroll) {
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

            if (checked) {
                if (dropWrap)    dropWrap.style.display        = 'none';
                if (applyBtn)  { applyBtn.disabled = true;  applyBtn.style.display  = 'none'; }
                if (printBtn)  { printBtn.disabled = true;  printBtn.style.display  = 'none'; }
                if (printOnly) { printOnly.disabled = false; printOnly.style.display = 'flex'; }
                if (overrideLbl) overrideLbl.style.display     = 'none';
                if (emptyMsg)    emptyMsg.textContent          = 'Adjust settings to preview the stamp';

                // Show orientation dropdown
                const orientSel = document.getElementById('stampOnlyOrient');
                if (orientSel) orientSel.style.display = '';

                // Hide Apply to Pages in all three modes
                ['simpleApplyPages','fmtApplyPages','sealApplyPages'].forEach(id => {
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

                // Hide orientation dropdown
                const orientSel = document.getElementById('stampOnlyOrient');
                if (orientSel) orientSel.style.display = 'none';

                // Restore Apply to Pages — only show if PDF loaded with 2+ pages
                if (!hasPdf || stampTotalPages <= 1) {
                    ['simpleApplyPages','fmtApplyPages','sealApplyPages'].forEach(id => {
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

    // Loading effect wrapper for orientation change
    window.stampOnlyOrientChange = function () {
        const scroll = document.getElementById('stampPreviewScroll');
        if (!scroll) { renderStampOnlyPreview(); return; }

        // Inject a brief fade overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:absolute;inset:0;z-index:50;
            background:var(--bg-primary);
            display:flex;align-items:center;justify-content:center;
            opacity:0;transition:opacity 0.15s ease;pointer-events:all;
        `;
        overlay.innerHTML = `<div style="
            width:32px;height:32px;border-radius:50%;
            border:3px solid var(--border-color);
            border-top-color:var(--accent-color);
            animation:modeSpinAnim 0.7s linear infinite;">
        </div>`;
        scroll.style.position = 'relative';
        scroll.appendChild(overlay);

        // Fade in
        requestAnimationFrame(() => { overlay.style.opacity = '1'; });

        // Render after overlay is visible, then fade out
        setTimeout(function () {
            renderStampOnlyPreview();
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 200);
        }, 200);
    };

    window.renderStampOnlyPreview = function renderStampOnlyPreview() {
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
        showToast(checked ? '🩶 Grayscale PDF enabled' : '🎨 Grayscale PDF disabled');
        renderStampPreviewPage();
    };

    // Converts all pixels of a canvas to grayscale in-place.
    // Stamp is drawn AFTER this so it stays in full color.
    function applyGrayscaleToCanvas(canvas) {
        const ctx  = canvas.getContext('2d');
        const imgd = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d    = imgd.data;
        for (let i = 0; i < d.length; i += 4) {
            const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
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
            showToast(`✏️ Custom override on for page ${stampPreviewPage}`);
            showNotification(`Page ${stampPreviewPage} now has custom stamp settings.`, 'info');
        } else {
            // Remove override — revert to global settings
            delete pageOverrides[stampPreviewPage];
            loadSettingsIntoUI(null);   // restore global settings into UI controls
            refreshOverlay();
            showToast(`↩️ Page ${stampPreviewPage} reverted to global settings`);
            showNotification(`Page ${stampPreviewPage} reverted to global settings.`, 'info');
        }
    };

    // Snapshot the current UI state into pageOverrides for the current page.
    // Reads DOM values directly into a fresh object — never writes to global
    // stampSettings / fmtSettings / sealSettings to avoid cross-page contamination.
    function saveCurrentPageOverride() {
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
        pageOverrides[stampPreviewPage] = snapshot;
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
              <div style="font-size:16px;font-weight:700;color:var(--text-primary)">🖨️ Print Stamp Only</div>
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
                  <div style="font-size:12px;font-weight:700;color:var(--text-primary)" id="psoFeedTitle">📄 Portrait — How to Feed the Paper</div>
                  <div id="psoFeedSvg" style="width:100%;overflow-x:auto"></div>
                  <div style="font-size:11px;color:var(--text-secondary);line-height:1.6" id="psoFeedDesc"></div>
                </div>

                <div style="display:flex;flex-direction:column;gap:8px">
                  <label style="font-size:12px;font-weight:600;color:var(--text-secondary)">Copies (stamps per page)</label>
                  <input type="number" id="psoCopies" class="stamp-input" value="1" min="1" max="20" style="width:80px">
                  <div style="font-size:11px;color:var(--text-secondary)">Multiple copies tile the stamp evenly across the page.</div>
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
              <button onclick="executePrintStampOnly()" class="btn btn-primary" style="flex:1;justify-content:center;">🖨️ Print</button>
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
            titleEl.textContent = '📄 Portrait — How to Feed the Paper';
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
            titleEl.textContent = '🔄 Landscape — How to Feed the Paper';
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

    window.executePrintStampOnly = function () {
        const sizeKey    = document.getElementById('psoPageSize')?.value || 'A4';
        const orient     = document.querySelector('input[name="psoOrient"]:checked')?.value || 'portrait';
        const copies  = Math.max(1, Math.min(20, parseInt(document.getElementById('psoCopies')?.value) || 1));

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
        else readStampSettings();

        // Draw stamp exactly as shown in preview — no rotation.
        // What you see in the canvas is what prints.
        if (copies === 1) {
            drawStampOnCanvas(ctx, cW, cH, now);
        } else {
            const cols = Math.ceil(Math.sqrt(copies));
            const rows = Math.ceil(copies / cols);
            let drawn  = 0;
            for (let r = 0; r < rows && drawn < copies; r++) {
                for (let c = 0; c < cols && drawn < copies; c++) {
                    const posX = ((c + 0.5) / cols) * 100;
                    const posY = ((r + 0.5) / rows) * 100;
                    drawStampOnCanvasAt(ctx, cW, cH, now, posX, posY);
                    drawn++;
                }
            }
        }

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
    };

    // Draw the stamp at its configured positionX/Y
    function drawStampOnCanvas(ctx, w, h, dateObj) {
        if (stampMode === 'formatted') drawFormattedStamp(ctx, w, h, fmtSettings, dateObj);
        else if (stampMode === 'seal') drawCircularSeal(ctx, w, h, sealSettings, dateObj);
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

        canvas.style.cursor = 'crosshair';

        // Mouse
        canvas.addEventListener('mousedown', function (e) {
            if (!stampPdfDoc && !stampOnlyMode) return;
            const pos = getCanvasPos(e, canvas);
            isDragging = true;
            dragStartX = pos.x; dragStartY = pos.y;
            // Use page override if active, else global settings
            const ovr = pageOverrideActive ? pageOverrides[stampPreviewPage] : null;
            const globalS = stampMode === 'formatted' ? fmtSettings
                          : stampMode === 'seal'       ? sealSettings
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
            setStampPosition(Math.round(newX), Math.round(newY), stampMode);
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
            roundRect(ctx, -(m.width + 22) / 2, -(s.fontSize + 18) / 2, m.width + 22, s.fontSize + 18, 6);
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

    // ─── Seal event callbacks ─────────────────────────────────────────────────
    // ─── Helper: is current page a custom-override page? ─────────────────────
    // Use this instead of checking pageOverrideActive (which can be stale).
    function isOnCustomPage() {
        const chk = document.getElementById('pageOverrideChk');
        return !!(chk && chk.checked && pageOverrides[stampPreviewPage]);
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
        } else {
            sealSettings.applyPages = radio.value;
            const r = document.getElementById('sealRangeRow');
            if (r) r.style.display = radio.value === 'range' ? 'flex' : 'none';
        }
    };

    window.setStampPosition = function (x, y, mode) {
        const isFmt  = (mode === 'formatted');
        const isSeal = (mode === 'seal');
        const pfx    = isFmt ? 'fmt' : (isSeal ? 'seal' : 'stamp');
        // Only update global settings when NOT on a custom page
        if (!isOnCustomPage()) {
            const s = isFmt ? fmtSettings : (isSeal ? sealSettings : stampSettings);
            s.positionX = x; s.positionY = y;
        }
        const px = document.getElementById(pfx + 'PosX'),   py = document.getElementById(pfx + 'PosY');
        const xv = document.getElementById(pfx + 'PosXVal'), yv = document.getElementById(pfx + 'PosYVal');
        if (px) px.value = x; if (py) py.value = y;
        if (xv) xv.textContent = x + '%'; if (yv) yv.textContent = y + '%';
        refreshOverlay();
    };

    window.changeStampPreviewPage = async function (d) {
        if (stampOnlyMode) return;   // no PDF pages in stamp-only mode
        if (!stampPdfDoc) return;
        stampPreviewPage = Math.min(Math.max(1, stampPreviewPage + d), stampTotalPages);
        await renderStampPreviewPage();
    };

    window.changeStampZoom = function (d) {
        stampPreviewScale = Math.min(Math.max(0.4, stampPreviewScale + d), 3.0);
        const lbl = document.getElementById('stampZoomLabel');
        if (lbl) lbl.textContent = Math.round(stampPreviewScale * 100) + '%';
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
        else readStampSettings();
        const active = getActiveSettings();
        const pages  = resolvePages(active);
        if (!pages.length) { showNotification('No valid pages selected.', 'warning'); return; }

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
        else readStampSettings();
        const active = getActiveSettings();
        const pages  = resolvePages(active);
        if (!pages.length) { showNotification('No valid pages selected.', 'warning'); return; }

        showProgress('Preparing print…', 'Rendering stamped pages');
        try {
            const b64      = await buildStampedPDF(pages);
            const pdfBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
            const blobUrl  = URL.createObjectURL(blob);

            const old = document.getElementById('stampPrintFrame');
            if (old) old.remove();

            const iframe = document.createElement('iframe');
            iframe.id    = 'stampPrintFrame';
            iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:-1;opacity:0;';
            iframe.src   = blobUrl;
            document.body.appendChild(iframe);

            iframe.onload = function () {
                setTimeout(function () {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                    setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
                }, 500);
            };

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
        const stampSet  = new Set(stampedPageNums), now = new Date();
        const RENDER_SCALE = 2.0;
        updateProgress(0, 'Preparing pages…');
        const pages = [];

        for (let pNum = 1; pNum <= stampTotalPages; pNum++) {
            updateProgress((pNum / stampTotalPages) * 70, `Rendering page ${pNum}/${stampTotalPages}…`);
            const page = await stampPdfDoc.getPage(pNum);

            const vpReal   = page.getViewport({ scale: 1.0 });
            const ptW      = vpReal.width;
            const ptH      = vpReal.height;

            const vpHigh   = page.getViewport({ scale: RENDER_SCALE });
            const canvas   = document.createElement('canvas');
            canvas.width   = vpHigh.width;
            canvas.height  = vpHigh.height;
            const ctx      = canvas.getContext('2d');
            ctx.fillStyle  = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: vpHigh }).promise;

            // Grayscale page — stamp is drawn after so it stays in color
            if (bwMode) applyGrayscaleToCanvas(canvas);

            if (stampSet.has(pNum)) {
                // Use per-page override settings if they exist, otherwise global
                const ovr = pageOverrides[pNum];
                if (stampMode === 'formatted') {
                    const s = ovr ? Object.assign({}, fmtSettings, ovr) : fmtSettings;
                    drawFormattedStamp(ctx, canvas.width, canvas.height, s, now);
                } else if (stampMode === 'seal') {
                    const s = ovr ? Object.assign({}, sealSettings, ovr) : sealSettings;
                    drawCircularSeal(ctx, canvas.width, canvas.height, s, now);
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
                dataUrl: canvas.toDataURL('image/jpeg', 0.92),
                canvasW: canvas.width,
                canvasH: canvas.height,
                ptW,
                ptH
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
            objs.push({ id: d.pageId, str: `${d.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${d.ptW.toFixed(2)} ${d.ptH.toFixed(2)}] /Resources << /XObject << /Im${d.imgId} ${d.imgId} 0 R >> >> /Contents ${cid} 0 R >>\nendobj\n` });
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
