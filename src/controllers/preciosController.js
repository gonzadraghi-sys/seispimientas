const { pool } = require('../config/database');

// ── Listar todas las listas de precios ────────────────────
exports.listarListas = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT lp.*,
             COUNT(DISTINCT pr.producto_id) AS cantidad_productos,
             l.nombre AS local_nombre
      FROM listas_precios lp
      LEFT JOIN precios pr ON pr.lista_id  = lp.id
      LEFT JOIN locales l  ON l.id         = lp.local_id
      WHERE lp.activa = true
      GROUP BY lp.id, l.nombre
      ORDER BY lp.nombre
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listarListas:', error);
    res.status(500).json({ error: 'Error al listar listas de precios' });
  }
};

// ── Actualizar lista de precios ────────────────────────────
exports.actualizarLista = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, tipo, ajuste_pct } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const result = await pool.query(
      `UPDATE listas_precios SET nombre = $1, tipo = $2, ajuste_pct = $3, updated_at = NOW()
       WHERE id = $4 AND activa = true RETURNING *`,
      [nombre, tipo || 'base', ajuste_pct || 0, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lista no encontrada' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizarLista:', error);
    res.status(500).json({ error: 'Error al actualizar lista' });
  }
};

// ── Crear lista de precios ────────────────────────────────
exports.crearLista = async (req, res) => {
  try {
    const { nombre, tipo, ajuste_pct, local_id, vigencia_desde, vigencia_hasta } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const result = await pool.query(
      `INSERT INTO listas_precios
         (nombre, tipo, ajuste_pct, local_id, vigencia_desde, vigencia_hasta)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nombre, tipo || 'base', ajuste_pct || 0,
       local_id || null, vigencia_desde || null, vigencia_hasta || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error crearLista:', error);
    res.status(500).json({ error: 'Error al crear lista' });
  }
};

// ── Precios de una lista especifica ──────────────────────
exports.listarPorLista = async (req, res) => {
  try {
    const { lista_id } = req.query;
    if (!lista_id) return res.status(400).json({ error: 'lista_id requerido' });
    const result = await pool.query(`
      SELECT
        p.id        AS producto_id,
        p.nombre    AS producto,
        p.unidad_medida,
        p.cantidad_por_unidad,
        p.costo_produccion,
        pr.precio,
        pr.id       AS precio_id,
        lp.nombre   AS lista_nombre,
        CASE WHEN hp.precio > 0 AND pr.precio IS NOT NULL
             THEN ROUND(((pr.precio - hp.precio) / hp.precio * 100)::numeric, 1)
             ELSE NULL
        END AS margen_pct,
        CASE WHEN pr.precio IS NOT NULL THEN 't' ELSE 'f' END AS tiene_precio
      FROM productos p
      JOIN listas_precios lp  ON lp.id = $1
      LEFT JOIN precios pr    ON pr.producto_id = p.id AND pr.lista_id = $1
      LEFT JOIN LATERAL (
        SELECT precio FROM historial_precios
        WHERE producto_id = p.id
        ORDER BY created_at DESC LIMIT 1
      ) hp ON true
      WHERE p.activo = true
      ORDER BY p.nombre
    `, [lista_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listarPorLista:', error);
    res.status(500).json({ error: 'Error al listar precios por lista' });
  }
};

// ── Precio vigente para el local del usuario ──────────────
exports.listar = async (req, res) => {
  try {
    const { local_id } = req.user;
    const listaQuery = await pool.query(`
      SELECT id FROM listas_precios
      WHERE (local_id IS NULL OR local_id = $1)
        AND activa = true
        AND (vigencia_desde IS NULL OR vigencia_desde <= CURRENT_DATE)
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURRENT_DATE)
      ORDER BY CASE WHEN local_id IS NULL THEN 1 ELSE 0 END
      LIMIT 1
    `, [local_id]);
    if (listaQuery.rows.length === 0) return res.json([]);
    const listaId = listaQuery.rows[0].id;
    const precios = await pool.query(`
      SELECT p.id, p.nombre, p.unidad_medida, pr.precio, l.nombre AS lista_nombre
      FROM precios pr
      JOIN productos p      ON p.id = pr.producto_id
      JOIN listas_precios l ON l.id = pr.lista_id
      WHERE pr.lista_id = $1 AND p.activo = true
      ORDER BY p.nombre
    `, [listaId]);
    res.json(precios.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al listar precios' });
  }
};

// ── Actualizar precio de un producto ─────────────────────
exports.actualizar = async (req, res) => {
  const client = await pool.connect();
  try {
    const { producto_id, lista_id, precio, motivo } = req.body;
    const usuario_id = req.user.id;
    await client.query('BEGIN');
    const anterior = await client.query(
      'SELECT precio FROM precios WHERE producto_id=$1 AND lista_id=$2',
      [producto_id, lista_id]
    );
    const precioAnterior = anterior.rows[0]?.precio || null;
    await client.query(
      `INSERT INTO precios (producto_id, lista_id, precio, usuario_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (producto_id, lista_id)
       DO UPDATE SET precio=$3, usuario_id=$4, created_at=NOW()`,
      [producto_id, lista_id, precio, usuario_id]
    );
    await client.query(
      `INSERT INTO historial_precios
         (producto_id, lista_id, precio_anterior, precio_nuevo, usuario_id, motivo)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [producto_id, lista_id, precioAnterior, precio, usuario_id, motivo]
    );
    await client.query('COMMIT');
    res.json({ message: 'Precio actualizado' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al actualizar precio' });
  } finally { client.release(); }
};

// ── Ajuste masivo porcentual ──────────────────────────────
exports.ajusteMasivo = async (req, res) => {
  const client = await pool.connect();
  try {
    const { lista_id, porcentaje, motivo } = req.body;
    const usuario_id = req.user.id;
    if (!lista_id)        return res.status(400).json({ error: 'lista_id requerido' });
    if (porcentaje <= -100) return res.status(400).json({ error: 'Porcentaje invalido' });
    await client.query('BEGIN');
    const rows = await client.query(
      'SELECT producto_id, precio FROM precios WHERE lista_id=$1', [lista_id]
    );
    for (const row of rows.rows) {
      const nuevo = parseFloat(row.precio) * (1 + porcentaje / 100);
      await client.query(
        'UPDATE precios SET precio=$1, usuario_id=$2, created_at=NOW() WHERE producto_id=$3 AND lista_id=$4',
        [nuevo, usuario_id, row.producto_id, lista_id]
      );
      await client.query(
        `INSERT INTO historial_precios
           (producto_id, lista_id, precio_anterior, precio_nuevo, usuario_id, motivo)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.producto_id, lista_id, row.precio, nuevo, usuario_id,
         motivo || `Ajuste masivo ${porcentaje}%`]
      );
    }
    await client.query('COMMIT');
    res.json({ message: `Ajuste de ${porcentaje}% aplicado a ${rows.rows.length} productos` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error en ajuste masivo' });
  } finally { client.release(); }
};

// ── Eliminar precio de un producto en una lista ─────────
exports.eliminar = async (req, res) => {
  try {
    const { producto_id, lista_id } = req.params;
    const result = await pool.query(
      'DELETE FROM precios WHERE producto_id=$1 AND lista_id=$2 RETURNING *',
      [producto_id, lista_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Producto no encontrado en esta lista' });

    await pool.query(
      `INSERT INTO historial_precios
         (producto_id, lista_id, precio_anterior, precio_nuevo, usuario_id, motivo)
       VALUES ($1,$2,$3,0,$4,$5)`,
      [producto_id, lista_id, result.rows[0].precio, req.user.id, 'Eliminado de la lista']
    );

    res.json({ message: 'Producto eliminado de la lista' });
  } catch (error) {
    console.error('Error eliminar precio:', error);
    res.status(500).json({ error: 'Error al eliminar precio' });
  }
};

// ── Actualizar datos del producto (unidad, costo, cantidad) ──
exports.actualizarProducto = async (req, res) => {
  try {
    const { id } = req.params;
    const { unidad_medida, costo_produccion, cantidad_por_unidad } = req.body;
    const result = await pool.query(
      `UPDATE productos SET
        unidad_medida = COALESCE($1, unidad_medida),
        costo_produccion = COALESCE($2, costo_produccion),
        cantidad_por_unidad = COALESCE($3, cantidad_por_unidad),
        updated_at = NOW()
       WHERE id = $4 AND activo = true
       RETURNING id, nombre, unidad_medida, costo_produccion, cantidad_por_unidad`,
      [unidad_medida, costo_produccion, cantidad_por_unidad, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizarProducto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
};

// ── Copiar productos entre listas ───────────────────────────
exports.copiarPrecios = async (req, res) => {
  const client = await pool.connect();
  try {
    const { origen_lista_id, destino_lista_id, producto_ids, ajuste_pct, todas } = req.body;
    const usuario_id = req.user.id;

    if (!origen_lista_id) {
      return res.status(400).json({ error: 'origen_lista_id requerido' });
    }

    // Determinar listas destino
    let destinos = [];
    if (todas) {
      const listas = await client.query(
        'SELECT id FROM listas_precios WHERE activa = true AND id != $1', [origen_lista_id]
      );
      destinos = listas.rows.map(r => r.id);
    } else {
      if (!destino_lista_id) return res.status(400).json({ error: 'destino_lista_id requerido' });
      destinos = [destino_lista_id];
    }

    if (destinos.length === 0) {
      return res.status(400).json({ error: 'No hay listas destino disponibles' });
    }

    // Obtener productos a copiar
    let query;
    let params;
    if (producto_ids && producto_ids.length > 0) {
      query = 'SELECT producto_id, precio FROM precios WHERE lista_id = $1 AND producto_id = ANY($2::uuid[])';
      params = [origen_lista_id, producto_ids];
    } else {
      query = 'SELECT producto_id, precio FROM precios WHERE lista_id = $1';
      params = [origen_lista_id];
    }
    const origen = await client.query(query, params);
    if (origen.rows.length === 0) {
      return res.status(404).json({ error: 'No hay productos para copiar en la lista origen' });
    }

    await client.query('BEGIN');
    let totalCopiados = 0;

    for (const destino_id of destinos) {
      for (const row of origen.rows) {
        let precio = parseFloat(row.precio);
        if (ajuste_pct) precio = precio * (1 + parseFloat(ajuste_pct) / 100);

        await client.query(
          `INSERT INTO precios (producto_id, lista_id, precio, usuario_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (producto_id, lista_id)
           DO UPDATE SET precio = $3, usuario_id = $4, created_at = NOW()`,
          [row.producto_id, destino_id, precio, usuario_id]
        );

        await client.query(
          `INSERT INTO historial_precios
             (producto_id, lista_id, precio_anterior, precio_nuevo, usuario_id, motivo)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.producto_id, destino_id, null, precio, usuario_id,
           ajuste_pct ? `Copiado desde lista origen con ajuste ${ajuste_pct}%` : 'Copiado desde otra lista']
        );
        totalCopiados++;
      }
    }

    await client.query('COMMIT');
    const listaWord = todas ? `${destinos.length} listas` : 'la lista destino';
    res.json({ message: `${totalCopiados} producto(s) copiados a ${listaWord}` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error copiarPrecios:', error);
    res.status(500).json({ error: 'Error al copiar precios' });
  } finally { client.release(); }
};

// ── Historial de precios ──────────────────────────────────
exports.historial = async (req, res) => {
  try {
    const { producto_id, lista_id, limit = 100 } = req.query;
    const conds  = ['1=1'];
    const params = [];
    let i = 1;
    if (producto_id) { conds.push(`hp.producto_id=$${i++}`); params.push(producto_id); }
    if (lista_id)    { conds.push(`hp.lista_id=$${i++}`);    params.push(lista_id);    }
    params.push(parseInt(limit));
    const result = await pool.query(`
      SELECT hp.*,
             p.nombre  AS producto,
             l.nombre  AS lista,
             u.username AS modificado_por
      FROM historial_precios hp
      JOIN productos      p ON p.id = hp.producto_id
      JOIN listas_precios l ON l.id = hp.lista_id
      LEFT JOIN usuarios  u ON u.id = hp.usuario_id
      WHERE ${conds.join(' AND ')}
      ORDER BY hp.created_at DESC
      LIMIT $${i}
    `, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
};

// ── Operaciones batch (seleccion multiple) ──────────────
exports.batch = async (req, res) => {
  const client = await pool.connect();
  try {
    const { accion, items, precio, motivo } = req.body;
    const usuario_id = req.user.id;

    if (!items?.length) return res.status(400).json({ error: 'Items requeridos' });

    if (accion === 'eliminar') {
      let count = 0;
      await client.query('BEGIN');
      for (const item of items) {
        const del = await client.query(
          'DELETE FROM precios WHERE producto_id=$1 AND lista_id=$2 RETURNING precio',
          [item.producto_id, item.lista_id]
        );
        if (del.rows.length) {
          await client.query(
            `INSERT INTO historial_precios
               (producto_id, lista_id, precio_anterior, precio_nuevo, usuario_id, motivo)
             VALUES ($1,$2,$3,0,$4,$5)`,
            [item.producto_id, item.lista_id, del.rows[0].precio, usuario_id, motivo || 'Eliminado batch']
          );
          count++;
        }
      }
      await client.query('COMMIT');
      res.json({ message: `${count} producto(s) eliminados` });
    } else if (accion === 'actualizar') {
      if (precio == null) return res.status(400).json({ error: 'Precio requerido' });
      let count = 0;
      await client.query('BEGIN');
      for (const item of items) {
        const ant = await client.query(
          'SELECT precio FROM precios WHERE producto_id=$1 AND lista_id=$2',
          [item.producto_id, item.lista_id]
        );
        const precioAnterior = ant.rows[0]?.precio || null;
        await client.query(
          `INSERT INTO precios (producto_id, lista_id, precio, usuario_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (producto_id, lista_id)
           DO UPDATE SET precio=$3, usuario_id=$4, created_at=NOW()`,
          [item.producto_id, item.lista_id, precio, usuario_id]
        );
        await client.query(
          `INSERT INTO historial_precios
             (producto_id, lista_id, precio_anterior, precio_nuevo, usuario_id, motivo)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [item.producto_id, item.lista_id, precioAnterior, precio, usuario_id, motivo || 'Actualizacion batch']
        );
        count++;
      }
      await client.query('COMMIT');
      res.json({ message: `${count} producto(s) actualizados` });
    } else {
      res.status(400).json({ error: 'Accion no valida. Usar "eliminar" o "actualizar"' });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error batch:', error);
    res.status(500).json({ error: 'Error en operacion batch' });
  } finally { client.release(); }
};
