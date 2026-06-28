// src/controllers/oauthController.js — OAuth 2.0 Authorization Server
const { pool } = require('../config/database');
const { logger } = require('../services/logger');
const { generarAccessToken, generarRefreshToken } = require('../utils/jwt');
const { createAuthorizationCode, exchangeCode } = require('../services/oauthService');
const bcrypt = require('bcryptjs');

// ═══════════════════════════════════════════
//  AUTHORIZATION ENDPOINT
// ═══════════════════════════════════════════

/**
 * Helper: valida un cliente OAuth y devuelve sus datos
 */
async function validarCliente(clientId, redirectUri) {
  if (!clientId) throw { error: 'invalid_request', description: 'client_id requerido' };
  if (!redirectUri) throw { error: 'invalid_request', description: 'redirect_uri requerido' };

  const client = await pool.query(
    'SELECT id, redirect_uris, active FROM oauth_clients WHERE client_id = $1 AND active = true',
    [clientId]
  );
  if (!client.rows.length) throw { error: 'invalid_client', description: 'Cliente no válido o inactivo' };

  const uriValida = client.rows[0].redirect_uris.some(uri => redirectUri.startsWith(uri));
  if (!uriValida) throw { error: 'invalid_redirect_uri', description: 'redirect_uri no autorizado' };

  return client.rows[0];
}

/**
 * GET /oauth2/authorize
 * Solo devuelve datos del cliente y los parámetros necesarios
 */
exports.authorizeGet = async (req, res) => {
  try {
    const { client_id, redirect_uri, state } = req.query;

    try {
      await validarCliente(client_id, redirect_uri);
    } catch (e) {
      return res.status(400).json({ error: e.error, error_description: e.description });
    }

    res.json({
      client_id,
      redirect_uri,
      state: state || null,
      auth_required: true,
      authorize_url: '/oauth2/authorize',
    });
  } catch (error) {
    logger.error('Error authorizeGet:', error);
    res.status(500).json({ error: 'server_error', description: 'Error interno' });
  }
};

/**
 * POST /oauth2/authorize
 * Autentica y emite authorization code
 * Acepta: Bearer token (ya autenticado) o username+password (login directo)
 */
exports.authorizePost = async (req, res) => {
  try {
    const { client_id, redirect_uri, code_challenge, code_challenge_method, state, username, password } = req.body;

    // Validar cliente
    let clientDb;
    try {
      clientDb = await validarCliente(client_id, redirect_uri);
    } catch (e) {
      return res.status(400).json({ error: e.error, error_description: e.description });
    }

    let usuarioId = null;
    let clienteId = null;

    // Modo 1: Ya autenticado via Bearer token
    if (req.user) {
      usuarioId = req.user.id;
    } else if (req.cliente) {
      clienteId = req.cliente.id;
    }
    // Modo 2: Autenticar con username+password
    else if (username && password) {
      // Intentar como usuario interno
      const userResult = await pool.query(
        'SELECT id, password_hash, activo FROM usuarios WHERE username = $1 AND activo = true',
        [username.toUpperCase()]
      );
      if (userResult.rows.length && await bcrypt.compare(password, userResult.rows[0].password_hash)) {
        usuarioId = userResult.rows[0].id;
      } else {
        // Intentar como cliente ecommerce
        const clientResult = await pool.query(
          'SELECT id FROM clientes WHERE email = $1 AND activo = true',
          [username]
        );
        if (clientResult.rows.length) {
          clienteId = clientResult.rows[0].id;
        } else {
          return res.status(401).json({ error: 'access_denied', error_description: 'Credenciales inválidas' });
        }
      }
    } else {
      return res.status(401).json({ error: 'login_required', error_description: 'Autenticación requerida' });
    }

    // Emitir authorization code
    const code = await createAuthorizationCode({
      clientId: clientDb.id,
      usuarioId,
      clienteId,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || 'S256',
      scopes: [],
    });

    res.json({
      code,
      state: state || null,
      redirect_to: `${redirect_uri}?code=${code}${state ? '&state=' + state : ''}`,
    });
  } catch (error) {
    logger.error('Error authorizePost:', error);
    res.status(500).json({ error: 'server_error', description: 'Error interno' });
  }
};

// ═══════════════════════════════════════════
//  TOKEN ENDPOINT
//  POST /oauth2/token
// ═══════════════════════════════════════════

exports.token = async (req, res) => {
  try {
    const { grant_type, code, code_verifier, redirect_uri, refresh_token, client_id } = req.body;

    // Validar cliente
    if (!client_id) return res.status(400).json({ error: 'invalid_request', error_description: 'client_id requerido' });
    const clientResult = await pool.query(
      'SELECT * FROM oauth_clients WHERE client_id = $1 AND active = true',
      [client_id]
    );
    if (!clientResult.rows.length) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Cliente no encontrado' });
    }
    const clientDb = clientResult.rows[0];

    if (grant_type === 'authorization_code') {
      if (!code) return res.status(400).json({ error: 'invalid_request', error_description: 'code requerido' });
      if (!redirect_uri) return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri requerido' });

      const { usuarioId, clienteId } = await exchangeCode({ code, codeVerifier: code_verifier, redirectUri: redirect_uri, clientDb });

      if (usuarioId) {
        const user = await pool.query('SELECT id, username, rol_id, local_id FROM usuarios WHERE id = $1 AND activo = true', [usuarioId]);
        if (!user.rows.length) return res.status(400).json({ error: 'invalid_grant', description: 'Usuario no encontrado' });

        const accessToken = generarAccessToken(user.rows[0]);
        const refreshToken = generarRefreshToken(user.rows[0]);
        await pool.query('INSERT INTO refresh_tokens (usuario_id, token, expires_at) VALUES ($1, $2, $3)',
          [usuarioId, refreshToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]);

        return res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 900, refresh_token: refreshToken, scope: 'admin' });
      }

      if (clienteId) {
        const { generarAccessToken: genCToken, generarRefreshToken: genCRefresh } = require('../middleware/authCliente');
        const client = await pool.query('SELECT id, nombre, email, tipo FROM clientes WHERE id = $1 AND activo = true', [clienteId]);
        if (!client.rows.length) return res.status(400).json({ error: 'invalid_grant', description: 'Cliente no encontrado' });

        const accessToken = genCToken(client.rows[0]);
        const refreshToken = genCRefresh(client.rows[0]);
        return res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope: 'shop' });
      }

      return res.status(400).json({ error: 'invalid_grant', description: 'Usuario no identificado' });
    }

    if (grant_type === 'refresh_token') {
      if (!refresh_token) return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token requerido' });

      const jwt = require('jsonwebtoken');
      const { JWT_REFRESH_SECRET } = require('../utils/jwt');
      const decoded = jwt.verify(refresh_token, JWT_REFRESH_SECRET);
      if (decoded.type !== 'refresh') return res.status(400).json({ error: 'invalid_grant', description: 'Token inválido' });

      await pool.query('UPDATE refresh_tokens SET revocado = true WHERE token = $1', [refresh_token]);

      const user = await pool.query('SELECT id, username, rol_id, local_id FROM usuarios WHERE id = $1 AND activo = true', [decoded.id]);
      if (!user.rows.length) return res.status(400).json({ error: 'invalid_grant', description: 'Usuario no encontrado' });

      const newAccess = generarAccessToken(user.rows[0]);
      const newRefresh = generarRefreshToken(user.rows[0]);
      await pool.query('INSERT INTO refresh_tokens (usuario_id, token, expires_at) VALUES ($1, $2, $3)',
        [decoded.id, newRefresh, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]);

      return res.json({ access_token: newAccess, token_type: 'Bearer', expires_in: 900, refresh_token: newRefresh, scope: 'admin' });
    }

    return res.status(400).json({ error: 'unsupported_grant_type', description: `grant_type '${grant_type}' no soportado` });
  } catch (error) {
    if (error.error) return res.status(400).json({ error: error.error, error_description: error.description });
    logger.error('Error token:', error);
    res.status(500).json({ error: 'server_error', description: 'Error interno' });
  }
};

// ═══════════════════════════════════════════
//  CLIENT CRUD (admin only)
// ═══════════════════════════════════════════

exports.listClients = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, client_id, name, description, redirect_uris, grant_types, scopes, active, created_at FROM oauth_clients ORDER BY name"
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Error list oauth clients:', error);
    res.status(500).json({ error: 'Error al listar clientes OAuth' });
  }
};

exports.createClient = async (req, res) => {
  try {
    const { client_id, name, description, redirect_uris, grant_types, scopes } = req.body;
    if (!client_id || !name) return res.status(400).json({ error: 'client_id y name requeridos' });

    const result = await pool.query(
      `INSERT INTO oauth_clients (client_id, name, description, redirect_uris, grant_types, scopes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, client_id, name, active`,
      [client_id, name, description || null, redirect_uris || [], grant_types || ['authorization_code', 'refresh_token'], scopes || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error create oauth client:', error);
    res.status(500).json({ error: 'Error al crear cliente OAuth' });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, redirect_uris, grant_types, scopes, active } = req.body;
    const result = await pool.query(
      `UPDATE oauth_clients SET name = COALESCE($1, name), description = COALESCE($2, description),
       redirect_uris = COALESCE($3, redirect_uris), grant_types = COALESCE($4, grant_types),
       scopes = COALESCE($5, scopes), active = COALESCE($6, active) WHERE id = $7 RETURNING id, client_id, name, active`,
      [name, description, redirect_uris, grant_types, scopes, active, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error update oauth client:', error);
    res.status(500).json({ error: 'Error al actualizar cliente OAuth' });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM oauth_clients WHERE id = $1 RETURNING client_id', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ message: `Cliente ${result.rows[0].client_id} eliminado` });
  } catch (error) {
    logger.error('Error delete oauth client:', error);
    res.status(500).json({ error: 'Error al eliminar cliente OAuth' });
  }
};
