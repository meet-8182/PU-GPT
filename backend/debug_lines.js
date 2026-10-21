import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chatPath = path.join(__dirname, 'src', 'services', 'chat.js');
const content = fs.readFileSync(chatPath, 'utf8');
const lines = content.split('\n');

// Check lines around 420-422 (0-indexed: 419-421)
console.log('Line 419:', JSON.stringify(lines[418]));
console.log('Line 420:', JSON.stringify(lines[419]));
console.log('Line 421:', JSON.stringify(lines[420]));
console.log('Line 422:', JSON.stringify(lines[421]));
console.log('Line 423:', JSON.stringify(lines[422]));