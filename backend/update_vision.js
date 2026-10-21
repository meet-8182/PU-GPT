import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chatPath = path.join(__dirname, 'src', 'services', 'chat.js');
const visionPath = path.join(__dirname, 'temp_vision.js');

const chatContent = fs.readFileSync(chatPath, 'utf8');
const visionContent = fs.readFileSync(visionPath, 'utf8');

// Find the analyzePDFWithVision function and replace it
const startMarker = '/**\n * Process PDF with vision model (for scanned PDFs)';
const endMarker = '}\n\nconst FIELD_CATEGORIES = {';

const startIdx = chatContent.indexOf(startMarker);
const endIdx = chatContent.indexOf(endMarker, startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find function boundaries');
  process.exit(1);
}

const newContent = chatContent.slice(0, startIdx) + visionContent + '\n\n' + chatContent.slice(endIdx);
fs.writeFileSync(chatPath, newContent);
console.log('Updated chat.js successfully');