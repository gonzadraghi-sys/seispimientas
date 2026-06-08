const { pool } = require('../config/database');

async function esUsuarioAdmin(rolId) {
  const result = await pool.query(`SELECT permisos->>'admin' as admin FROM roles WHERE id = $1`, [rolId]);
  return result.rows[0]?.admin === 'true';
}
async function usuarioPuedeEnLocal(user, localId) {
  if (await esUsuarioAdmin(user.rol_id)) return true;
  return user.local_id === localId;
}

exports.listar = async (req, res) => {
  try {
    const { local_id, rol_id } = req.user;
    const esAdmin = await esUsuarioAdmin(rol_id);
    let query = `
      SELECT of.*, p.nombre as producto_nombre, l.nombre as local_nombre
      FROM ordenes_fabricacion of
      JOIN productos p ON p.id = of.producto_id
      JOIN locales l ON l.id = of.local_destino
      WHERE 1=1
    `;
    const params = [];
    if (!esAdmin && local_id) {
      query += ` AND of.local_destino = $1`;
      params.push(local_id);
    }
    query += ` ORDER BY of.created_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar órdenes de fabricación' });
  }
};

exports.crear = async (req, res) => {
  const client = await pool.connect();
  try {
    const { producto_id, local_destino, cantidad_pedida, prioridad, notas } = req.body;
    const solicitado_por = req.user.id;
    const puede = await usuarioPuedeEnLocal(req.user, local_destino);
    if (!puede) return res.status(403).json({ error: 'No autorizado para este local' });

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO ordenes_fabricacion
       (producto_id, local_destino, cantidad_pedida, prioridad, solicitado_por, notas, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendiente')
       RETURNING id, numero`,
      [producto_id, local_destino, cantidad_pedida, prioridad || 'normal', solicitado_por, notas]
    );
    await client.query('COMMIT');
    res.status(201).json({ message: 'Orden creada', orden: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al crear orden' });
  } finally {
    client.release();
  }
};

exports.cambiarEstado = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    // Si no se pasa estado en el body, se deduce del último segmento de la URL
    // Ej: /produccion/123/aprobar → estado = 'aprobada'
    let { estado, motivo_cancelacion, cantidad_real } = req.body;
    if (!estado) {
      const segments = req.originalUrl.split('/');
      const actionMap = { aprobar: 'aprobada', iniciar: 'en_produccion', calidad: 'control_calidad', completar: 'completada', cancelar: 'cancelada' };
      estado = actionMap[segments[segments.length - 1]];
    }
    const usuario_id = req.user.id;
    const esAdmin = await esUsuarioAdmin(req.user.rol_id);

    await client.query('BEGIN');
    const orden = await client.query(`SELECT * FROM ordenes_fabricacion WHERE id = $1`, [id]);
    if (orden.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada' });
    const ordenData = orden.rows[0];

    if (estado === 'aprobada' && ordenData.estado !== 'pendiente')
      return res.status(400).json({ error: 'Solo se puede aprobar una orden pendiente' });
    if (estado === 'en_produccion' && ordenData.estado !== 'aprobada' && ordenData.estado !== 'pendiente')
      return res.status(400).json({ error: 'Estado inválido para iniciar producción' });
    if (estado === 'completada' && ordenData.estado !== 'en_produccion')
      return res.status(400).json({ error: 'Solo se puede completar una orden en producción' });

    if (estado === 'completada') {
      const cantidad = cantidad_real || ordenData.cantidad_pedida;
      await client.query(
        `INSERT INTO movimientos_stock
         (producto_id, local_id, tipo, cantidad, referencia_id, usuario_id, notas)
         VALUES ($1, $2, 'produccion', $3, $4, $5, 'Producción completada')`,
        [ordenData.producto_id, ordenData.local_destino, cantidad, id, usuario_id]
      );
      await client.query(
        `INSERT INTO stock (producto_id, local_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (producto_id, local_id)
         DO UPDATE SET cantidad = stock.cantidad + $3, updated_at = NOW()`,
        [ordenData.producto_id, ordenData.local_destino, cantidad]
      );
    }

    const updateFields = { estado };
    if (estado === 'aprobada') { updateFields.aprobado_por = usuario_id; updateFields.fecha_aprobacion = new Date(); }
    if (estado === 'en_produccion') updateFields.fecha_inicio = new Date();
    if (estado === 'completada') { updateFields.fecha_completado = new Date(); updateFields.cantidad_real = cantidad_real; }
    if (estado === 'cancelada') updateFields.motivo_cancelacion = motivo_cancelacion;

    const setClause = Object.keys(updateFields).map((k, i) => `${k}=$${i+2}`).join(',');
    const values = [id, ...Object.values(updateFields)];
    await client.query(`UPDATE ordenes_fabricacion SET ${setClause}, updated_at=NOW() WHERE id=$1`, values);

    await client.query('COMMIT');
    res.json({ message: `Estado actualizado a ${estado}` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al cambiar estado' });
  } finally {
    client.release();
  }
};
