// src/services/mfaService.js — Autenticación de 2 Factores (TOTP)
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { pool } = require('../config/database');

const APP_NAME = process.env.MFA_APP_NAME || 'SeisPimientas';

/**
 * Genera un secreto TOTP y el QR code para configurar la app
 */
async function setupMFA(usuarioId, email) {
  const secret = speakeasy.generateSecret({
    name: `${APP_NAME}:${email}`,
    issuer: APP_NAME,
    length: 20,
  });

  // Guardar el secreto temporalmente (aún no activado)
  await pool.query(
    'UPDATE usuarios SET mfa_secret = $1, updated_at = NOW() WHERE id = $2',
    [secret.base32, usuarioId]
  );

  // Generar QR code como base64
  const qrCode = await QRCode.toDataURL(secret.otpauth_url);

  // Generar 8 códigos de respaldo (10 dígitos hex)
  const backupCodes = Array.from({ length: 8 }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-')
  );

  await pool.query(
    'UPDATE usuarios SET mfa_backup_codes = $1 WHERE id = $2',
    [backupCodes, usuarioId]
  );

  return {
    secret: secret.base32,
    qrCode,
    backupCodes,
  };
}

/**
 * Verifica un código TOTP contra el secreto del usuario
 */
function verifyTOTP(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1, // ±30 segundos de tolerancia
  });
}

/**
 * Verifica si el token es un código de respaldo válido
 */
async function verifyBackupCode(usuarioId, code) {
  const user = await pool.query(
    'SELECT mfa_backup_codes FROM usuarios WHERE id = $1',
    [usuarioId]
  );
  if (!user.rows.length || !user.rows[0].mfa_backup_codes) return false;

  const codes = user.rows[0].mfa_backup_codes;
  const idx = codes.indexOf(code.toUpperCase());
  if (idx === -1) return false;

  // Eliminar el código usado
  codes.splice(idx, 1);
  await pool.query(
    'UPDATE usuarios SET mfa_backup_codes = $1 WHERE id = $2',
    [codes, usuarioId]
  );
  return true;
}

/**
 * Activa MFA después de verificar el primer código
 */
async function enableMFA(usuarioId, token) {
  const user = await pool.query(
    'SELECT mfa_secret FROM usuarios WHERE id = $1',
    [usuarioId]
  );
  if (!user.rows.length || !user.rows[0].mfa_secret) {
    throw new Error('Primero debes generar el setup MFA');
  }

  if (!verifyTOTP(user.rows[0].mfa_secret, token)) {
    throw new Error('Código inválido');
  }

  await pool.query(
    'UPDATE usuarios SET mfa_enabled = true WHERE id = $1',
    [usuarioId]
  );
  return true;
}

/**
 * Desactiva MFA para un usuario
 */
async function disableMFA(usuarioId, token) {
  const user = await pool.query(
    'SELECT mfa_secret FROM usuarios WHERE id = $1',
    [usuarioId]
  );
  if (!user.rows.length) throw new Error('Usuario no encontrado');

  if (!verifyTOTP(user.rows[0].mfa_secret, token)) {
    throw new Error('Código inválido');
  }

  await pool.query(
    'UPDATE usuarios SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = $1',
    [usuarioId]
  );
  return true;
}

/**
 * Verifica el estado MFA de un usuario (para login)
 */
async function checkMFAStatus(usuarioId) {
  const user = await pool.query(
    'SELECT mfa_enabled, mfa_secret FROM usuarios WHERE id = $1',
    [usuarioId]
  );
  return {
    enabled: user.rows[0]?.mfa_enabled || false,
    secret: user.rows[0]?.mfa_secret || null,
  };
}

module.exports = {
  setupMFA,
  verifyTOTP,
  verifyBackupCode,
  enableMFA,
  disableMFA,
  checkMFAStatus,
};
