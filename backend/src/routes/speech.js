import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/index.js';
import { config } from '../config/index.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = express.Router();

// Multer for audio uploads (webm/ogg from MediaRecorder)
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'audio/webm',
      'audio/ogg',
      'audio/wav',
      'audio/mpeg',
      'audio/mp4',
      'audio/x-m4a',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported audio format'), false);
    }
  },
});

// POST /api/speech/to-text - Transcribe audio to text
router.post('/to-text', requireAuth, upload.single('audio'), async (req, res, next) => {
  try {
    console.log('[STT] Request received:', { 
      file: req.file ? { size: req.file.size, mimetype: req.file.mimetype } : 'none',
      provider: config.sttProvider 
    });
    
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Use configured STT provider
    const provider = config.sttProvider || 'whisper-cpp';
    let transcript;

    switch (provider) {
      case 'whisper-cpp':
        transcript = await transcribeWithWhisperCpp(audioBuffer, mimeType);
        break;
      case 'faster-whisper':
        transcript = await transcribeWithFasterWhisper(audioBuffer, mimeType);
        break;
      case 'whisper-api':
        transcript = await transcribeWithWhisperApi(audioBuffer, mimeType);
        break;
      case 'assemblyai':
        transcript = await transcribeWithAssemblyAI(audioBuffer, mimeType);
        break;
      default:
        throw new Error(`Unknown STT provider: ${provider}`);
    }

    res.json({ transcript: transcript.trim() });
  } catch (error) {
    console.error('STT error:', error);
    res.status(500).json({ error: 'Transcription failed', details: error.message });
  }
});

// ---------- Whisper.cpp (local binary) ----------
async function transcribeWithWhisperCpp(audioBuffer, mimeType) {
  const whisperPath = config.whisperCppPath || 'whisper-cli'; // or 'main' depending on build
  const modelPath = config.whisperModelPath || path.join(process.cwd(), 'models', 'ggml-base.en.bin');

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found at ${modelPath}. Download from https://huggingface.co/ggerganov/whisper.cpp`);
  }

  // Save audio to temp file
  const ext = mimeTypeToExt(mimeType);
  const tempInput = path.join(os.tmpdir(), `stt-in-${Date.now()}.${ext}`);
  const tempOutput = path.join(os.tmpdir(), `stt-out-${Date.now()}.txt`);
  
  fs.writeFileSync(tempInput, audioBuffer);

  return new Promise((resolve, reject) => {
    // whisper-cli -m model.bin -f input.wav -otxt
    const args = [
      '-m', modelPath,
      '-f', tempInput,
      '-otxt',
      '-l', 'en', // language
      '-np', // no prints
    ];

    const child = spawn(whisperPath, args, { cwd: path.dirname(whisperPath) });
    let stderr = '';

    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      // Cleanup
      fs.unlinkSync(tempInput);
      if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);

      if (code !== 0) {
        return reject(new Error(`whisper.cpp exited with code ${code}: ${stderr}`));
      }

      // Output file is input.txt (whisper.cpp creates it next to input)
      const outFile = tempInput.replace(/\.[^.]+$/, '.txt');
      if (fs.existsSync(outFile)) {
        const text = fs.readFileSync(outFile, 'utf8');
        fs.unlinkSync(outFile);
        resolve(text);
      } else {
        reject(new Error('Whisper output file not found'));
      }
    });

    child.on('error', (err) => {
      fs.unlinkSync(tempInput);
      reject(new Error(`Failed to start whisper.cpp: ${err.message}. Ensure '${whisperPath}' is in PATH or set config.whisperCppPath`));
    });
  });
}

// ---------- faster-whisper (Python) ----------
async function transcribeWithFasterWhisper(audioBuffer, mimeType) {
  const pythonScript = config.fasterWhisperScript || path.join(process.cwd(), 'stt', 'transcribe.py');
  
  console.log('[STT] faster-whisper:', { pythonScript, exists: fs.existsSync(pythonScript), cwd: process.cwd() });
  
  if (!fs.existsSync(pythonScript)) {
    throw new Error(`faster-whisper script not found at ${pythonScript}`);
  }

  const ext = mimeTypeToExt(mimeType);
  const tempInput = path.join(os.tmpdir(), `stt-in-${Date.now()}.${ext}`);
  fs.writeFileSync(tempInput, audioBuffer);

  // Use 'python' on Windows, 'python3' on Unix
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  // Fix OpenMP conflict on Windows (libiomp5md.dll already initialized)
  const env = { 
    ...process.env, 
    KMP_DUPLICATE_LIB_OK: 'TRUE',
    // Also help with model caching
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
  };

  return new Promise((resolve, reject) => {
    console.log('[STT] Spawning:', pythonCmd, pythonScript, tempInput);
    const child = spawn(pythonCmd, [pythonScript, tempInput], { env });
    let stdout = '', stderr = '';

    child.stdout.on('data', (d) => stdout += d.toString());
    child.stderr.on('data', (d) => stderr += d.toString());

    child.on('close', (code) => {
      console.log('[STT] Process closed:', { code, stdout: stdout.slice(0, 200), stderr: stderr.slice(0, 200) });
      fs.unlinkSync(tempInput);
      if (code !== 0) return reject(new Error(`faster-whisper failed: ${stderr}`));
      resolve(stdout.trim());
    });

    child.on('error', (err) => {
      console.error('[STT] Spawn error:', err);
      fs.unlinkSync(tempInput);
      reject(new Error(`Failed to start faster-whisper: ${err.message}. Ensure '${pythonCmd}' is in PATH.`));
    });
  });
}

// ---------- OpenAI Whisper API ----------
async function transcribeWithWhisperApi(audioBuffer, mimeType) {
  const apiKey = config.openaiApiKey;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', audioBuffer, { filename: `audio.${mimeTypeToExt(mimeType)}`, contentType: mimeType });
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'text');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, ...form.getHeaders() },
    body: form,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper API error: ${err}`);
  }
  return response.text();
}

// ---------- AssemblyAI ----------
async function transcribeWithAssemblyAI(audioBuffer, mimeType) {
  const apiKey = config.assemblyAiApiKey;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not configured');

  // 1. Upload audio
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: apiKey },
    body: audioBuffer,
  });
  const { upload_url } = await uploadRes.json();

  // 2. Request transcription
  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, language_code: 'en' }),
  });
  const { id } = await transcriptRes.json();

  // 3. Poll for completion
  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    const { status, text, error } = await poll.json();
    if (status === 'completed') return text;
    if (status === 'error') throw new Error(error);
  }
}

function mimeTypeToExt(mime) {
  const map = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
  };
  return map[mime] || 'webm';
}

export default router;