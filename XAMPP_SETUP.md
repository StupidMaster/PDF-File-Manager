# PDF Manager Pro - XAMPP Installation Guide

## 🚀 Complete Setup with XAMPP (Windows/Mac/Linux)

XAMPP provides Apache (web server) + PHP + MySQL in one package.

---

## Step 1: Install XAMPP

### Download XAMPP:
- **Windows:** https://www.apachefriends.org/download.html
- **Mac:** https://www.apachefriends.org/download.html
- **Linux:** https://www.apachefriends.org/download.html

### Install:
1. Run the installer
2. Select components: Apache, PHP (MySQL optional)
3. Install to default location (C:\xampp on Windows)
4. Finish installation

---

## Step 2: Start XAMPP

1. Open **XAMPP Control Panel**
2. Click **Start** next to **Apache**
3. Apache status should turn green

![XAMPP Control Panel](https://i.imgur.com/xampp-example.png)

---

## Step 3: Install Your PDF Manager

### Copy Files:

**Windows:**
```
C:\xampp\htdocs\pdf-manager\
├── index.html
├── pdf_manager.php
├── test_system.php
├── uploads\
└── output\
```

**Mac/Linux:**
```
/Applications/XAMPP/htdocs/pdf-manager/
├── index.html
├── pdf_manager.php
├── test_system.php
├── uploads/
└── output/
```

### Create Directories:
1. Go to `htdocs` folder
2. Create new folder: `pdf-manager`
3. Copy all your files there
4. Create `uploads` and `output` folders inside

---

## Step 4: Set Permissions (Mac/Linux Only)

```bash
cd /Applications/XAMPP/htdocs/pdf-manager
chmod 755 uploads output
```

**Windows:** No need to set permissions

---

## Step 5: Install Required Tools

### Windows:

**Install Poppler (for pdfinfo):**
1. Download: https://github.com/oschwartz10612/poppler-windows/releases/
2. Extract to `C:\poppler`
3. Add to PATH:
   - Right-click "This PC" → Properties
   - Advanced System Settings → Environment Variables
   - Edit PATH, add: `C:\poppler\Library\bin`

**Install QPDF:**
1. Download: https://github.com/qpdf/qpdf/releases
2. Extract to `C:\qpdf`
3. Add to PATH: `C:\qpdf\bin`

**Install Python:**
1. Download from: https://www.python.org/downloads/
2. Run installer, check "Add Python to PATH"
3. Install libraries:
   ```cmd
   pip install pdfplumber pandas openpyxl pytesseract pdf2image python-pptx
   ```

**Optional (for full features):**
- LibreOffice: https://www.libreoffice.org/download/
- Tesseract OCR: https://github.com/UB-Mannheim/tesseract/wiki

### Mac:

```bash
# Install Homebrew first if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install tools
brew install poppler qpdf tesseract libreoffice python3

# Install Python libraries
pip3 install pdfplumber pandas openpyxl pytesseract pdf2image python-pptx
```

### Linux:

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils qpdf tesseract-ocr libreoffice python3 python3-pip
pip3 install pdfplumber pandas openpyxl pytesseract pdf2image python-pptx
```

---

## Step 6: Configure PHP

### Windows:
1. Open `C:\xampp\php\php.ini`
2. Find and change these lines:
```ini
upload_max_filesize = 50M
post_max_size = 50M
max_execution_time = 300
memory_limit = 256M
```
3. Save file
4. Restart Apache in XAMPP Control Panel

### Mac/Linux:
```bash
sudo nano /Applications/XAMPP/etc/php.ini
# Make same changes as above
# Restart Apache in XAMPP Control Panel
```

---

## Step 7: Test Installation

### Open in Browser:
```
http://localhost/pdf-manager/test_system.php
```

This will show you what's installed and what's missing.

### Expected Results:
- ✅ PHP Version: 7.4+
- ✅ Uploads Directory: Writable
- ✅ Output Directory: Writable
- ✅ pdfinfo: Installed (after Poppler installation)
- ✅ qpdf: Installed (after QPDF installation)
- And so on...

---

## Step 8: Use the Application

Once all tests pass:
```
http://localhost/pdf-manager/index.html
```

---

## 🐛 Troubleshooting XAMPP

### Apache Won't Start:

**Port 80 is already in use:**
1. Open XAMPP Control Panel
2. Click Config → Service and Port Settings
3. Change Main Port from 80 to 8080
4. Access via: `http://localhost:8080/pdf-manager/`

**Skype/IIS using port 80:**
- Close Skype
- Or disable IIS in Windows Features

### PHP Not Working:

1. Check Apache is running (green in XAMPP)
2. Test PHP:
   - Create file: `C:\xampp\htdocs\test.php`
   - Contents: `<?php phpinfo(); ?>`
   - Open: `http://localhost/test.php`
   - Should show PHP info page

### File Upload Errors:

1. Check `php.ini` settings (Step 6)
2. Restart Apache after changes
3. Check directory permissions

### Commands Not Found:

**Windows:**
- Verify PATH includes tool directories
- Open new Command Prompt after PATH changes
- Test: `where pdfinfo` should show path

**Mac/Linux:**
- Test: `which pdfinfo` should show path
- If not found, reinstall with Homebrew/apt-get

---

## 📱 Accessing from Mobile

### Same WiFi Network:

1. Find your computer's IP address:
   - **Windows:** `ipconfig` in Command Prompt
   - **Mac/Linux:** `ifconfig` or `ip addr`

2. Look for IPv4 address (e.g., 192.168.1.100)

3. On mobile browser:
   ```
   http://192.168.1.100/pdf-manager/index.html
   ```

### Firewall:
- Allow Apache through firewall
- Windows: Settings → Firewall → Allow app
- Add Apache (C:\xampp\apache\bin\httpd.exe)

---

## 🔒 Security Notes

**For Development Only:**
- This XAMPP setup is for local development
- Not secure for production/public internet
- Don't expose to internet without proper security

**For Production:**
- Use proper web hosting with PHP support
- Set secure file permissions
- Use HTTPS
- Implement authentication

---

## ✅ Verification Checklist

Before using the application:

- [ ] XAMPP installed
- [ ] Apache running (green in Control Panel)
- [ ] Files in correct location (htdocs/pdf-manager/)
- [ ] Directories created (uploads, output)
- [ ] PHP configured (upload limits, execution time)
- [ ] Tools installed (poppler, qpdf, etc.)
- [ ] Tools in PATH (can run from command line)
- [ ] test_system.php shows all green ✅
- [ ] Can upload a test PDF
- [ ] Features work without errors

---

## 🎓 Understanding the Error You Got

### Your Error:
```
"Upload error: Unexpected token '<', "<br />..."
"Cannot set properties of null (setting 'value')"
```

### What This Means:
1. You opened `index.html` directly (file:// protocol)
2. JavaScript tried to upload via AJAX to `pdf_manager.php`
3. PHP file can't execute without a PHP server
4. Browser got HTML error instead of JSON
5. JavaScript crashed trying to parse HTML as JSON

### Why XAMPP Fixes This:
1. XAMPP provides Apache web server
2. Apache has PHP module
3. PHP files execute properly
4. Returns valid JSON to JavaScript
5. Application works correctly

---

## 💡 Alternative: Built-in PHP Server (Advanced)

If you don't want XAMPP, use PHP's built-in server:

**Requirements:**
- PHP installed separately
- Command line access

**Steps:**
```bash
# Navigate to your project
cd /path/to/pdf-manager

# Start PHP server
php -S localhost:3000

# Open browser
http://localhost:3000/index.html
```

**Configure PHP:**
```bash
# Create php.ini
upload_max_filesize = 50M
post_max_size = 50M
max_execution_time = 300

# Start with custom php.ini
php -S localhost:3000 -c php.ini
```

---

## 📞 Need Help?

**Check these in order:**

1. **Apache running?**
   - XAMPP Control Panel → Apache should be green

2. **Files in right place?**
   - Should be in htdocs folder, not Desktop/Downloads

3. **Using correct URL?**
   - Should start with `http://localhost/`
   - NOT `file:///C:/Users/...`

4. **PHP working?**
   - Test with `http://localhost/pdf-manager/test_system.php`

5. **Tools installed?**
   - Run commands in terminal to verify

---

## 🎉 Success!

Once everything is set up:
- All PDF operations will work
- Mobile responsive interface
- No more JSON errors
- Professional PDF management system

**Enjoy your PDF Manager Pro!** 🎊
