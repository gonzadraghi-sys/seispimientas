const { pool } = require('../config/database');

async function esUsuarioAdmin(rolId) {
  const result = await pool.query(`SELECT permisos->>'admin' as admin FROM roles WHERE id = $1`, [rolId]);
  return result.rows[0]?.admin === 'true';
}

async function esRepartidor(rolId) {
  const result = await pool.query(`SELECT nombre FROM roles WHERE id = $1`, [rolId]);
  return result.rows[0]?.nombre === 'repartidor';
}

async function usuarioPuedeEnLocal(user, localId) {
  if (await esUsuarioAdmin(user.rol_id)) return true;
  return user.local_id === localId;
}

module.exports = { esUsuarioAdmin, esRepartidor, usuarioPuedeEnLocal };
