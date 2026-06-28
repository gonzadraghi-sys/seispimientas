// src/services/logger.js — Logger sanitizado con Winston
const winston = require('winston');
const { combine, timestamp, json, printf, colorize } = winston.format;

// ── Lista de campos sensibles a SANITIZAR ────────────
const SENSITIVE_FIELDS = [
  'password', 'password_hash', 'newPassword', 'oldPassword', 'nueva_password',
  'accessToken', 'refreshToken', 'token', 'reset_token',
  'secret', 'api_key', 'apiKey', 'API_KEY',
  'jwt_secret', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_SECRET_CLIENTES',
  'mp_access_token', 'MP_ACCESS_TOKEN', 'stability_api_key', 'openai_api_key', 'clipdrop_api_key',
  'authorization', 'Authorization',
];

const SENSITIVE_PATTERNS = [
  /(eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/g,  // JWT tokens
  /(sk-[a-zA-Z0-9_-]{20,})/g,                                    // API keys sk-...
  /(['"][a-f0-9]{64,}['"])/g,                                     // Hex secrets 64+ chars
];

/**
 * Reemplaza valores sensibles por [REDACTED] manteniendo la estructura
 */
function sanitize(obj, depth = 0) {
  if (depth > 5) return obj;
  if (typeof obj === 'string') {
    let s = obj;
    for (const pattern of SENSITIVE_PATTERNS) {
      s = s.replace(pattern, (match) => {
        if (match.length > 10) return match.substring(0, 6) + '...[REDACTED]';
        return '[REDACTED]';
      });
    }
    return s;
  }
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(i => sanitize(i, depth + 1));
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      if (SENSITIVE_FIELDS.some(f => keyLower.includes(f.toLowerCase()))) {
        sanitized[key] = value ? '[REDACTED]' : value;
      } else {
        sanitized[key] = sanitize(value, depth + 1);
      }
    }
    return sanitized;
  }
  return obj;
}

// ── Formato para desarrollo (legible) ──
const devFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ timestamp, level, message, ...meta }) => {
    const safe = sanitize(meta);
    const metaStr = Object.keys(safe).length ? ' ' + JSON.stringify(safe, null, 2) : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// ── Formato para producción (JSON estructurado) ──
const prodFormat = combine(
  timestamp(),
  json()
);

// ── Crear logger ──
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: 'seispimientas-api' },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
    }),
  ],
});

// En producción, agregar archivos rotados
if (process.env.NODE_ENV === 'production') {
  const fs = require('fs');
  const path = require('path');
  const logDir = path.join(process.cwd(), 'logs');

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const fileRotate = require('winston-daily-rotate-file');
  // Opcional: si el paquete no está instalado, solo usamos console
  try {
    const DailyRotateFile = require('winston-daily-rotate-file');
    logger.add(new DailyRotateFile({
      filename: path.join(logDir, 'api-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: prodFormat,
    }));
  } catch (e) {
    logger.warn('winston-daily-rotate-file no disponible, logs solo a consola');
  }
}

/**
 * Middleware sanitizado para Express — registra cada request
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const safeHeaders = sanitize({ ...req.headers });
    const safeBody = sanitize(req.body || {});
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      query: Object.keys(req.query).length ? sanitize(req.query) : undefined,
      body: Object.keys(safeBody).length ? safeBody : undefined,
    });
  });
  next();
}

module.exports = { logger, sanitize, requestLogger };
