const { pool } = require('../config/database');

// ── Listar locales ────────────────────────────────────────
exports.listar = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, p.nombre AS provincia_nombre
      FROM locales l
      LEFT JOIN provincias p ON p.id = l.provincia_id
      WHERE l.activo = true
      ORDER BY l.nombre
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listar locales:', error);
    res.status(500).json({ error: 'Error al listar locales' });
  }
};

// ── Listar provincias ─────────────────────────────────────
exports.listarProvincias = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre FROM provincias WHERE activa = true ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar provincias' });
  }
};

// ── Crear local ───────────────────────────────────────────
exports.crear = async (req, res) => {
  try {
    const { nombre, tipo, provincia_id, departamento, direccion, telefono, encargado, lat, lng } = req.body;
    if (!nombre || !tipo) return res.status(400).json({ error: 'Nombre y tipo son obligatorios' });
    const result = await pool.query(
      `INSERT INTO locales
         (nombre, tipo, provincia_id, departamento, direccion, telefono, encargado, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [nombre, tipo, provincia_id || null, departamento || null,
       direccion || null, telefono || null, encargado || null, lat || null, lng || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error crear local:', error);
    res.status(500).json({ error: 'Error al crear local' });
  }
};

// ── Actualizar local ──────────────────────────────────────
exports.actualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, tipo, provincia_id, departamento, direccion, telefono, encargado, activo, lat, lng } = req.body;
    const result = await pool.query(
      `UPDATE locales SET
        nombre       = COALESCE($1,  nombre),
        tipo         = COALESCE($2,  tipo),
        provincia_id = COALESCE($3,  provincia_id),
        departamento = COALESCE($4,  departamento),
        direccion    = COALESCE($5,  direccion),
        telefono     = COALESCE($6,  telefono),
        encargado    = COALESCE($7,  encargado),
        activo       = COALESCE($8,  activo),
        lat          = COALESCE($9,  lat),
        lng          = COALESCE($10, lng),
        updated_at   = NOW()
       WHERE id = $11 RETURNING *`,
      [nombre, tipo, provincia_id || null, departamento || null,
       direccion, telefono, encargado, activo, lat, lng, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Local no encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizar local:', error);
    res.status(500).json({ error: 'Error al actualizar local' });
  }
};

// ── Desactivar local ──────────────────────────────────────
exports.eliminar = async (req, res) => {
  try {
    await pool.query(
      'UPDATE locales SET activo=false, updated_at=NOW() WHERE id=$1',
      [req.params.id]
    );
    res.json({ message: 'Local desactivado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al desactivar local' });
  }
};

// ── Transferencia de stock entre locales ──────────────────
exports.transferir = async (req, res) => {
  const client = await pool.connect();
  try {
    const { producto_id, local_origen, local_destino, cantidad, notas } = req.body;
    const usuario_id = req.user.id;
    await client.query('BEGIN');
    const origen = await client.query(
      'SELECT cantidad FROM stock WHERE producto_id=$1 AND local_id=$2 FOR UPDATE',
      [producto_id, local_origen]
    );
    if (!origen.rows.length || origen.rows[0].cantidad < cantidad)
      throw new Error('Stock insuficiente en origen');
    const transfer = await client.query(
      `INSERT INTO transferencias
         (producto_id, local_origen, local_destino, cantidad, solicitado_por, notas, estado)
       VALUES ($1,$2,$3,$4,$5,$6,'pendiente') RETURNING id`,
      [producto_id, local_origen, local_destino, cantidad, usuario_id, notas]
    );
    const tid = transfer.rows[0].id;
    await client.query(
      `INSERT INTO movimientos_stock (producto_id, local_id, tipo, cantidad, referencia_id, usuario_id, notas)
       VALUES ($1,$2,'transferencia_salida',$3,$4,$5,$6)`,
      [producto_id, local_origen, cantidad, tid, usuario_id, notas]
    );
    await client.query(
      'UPDATE stock SET cantidad=cantidad-$1, updated_at=NOW() WHERE producto_id=$2 AND local_id=$3',
      [cantidad, producto_id, local_origen]
    );
    await client.query(
      `INSERT INTO movimientos_stock (producto_id, local_id, tipo, cantidad, referencia_id, usuario_id, notas)
       VALUES ($1,$2,'transferencia_entrada',$3,$4,$5,$6)`,
      [producto_id, local_destino, cantidad, tid, usuario_id, notas]
    );
    await client.query(
      `INSERT INTO stock (producto_id, local_id, cantidad) VALUES ($1,$2,$3)
       ON CONFLICT (producto_id, local_id)
       DO UPDATE SET cantidad=stock.cantidad+$3, updated_at=NOW()`,
      [producto_id, local_destino, cantidad]
    );
    await client.query(
      "UPDATE transferencias SET estado='completada', updated_at=NOW() WHERE id=$1", [tid]
    );
    await client.query('COMMIT');
    res.status(201).json({ message: 'Transferencia realizada', transferId: tid });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || 'Error al transferir' });
  } finally { client.release(); }
};
