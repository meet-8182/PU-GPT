import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Canvas } from '@napi-rs/canvas';
import { Ollama } from 'ollama';
import fs from 'fs';
import path from 'path';

const VISION_MODEL = 'llava-llama3:8b';
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

async function test() {
  const pdfPath = './uploads/07468bb6-ade7-4040-bd7a-e755c363ce5a.pdf';
  const pdfBuffer = fs.readFileSync(pdfPath);
  
  // Convert PDF to images
  const pdfData = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({ data: pdfData });
  const pdfDoc = await loadingTask.promise;
  
  console.log('PDF pages:', pdfDoc.numPages);
  
  // Test with just 1 page
  const pageCount = 1;
  const base64Images = [];
  
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = new Canvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    const renderContext = { canvasContext: context, viewport: viewport };
    await page.render(renderContext).promise;
    const buffer = canvas.toBuffer('image/png');
    
    if (buffer.length === 0) {
      console.warn(`Page ${i} produced empty buffer`);
      continue;
    }
    
    const base64 = buffer.toString('base64');
    base64Images.push(base64);
    console.log(`Page ${i}: ${buffer.length} bytes, ${viewport.width}x${viewport.height}`);
  }
  
  if (base64Images.length === 0) {
    console.error('No valid images produced');
    return;
  }
  
  // Test vision model
  const systemPrompt = `You are PuGPT, a tutor for Computer Science. Analyze the attached PDF page and answer the user's question. If something is unclear or unreadable, say so instead of guessing.`;
  
  try {
    console.log('Sending request to Ollama...');
    console.log('Model:', VISION_MODEL);
    console.log('Image count:', base64Images.length);
    
    const response = await ollama.chat({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Question: What is this document about?`,
          images: base64Images,
        },
      ],
      options: {
        temperature: 0.3,
        num_predict: 500,
        num_ctx: 4096,
        keep_alive: -1,
      },
      stream: false,
    });
    
    console.log('Response received:');
    console.log(response.message.content);
    
  } catch (error) {
    console.error('Error:', error);
    if (error.cause) console.error('Cause:', error.cause);
    if (error.response) {
      console.error('Response status:', error.response?.status);
      console.error('Response data:', error.response?.data);
    }
  }
}

test();