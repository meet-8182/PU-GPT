import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Canvas } from '@napi-rs/canvas';

const pdfPath = './uploads/07468bb6-ade7-4040-bd7a-e755c363ce5a.pdf';
const pdfBuffer = fs.readFileSync(pdfPath);

// Convert Buffer to Uint8Array
const pdfData = new Uint8Array(pdfBuffer);

const loadingTask = pdfjsLib.getDocument({ data: pdfData });
const pdfDoc = await loadingTask.promise;
console.log('PDF pages:', pdfDoc.numPages);

for (let i = 1; i <= Math.min(pdfDoc.numPages, 5); i++) {
  const page = await pdfDoc.getPage(i);
  const viewport = page.getViewport({ scale: 2.0 });
  
  const canvas = new Canvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');
  
  const renderContext = {
    canvasContext: context,
    viewport: viewport
  };
  
  await page.render(renderContext).promise;
  
  // Convert to buffer
  const buffer = canvas.toBuffer('image/png');
  console.log('Page', i, 'buffer length:', buffer.length);
  
  // Check PNG signature
  console.log('Page', i, 'PNG signature:', buffer.subarray(0, 8).toString('hex'));
}