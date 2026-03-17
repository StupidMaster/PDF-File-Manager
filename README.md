# PDF Manager Pro - Complete Documentation

## Overview

PDF Manager Pro is a powerful, client-side PDF manipulation tool that runs entirely in your browser. No server required! Split, merge, and stamp PDFs with an intuitive drag-and-drop interface.

### ✨ Features

| Feature | Description |
|---------|-------------|
| **Split PDF** | Split PDFs at custom points or after every N pages |
| **Merge PDFs** | Combine multiple PDFs with drag-and-drop reordering |
| **Stamp PDF** | Add text stamps, official seals, or custom watermarks |
| **Page Operations** | Rotate, duplicate, delete individual pages |
| **Preview** | Zoom, navigate, and preview pages before processing |
| **Dark Mode** | Toggle between light and dark themes |
| **Mobile Friendly** | Fully responsive design works on all devices |

## 🚀 Quick Start

### Option 1: Direct Browser Usage (Simplest)

Just open `index.html` in any modern browser:

```bash
# Clone or download the files
git clone <your-repo>
cd pdf-manager

# Open in browser
open index.html  # Mac
start index.html # Windows
```

That's it! The app runs entirely in your browser - no server needed.

### Option 2: Local Web Server

For better performance with large files:

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js
npx http-server

# Then open http://localhost:8000
```

## 📖 Usage Guide

### Split PDF

1. Click **Split** tab
2. Upload one or more PDFs
3. Click between pages to add split points ✂️
4. Enable "Split after every N pages" for automatic splitting
5. Click **Split into X PDFs** to download

### Merge PDFs

1. Click **Merge** tab
2. Upload multiple PDF files
3. Drag pages to reorder them
4. Click **+** between pages to insert blank pages or more PDFs
5. Click **Merge** to combine

### Stamp PDF

1. Click **Stamp** tab
2. Choose stamp type:
   - **Simple Text**: Custom text with styling
   - **Official Stamp**: Formatted certification box
   - **Round Seal**: Circular certification seal
3. Drag the stamp to position it
4. Customize color, opacity, size
5. Choose pages to apply (all, current, or range)
6. Click **Download** or **Print**

## 🎯 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+Z` | Switch to Split mode |
| `Ctrl+Shift+X` | Switch to Merge mode |
| `Ctrl+Shift+C` | Switch to Stamp mode |
| `Ctrl+Shift+O` | Open file picker |
| `Ctrl+Shift+S` | Execute current action (Split/Merge/Stamp) |
| `Ctrl+Shift+P` | Toggle file panel |
| `Ctrl+Shift+L` | Toggle dark/light theme |
| `Escape` | Close modals / menus |

## 🛠️ Technology Stack

- **PDF.js** - PDF rendering and parsing
- **pdf-lib** - PDF creation and modification
- **JSZip** - ZIP file creation for multiple outputs
- **Vanilla JavaScript** - No frameworks, lightweight
- **CSS3** - Modern responsive design with CSS variables

## 📁 Project Structure

```
pdf-manager/
├── index.html          # Main application
├── README.md           # This documentation
├── CSS/
│   └── index.css       # All styles
├── js/
│   ├── common.js       # Shared utilities
│   ├── split.js        # Split functionality
│   ├── merge.js        # Merge functionality
│   └── stamp.js        # Stamp functionality
└── ScriptsJS/
    ├── 3.10.1-jszip.min.js
    └── 3.11.174-pdf.min.js
```

## 💡 Advanced Features

### Stamp Tool Details

**Simple Stamp:**
- Custom text with font size, color, opacity
- Rotation from -180° to 180°
- Bold/italic/border options
- Drag to position or use position grid

**Official Stamp:**
- Multi-line header
- Signatory name and title
- Institution name
- Date and time display
- Scale adjustment

**Round Seal:**
- Curved text on top and bottom arcs
- School abbreviation
- Date display
- Double-circle border
- Decorative dots at 3 and 9 o'clock

### Per-Page Customization

In Stamp mode, when a PDF has multiple pages, you can:
- Click **Custom this page** to override settings for the current page
- Each page can have independent stamp position, style, and content
- Great for stamping different signatures on different pages

### Stamp-Only Mode

Check **Stamp Only (no PDF)** to:
- Print just the stamp on blank paper
- Use for stamping physical documents
- Choose paper size (A4, Letter, Legal)
- Print multiple copies per page

## ⚠️ Limitations

- Maximum file size: 50MB per file
- Maximum total size: 100MB
- Maximum pages: 500
- Maximum output files: 200 (when splitting)
- Browser must support modern JavaScript features

## 🌐 Browser Support

| Browser | Version |
|---------|---------|
| Chrome | 60+ |
| Firefox | 60+ |
| Safari | 14+ |
| Edge | 80+ |

## 🔧 Troubleshooting

### "File too large" error
- Files are limited to 50MB each
- Total uploads limited to 100MB
- Consider splitting large files first

### PDF doesn't load
- Ensure file is valid PDF
- Check browser console for errors
- Try a different browser

### Stamp doesn't appear
- Check opacity setting (not 0%)
- Ensure stamp color contrasts with page
- Try different position (not off-page)

### Memory issues with large files
- Close other tabs
- Process files one at a time
- Use smaller files

## 🔒 Privacy & Security

- **100% Client-side**: No files ever leave your computer
- **No tracking**: No analytics, no cookies
- **No server**: Everything runs in your browser
- **Secure**: Files processed in memory, cleared when done

## 🎨 Customization

### Theme Colors

Edit CSS variables in `index.css`:

```css
:root {
  --bg-primary: #f0f4f8;     /* Light mode background */
  --accent-color: #1976d2;    /* Primary action color */
  --file-color-1: #4caf50;    /* File 1 color */
  --file-color-2: #2196f3;    /* File 2 color */
  /* ... */
}

[data-theme="dark"] {
  --bg-primary: #1a1a1a;      /* Dark mode background */
  /* ... */
}
```

### Stamp Presets

Add your own presets in `stamp.js`:

```javascript
const PRESETS = [
  { label: 'CUSTOM', color: '#ff0000', text: 'CUSTOM STAMP' },
  // Add more...
];
```

## 📝 License

MIT License - Feel free to use, modify, and distribute.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📞 Support

- Check browser console for errors
- Review browser compatibility
- Open an issue on GitHub
- Contact: [your-email]

## 🎉 Version History

**v2.0.0** (Current)
- Complete rewrite with split/merge/stamp
- Client-side only - no server needed
- Modern responsive UI
- Dark mode support
- Keyboard shortcuts
- Stamp-only mode
- Per-page customizations

**v1.0.0** (Legacy)
- Original PHP-based version
- Required server setup
- See `XAMPP_SETUP.md` if needed

---

**Enjoy using PDF Manager Pro!** 🎊
