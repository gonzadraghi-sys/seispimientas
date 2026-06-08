const { pool } = require('../config/database');

async function esAdmin(rol_id) {
  const r = await pool.query(`SELECT permisos->>'admin' as admin FROM roles WHERE id=$1`, [rol_id]);
  return r.rows[0]?.admin === 'true';
}

// ── Listar stock ──────────────────────────────────────────
exports.listar = async (req, res) => {
  try {
    const { local_id, rol_id } = req.user;
    const admin = await esAdmin(rol_id);
    let query = `
      SELECT
        p.id              AS producto_id,
        p.nombre          AS producto,
        p.unidad_medida,
        p.categoria,
        COALESCE(s.cantidad,    0) AS cantidad,
        COALESCE(s.stock_minimo,0) AS stock_minimo,
        l.nombre          AS local,
        l.id              AS local_id,
        CASE
          WHEN COALESCE(s.cantidad,0) = 0                                                        THEN 'critico'
          WHEN COALESCE(s.stock_minimo,0) > 0
           AND COALESCE(s.cantidad,0) <= COALESCE(s.stock_minimo,0) * 0.5                        THEN 'critico'
          WHEN COALESCE(s.stock_minimo,0) > 0
           AND COALESCE(s.cantidad,0) <= COALESCE(s.stock_minimo,0)                              THEN 'bajo'
          ELSE 'ok'
        END               AS estado,
        CASE
          WHEN COALESCE(s.stock_minimo,0) > 0
          THEN LEAST(100, ROUND((COALESCE(s.cantidad,0)::numeric / s.stock_minimo::numeric) * 100))
          ELSE 100
        END               AS pct_minimo
      FROM productos p
      CROSS JOIN locales l
      LEFT JOIN stock s ON s.producto_id = p.id AND s.local_id = l.id
      WHERE p.activo = true AND l.activo = true
    `;
    const params = [];
    if (!admin && local_id) {
      query += ` AND l.id = $1`;
      params.push(local_id);
    }
    query += ` ORDER BY l.nombre, p.categoria, p.nombre`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listar stock:', error);
    res.status(500).json({ error: 'Error al listar stock' });
  }
};

// ── Alertas ───────────────────────────────────────────────
exports.alertas = async (req, res) => {
  try {
    const { local_id, rol_id } = req.user;
    const admin = await esAdmin(rol_id);
    let query = `
      SELECT
        p.id AS producto_id, p.nombre AS producto,
        s.cantidad, s.stock_minimo,
        l.nombre AS local, l.id AS local_id,
        CASE
          WHEN s.cantidad <= s.stock_minimo * 0.5 THEN 'critico'
          ELSE 'bajo'
        END AS estado
      FROM stock s
      JOIN productos p ON p.id = s.producto_id
      JOIN locales  l ON l.id = s.local_id
      WHERE s.cantidad <= s.stock_minimo AND s.stock_minimo > 0 AND p.activo = true
    `;
    const params = [];
    if (!admin && local_id) {
      query += ` AND s.local_id = $1`;
      params.push(local_id);
    }
    query += ` ORDER BY estado DESC, p.nombre`;
    const result = await pool.query(query, params);
    const items    = result.rows;
    const criticos = items.filter(i => i.estado === 'critico').length;
    const bajos    = items.filter(i => i.estado === 'bajo').length;
    res.json({ total: items.length, criticos, bajos, items });
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar alertas' });
  }
};

// ── Consolidado ───────────────────────────────────────────
exports.consolidado = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.nombre, p.unidad_medida, p.categoria,
             SUM(COALESCE(s.cantidad,0)) AS total_stock
      FROM productos p
      LEFT JOIN stock s ON s.producto_id = p.id
      WHERE p.activo = true
      GROUP BY p.id
      ORDER BY p.categoria, p.nombre
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener consolidado' });
  }
};

// ── Movimiento de stock ───────────────────────────────────
exports.movimiento = async (req, res) => {
  const client = await pool.connect();
  try {
    const { producto_id, local_id, tipo, cantidad, notas, referencia_id } = req.body;
    const usuario_id = req.user.id;
    const admin = await esAdmin(req.user.rol_id);
    if (!admin && req.user.local_id !== local_id)
      return res.status(403).json({ error: 'Sin permiso en este local' });

    await client.query('BEGIN');
    const actual = await client.query(
      'SELECT cantidad FROM stock WHERE producto_id=$1 AND local_id=$2 FOR UPDATE',
      [producto_id, local_id]
    );
    const antes = parseFloat(actual.rows[0]?.cantidad || 0);
    let despues = antes;

    if (tipo === 'entrada') {
      despues = antes + cantidad;
      await client.query(
        `INSERT INTO stock (producto_id,local_id,cantidad)
         VALUES ($1,$2,$3)
         ON CONFLICT (producto_id,local_id)
         DO UPDATE SET cantidad=stock.cantidad+$3, updated_at=NOW()`,
        [producto_id, local_id, cantidad]
      );
    } else if (tipo === 'salida') {
      if (antes < cantidad) throw new Error('Stock insuficiente');
      despues = antes - cantidad;
      await client.query(
        'UPDATE stock SET cantidad=cantidad-$1, updated_at=NOW() WHERE producto_id=$2 AND local_id=$3',
        [cantidad, producto_id, local_id]
      );
    } else if (tipo === 'ajuste') {
      despues = cantidad;
      await client.query(
        'UPDATE stock SET cantidad=$1, updated_at=NOW() WHERE producto_id=$2 AND local_id=$3',
        [cantidad, producto_id, local_id]
      );
    } else {
      throw new Error('Tipo no soportado: ' + tipo);
    }

    await client.query(
      `INSERT INTO movimientos_stock
         (producto_id,local_id,tipo,cantidad,cantidad_antes,cantidad_despues,referencia_id,usuario_id,notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [producto_id, local_id, tipo, cantidad, antes, despues, referencia_id || null, usuario_id, notas]
    );
    await client.query('COMMIT');
    res.status(201).json({ message: 'Movimiento registrado', cantidad_despues: despues });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error movimiento:', error);
    res.status(500).json({ error: error.message || 'Error al procesar movimiento' });
  } finally {
    client.release();
  }
};
