import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { Ollama } from 'ollama';
import { config, validateConfig } from './config/index.js';
import { setupRoutes } from './routes/index.js';
import { errorHandler } from './middleware/index.js';

const app = express();

// Do not advertise the framework.
app.disable('x-powered-by');

// Only trust proxy headers when explicitly configured (needed for correct rate-limit keys).
if (config.trustProxy && config.trustProxy !== 'false') {
  const value = /^\d+$/.test(String(config.trustProxy))
    ? Number(config.trustProxy)
    : config.trustProxy;
  app.set('trust proxy', value);
}

const corsOptions = {
  // Explicit allowlist only. Requests from unknown origins receive no CORS headers,
  // so browsers refuse to expose their responses.
  origin(origin, callback) {
    if (!origin) {
      // Same-origin, curl, server-to-server requests.
      return callback(null, true);
    }
    if (config.corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
};

app.use(helmet({
  // The app only serves JSON and generated files, not HTML documents.
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

setupRoutes(app);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

async function startServer() {
  try {
    validateConfig();

    const mongoOptions = {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    };

    // TLS is opt-in and always verifies certificates and hostnames.
    if (config.mongoTls) {
      mongoOptions.tls = false;
      if (config.mongoTlsCAFile) mongoOptions.tlsCAFile = config.mongoTlsCAFile;
      if (config.mongoTlsCertKeyFile) mongoOptions.tlsCertificateKeyFile = config.mongoTlsCertKeyFile;
    }

    await mongoose.connect(config.mongoUri, mongoOptions);
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
    console.error('Failed to start server:', error.message);
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
