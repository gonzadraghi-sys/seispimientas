const { verificarAccessToken } = require('../utils/jwt');
const { pool } = require('../config/database');
const { esUsuarioAdmin, usuarioPuedeEnLocal, esRepartidor } = require('../utils/permisos');

// Middleware principal: verifica token y carga usuario en req.user
const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado o formato inválido' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = verificarAccessToken(token);
    // Verificar que el usuario aún exista y esté activo
    const result = await pool.query(
      `SELECT id, username, nombre_completo, email, rol_id, local_id, activo
       FROM usuarios WHERE id = $1`,
      [decoded.id]
    );
    if (result.rows.length === 0 || !result.rows[0].activo) {
      return res.status(401).json({ error: 'Usuario no válido o desactivado' });
    }
    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error interno en autenticación' });
  }
};

// Middleware para verificar un permiso específico (basado en JSONB permisos del rol)
const can = (permiso) => {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    try {
      const roleQuery = await pool.query(`SELECT permisos FROM roles WHERE id = $1`, [req.user.rol_id]);
      if (roleQuery.rows.length === 0) {
        return res.status(403).json({ error: 'Rol no encontrado' });
      }
      const permisos = roleQuery.rows[0].permisos || {};
      // Si el permiso existe y es true, o si es admin global
      if (permisos[permiso] === true || permisos.admin === true) {
        return next();
      }
      return res.status(403).json({ error: `Permiso insuficiente: se requiere '${permiso}'` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al verificar permisos' });
    }
  };
};

// Middleware que solo permite acceso a administradores globales
const adminOnly = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  const isAdmin = await esUsuarioAdmin(req.user.rol_id);
  if (isAdmin) return next();
  return res.status(403).json({ error: 'Acceso solo para administradores' });
};

// Middleware para restringir al mismo local del usuario (útil para recursos que deben coincidir)
const sameLocal = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  const resourceLocalId = req.params.localId || req.body.local_id;
  if (resourceLocalId && req.user.local_id !== resourceLocalId) {
    return res.status(403).json({ error: 'No tienes permisos sobre este local' });
  }
  next();
};

module.exports = { auth, can, adminOnly, sameLocal };
