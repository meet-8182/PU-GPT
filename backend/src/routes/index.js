import authRoutes from './auth.js';
import documentRoutes from './documents.js';
import chatRoutes from './chat.js';
import teacherRoutes from './teacher.js';
import adminRoutes from './admin.js';
import imageRoutes from './images.js';
import memoryRoutes from './memory.js';
import speechRoutes from './speech.js';
import evalRoutes from './eval.js';

export const setupRoutes = (app) => {
  app.use('/api/auth', authRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/teacher', teacherRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/images', imageRoutes);
  app.use('/api/memory', memoryRoutes);
  app.use('/api/speech', speechRoutes);
  app.use('/api/eval', evalRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
};