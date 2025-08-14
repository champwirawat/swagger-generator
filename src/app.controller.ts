import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Res,
  Query,
} from '@nestjs/common';
import { Response } from 'express';
import * as puppeteer from 'puppeteer';
import axios from 'axios';
import { marked } from 'marked';
import { faker } from '@faker-js/faker';

// กำหนดค่าขนาดสูงสุดของ JSON response (5MB)
const MAX_JSON_SIZE = 5 * 1024 * 1024; // 5MB in bytes

@Controller('')
export class AppController {
  private swaggerDoc: any;

  constructor() {
    // ตั้งค่า marked options
    marked.setOptions({
      breaks: true, // รองรับ line breaks
      gfm: true, // GitHub Flavored Markdown
    });
  }

  private async convertMarkdownToHtml(markdown: string): Promise<string> {
    if (!markdown) return '';

    try {
      const result = await marked.parse(markdown);
      return typeof result === 'string' ? result : String(result);
    } catch (error) {
      console.warn('Failed to parse markdown:', error);
      return this.escapeHtml(markdown);
    }
  }

  @Get('pdf')
  async exportSwaggerPdf(@Res() res: Response, @Query('url') url?: string) {
    try {
      let swaggerDoc: any;

      if (url) {
        // ตรวจสอบว่า URL ถูกต้องหรือไม่
        try {
          new URL(url);
        } catch (error) {
          throw new HttpException('Invalid URL format', HttpStatus.BAD_REQUEST);
        }

        // ถ้ามี URL ให้ดึง swagger doc จาก URL
        try {
          const response = await axios.get(url, {
            timeout: 10000, // timeout 10 วินาที
            maxContentLength: MAX_JSON_SIZE, // จำกัดขนาด response
            maxBodyLength: MAX_JSON_SIZE, // จำกัดขนาด body
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Swagger-PDF-Generator/1.0',
            },
          });

          // ตรวจสอบขนาดของ response
          const responseSize = JSON.stringify(response.data).length;
          if (responseSize > MAX_JSON_SIZE) {
            throw new HttpException(
              `JSON response too large: ${(responseSize / 1024 / 1024).toFixed(2)}MB (max: ${MAX_JSON_SIZE / 1024 / 1024}MB)`,
              HttpStatus.PAYLOAD_TOO_LARGE,
            );
          }

          // ตรวจสอบว่า response เป็น JSON หรือไม่
          if (typeof response.data !== 'object') {
            throw new HttpException(
              'Invalid JSON response from URL',
              HttpStatus.BAD_REQUEST,
            );
          }

          swaggerDoc = response.data;
        } catch (error) {
          if (error.response) {
            throw new HttpException(
              `Failed to fetch swagger document from URL: HTTP ${error.response.status}`,
              HttpStatus.BAD_REQUEST,
            );
          } else if (error.code === 'ECONNABORTED') {
            throw new HttpException(
              'Request timeout when fetching swagger document',
              HttpStatus.REQUEST_TIMEOUT,
            );
          } else if (
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNREFUSED'
          ) {
            throw new HttpException(
              `Failed to connect to URL: ${error.message}`,
              HttpStatus.BAD_REQUEST,
            );
          } else if (
            error.message &&
            error.message.includes('maxContentLength')
          ) {
            throw new HttpException(
              `Response too large: Maximum allowed size is ${MAX_JSON_SIZE / 1024 / 1024}MB`,
              HttpStatus.PAYLOAD_TOO_LARGE,
            );
          } else {
            throw new HttpException(
              `Failed to fetch swagger document from URL: ${error.message}`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      } else {
        // ถ้าไม่มี URL ให้ใช้ swagger doc จาก Express app locals
        const app = res.req.app;
        swaggerDoc = app.locals.swaggerDocument;
        if (!swaggerDoc) {
          throw new HttpException(
            'Swagger Document not found',
            HttpStatus.NOT_FOUND,
          );
        }
      }

      // เก็บ swaggerDoc ไว้ใช้ใน methods อื่นๆ
      this.swaggerDoc = swaggerDoc;

      // สร้าง HTML แสดง API Documentation แบบสวยงาม
      const html = await this.generateBeautifulHtml(swaggerDoc);

      // ใช้ Puppeteer สร้าง PDF จาก HTML
      const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm',
        },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="font-size: 10px; text-align: center; width: 100%; color: #666; padding: 10px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      });
      await browser.close();

      // ส่ง PDF กลับ client
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=api-documentation.pdf',
      );
      res.send(pdfBuffer);
    } catch (err) {
      console.error(err);
      throw new HttpException(
        'Failed to generate PDF',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('fetch-doc')
  async fetchSwaggerDoc(@Query('url') url: string) {
    try {
      if (!url) {
        throw new HttpException(
          'URL parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      // ตรวจสอบว่า URL ถูกต้องหรือไม่
      try {
        new URL(url);
      } catch (error) {
        throw new HttpException('Invalid URL format', HttpStatus.BAD_REQUEST);
      }

      const response = await axios.get(url, {
        timeout: 10000, // timeout 10 วินาที
        maxContentLength: MAX_JSON_SIZE, // จำกัดขนาด response
        maxBodyLength: MAX_JSON_SIZE, // จำกัดขนาด body
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Swagger-PDF-Generator/1.0',
        },
      });

      // ตรวจสอบขนาดของ response
      const responseSize = JSON.stringify(response.data).length;
      if (responseSize > MAX_JSON_SIZE) {
        throw new HttpException(
          `JSON response too large: ${(responseSize / 1024 / 1024).toFixed(2)}MB (max: ${MAX_JSON_SIZE / 1024 / 1024}MB)`,
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }

      // ตรวจสอบว่า response เป็น JSON หรือไม่
      if (typeof response.data !== 'object') {
        throw new HttpException(
          'Invalid JSON response from URL',
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        success: true,
        data: response.data,
        source: url,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error.response) {
        throw new HttpException(
          `Failed to fetch swagger document: HTTP ${error.response.status}`,
          HttpStatus.BAD_REQUEST,
        );
      } else if (error.code === 'ECONNABORTED') {
        throw new HttpException(
          'Request timeout when fetching swagger document',
          HttpStatus.REQUEST_TIMEOUT,
        );
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new HttpException(
          `Failed to connect to URL: ${error.message}`,
          HttpStatus.BAD_REQUEST,
        );
      } else if (error.message && error.message.includes('maxContentLength')) {
        throw new HttpException(
          `Response too large: Maximum allowed size is ${MAX_JSON_SIZE / 1024 / 1024}MB`,
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      } else {
        throw new HttpException(
          `Failed to fetch swagger document: ${error.message}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  @Get('html')
  async exportSwaggerHtml(@Res() res: Response, @Query('url') url?: string) {
    try {
      let swaggerDoc: any;

      if (url) {
        // ตรวจสอบว่า URL ถูกต้องหรือไม่
        try {
          new URL(url);
        } catch (error) {
          throw new HttpException('Invalid URL format', HttpStatus.BAD_REQUEST);
        }

        // ถ้ามี URL ให้ดึง swagger doc จาก URL
        try {
          const response = await axios.get(url, {
            timeout: 10000, // timeout 10 วินาที
            maxContentLength: MAX_JSON_SIZE, // จำกัดขนาด response
            maxBodyLength: MAX_JSON_SIZE, // จำกัดขนาด body
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Swagger-PDF-Generator/1.0',
            },
          });

          // ตรวจสอบขนาดของ response
          const responseSize = JSON.stringify(response.data).length;
          if (responseSize > MAX_JSON_SIZE) {
            throw new HttpException(
              `JSON response too large: ${(responseSize / 1024 / 1024).toFixed(2)}MB (max: ${MAX_JSON_SIZE / 1024 / 1024}MB)`,
              HttpStatus.PAYLOAD_TOO_LARGE,
            );
          }

          // ตรวจสอบว่า response เป็น JSON หรือไม่
          if (typeof response.data !== 'object') {
            throw new HttpException(
              'Invalid JSON response from URL',
              HttpStatus.BAD_REQUEST,
            );
          }

          swaggerDoc = response.data;
        } catch (error) {
          if (error.response) {
            throw new HttpException(
              `Failed to fetch swagger document from URL: HTTP ${error.response.status}`,
              HttpStatus.BAD_REQUEST,
            );
          } else if (error.code === 'ECONNABORTED') {
            throw new HttpException(
              'Request timeout when fetching swagger document',
              HttpStatus.REQUEST_TIMEOUT,
            );
          } else if (
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNREFUSED'
          ) {
            throw new HttpException(
              `Failed to connect to URL: ${error.message}`,
              HttpStatus.BAD_REQUEST,
            );
          } else if (
            error.message &&
            error.message.includes('maxContentLength')
          ) {
            throw new HttpException(
              `Response too large: Maximum allowed size is ${MAX_JSON_SIZE / 1024 / 1024}MB`,
              HttpStatus.PAYLOAD_TOO_LARGE,
            );
          } else {
            throw new HttpException(
              `Failed to fetch swagger document from URL: ${error.message}`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      } else {
        // ถ้าไม่มี URL ให้ใช้ swagger doc จาก Express app locals
        const app = res.req.app;
        swaggerDoc = app.locals.swaggerDocument;
        if (!swaggerDoc) {
          throw new HttpException(
            'Swagger Document not found',
            HttpStatus.NOT_FOUND,
          );
        }
      }

      // เก็บ swaggerDoc ไว้ใช้ใน methods อื่นๆ
      this.swaggerDoc = swaggerDoc;

      // สร้าง HTML แสดง API Documentation แบบสวยงาม
      const html = await this.generateBeautifulHtml(swaggerDoc);

      // ส่ง HTML กลับ client
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      console.error(err);
      throw new HttpException(
        'Failed to generate HTML',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('')
  async showWebInterface(@Res() res: Response) {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Swagger Documentation Generator</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 2rem;
          }
          
          .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            overflow: hidden;
          }
          
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            text-align: center;
          }
          
          .header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            font-weight: 300;
          }
          
          .header p {
            font-size: 1.1rem;
            opacity: 0.9;
          }
          
          .content {
            padding: 2rem;
          }
          
          .form-group {
            margin-bottom: 1.5rem;
          }
          
          .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: #495057;
          }
          
          .form-group input[type="url"] {
            width: 100%;
            padding: 0.75rem;
            border: 2px solid #e9ecef;
            border-radius: 6px;
            font-size: 1rem;
            transition: border-color 0.3s ease;
          }
          
          .form-group input[type="url"]:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          }
          
          .button-group {
            display: flex;
            gap: 1rem;
            margin-top: 1rem;
            flex-wrap: wrap;
          }
          
          .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 6px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
            text-align: center;
            min-width: 120px;
          }
          
          .btn-primary {
            background: #667eea;
            color: white;
          }
          
          .btn-primary:hover {
            background: #5a67d8;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
          }
          
          .btn-secondary {
            background: #6c757d;
            color: white;
          }
          
          .btn-secondary:hover {
            background: #5a6268;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(108, 117, 125, 0.3);
          }
          
          .examples {
            margin-top: 2rem;
            padding: 1.5rem;
            border-radius: 8px;
            border-left: 4px solid #667eea;
          }
          
          .examples h3 {
            color: #495057;
            margin-bottom: 1rem;
          }
          
          .example-links {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }
          
          .example-link {
            color: #667eea;
            text-decoration: none;
            padding: 0.5rem;
            border-radius: 4px;
            transition: background-color 0.3s ease;
            cursor: pointer;
          }
          
          .example-link:hover {
            background: #e9ecef;
            text-decoration: underline;
          }
          
          .loading {
            display: none;
            text-align: center;
            padding: 2rem;
            color: #6c757d;
            border-radius: 8px;
            margin: 1rem 0;
            border: 1px solid #dee2e6;
          }
          
          .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
          }
          
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          .error {
            display: none;
            background: #f8d7da;
            color: #721c24;
            padding: 1rem;
            border-radius: 6px;
            margin-top: 1rem;
            border: 1px solid #f5c6cb;
          }
          
          .success {
            display: none;
            background: #d4edda;
            color: #155724;
            padding: 1rem;
            border-radius: 6px;
            margin-top: 1rem;
            border: 1px solid #c3e6cb;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📚 Swagger Documentation Generator</h1>
            <p>Generate beautiful PDF and HTML documentation from Swagger/OpenAPI specifications</p>
          </div>
          
          <div class="content">
            <form id="docForm" onsubmit="return false;">
              <div class="form-group">
                <label for="swaggerUrl">Swagger/OpenAPI URL:</label>
                <input 
                  type="url" 
                  id="swaggerUrl" 
                  name="swaggerUrl" 
                  placeholder="https://example.com/swagger.json"
                  required
                >
              </div>
              
              <div class="button-group">
                <button type="button" class="btn btn-primary" onclick="generatePDF()">
                  📄 Generate PDF
                </button>
                <button type="button" class="btn btn-secondary" onclick="generateHTML()">
                  🌐 View HTML
                </button>
                <button type="button" class="btn btn-secondary" onclick="fetchDoc()">
                  📋 Fetch Document
                </button>
              </div>
            </form>
            
            <div class="loading" id="loading">
              <div class="spinner"></div>
              <p id="loading-text">Generating documentation...</p>
            </div>
            
            <div class="error" id="error"></div>
            <div class="success" id="success"></div>
            
            <div class="examples">
              <h3>📖 Example URLs:</h3>
              <div class="example-links">
                <a href="#" class="example-link" onclick="setUrl('https://petstore.swagger.io/v2/swagger.json')">
                  🐾 Petstore API (Swagger 2.0)
                </a>
              </div>
            </div>
          </div>
        </div>
        
        <script>
          function setUrl(url) {
            document.getElementById('swaggerUrl').value = url;
            return false;
          }
          
          function showLoading(message = 'Generating documentation...') {
            document.getElementById('loading').style.display = 'block';
            document.getElementById('loading-text').textContent = message;
            document.getElementById('error').style.display = 'none';
            document.getElementById('success').style.display = 'none';
          }
          
          function hideLoading() {
            document.getElementById('loading').style.display = 'none';
          }
          
          function showError(message) {
            document.getElementById('error').textContent = message;
            document.getElementById('error').style.display = 'block';
            hideLoading();
          }
          
          function showSuccess(message) {
            document.getElementById('success').textContent = message;
            document.getElementById('success').style.display = 'block';
            hideLoading();
          }
          
          function generatePDF() {
            const url = document.getElementById('swaggerUrl').value;
            if (!url) {
              showError('Please enter a Swagger URL');
              return;
            }
            
            showLoading('Generating PDF... This may take a few moments.');
            
            console.log('Generating PDF for URL:', url);
            
            // ใช้ fetch เพื่อติดตามสถานะการสร้าง PDF
            fetch('/pdf?url=' + encodeURIComponent(url))
              .then(response => {
                console.log('PDF generation response status:', response.status);
                if (!response.ok) {
                  throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                }
                return response.blob();
              })
              .then(blob => {
                console.log('PDF generated successfully, size:', blob.size);
                
                // สร้าง download link
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(blob);
                downloadLink.download = 'api-documentation.pdf';
                downloadLink.style.display = 'none';
                document.body.appendChild(downloadLink);
                
                downloadLink.click();
                document.body.removeChild(downloadLink);
                
                // ล้าง URL object
                URL.revokeObjectURL(downloadLink.href);
                
                showSuccess('PDF generated and downloaded successfully!');
              })
              .catch(error => {
                console.error('PDF generation error:', error);
                showError('Failed to generate PDF: ' + error.message);
              });
          }
          
          function generateHTML() {
            const url = document.getElementById('swaggerUrl').value;
            if (!url) {
              showError('Please enter a Swagger URL');
              return;
            }
            
            showLoading('Generating HTML documentation...');
            
            try {
              console.log('Generating HTML for URL:', url);
              
              // เปิด HTML ในแท็บใหม่
              const htmlUrl = '/html?url=' + encodeURIComponent(url);
              console.log('Opening HTML URL:', htmlUrl);
              
              const newWindow = window.open(htmlUrl, '_blank');
              if (newWindow) {
                showSuccess('HTML documentation opened in new tab!');
              } else {
                showError('Popup blocked! Please allow popups for this site.');
              }
            } catch (error) {
              console.error('HTML generation error:', error);
              showError('Failed to open HTML: ' + error.message);
            }
          }
          
          function fetchDoc() {
            const url = document.getElementById('swaggerUrl').value;
            if (!url) {
              showError('Please enter a Swagger URL');
              return;
            }
            
            showLoading('Fetching Swagger document...');
            
            console.log('Fetching document from URL:', url);
            
            fetch('/fetch-doc?url=' + encodeURIComponent(url))
              .then(response => {
                console.log('Fetch response status:', response.status);
                if (!response.ok) {
                  throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                }
                return response.json();
              })
              .then(data => {
                console.log('Swagger Document:', data);
                showSuccess('Document fetched successfully! Check console for details.');
              })
              .catch(error => {
                console.error('Fetch error:', error);
                showError('Failed to fetch document: ' + error.message);
              });
          }
          
          // ตั้งค่า URL เริ่มต้น
          document.getElementById('swaggerUrl').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              generateHTML();
            }
          });
          
          // Debug: แสดงข้อความเมื่อโหลดหน้าเสร็จ
          console.log('Swagger Documentation Generator loaded successfully!');
        </script>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  private async generateBeautifulHtml(swaggerDoc: any): Promise<string> {
    const { info, paths, tags } = swaggerDoc;

    // แปลง markdown เป็น HTML
    const descriptionHtml = await this.convertMarkdownToHtml(
      info?.description || 'Comprehensive API Reference Guide',
    );

    // สร้าง HTML สำหรับ API Documentation
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${info?.title || 'API Documentation'}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #fff;
            margin: 0;
            padding: 2rem;
            font-size: 14px;
          }
          

          
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 1.5rem;
            text-align: center;
            margin-bottom: 1rem;
          }
          
          .header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            font-weight: 300;
          }
          
          .header p {
            font-size: 1.1rem;
            opacity: 0.9;
          }
          
          .generated-date {
            font-size: 0.9rem !important;
            opacity: 0.8 !important;
            margin-top: 0.5rem;
            font-style: italic;
          }
          
          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 1rem;
          }
          
          .description-section {
            border: 2px solid #667eea;
            border-radius: 8px;
            padding: 1.5rem;
            margin: 1rem 0 2rem 0;
          }
          
          .description-content {
            color: #495057;
            line-height: 1.8;
            font-size: 16px;
          }
          
          .description-content h1,
          .description-content h2,
          .description-content h3,
          .description-content h4,
          .description-content h5,
          .description-content h6 {
            color: #495057;
            margin: 1rem 0 0.5rem 0;
            font-weight: 600;
          }
          
          .description-content h1 {
            font-size: 1.8rem;
            border-bottom: 2px solid #667eea;
            padding-bottom: 0.5rem;
          }
          
          .description-content h2 {
            font-size: 1.5rem;
            border-bottom: 1px solid #dee2e6;
            padding-bottom: 0.3rem;
          }
          
          .description-content h3 {
            font-size: 1.3rem;
          }
          
          .description-content p {
            margin: 0.75rem 0;
            font-size: 16px;
          }
          
          .description-content ul,
          .description-content ol {
            margin: 0.75rem 0;
            padding-left: 1.5rem;
            font-size: 16px;
          }
          
          .description-content li {
            margin: 0.25rem 0;
          }
          
          .description-content code {
            background: #e9ecef;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            color: #495057;
          }
          
          .description-content pre {
            background: #2d3748;
            color: #e2e8f0;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
            margin: 0.75rem 0;
          }
          
          .description-content pre code {
            background: none;
            color: inherit;
            padding: 0;
          }
          
          .description-content a {
            color: #667eea;
            text-decoration: underline;
          }
          
          .description-content a:hover {
            color: #5a67d8;
          }
          
          .description-content blockquote {
            border-left: 4px solid #667eea;
            padding-left: 1rem;
            margin: 1rem 0;
            color: #6c757d;
            font-style: italic;
          }
          
          .description-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 0.75rem 0;
            font-size: 0.9rem;
          }
          
          .description-content table th,
          .description-content table td {
            border: 1px solid #dee2e6;
            padding: 0.5rem;
            text-align: left;
          }
          
          .description-content table th {
            background: #667eea;
            color: white;
            font-weight: 600;
          }
          
          .description-content table tr:nth-child(even) {
            background: #f8f9fa;
          }
          

          
          .endpoints-section {
            margin-bottom: 2rem;
          }
          
          .endpoints-section h2 {
            color: #495057;
            margin-bottom: 1rem;
            font-size: 2rem;
            border-bottom: 2px solid #667eea;
            padding-bottom: 0.75rem;
          }
          

          
          .endpoint-item {
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            font-size: 16px;
          }
          
          .endpoint-item:last-child {
            border-bottom: 1px solid #e9ecef;
          }
          
          .method-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 4px;
            font-size: 0.9rem;
            font-weight: bold;
            text-transform: uppercase;
            margin-right: 1rem;
          }
          
          .method-get { background: #28a745; color: white; }
          .method-post { background: #007bff; color: white; }
          .method-put { background: #ffc107; color: #212529; }
          .method-delete { background: #dc3545; color: white; }
          .method-patch { background: #6f42c1; color: white; }
          
          .endpoint-title {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 0.75rem;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid #e9ecef;
            font-size: 18px;
          }
          
          .endpoint-path {
            font-family: 'Courier New', monospace;
            font-size: 1.3rem;
            color: #495057;
            font-weight: 600;
          }
          
          .endpoint-description {
            color: #6c757d;
            margin-bottom: 0.5rem;
            font-size: 16px;
          }
          
          .endpoint-details {
            padding: 1rem;
            border-radius: 4px;
            margin-top: 0.75rem;
            font-size: 15px;
          }
          
          .detail-table {
            width: 100%;
            border-collapse: collapse;
            margin: 0.5rem 0;
            font-size: 14px;
          }
          
          .detail-table th,
          .detail-table td {
            border: 1px solid #dee2e6;
            padding: 0.6rem;
            text-align: left;
            vertical-align: top;
          }
          
          .detail-table th {
            background: #495057;
            color: white;
            font-weight: 600;
          }
          
          .detail-table tr:nth-child(even) {
            background: transparent;
          }
          
          .detail-table tr:hover {
            background: #e9ecef;
          }
          
          .response-item {
            margin: 0.5rem 0;
          }
          
          .response-item h5 {
            color: #495057;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
          }
          
          .nested-schema {
            border-left: 3px solid #667eea;
            padding-left: 1rem;
            margin: 0.5rem 0;
          }
          
          .properties-table {
            margin: 0.5rem 0;
          }
          
          code {
            background: #e9ecef;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 0.85rem;
          }
          
          .example-section {
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 1rem;
            margin: 0.5rem 0;
          }
          
          .example-section h6 {
            color: #495057;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
            font-weight: 600;
          }
          
          .example-code {
            background: #2d3748;
            border-radius: 4px;
            overflow: hidden;
          }
          
          .example-code pre {
            margin: 0;
            padding: 1rem;
            overflow-x: auto;
          }
          
          .example-code code {
            background: none;
            color: #e2e8f0;
            font-family: 'Courier New', monospace;
            font-size: 0.8rem;
            line-height: 1.4;
            padding: 0;
          }
          
          .language-json {
            color: #68d391 !important;
          }
          
          .language-text {
            color: #e2e8f0 !important;
          }
          
          .referenced-schema {
            border-left: 3px solid #28a745;
            padding-left: 1rem;
            margin: 0.5rem 0;
          }
          

          
          .tags-section {
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1rem;
          }
          
          .tags-section h2 {
            color: #495057;
            margin-bottom: 1rem;
            font-size: 1.5rem;
          }
          
          .tag-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
          }
          
          .tag-item {
            background: #667eea;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
          }
          
          .table-of-contents {
            border: 2px solid #667eea;
            border-radius: 8px;
            padding: 1.5rem;
            margin: 1rem 0 2rem 0;
          }
          
          .table-of-contents h2 {
            color: #495057;
            margin-bottom: 1rem;
            font-size: 1.5rem;
          }
          
          .toc-list {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }
          
          .toc-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.5rem;
            border-radius: 4px;
            transition: background-color 0.2s ease;
          }
          
          .toc-item:hover {
            background: #e9ecef;
          }
          
          .toc-number {
            font-weight: 600;
            color: #495057;
            min-width: 2rem;
          }
          
          .toc-link {
            color: #667eea;
            text-decoration: none;
            font-weight: 500;
            flex: 1;
          }
          
          .toc-link:hover {
            text-decoration: underline;
            color: #5a67d8;
          }
          
          .toc-path {
            color: #6c757d;
            font-family: 'Courier New', monospace;
            font-size: 0.85rem;
          }
          
          .method-badge-small {
            display: inline-block;
            padding: 0.15rem 0.4rem;
            border-radius: 3px;
            font-size: 0.7rem;
            font-weight: bold;
            text-transform: uppercase;
            margin-right: 0.5rem;
          }
          
          .toc-section {
            margin-bottom: 1rem;
          }
          
          .toc-section-title {
            color: #495057;
            margin-bottom: 0.75rem;
            font-size: 1.1rem;
            font-weight: 600;
            border-bottom: 1px solid #dee2e6;
            padding-bottom: 0.3rem;
            cursor: pointer;
            user-select: none;
            transition: color 0.2s ease;
          }
          
          .toc-section-title:hover {
            color: #667eea;
          }
          
          .toc-toggle-icon {
            display: inline-block;
            margin-right: 0.5rem;
            font-size: 0.8rem;
            transition: transform 0.3s ease;
          }
          
          .toc-list {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            transition: max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease;
            overflow-y: auto;
            max-height: 300px;
            opacity: 1;
            padding-right: 0.5rem;
          }
          
          .toc-list.collapsed {
            max-height: 0 !important;
            opacity: 0;
            margin: 0;
            padding: 0;
          }
          
          /* Custom scrollbar for toc-list */
          .toc-list::-webkit-scrollbar {
            width: 6px;
          }
          
          .toc-list::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 3px;
          }
          
          .toc-list::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 3px;
          }
          
          .toc-list::-webkit-scrollbar-thumb:hover {
            background: #a8a8a8;
          }
          

          
          @media print {
            body {
              font-size: 12pt !important;
              line-height: 1.4 !important;
              padding: 1rem !important;
            }
            
            .header { 
              background: #667eea !important; 
              padding: 1.5rem !important;
            }
            
            .header h1 {
              font-size: 2rem !important;
            }
            
            .header p {
              font-size: 1rem !important;
            }
            
            .container {
              max-width: none !important;
              padding: 0 !important;
            }
            
            .description-content {
              font-size: 11pt !important;
            }
            
            .description-content p,
            .description-content ul,
            .description-content ol {
              font-size: 11pt !important;
            }
            
            .endpoint-item {
              font-size: 11pt !important;
              margin-bottom: 2rem !important;
              padding: 1rem !important;
            }
            
            .endpoint-title {
              font-size: 12pt !important;
            }
            
            .endpoint-path {
              font-size: 11pt !important;
            }
            
            .endpoint-description {
              font-size: 10pt !important;
            }
            
            .detail-table {
              font-size: 9pt !important;
            }
            
            .detail-table th,
            .detail-table td {
              padding: 0.4rem !important;
            }
            
            .endpoint-details {
              font-size: 10pt !important;
              padding: 0.8rem !important;
            }
            
            .example-code {
              font-size: 8pt !important;
            }
            
            .example-code code {
              font-size: 8pt !important;
            }
            
            .endpoints-section h2 {
              font-size: 1.3rem !important;
            }
            
            .tags-section h2 {
              font-size: 1.2rem !important;
            }
            
            .tag-item {
              font-size: 9pt !important;
            }
            
            .description-section {
              font-size: 11pt !important;
              padding: 1rem !important;
            }
            
            .response-item h5 {
              font-size: 9pt !important;
            }
            
            .table-of-contents {
              font-size: 10pt !important;
              padding: 1rem !important;
            }
            
            .table-of-contents h2 {
              font-size: 12pt !important;
            }
            
            .toc-item {
              font-size: 9pt !important;
              padding: 0.3rem !important;
            }
            
            .toc-link {
              font-size: 9pt !important;
            }
            
            .toc-path {
              font-size: 8pt !important;
            }
            
            .toc-item {
              font-size: 9pt !important;
              padding: 0.2rem 0 !important;
              margin: 0 !important;
            }
            
            .method-badge-small {
              font-size: 7pt !important;
              padding: 0.1rem 0.3rem !important;
            }
            
            .toc-section-title {
              font-size: 10pt !important;
              cursor: default !important;
              margin-bottom: 0.5rem !important;
              padding-bottom: 0.2rem !important;
            }
            
            .toc-toggle-icon {
              display: none !important;
            }
            
            .toc-list {
              max-height: none !important;
              opacity: 1 !important;
              margin: 0.5rem 0 !important;
              padding: 0 !important;
              overflow: visible !important;
            }
            
            .toc-list.collapsed {
              max-height: none !important;
              opacity: 1 !important;
              margin: 0.5rem 0 !important;
              padding: 0 !important;
            }
            
            .back-to-top {
              display: none !important;
            }
          }
          
          .back-to-top {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 50px;
            height: 50px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 50%;
            font-size: 20px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            transition: all 0.3s ease;
            z-index: 1000;
            display: none;
          }
          
          .back-to-top:hover {
            background: #5a67d8;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
          }
          
          .back-to-top.show {
            display: block;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${info?.title || 'API Documentation'}</h1>
          ${info?.version ? `<p>Version: ${info.version}</p>` : ''}
          <p class="generated-date">Generated on ${new Date().toLocaleDateString(
            'en-US',
            {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            },
          )}</p>
        </div>
        
        <div class="container">
          <div class="description-section">
            <div class="description-content">${descriptionHtml}</div>
          </div>
          ${this.generateTagsSection(tags)}
          ${this.generateTableOfContents(paths, tags)}
          ${await this.generateEndpointsSection(paths)}
        </div>
        
        <button id="backToTop" class="back-to-top" onclick="scrollToTop()" title="Back to Table of Contents">
          ↑
        </button>
        
        <script>
          function toggleSection(sectionId) {
            const section = document.getElementById('section-' + sectionId);
            const icon = document.getElementById('icon-' + sectionId);
            
            if (section.classList.contains('collapsed')) {
              // เปิด section
              section.classList.remove('collapsed');
              icon.textContent = '▼';
              icon.style.transform = 'rotate(0deg)';
              
              // ตั้งค่า max-height ตามเนื้อหาจริง
              setTimeout(() => {
                const contentHeight = section.scrollHeight;
                section.style.maxHeight = Math.min(contentHeight, 300) + 'px';
              }, 10);
            } else {
              // หุบ section
              section.classList.add('collapsed');
              icon.textContent = '▶';
              icon.style.transform = 'rotate(-90deg)';
            }
          }
          
          // ตั้งค่าเริ่มต้นให้ทุก section หุบอยู่
          document.addEventListener('DOMContentLoaded', function() {
            const sections = document.querySelectorAll('.toc-list');
            sections.forEach(section => {
              section.classList.add('collapsed');
              // เก็บความสูงจริงของเนื้อหา
              section.setAttribute('data-full-height', section.scrollHeight);
            });
            
            // อัพเดท icons ให้เป็นหุบ
            const icons = document.querySelectorAll('.toc-toggle-icon');
            icons.forEach(icon => {
              icon.textContent = '▶';
              icon.style.transform = 'rotate(-90deg)';
            });
            
            // ตั้งค่า scroll event สำหรับปุ่ม Back to Top
            setupBackToTop();
          });
          
          function scrollToTop() {
            const tableOfContents = document.querySelector('.table-of-contents');
            if (tableOfContents) {
              tableOfContents.scrollIntoView({ 
                behavior: 'smooth',
                block: 'start'
              });
            }
          }
          
          function setupBackToTop() {
            const backToTopButton = document.getElementById('backToTop');
            const tableOfContents = document.querySelector('.table-of-contents');
            
            if (!backToTopButton || !tableOfContents) return;
            
            window.addEventListener('scroll', function() {
              const tocRect = tableOfContents.getBoundingClientRect();
              const isTocVisible = tocRect.top < 0;
              
              if (isTocVisible) {
                backToTopButton.classList.add('show');
              } else {
                backToTopButton.classList.remove('show');
              }
            });
          }
        </script>

      </body>
      </html>
    `;

    return html;
  }

  private generateTagsSection(tags: any[]): string {
    if (!tags || tags.length === 0) return '';

    const tagItems = tags
      .map((tag) => `<span class="tag-item">${tag.name || tag}</span>`)
      .join('');

    return `
      <div class="tags-section">
        <h2>API Tags</h2>
        <div class="tag-list">
          ${tagItems}
        </div>
      </div>
    `;
  }

  private generateTableOfContents(paths: any, tags: any[]): string {
    if (!paths) return '';

    // สร้าง map ของ endpoints ตาม tags
    const endpointsByTag: {
      [tag: string]: Array<{
        path: string;
        method: string;
        details: any;
        itemNumber: number;
      }>;
    } = {};
    const untaggedEndpoints: Array<{
      path: string;
      method: string;
      details: any;
      itemNumber: number;
    }> = [];

    Object.entries(paths).forEach(([path, methods]: [string, any]) => {
      Object.entries(methods).forEach(([method, details]: [string, any]) => {
        const endpoint = { path, method, details, itemNumber: 0 }; // จะกำหนดหมายเลขใหม่ตาม group

        // หา tag จาก endpoint
        const endpointTags = details.tags || [];
        if (endpointTags.length > 0) {
          const primaryTag = endpointTags[0];
          if (!endpointsByTag[primaryTag]) {
            endpointsByTag[primaryTag] = [];
          }
          endpointsByTag[primaryTag].push(endpoint);
        } else {
          untaggedEndpoints.push(endpoint);
        }
      });
    });

    const tocSections: string[] = [];

    // สร้าง sections ตาม tags พร้อมหมายเลขตาม group
    Object.entries(endpointsByTag).forEach(([tag, endpoints]) => {
      // กำหนดหมายเลขใหม่ตาม group
      endpoints.forEach((endpoint, index) => {
        endpoint.itemNumber = index + 1;
      });

      const tagEndpoints = endpoints
        .map((endpoint) => {
          const methodClass = `method-${endpoint.method.toLowerCase()}`;
          const summary =
            endpoint.details.summary ||
            `${endpoint.method.toUpperCase()} ${endpoint.path}`;
          const anchorId = `endpoint-${tag}-${endpoint.itemNumber}`;

          return `
          <div class="toc-item">
            <span class="toc-number">${endpoint.itemNumber}.</span>
            <span class="method-badge-small ${methodClass}">${endpoint.method.toUpperCase()}</span>
            <a href="#${anchorId}" class="toc-link">${summary}</a>
            <span class="toc-path">${endpoint.path}</span>
          </div>
        `;
        })
        .join('');

      tocSections.push(`
        <div class="toc-section">
          <h3 class="toc-section-title" onclick="toggleSection('${tag}')">
            <span class="toc-toggle-icon" id="icon-${tag}">▼</span>
            ${tag} (${endpoints.length})
          </h3>
          <div class="toc-list" id="section-${tag}">
            ${tagEndpoints}
          </div>
        </div>
      `);
    });

    // เพิ่ม untagged endpoints ถ้ามี
    if (untaggedEndpoints.length > 0) {
      // กำหนดหมายเลขใหม่สำหรับ untagged endpoints
      untaggedEndpoints.forEach((endpoint, index) => {
        endpoint.itemNumber = index + 1;
      });

      const untaggedItems = untaggedEndpoints
        .map((endpoint) => {
          const methodClass = `method-${endpoint.method.toLowerCase()}`;
          const summary =
            endpoint.details.summary ||
            `${endpoint.method.toUpperCase()} ${endpoint.path}`;
          const anchorId = `endpoint-other-${endpoint.itemNumber}`;

          return `
          <div class="toc-item">
            <span class="toc-number">${endpoint.itemNumber}.</span>
            <span class="method-badge-small ${methodClass}">${endpoint.method.toUpperCase()}</span>
            <a href="#${anchorId}" class="toc-link">${summary}</a>
            <span class="toc-path">${endpoint.path}</span>
          </div>
        `;
        })
        .join('');

      tocSections.push(`
        <div class="toc-section">
          <h3 class="toc-section-title" onclick="toggleSection('other')">
            <span class="toc-toggle-icon" id="icon-other">▼</span>
            Other Endpoints (${untaggedEndpoints.length})
          </h3>
          <div class="toc-list" id="section-other">
            ${untaggedItems}
          </div>
        </div>
      `);
    }

    if (tocSections.length === 0) return '';

    return `
      <div class="table-of-contents">
        <h2>Table of Contents</h2>
        ${tocSections.join('')}
      </div>
    `;
  }

  private async generateEndpointsSection(paths: any): Promise<string> {
    if (!paths) return '';

    // สร้าง map ของ endpoints ตาม tags เพื่อสร้าง anchor ID
    const endpointsByTag: {
      [tag: string]: Array<{
        path: string;
        method: string;
        details: any;
        itemNumber: number;
      }>;
    } = {};
    const untaggedEndpoints: Array<{
      path: string;
      method: string;
      details: any;
      itemNumber: number;
    }> = [];

    Object.entries(paths).forEach(([path, methods]: [string, any]) => {
      Object.entries(methods).forEach(([method, details]: [string, any]) => {
        const endpoint = { path, method, details, itemNumber: 0 };

        const endpointTags = details.tags || [];
        if (endpointTags.length > 0) {
          const primaryTag = endpointTags[0];
          if (!endpointsByTag[primaryTag]) {
            endpointsByTag[primaryTag] = [];
          }
          endpointsByTag[primaryTag].push(endpoint);
        } else {
          untaggedEndpoints.push(endpoint);
        }
      });
    });

    // กำหนดหมายเลขตาม group
    Object.entries(endpointsByTag).forEach(([tag, endpoints]) => {
      endpoints.forEach((endpoint, index) => {
        endpoint.itemNumber = index + 1;
      });
    });

    untaggedEndpoints.forEach((endpoint, index) => {
      endpoint.itemNumber = index + 1;
    });

    const endpointsPromises = Object.entries(paths).map(
      async ([path, methods]: [string, any]) => {
        const methodItemsPromises = Object.entries(methods).map(
          async ([method, details]: [string, any], index: number) => {
            const methodClass = `method-${method.toLowerCase()}`;
            const detailsHtml = await this.generateEndpointDetails(details);
            const descriptionHtml = details.description
              ? await this.convertMarkdownToHtml(details.description)
              : '';

            // หา anchor ID จาก tag
            const endpointTags = details.tags || [];
            let anchorId = '';
            if (endpointTags.length > 0) {
              const primaryTag = endpointTags[0];
              const tagEndpoints = endpointsByTag[primaryTag] || [];
              const endpoint = tagEndpoints.find(
                (ep) => ep.path === path && ep.method === method,
              );
              anchorId = `endpoint-${primaryTag}-${endpoint?.itemNumber || 1}`;
            } else {
              const endpoint = untaggedEndpoints.find(
                (ep) => ep.path === path && ep.method === method,
              );
              anchorId = `endpoint-other-${endpoint?.itemNumber || 1}`;
            }

            return `
            <div class="endpoint-item" id="${anchorId}">
              <div class="endpoint-title">
                <span class="method-badge ${methodClass}">${method.toUpperCase()}</span>
                <span class="endpoint-path">${path}</span>
              </div>
              ${descriptionHtml ? `<div class="endpoint-description">${descriptionHtml}</div>` : ''}
              ${detailsHtml}
            </div>
          `;
          },
        );

        const methodItems = await Promise.all(methodItemsPromises);
        return methodItems.join('');
      },
    );

    const endpoints = await Promise.all(endpointsPromises);

    return `
      <div class="endpoints-section">
        <h2>API Endpoints</h2>
        ${endpoints.join('')}
      </div>
    `;
  }

  private async generateEndpointDetails(details: any): Promise<string> {
    const detailsArray: string[] = [];

    if (details.summary) {
      detailsArray.push(`<strong>Summary:</strong> ${details.summary}`);
    }

    // แสดง Parameters
    if (details.parameters && details.parameters.length > 0) {
      const paramsHtml = this.generateParametersTable(details.parameters);
      detailsArray.push(`<strong>Parameters:</strong><br>${paramsHtml}`);
    }

    // แสดง Request Body
    if (details.requestBody) {
      const requestBodyHtml = await this.generateRequestBodySection(
        details.requestBody,
      );
      detailsArray.push(`<strong>Request Body:</strong><br>${requestBodyHtml}`);
    }

    // แสดง Responses
    if (details.responses) {
      const responsesHtml = await this.generateResponsesSection(
        details.responses,
      );
      detailsArray.push(`<strong>Responses:</strong><br>${responsesHtml}`);
    }

    if (detailsArray.length === 0) return '';

    return `
      <div class="endpoint-details">
        ${detailsArray.join('<br><br>')}
      </div>
    `;
  }

  private generateParametersTable(parameters: any[]): string {
    const tableRows = parameters
      .map(
        (param) => `
      <tr>
        <td>${param.name}</td>
        <td>${param.in || 'unknown'}</td>
        <td>${param.required ? 'Yes' : 'No'}</td>
        <td>${param.schema?.type || param.type || 'string'}</td>
        <td>${param.description || '-'}</td>
      </tr>
    `,
      )
      .join('');

    return `
      <table class="detail-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Location</th>
            <th>Required</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    `;
  }

  private async generateRequestBodySection(requestBody: any): Promise<string> {
    let content = '';

    if (requestBody.description) {
      const descriptionHtml = await this.convertMarkdownToHtml(
        requestBody.description,
      );
      content += `<p><em>${descriptionHtml}</em></p>`;
    }

    if (requestBody.required !== undefined) {
      content += `<p><strong>Required:</strong> ${requestBody.required ? 'Yes' : 'No'}</p>`;
    }

    if (requestBody.content) {
      const contentTypes = Object.keys(requestBody.content);
      content += `<p><strong>Content Types:</strong> ${contentTypes.join(', ')}</p>`;

      // แสดง schema ของ request body
      for (const contentType of contentTypes) {
        const schema = requestBody.content[contentType].schema;
        if (schema) {
          content += await this.generateSchemaInfo(schema);
        }
      }
    }

    return content;
  }

  private async generateResponsesSection(responses: any): Promise<string> {
    const responseItemsPromises = Object.entries(responses).map(
      async ([statusCode, response]: [string, any]) => {
        let content = `<div class="response-item">`;

        const descriptionHtml = response.description
          ? await this.convertMarkdownToHtml(response.description)
          : 'No description';
        content += `<h5>${statusCode} - ${descriptionHtml}</h5>`;

        if (response.content) {
          const contentTypes = Object.keys(response.content);
          content += `<p><strong>Content Types:</strong> ${contentTypes.join(', ')}</p>`;

          for (const contentType of contentTypes) {
            const schema = response.content[contentType].schema;
            const example = response.content[contentType].example;

            if (schema) {
              content += await this.generateSchemaInfo(schema);
            }

            // แสดงตัวอย่าง Response
            if (example) {
              content += `<div class="example-section">`;
              content += `<h6>Example Response:</h6>`;
              content += this.generateExampleResponse(example, contentType);
              content += `</div>`;
            } else {
              // สร้างตัวอย่างจาก schema ถ้าไม่มี example
              const generatedExample = this.generateExampleFromSchema(schema);
              if (generatedExample) {
                content += `<div class="example-section">`;
                content += `<h6>Example Response:</h6>`;
                content += this.generateExampleResponse(
                  generatedExample,
                  contentType,
                );
                content += `</div>`;
              }
            }
          }
        }

        content += `</div>`;
        return content;
      },
    );

    const responseItems = await Promise.all(responseItemsPromises);
    return responseItems.join('');
  }

  private async generateSchemaInfo(schema: any): Promise<string> {
    let content = '';

    // รองรับ $ref
    if (schema.$ref) {
      const refSchema = this.resolveRef(schema.$ref);
      if (refSchema) {
        return this.generateSchemaInfo(refSchema);
      }
    }

    if (schema.properties) {
      // สร้าง set ของ required properties
      const requiredProps = new Set<string>(schema.required || []);

      // แปลง nested properties เป็น flat structure ด้วย dot notation
      const flattenedProperties = this.flattenProperties(
        schema.properties,
        requiredProps,
      );

      const propertyRowsPromises = flattenedProperties.map(
        async ({ path, propSchema, isRequired }) => {
          const descriptionHtml = propSchema.description
            ? await this.convertMarkdownToHtml(propSchema.description)
            : '-';

          return `
          <tr>
            <td>${path}</td>
            <td>${this.getSchemaTypeDisplay(propSchema)}</td>
            <td>${isRequired ? 'Yes' : 'No'}</td>
            <td>${descriptionHtml}</td>
          </tr>
        `;
        },
      );

      const propertyRows = await Promise.all(propertyRowsPromises);

      content += `
        <table class="detail-table">
          <thead>
            <tr>
              <th>Property</th>
              <th>Type</th>
              <th>Required</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${propertyRows.join('')}
          </tbody>
        </table>
      `;
    }

    return content;
  }

  private flattenProperties(
    properties: any,
    requiredProps: Set<string>,
    parentPath: string = '',
  ): Array<{ path: string; propSchema: any; isRequired: boolean }> {
    const flattened: Array<{
      path: string;
      propSchema: any;
      isRequired: boolean;
    }> = [];

    Object.entries(properties).forEach(
      ([propName, propSchema]: [string, any]) => {
        const currentPath = parentPath ? `${parentPath}.${propName}` : propName;
        const isRequired = requiredProps.has(propName);

        // รองรับ $ref - resolve schema ก่อน
        let resolvedSchema = propSchema;
        if (propSchema.$ref) {
          const refSchema = this.resolveRef(propSchema.$ref);
          if (refSchema) {
            resolvedSchema = refSchema;
          }
        }

        // ถ้า property เป็น object และมี properties ให้ flatten ต่อไป
        if (resolvedSchema.type === 'object' && resolvedSchema.properties) {
          // สร้าง set ของ required properties สำหรับ nested object
          const nestedRequiredProps = new Set<string>(
            resolvedSchema.required || [],
          );
          const nestedFlattened = this.flattenProperties(
            resolvedSchema.properties,
            nestedRequiredProps,
            currentPath,
          );
          flattened.push(...nestedFlattened);
        } else if (resolvedSchema.type === 'array' && resolvedSchema.items) {
          // รองรับ $ref ใน array items ด้วย
          let resolvedItems = resolvedSchema.items;
          if (resolvedSchema.items.$ref) {
            const refItems = this.resolveRef(resolvedSchema.items.$ref);
            if (refItems) {
              resolvedItems = refItems;
            }
          }

          if (resolvedItems.type === 'object' && resolvedItems.properties) {
            // ถ้าเป็น array ของ objects ให้แสดง properties ของ item
            const itemRequiredProps = new Set<string>(
              resolvedItems.required || [],
            );
            const itemFlattened = this.flattenProperties(
              resolvedItems.properties,
              itemRequiredProps,
              `${currentPath}[0]`,
            );
            flattened.push(...itemFlattened);
          } else {
            // ถ้าเป็น array ของ primitives
            flattened.push({
              path: currentPath,
              propSchema: resolvedSchema,
              isRequired,
            });
          }
        } else {
          // ถ้าเป็น primitive type หรือ array ของ primitives
          flattened.push({
            path: currentPath,
            propSchema: resolvedSchema,
            isRequired,
          });
        }
      },
    );

    return flattened;
  }

  private resolveRef($ref: string): any {
    // แยก path ของ $ref เช่น "#/components/schemas/SsrResponseDto"
    if ($ref.startsWith('#/')) {
      const path = $ref.substring(2).split('/');
      let current = this.swaggerDoc;

      for (const segment of path) {
        if (current && typeof current === 'object' && current[segment]) {
          current = current[segment];
        } else {
          return null;
        }
      }

      return current;
    }

    return null;
  }

  private getSchemaTypeDisplay(schema: any): string {
    if (schema.$ref) {
      // แสดงชื่อ schema จาก $ref
      const refName = schema.$ref.split('/').pop();
      return `<code>${refName}</code>`;
    }

    if (schema.type === 'array' && schema.items) {
      const itemType = this.getSchemaTypeDisplay(schema.items);
      return `array of ${itemType}`;
    }

    if (schema.type === 'object') {
      return 'object';
    }

    if (schema.format) {
      return `${schema.type} (${schema.format})`;
    }

    return schema.type || 'unknown';
  }

  private generateExampleResponse(example: any, contentType: string): string {
    let formattedExample: string;

    if (typeof example === 'object') {
      formattedExample = JSON.stringify(example, null, 2);
    } else {
      formattedExample = String(example);
    }

    return `
      <div class="example-code">
        <pre><code class="language-${contentType.includes('json') ? 'json' : 'text'}">${this.escapeHtml(formattedExample)}</code></pre>
      </div>
    `;
  }

  private generateExampleFromSchema(schema: any, propertyName?: string): any {
    if (!schema) return null;

    // รองรับ $ref
    if (schema.$ref) {
      const refSchema = this.resolveRef(schema.$ref);
      if (refSchema) {
        return this.generateExampleFromSchema(refSchema, propertyName);
      }
      return null;
    }

    switch (schema.type) {
      case 'string':
        if (schema.example) {
          return schema.example;
        }
        if (schema.enum && schema.enum.length > 0) {
          return schema.enum[0];
        }

        // ตรวจสอบ format
        if (schema.format === 'email') {
          return faker.internet.email();
        }
        if (schema.format === 'date') {
          return faker.date.past().toISOString().split('T')[0];
        }
        if (schema.format === 'date-time') {
          return faker.date.recent().toISOString();
        }
        if (schema.format === 'uuid') {
          return faker.string.uuid();
        }
        if (schema.format === 'uri' || schema.format === 'url') {
          return faker.internet.url();
        }
        if (schema.format === 'ipv4') {
          return faker.internet.ipv4();
        }
        if (schema.format === 'ipv6') {
          return faker.internet.ipv6();
        }
        if (schema.format === 'phone') {
          return faker.phone.number();
        }

        // ตรวจสอบ property name เพื่อสร้างข้อมูลที่เหมาะสม
        if (propertyName) {
          const name = propertyName.toLowerCase();

          if (name.includes('name') || name.includes('title')) {
            if (name.includes('first')) return faker.person.firstName();
            if (name.includes('last')) return faker.person.lastName();
            if (name.includes('full')) return faker.person.fullName();
            if (name.includes('user')) return faker.internet.userName();
            return faker.person.fullName();
          }

          if (name.includes('email')) {
            return faker.internet.email();
          }

          if (name.includes('phone') || name.includes('mobile')) {
            return faker.phone.number();
          }

          if (name.includes('address') || name.includes('street')) {
            return faker.location.streetAddress();
          }

          if (name.includes('city')) {
            return faker.location.city();
          }

          if (name.includes('country')) {
            return faker.location.country();
          }

          if (name.includes('zip') || name.includes('postal')) {
            return faker.location.zipCode();
          }

          if (name.includes('company')) {
            return faker.company.name();
          }

          if (name.includes('job') || name.includes('position')) {
            return faker.person.jobTitle();
          }

          if (name.includes('description') || name.includes('bio')) {
            return faker.lorem.paragraph();
          }

          if (name.includes('comment') || name.includes('note')) {
            return faker.lorem.sentence();
          }

          if (name.includes('url') || name.includes('link')) {
            return faker.internet.url();
          }

          if (name.includes('avatar') || name.includes('image')) {
            return faker.image.avatar();
          }

          if (name.includes('password')) {
            return faker.internet.password();
          }

          if (name.includes('token') || name.includes('key')) {
            return faker.string.alphanumeric(32);
          }

          if (name.includes('id')) {
            return faker.string.alphanumeric(8);
          }
        }

        // Default string
        return faker.lorem.sentence();

      case 'number':
      case 'integer':
        if (schema.example) {
          return schema.example;
        }

        // ตรวจสอบ property name
        if (propertyName) {
          const name = propertyName.toLowerCase();

          if (name.includes('age')) {
            return faker.number.int({ min: 18, max: 80 });
          }

          if (
            name.includes('price') ||
            name.includes('cost') ||
            name.includes('amount')
          ) {
            return faker.number.float({ min: 1, max: 1000, fractionDigits: 2 });
          }

          if (name.includes('rating') || name.includes('score')) {
            return faker.number.int({ min: 1, max: 5 });
          }

          if (name.includes('count') || name.includes('total')) {
            return faker.number.int({ min: 0, max: 100 });
          }
        }

        if (schema.minimum !== undefined && schema.maximum !== undefined) {
          return faker.number.int({ min: schema.minimum, max: schema.maximum });
        }
        if (schema.minimum !== undefined) {
          return faker.number.int({
            min: schema.minimum,
            max: schema.minimum + 100,
          });
        }
        return faker.number.int({ min: 1, max: 100 });

      case 'boolean':
        if (schema.example !== undefined) {
          return schema.example;
        }
        return faker.datatype.boolean();

      case 'array':
        if (schema.example) {
          return schema.example;
        }
        if (schema.items) {
          const itemExample = this.generateExampleFromSchema(
            schema.items,
            propertyName,
          );
          const arraySize = schema.minItems || schema.maxItems || 3;
          const size =
            typeof arraySize === 'number' ? Math.min(arraySize, 5) : 3;
          return Array.from({ length: size }, () => itemExample);
        }
        return [];

      case 'object':
        if (schema.example) {
          return schema.example;
        }
        if (schema.properties) {
          const example: any = {};
          Object.entries(schema.properties).forEach(
            ([propName, propSchema]: [string, any]) => {
              example[propName] = this.generateExampleFromSchema(
                propSchema,
                propName,
              );
            },
          );
          return example;
        }
        return {};

      default:
        return null;
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
