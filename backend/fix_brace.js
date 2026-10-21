import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chatPath = path.join(__dirname, 'src', 'services', 'chat.js');
const content = fs.readFileSync(chatPath, 'utf8');
const lines = content.split('\n');

// Remove the extra closing brace at line 422 (0-indexed: 421)
if (lines[421] === '}' && lines[422] === '') {
  lines.splice(421, 1);
  fs.writeFileSync(chatPath, lines.join('\n'));
  console.log('Fixed extra brace at line 422 (index 421)');
} else {
  console.log('Pattern not matched:', lines[421], lines[422]);
}