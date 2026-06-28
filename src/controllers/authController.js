const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { generarAccessToken, generarRefreshToken, verificarRefreshToken } = require('../utils/jwt');
const { logger } = require('../services/logger');
const { verifyTOTP, verifyBackupCode, setupMFA, enableMFA, disableMFA, checkMFAStatus } = require('../services/mfaService');
const { decryptRecord, encryptRecord } = require('../services/cryptoService');

// Helper para registrar log de acceso
async function logAcceso(usuarioId, username, accion, modulo, descripcion, ip, userAgent, localId) {
  const clientIp = ip || null;
  const ua = userAgent || null;
  await pool.query(
    `INSERT INTO log_accesos (usuario_id, username, accion, modulo, descripcion, ip, user_agent, local_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [usuarioId, username, accion, modulo, descripcion, clientIp, ua, localId]
  );
}

exports.login = async (req, res) => {
  const { username, password, mfa_code } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }
  try {
    const result = await pool.query(
      `SELECT id, username, password_hash, nombre_completo, email, rol_id, local_id, activo, mfa_enabled, mfa_secret
       FROM usuarios
       WHERE username = $1`,
      [username]
    );
    const user = decryptRecord('usuarios', result.rows[0]);
    if (!user || !user.activo) {
      await logAcceso(null, username, 'login_failed', 'auth', 'Usuario no existe o inactivo', req.ip, req.get('user-agent'), null);
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    const passwordValido = await bcrypt.compare(password, user.password_hash);
    if (!passwordValido) {
      await logAcceso(user.id, username, 'login_failed', 'auth', 'Contraseña incorrecta', req.ip, req.get('user-agent'), user.local_id);
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // ── MFA: si está habilitado, validar código ──
    if (user.mfa_enabled) {
      const isTOTP = mfa_code ? verifyTOTP(user.mfa_secret, mfa_code) : false;
      const isBackup = mfa_code ? await verifyBackupCode(user.id, mfa_code) : false;

      if (!isTOTP && !isBackup) {
        // Si no envió código, devolver challenge
        if (!mfa_code) {
          const mfaChallenge = jwt.sign(
            { id: user.id, type: 'mfa_challenge' },
            process.env.JWT_SECRET,
            { expiresIn: '5m' }
          );
          return res.json({
            mfa_required: true,
            mfa_token: mfaChallenge,
            message: 'Código de verificación requerido',
          });
        }
        await logAcceso(user.id, username, 'login_failed', 'auth', 'Código MFA inválido', req.ip, req.get('user-agent'), user.local_id);
        return res.status(401).json({ error: 'Código de verificación inválido' });
      }
    }

    // ── Generar tokens ──
    const accessToken = generarAccessToken(user);
    const refreshToken = generarRefreshToken(user);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await pool.query(
      `INSERT INTO refresh_tokens (usuario_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );

    await logAcceso(user.id, username, 'login', 'auth', 'Inicio de sesión exitoso', req.ip, req.get('user-agent'), user.local_id);
    await pool.query(`UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1`, [user.id]);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        nombre_completo: user.nombre_completo,
        email: user.email,
        rol_id: user.rol_id,
        local_id: user.local_id,
      },
      accessToken,
      refreshToken,
      mfa_enabled: user.mfa_enabled,
    });
  } catch (error) {
    logger.error('Error login:', error);
    res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }
};

exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token requerido' });
  try {
    const decoded = verificarRefreshToken(refreshToken);
    // Verificar que el token exista en BD y no esté revocado
    const tokenDb = await pool.query(
      `SELECT * FROM refresh_tokens WHERE token = $1 AND revocado = false AND expires_at > NOW()`,
      [refreshToken]
    );
    if (tokenDb.rows.length === 0) {
      return res.status(401).json({ error: 'Refresh token inválido o expirado' });
    }
    const userResult = await pool.query(
      `SELECT id, username, rol_id, local_id, activo FROM usuarios WHERE id = $1 AND activo = true`,
      [decoded.id]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no activo o no encontrado' });
    }
    const user = userResult.rows[0];
    const newAccessToken = generarAccessToken(user);
    res.json({ accessToken: newAccessToken });
  } catch (error) {
    logger.error(error);
    res.status(401).json({ error: 'Refresh token inválido' });
  }
};

exports.logout = async (req, res) => {
  const { refreshToken } = req.body;
  const usuarioId = req.user?.id;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token requerido' });
  try {
    // Revocar el refresh token usado
    await pool.query(`UPDATE refresh_tokens SET revocado = true WHERE token = $1`, [refreshToken]);
    await logAcceso(usuarioId, req.user?.username, 'logout', 'auth', 'Cierre de sesión', req.ip, req.get('user-agent'), req.user?.local_id);
    res.json({ message: 'Sesión cerrada correctamente' });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
};

exports.me = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  const [rolePermisos, mfaStatus] = await Promise.all([
    pool.query(`SELECT permisos FROM roles WHERE id = $1`, [req.user.rol_id]),
    pool.query(`SELECT mfa_enabled FROM usuarios WHERE id = $1`, [req.user.id]),
  ]);
  res.json({
    ...req.user,
    password_hash: undefined,
    permisos: rolePermisos.rows[0]?.permisos || {},
    mfa_enabled: mfaStatus.rows[0]?.mfa_enabled || false,
  });
};

exports.cambiarPassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const user = await pool.query(`SELECT password_hash FROM usuarios WHERE id = $1`, [req.user.id]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const valid = await bcrypt.compare(oldPassword, user.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, req.user.id]);
    await logAcceso(req.user.id, req.user.username, 'cambio_password', 'auth', 'Contraseña actualizada', req.ip, req.get('user-agent'), req.user.local_id);
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
};

// ═══════════════════════════════════════════
//  RESETEO DE CONTRASEÑA
// ═══════════════════════════════════════════

exports.olvidePassword = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Usuario requerido' });

    const crypto = require('crypto');
    const user = await pool.query('SELECT id FROM usuarios WHERE username = $1 AND activo = true', [username.toUpperCase()]);
    if (!user.rows.length) {
      return res.json({ ok: true, message: 'Si el usuario existe, recibirás instrucciones' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000);

    await pool.query('UPDATE usuarios SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [resetToken, expires, user.rows[0].id]);

    res.json({
      ok: true, message: 'Si el usuario existe, recibirás instrucciones',
      reset_token: process.env.NODE_ENV === 'development' ? resetToken : undefined,
    });
  } catch (error) {
    logger.error('Error olvide-password:', { msg: error?.message });
    res.status(500).json({ error: 'Error al procesar solicitud' });
  }
};

exports.restablecerPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const user = await pool.query(
      'SELECT id FROM usuarios WHERE reset_token = $1 AND reset_token_expires > NOW() AND activo = true', [token]);
    if (!user.rows.length) return res.status(401).json({ error: 'Token inválido o expirado' });

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    await pool.query('UPDATE usuarios SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, user.rows[0].id]);

    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    logger.error('Error restablecer-password admin:', error);
    res.status(500).json({ error: 'Error al restablecer contraseña' });
  }
};

// ═══════════════════════════════════════════
//  MFA (2FA)
// ═══════════════════════════════════════════

// ── POST /auth/mfa/setup — Generar secreto y QR ──
exports.mfaSetup = async (req, res) => {
  try {
    const user = await pool.query('SELECT email FROM usuarios WHERE id = $1', [req.user.id]);
    if (!user.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const result = await setupMFA(req.user.id, user.rows[0].email);
    res.json({
      secret: result.secret,
      qrCode: result.qrCode,
      backupCodes: result.backupCodes,
    });
  } catch (error) {
    logger.error('Error MFA setup:', error);
    res.status(500).json({ error: 'Error al generar configuración MFA' });
  }
};

// ── POST /auth/mfa/verify — Verificar y activar MFA ──
exports.mfaVerify = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Código de verificación requerido' });
    await enableMFA(req.user.id, token);
    await logAcceso(req.user.id, req.user.username, 'mfa_activado', 'auth', 'MFA activado', req.ip, req.get('user-agent'), req.user.local_id);
    res.json({ message: 'MFA activado correctamente' });
  } catch (error) {
    logger.error('Error MFA verify:', error);
    res.status(400).json({ error: error.message || 'Error al verificar código' });
  }
};

// ── POST /auth/mfa/disable — Desactivar MFA ──
exports.mfaDisable = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Código de verificación requerido' });
    await disableMFA(req.user.id, token);
    await logAcceso(req.user.id, req.user.username, 'mfa_desactivado', 'auth', 'MFA desactivado', req.ip, req.get('user-agent'), req.user.local_id);
    res.json({ message: 'MFA desactivado' });
  } catch (error) {
    logger.error('Error MFA disable:', error);
    res.status(400).json({ error: error.message || 'Error al desactivar MFA' });
  }
};

// ── GET /auth/mfa/status — Ver estado MFA ──
exports.mfaStatus = async (req, res) => {
  try {
    const status = await checkMFAStatus(req.user.id);
    res.json(status);
  } catch (error) {
    logger.error('Error MFA status:', error);
    res.status(500).json({ error: 'Error al obtener estado MFA' });
  }
};
