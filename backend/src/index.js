import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { Ollama } from 'ollama';
import { config } from './config/index.js';
import { setupRoutes } from './routes/index.js';
import { errorHandler } from './middleware/index.js';

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

setupRoutes(app);

app.use(errorHandler);

async function startServer() {
  try {
    await mongoose.connect(config.mongoUri, {
      tls: true,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });
    console.log('Connected to MongoDB');

    // Verify Ollama is reachable and model exists
    const ollama = new Ollama({ host: config.ollamaHost });
    console.log('[Startup] Ollama host:', config.ollamaHost);
    try {
      const models = await ollama.list();
      const modelNames = models.models?.map(m => m.name) || [];
      console.log('[Startup] Available Ollama models:', modelNames);
      const LLM_MODEL = 'qwen2.5:3b-instruct-q4_K_M';
      const VISION_MODEL = config.visionModel || 'llava-llama3:8b';
      
      if (!modelNames.includes(LLM_MODEL)) {
        console.warn(`[Startup] WARNING: LLM model "${LLM_MODEL}" not found in Ollama. Available: ${modelNames.join(', ')}`);
      }
      if (!modelNames.includes(VISION_MODEL)) {
        console.warn(`[Startup] WARNING: Vision model "${VISION_MODEL}" not found in Ollama. Available: ${modelNames.join(', ')}`);
      }
    } catch (e) {
      console.error('[Startup] Failed to connect to Ollama:', e.message);
      console.warn('[Startup] Continuing without model validation - Ollama may not be ready yet');
    }

    // In-process image queue is initialized on first use (lazy)
    console.log('In-process image generation queue ready (concurrency: 1)');

    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`Server running on port ${config.port}`);
      console.log('Server address:', server.address());
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        await mongoose.connection.close();
        console.log('Server closed');
        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});