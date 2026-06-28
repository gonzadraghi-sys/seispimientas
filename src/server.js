// src/server.js — Punto de entrada del servidor
require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { pool }   = require('./config/database');
const { logger, requestLogger } = require('./services/logger');
const apiRoutes = require('./routes/index');
const path = require('path');
const fs = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── ARCHIVOS ESTÁTICOS (imágenes de productos) ──
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (fs.existsSync(uploadsDir)) {
  app.use('/uploads', express.static(uploadsDir, { maxAge: '1d' }));
}

// ── SEGURIDAD ────────────────────────────────────────────
// Helmet: cabeceras HTTP seguras
app.use(helmet());

// CORS: permitir origenes configurados (separados por coma en .env)
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',').map(s => s.trim());

app.use(cors({
  origin:      corsOrigins,
  methods:     ['GET','POST','PUT','DELETE','PATCH'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));

// Rate limiting global
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message:  { error: 'Demasiadas solicitudes. Intentá de nuevo más tarde.' },
  standardHeaders: true,
  legacyHeaders:   false,
}));

// ── PARSERS ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOG SANITIZADO DE REQUESTS ─────────────────────────
app.use(requestLogger);

// ── RUTAS ────────────────────────────────────────────────
const oauthRoutes = require('./routes/oauth');
app.use('/api', apiRoutes);
app.use('/oauth2', oauthRoutes);

// Health check — para monitoreo y Docker
app.get('/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      db:        'conectada',
      version:   '1.0.0',
    });
  } catch {
    res.status(503).json({ status: 'error', db: 'desconectada' });
  }
});

// ── 404 ──────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// ── ERROR HANDLER GLOBAL ─────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error('Error no capturado', { error: err.message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
  });
});

// ── INICIAR (solo si se ejecuta directamente, no al requerirlo para tests) ──
if (require.main === module) {
  const server = app.listen(PORT, () => {
    logger.info('Seis Pimientas API iniciada', { puerto: PORT, entorno: process.env.NODE_ENV || 'development' });
  });

  // Timeout largo para requests de backup pesados (10 min)
  server.timeout = 600000;
  server.headersTimeout = 610000;
  server.requestTimeout = 600000;
}

module.exports = app; // para tests
