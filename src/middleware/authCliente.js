// src/middleware/authCliente.js — Middleware JWT para clientes web
// Independiente del auth de usuarios internos (usa secretos separados)
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const JWT_SECRET_CLIENTES = process.env.JWT_SECRET_CLIENTES || (process.env.JWT_SECRET + '_clientes');
const JWT_EXPIRES_IN = process.env.JWT_CLIENTES_EXPIRES_IN || '1h';

/**
 * Genera un access token para un cliente web
 */
function generarAccessToken(cliente) {
  return jwt.sign(
    { id: cliente.id, email: cliente.email, tipo: cliente.tipo || 'minorista', type: 'cliente' },
    JWT_SECRET_CLIENTES,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Genera un refresh token para un cliente web
 */
function generarRefreshToken(cliente) {
  return jwt.sign(
    { id: cliente.id, type: 'cliente_refresh' },
    JWT_SECRET_CLIENTES,
    { expiresIn: '30d' }
  );
}

/**
 * Verifica un token de cliente
 */
function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET_CLIENTES);
}

/**
 * Middleware: autentica cliente por JWT, carga req.cliente
 */
const authCliente = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET_CLIENTES);

    if (decoded.type !== 'cliente') {
      return res.status(401).json({ error: 'Token inválido para cliente' });
    }

    const result = await pool.query(
      'SELECT id, nombre, email, telefono, direccion, ciudad, provincia, codigo_postal, tipo, created_at FROM clientes WHERE id = $1 AND activo = true',
      [decoded.id]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Cliente no válido o desactivado' });
    }
    req.cliente = result.rows[0];
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
};

module.exports = { authCliente, generarAccessToken, generarRefreshToken, verificarToken };
