# PDF Manager Pro - Installation & Setup Guide

## Overview
PDF Manager Pro is a comprehensive PHP application for PDF manipulation and conversion with the following features:

### Features:
- ✅ **View PDF** - Get PDF information and metadata
- ✂️ **Split PDF** - Separate PDF into individual pages
- 🔗 **Merge PDFs** - Combine multiple PDFs into one
- 🔄 **Rotate Pages** - Rotate pages by 90, 180, or 270 degrees
- 🗑️ **Delete Pages** - Remove specific pages from PDF
- 📋 **Extract Pages** - Extract specific page ranges
- 📝 **PDF to Word** - Convert PDF to DOCX format
- 📊 **PDF to Excel** - Convert PDF tables to XLSX
- 📊 **PDF to PowerPoint** - Convert PDF to PPTX presentation
- 🖼️ **PDF to Images** - Convert PDF pages to PNG/JPG images
- 🔍 **OCR** - Extract text from scanned PDFs

## System Requirements

### Server Requirements:
- **PHP**: 7.4 or higher
- **Python**: 3.7 or higher
- **Web Server**: Apache/Nginx
- **Operating System**: Linux (Ubuntu 20.04+ recommended)

### Required System Tools:
```bash
# PDF manipulation tools
sudo apt-get install poppler-utils
sudo apt-get install qpdf

# For PDF to Word/Excel/PowerPoint conversion
sudo apt-get install libreoffice

# For image processing
sudo apt-get install tesseract-ocr
sudo apt-get install python3-pip
```

### Required Python Libraries:
```bash
# Install required Python packages
pip3 install pdfplumber
pip3 install pandas
pip3 install openpyxl
pip3 install pytesseract
pip3 install pdf2image
pip3 install python-pptx
```

## Installation Steps

### 1. Clone/Download the Application
```bash
# Create project directory
mkdir pdf-manager-pro
cd pdf-manager-pro

# Copy the files
# - pdf_manager.php (backend PHP class)
# - index.html (frontend interface)
```

### 2. Set Up Directory Structure
```bash
# Create required directories
mkdir uploads
mkdir output

# Set proper permissions
chmod 777 uploads
chmod 777 output
```

### 3. Configure Web Server

#### For Apache:
Create `.htaccess` file:
```apache
Options +FollowSymLinks
RewriteEngine On

# Increase file upload size
php_value upload_max_filesize 50M
php_value post_max_size 50M
php_value max_execution_time 300
php_value max_input_time 300
```

#### For Nginx:
Add to your nginx configuration:
```nginx
location /pdf-manager-pro {
    client_max_body_size 50M;
    
    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php7.4-fpm.sock;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_read_timeout 300;
    }
}
```

### 4. Configure PHP
Edit `php.ini`:
```ini
upload_max_filesize = 50M
post_max_size = 50M
max_execution_time = 300
memory_limit = 256M
```

### 5. Test Installation
```bash
# Test if all command-line tools are available
which pdfinfo    # Should return path
which qpdf       # Should return path
which pdftoppm   # Should return path
which libreoffice # Should return path
which tesseract  # Should return path

# Test Python libraries
python3 -c "import pdfplumber; print('pdfplumber OK')"
python3 -c "import pandas; print('pandas OK')"
python3 -c "import pytesseract; print('pytesseract OK')"
```

## Usage Guide

### Web Interface Usage:

1. **Open the Application**
   - Navigate to `http://localhost/pdf-manager-pro/index.html` in your browser

2. **Upload a PDF**
   - Click on the upload area or drag & drop a PDF file
   - The file will be uploaded to the `uploads/` directory

3. **Use Different Features**
   - Switch between tabs to access different features
   - Follow the on-screen instructions for each feature
   - Results will be saved in the `output/` directory

### PHP Class Usage (Programmatic):

```php
<?php
require_once 'pdf_manager.php';

$pdfManager = new PDFManager();

// Example 1: View PDF Information
$info = $pdfManager->viewPDF('uploads/document.pdf');
print_r($info);

// Example 2: Split PDF
$result = $pdfManager->splitPDF('uploads/document.pdf', 'page');
print_r($result);

// Example 3: Merge PDFs
$files = ['uploads/file1.pdf', 'uploads/file2.pdf'];
$result = $pdfManager->mergePDFs($files, 'merged.pdf');
print_r($result);

// Example 4: Rotate Pages
$result = $pdfManager->rotatePDF('uploads/document.pdf', 90, 'all');
print_r($result);

// Example 5: Delete Pages
$result = $pdfManager->deletePages('uploads/document.pdf', [1, 3, 5]);
print_r($result);

// Example 6: Extract Pages
$result = $pdfManager->extractPages('uploads/document.pdf', '1-5');
print_r($result);

// Example 7: Convert PDF to Word
$result = $pdfManager->pdfToWord('uploads/document.pdf');
print_r($result);

// Example 8: Convert PDF to Excel
$result = $pdfManager->pdfToExcel('uploads/document.pdf');
print_r($result);

// Example 9: Convert PDF to PowerPoint
$result = $pdfManager->pdfToPowerPoint('uploads/document.pdf');
print_r($result);

// Example 10: Convert PDF to Images
$result = $pdfManager->pdfToImages('uploads/document.pdf', 'png', 300);
print_r($result);

// Example 11: OCR
$result = $pdfManager->pdfOCR('uploads/scanned.pdf', 'eng');
print_r($result);
?>
```

## API Reference

### Class: PDFManager

#### Methods:

1. **viewPDF($pdfPath)**
   - Returns PDF information and metadata
   - Parameters: `$pdfPath` - Path to PDF file
   - Returns: Array with PDF information

2. **splitPDF($pdfPath, $outputPrefix)**
   - Splits PDF into individual pages
   - Parameters:
     - `$pdfPath` - Path to PDF file
     - `$outputPrefix` - Prefix for output files (default: 'page')
   - Returns: Array with list of created files

3. **mergePDFs($pdfFiles, $outputFile)**
   - Merges multiple PDFs into one
   - Parameters:
     - `$pdfFiles` - Array of PDF file paths
     - `$outputFile` - Output filename (default: 'merged.pdf')
   - Returns: Array with output file information

4. **rotatePDF($pdfPath, $angle, $pages, $outputFile)**
   - Rotates PDF pages
   - Parameters:
     - `$pdfPath` - Path to PDF file
     - `$angle` - Rotation angle (90, 180, 270, -90)
     - `$pages` - Page range or 'all' (default: 'all')
     - `$outputFile` - Output filename (default: 'rotated.pdf')
   - Returns: Array with output file information

5. **deletePages($pdfPath, $pagesToDelete, $outputFile)**
   - Deletes specific pages from PDF
   - Parameters:
     - `$pdfPath` - Path to PDF file
     - `$pagesToDelete` - Array or comma-separated string of page numbers
     - `$outputFile` - Output filename (default: 'modified.pdf')
   - Returns: Array with output file information

6. **extractPages($pdfPath, $pageRange, $outputFile)**
   - Extracts specific pages from PDF
   - Parameters:
     - `$pdfPath` - Path to PDF file
     - `$pageRange` - Page range (e.g., '1-5', '1,3,5-7')
     - `$outputFile` - Output filename (default: 'extracted.pdf')
   - Returns: Array with output file information

7. **pdfToWord($pdfPath, $outputFile)**
   - Converts PDF to Word document
   - Parameters:
     - `$pdfPath` - Path to PDF file
     - `$outputFile` - Output filename (default: 'converted.docx')
   - Returns: Array with output file information

8. **pdfToExcel($pdfPath, $outputFile)**
   - Converts PDF to Excel spreadsheet
   - Parameters:
     - `$pdfPath` - Path to PDF file
     - `$outputFile` - Output filename (default: 'converted.xlsx')
   - Returns: Array with output file information

9. **pdfToPowerPoint($pdfPath, $outputFile)**
   - Converts PDF to PowerPoint presentation
   - Parameters:
     - `$pdfPath` - Path to PDF file
     - `$outputFile` - Output filename (default: 'converted.pptx')
   - Returns: Array with output file information

10. **pdfToImages($pdfPath, $format, $dpi, $prefix)**
    - Converts PDF pages to images
    - Parameters:
      - `$pdfPath` - Path to PDF file
      - `$format` - Image format ('png' or 'jpg', default: 'png')
      - `$dpi` - Resolution (default: 300)
      - `$prefix` - Prefix for image files (default: 'page')
    - Returns: Array with list of created images

11. **pdfOCR($pdfPath, $language, $outputFile)**
    - Performs OCR on scanned PDF
    - Parameters:
      - `$pdfPath` - Path to PDF file
      - `$language` - OCR language code (default: 'eng')
      - `$outputFile` - Output filename (default: 'ocr_result.txt')
    - Returns: Array with extracted text

## Troubleshooting

### Common Issues:

1. **"Command not found" errors**
   - Solution: Make sure all required tools are installed
   - Run the test commands in step 5 of installation

2. **Permission denied errors**
   - Solution: Set proper permissions on directories
   ```bash
   chmod 777 uploads
   chmod 777 output
   ```

3. **Upload size limit**
   - Solution: Increase limits in php.ini and web server config

4. **Timeout errors**
   - Solution: Increase `max_execution_time` in php.ini

5. **OCR not working**
   - Solution: Install Tesseract language data
   ```bash
   sudo apt-get install tesseract-ocr-eng
   sudo apt-get install tesseract-ocr-spa  # For Spanish
   ```

## Security Considerations

1. **Input Validation**
   - Always validate uploaded files
   - Check file types and sizes
   - Sanitize user inputs

2. **File Permissions**
   - Don't give write permissions to web-accessible directories unless necessary
   - Use proper file ownership

3. **Rate Limiting**
   - Implement rate limiting for file uploads
   - Prevent abuse of conversion features

4. **File Cleanup**
   - Regularly clean up temporary files
   - Implement automatic cleanup after processing

## Performance Optimization

1. **File Size Limits**
   - Set reasonable file size limits
   - Large PDFs can take significant time to process

2. **Asynchronous Processing**
   - Consider using job queues for large files
   - Implement progress tracking

3. **Caching**
   - Cache converted files when appropriate
   - Implement cleanup policies

## License
This software is provided as-is for educational and commercial use.

## Support
For issues and feature requests, please refer to the documentation or contact support.

## Version
Version 1.0.0 - Initial Release
