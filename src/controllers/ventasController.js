const { pool } = require('../config/database');
const { descontarStock, revertirStock } = require('../services/stockService');
const { logger } = require('../services/logger');

// ── Listar ventas ──────────────────────────────────────────
exports.listar = async (req, res) => {
  try {
    const { local_id, desde, hasta, limit = 100 } = req.query;
    const conds = ['1=1'];
    const params = [];
    let i = 1;

    if (local_id) { conds.push(`v.local_id = $${i++}`); params.push(local_id); }
    if (desde)    { conds.push(`v.created_at >= $${i++}`); params.push(desde); }
    if (hasta)    { conds.push(`v.created_at <= $${i++}::date + interval '1 day'`); params.push(hasta); }

    params.push(parseInt(limit));
    const result = await pool.query(`
      SELECT v.*,
             u.username AS usuario,
             l.nombre   AS local_nombre,
             (SELECT json_agg(json_build_object(
                 'producto_id', vd.producto_id,
                 'producto',    p.nombre,
                 'cantidad',    vd.cantidad,
                 'precio_unitario', vd.precio_unitario,
                 'subtotal',    vd.subtotal
               ) ORDER BY p.nombre)
              FROM venta_detalles vd
              JOIN productos p ON p.id = vd.producto_id
              WHERE vd.venta_id = v.id
             ) AS items
      FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      JOIN locales l  ON l.id = v.local_id
      WHERE ${conds.join(' AND ')}
      ORDER BY v.created_at DESC
      LIMIT $${i}
    `, params);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error listar ventas:', error);
    res.status(500).json({ error: 'Error al listar ventas' });
  }
};

// ── Obtener una venta ──────────────────────────────────────
exports.obtener = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT v.*,
             u.username AS usuario,
             l.nombre   AS local_nombre,
             (SELECT json_agg(json_build_object(
                 'producto_id', vd.producto_id,
                 'producto',    p.nombre,
                 'cantidad',    vd.cantidad,
                 'precio_unitario', vd.precio_unitario,
                 'subtotal',    vd.subtotal
               ) ORDER BY p.nombre)
              FROM venta_detalles vd
              JOIN productos p ON p.id = vd.producto_id
              WHERE vd.venta_id = v.id
             ) AS items
      FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      JOIN locales l  ON l.id = v.local_id
      WHERE v.id = $1
    `, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error obtener venta:', error);
    res.status(500).json({ error: 'Error al obtener venta' });
  }
};

// ── Crear venta (con descuento de stock) ──────────────────
exports.crear = async (req, res) => {
  const client = await pool.connect();
  try {
    const { items, notas } = req.body;
    const usuario_id = req.user.id;
    const local_id = req.user.local_id;

    if (!items?.length) return res.status(400).json({ error: 'Debe incluir al menos un producto' });
    if (!local_id) return res.status(400).json({ error: 'El usuario no tiene un local asignado' });

    // Calcular total
    let total = 0;
    for (const item of items) {
      const subtotal = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      if (isNaN(subtotal) || subtotal <= 0)
        return res.status(400).json({ error: `Cantidad o precio invalido para producto ${item.producto_id}` });
      item.subtotal = subtotal;
      total += subtotal;
    }

    await client.query('BEGIN');

    // Crear venta
    const venta = await client.query(
      `INSERT INTO ventas (local_id, usuario_id, total, notas)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [local_id, usuario_id, total, notas || null]
    );
    const ventaId = venta.rows[0].id;

    // Insertar detalles
    for (const item of items) {
      await client.query(
        `INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [ventaId, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal]
      );
    }

    // Descontar stock (servicio compartido con shop)
    try {
      await descontarStock(client, items, local_id, ventaId, usuario_id, 'venta', notas || 'Venta registrada');
    } catch (stockErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: stockErr.message });
    }

    await client.query('COMMIT');
    res.status(201).json(venta.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Error crear venta:', error);
    res.status(500).json({ error: 'Error al registrar venta' });
  } finally {
    client.release();
  }
};

// ── Anular venta (revierte el stock) ──────────────────────
exports.anular = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const usuario_id = req.user.id;

    await client.query('BEGIN');

    const venta = await client.query(
      'SELECT * FROM ventas WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!venta.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    if (venta.rows[0].estado === 'anulada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La venta ya fue anulada' });
    }

    // Obtener detalles
    const detalles = await client.query(
      'SELECT * FROM venta_detalles WHERE venta_id = $1',
      [id]
    );

    // Revertir stock (servicio compartido)
    await revertirStock(client, detalles.rows, venta.rows[0].local_id, id, usuario_id, 'Devolución por anulación de venta');

    await client.query(
      'UPDATE ventas SET estado = $1 WHERE id = $2',
      ['anulada', id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Venta anulada y stock revertido' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Error anular venta:', error);
    res.status(500).json({ error: 'Error al anular venta' });
  } finally {
    client.release();
  }
};
