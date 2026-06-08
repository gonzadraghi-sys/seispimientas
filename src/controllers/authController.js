const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { generarAccessToken, generarRefreshToken, verificarRefreshToken } = require('../utils/jwt');

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
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }
  try {
    const result = await pool.query(
      `SELECT id, username, password_hash, nombre_completo, email, rol_id, local_id, activo
       FROM usuarios
       WHERE username = $1`,
      [username]
    );
    const user = result.rows[0];
    if (!user || !user.activo) {
      await logAcceso(null, username, 'login_failed', 'auth', 'Usuario no existe o inactivo', req.ip, req.get('user-agent'), null);
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    const passwordValido = await bcrypt.compare(password, user.password_hash);
    if (!passwordValido) {
      await logAcceso(user.id, username, 'login_failed', 'auth', 'Contraseña incorrecta', req.ip, req.get('user-agent'), user.local_id);
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    // Generar tokens
    const accessToken = generarAccessToken(user);
    const refreshToken = generarRefreshToken(user);
    // Guardar refresh token en BD
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 días por defecto
    await pool.query(
      `INSERT INTO refresh_tokens (usuario_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );
    // Log exitoso
    await logAcceso(user.id, username, 'login', 'auth', 'Inicio de sesión exitoso', req.ip, req.get('user-agent'), user.local_id);
    // Actualizar último acceso
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
    });
  } catch (error) {
    console.error(error);
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
    console.error(error);
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
    console.error(error);
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
};

exports.me = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  // Puedes obtener permisos del rol también
  const rolePermisos = await pool.query(`SELECT permisos FROM roles WHERE id = $1`, [req.user.rol_id]);
  res.json({
    ...req.user,
    password_hash: undefined,
    permisos: rolePermisos.rows[0]?.permisos || {},
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
    console.error(error);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
};
