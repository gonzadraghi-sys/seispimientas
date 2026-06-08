// src/controllers/usuariosController.js
const bcrypt  = require('bcryptjs');
const { query, transaction } = require('../config/database');

// ══ GET /api/usuarios ═══════════════════════════════════
const listar = async (req, res) => {
  try {
    const { rol, local_id, activo } = req.query;
    let conditions = ['1=1'];
    let params = [];
    let i = 1;

    // Filtrar por local si el usuario no es global
    if (req.user.local_id) {
      conditions.push(`u.local_id = $${i++}`);
      params.push(req.user.local_id);
    } else if (local_id) {
      conditions.push(`u.local_id = $${i++}`);
      params.push(local_id);
    }

    if (rol) { conditions.push(`r.nombre = $${i++}`); params.push(rol); }
    if (activo !== undefined) { conditions.push(`u.activo = $${i++}`); params.push(activo === 'true'); }

    const result = await query(
      `SELECT u.id, u.username, u.nombre_completo, u.email, u.telefono,
              u.activo, u.ultimo_acceso, u.created_at, u.local_id,
              r.nombre AS rol,
              l.nombre AS local_nombre
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN locales l ON l.id = u.local_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY u.created_at DESC`,
      params
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error listar usuarios:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ══ GET /api/usuarios/:id ════════════════════════════════
const obtener = async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.nombre_completo, u.email, u.telefono,
              u.activo, u.ultimo_acceso, u.created_at, u.local_id,
              r.id AS rol_id, r.nombre AS rol, r.permisos,
              l.nombre AS local_nombre
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN locales l ON l.id = u.local_id
       WHERE u.id = $1`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Si el usuario tiene local asignado, solo puede ver usuarios de su local
    if (req.user.local_id && result.rows[0].local_id !== req.user.local_id) {
      return res.status(403).json({ error: 'No puedes ver usuarios de otros locales' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ══ POST /api/usuarios ══════════════════════════════════
const crear = async (req, res) => {
  let { username, password, nombre_completo, email, telefono, rol_id, local_id } = req.body;

  try {
    // Si el creador tiene un local asignado, forzar ese local en el nuevo usuario
    if (req.user.local_id) {
      local_id = req.user.local_id;
    }

    // Verificar que el username no exista
    const existe = await query(
      `SELECT id FROM usuarios WHERE username = $1`,
      [username.toUpperCase()]
    );
    if (existe.rows.length) {
      return res.status(409).json({ error: 'El nombre de usuario ya existe' });
    }

    // Hashear contraseña
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    const result = await query(
      `INSERT INTO usuarios
         (username, password_hash, nombre_completo, email, telefono, rol_id, local_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, username, nombre_completo, email, activo, created_at`,
      [username.toUpperCase(), hash, nombre_completo, email || null,
       telefono || null, rol_id, local_id || null]
    );

    return res.status(201).json({
      message: 'Usuario creado exitosamente',
      usuario: result.rows[0]
    });
  } catch (err) {
    console.error('Error crear usuario:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ══ PUT /api/usuarios/:id ════════════════════════════════
const actualizar = async (req, res) => {
  let { nombre_completo, email, telefono, rol_id, local_id, activo } = req.body;

  try {
    // Si el usuario editor tiene local asignado, restringir y forzar su local
    if (req.user.local_id) {
      local_id = req.user.local_id;
      // Verificar que el usuario editado pertenezca al mismo local
      const target = await query(
        `SELECT local_id FROM usuarios WHERE id = $1`, [req.params.id]
      );
      if (target.rows.length && target.rows[0].local_id !== req.user.local_id) {
        return res.status(403).json({ error: 'No puedes editar usuarios de otros locales' });
      }
    }

    const result = await query(
      `UPDATE usuarios
       SET nombre_completo = COALESCE($1, nombre_completo),
           email     = COALESCE($2, email),
           telefono  = COALESCE($3, telefono),
           rol_id    = COALESCE($4, rol_id),
           local_id  = $5,
           activo    = COALESCE($6, activo)
       WHERE id = $7
       RETURNING id, username, nombre_completo, email, activo`,
      [nombre_completo, email, telefono, rol_id, local_id ?? null, activo, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    return res.status(200).json({ message: 'Usuario actualizado', usuario: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ══ POST /api/usuarios/:id/reset-password ══════════════
const resetPassword = async (req, res) => {
  const { nueva_password } = req.body;
  if (!nueva_password || nueva_password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  try {
    // Si el usuario tiene local asignado, solo puede resetear password de usuarios de su local
    if (req.user.local_id) {
      const target = await query(
        `SELECT local_id FROM usuarios WHERE id = $1`, [req.params.id]
      );
      if (target.rows.length && target.rows[0].local_id !== req.user.local_id) {
        return res.status(403).json({ error: 'No puedes resetear contraseña de usuarios de otros locales' });
      }
    }

    const hash = await bcrypt.hash(nueva_password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    await transaction(async (client) => {
      await client.query(
        `UPDATE usuarios SET password_hash = $1 WHERE id = $2`,
        [hash, req.params.id]
      );
      // Revocar todos los tokens del usuario
      await client.query(
        `UPDATE refresh_tokens SET revocado = TRUE WHERE usuario_id = $1`,
        [req.params.id]
      );
    });

    return res.status(200).json({ message: 'Contraseña reseteada. El usuario deberá iniciar sesión.' });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ══ POST /api/usuarios/:id/suspender ═══════════════════
const suspender = async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'No podés suspender tu propia cuenta' });
    }

    // Si el usuario tiene local asignado, solo puede suspender usuarios de su local
    if (req.user.local_id) {
      const target = await query(
        `SELECT local_id FROM usuarios WHERE id = $1`, [req.params.id]
      );
      if (target.rows.length && target.rows[0].local_id !== req.user.local_id) {
        return res.status(403).json({ error: 'No puedes suspender usuarios de otros locales' });
      }
    }

    await transaction(async (client) => {
      await client.query(
        `UPDATE usuarios SET activo = FALSE WHERE id = $1`,
        [req.params.id]
      );
      await client.query(
        `UPDATE refresh_tokens SET revocado = TRUE WHERE usuario_id = $1`,
        [req.params.id]
      );
    });

    return res.status(200).json({ message: 'Usuario suspendido' });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ══ DELETE /api/usuarios/:id ═══════════════════════════
const eliminar = async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
    }

    // Si el usuario tiene local asignado, solo puede eliminar usuarios de su local
    if (req.user.local_id) {
      const target = await query(
        `SELECT local_id FROM usuarios WHERE id = $1`, [req.params.id]
      );
      if (target.rows.length && target.rows[0].local_id !== req.user.local_id) {
        return res.status(403).json({ error: 'No puedes eliminar usuarios de otros locales' });
      }
    }

    const result = await query(
      `DELETE FROM usuarios WHERE id = $1 RETURNING id, username`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    return res.status(200).json({ message: `Usuario ${result.rows[0].username} eliminado` });
  } catch (err) {
    console.error('Error eliminar usuario:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = { listar, obtener, crear, actualizar, resetPassword, suspender, eliminar };
