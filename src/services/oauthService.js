// src/services/oauthService.js — OAuth 2.0 Authorization Server
const crypto = require('crypto');
const { pool } = require('../config/database');
const { logger } = require('./logger');

const AUTH_CODE_EXPIRES_MINUTES = 5;

/**
 * Genera un authorization code criptográficamente seguro
 */
function generateCode() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Genera code_challenge desde code_verifier usando S256
 */
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Valida PKCE: code_verifier vs code_challenge
 */
function validatePKCE(codeVerifier, codeChallenge, method = 'S256') {
  if (method === 'S256') {
    return generateCodeChallenge(codeVerifier) === codeChallenge;
  }
  // method === 'plain'
  return codeVerifier === codeChallenge;
}

/**
 * Crea un authorization code y lo guarda en BD
 */
async function createAuthorizationCode({ clientId, usuarioId, clienteId, redirectUri, codeChallenge, codeChallengeMethod, scopes }) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + AUTH_CODE_EXPIRES_MINUTES * 60 * 1000);

  await pool.query(
    `INSERT INTO oauth_authorization_codes
       (code, client_id, usuario_id, cliente_id, redirect_uri, code_challenge, code_challenge_method, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [code, clientId, usuarioId || null, clienteId || null, redirectUri, codeChallenge || null, codeChallengeMethod || 'S256', scopes || [], expiresAt]
  );

  return code;
}

/**
 * Valida y canjea un authorization code por un par access_token + refresh_token
 */
async function exchangeCode({ code, codeVerifier, redirectUri, clientDb }) {
  const result = await pool.query(
    'SELECT * FROM oauth_authorization_codes WHERE code = $1 AND used = false AND expires_at > NOW()',
    [code]
  );
  if (!result.rows.length) {
    throw { error: 'invalid_grant', description: 'Código inválido o expirado' };
  }

  const authCode = result.rows[0];

  // Validar client_id
  if (authCode.client_id !== clientDb.id) {
    throw { error: 'invalid_grant', description: 'Código no pertenece a este cliente' };
  }

  // Validar redirect_uri
  if (authCode.redirect_uri !== redirectUri) {
    throw { error: 'invalid_grant', description: 'redirect_uri no coincide' };
  }

  // Validar PKCE (si hay code_challenge)
  if (authCode.code_challenge) {
    if (!codeVerifier) {
      throw { error: 'invalid_grant', description: 'code_verifier requerido (PKCE)' };
    }
    if (!validatePKCE(codeVerifier, authCode.code_challenge, authCode.code_challenge_method)) {
      throw { error: 'invalid_grant', description: 'code_verifier inválido' };
    }
  }

  // Marcar como usado (one-time use)
  await pool.query('UPDATE oauth_authorization_codes SET used = true WHERE id = $1', [authCode.id]);

  return {
    usuarioId: authCode.usuario_id,
    clienteId: authCode.cliente_id,
    scopes: authCode.scopes,
    clientId: authCode.client_id,
  };
}

/**
 * Revoca todos los tokens de un usuario para un cliente
 */
async function revokeUserTokens(usuarioId, clientId) {
  await pool.query(
    'UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1',
    [usuarioId]
  );
}

module.exports = {
  generateCode,
  generateCodeChallenge,
  validatePKCE,
  createAuthorizationCode,
  exchangeCode,
  revokeUserTokens,
};
