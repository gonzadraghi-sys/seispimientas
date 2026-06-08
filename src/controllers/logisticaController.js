const { pool } = require('../config/database');

async function esAdmin(rol_id) {
  const r = await pool.query(`SELECT permisos->>'admin' as admin FROM roles WHERE id=$1`, [rol_id]);
  return r.rows[0]?.admin === 'true';
}
async function esRepartidor(rol_id) {
  const r = await pool.query(`SELECT nombre FROM roles WHERE id=$1`, [rol_id]);
  return r.rows[0]?.nombre === 'repartidor';
}

// ── Listar pedidos ────────────────────────────────────────
exports.pedidos = async (req, res) => {
  try {
    const { id: usuario_id, rol_id, local_id } = req.user;
    const admin      = await esAdmin(rol_id);
    const repartidor = await esRepartidor(rol_id);
    let query = `
      SELECT p.*,
             l.nombre  AS local_nombre,
             l.direccion AS direccion_destino,
             l.telefono  AS telefono_destino,
             l.lat, l.lng,
             u.username  AS repartidor_nombre,
             (SELECT json_agg(json_build_object(
               'producto_id',  pi.producto_id,
               'producto',     pr.nombre,
               'cantidad',     pi.cantidad,
               'precio_unit',  pi.precio_unit,
               'unidad_medida',pr.unidad_medida
             )) FROM pedido_items pi
              JOIN productos pr ON pr.id = pi.producto_id
              WHERE pi.pedido_id = p.id
             ) AS items,
             (SELECT COUNT(*) FROM pedido_items WHERE pedido_id = p.id) AS cantidad_items
      FROM pedidos p
      JOIN locales l ON l.id = p.local_destino
      LEFT JOIN usuarios u ON u.id = p.repartidor_id
      WHERE 1=1
    `;
    const params = [];
    if (!admin) {
      if (repartidor) {
        query += ` AND p.repartidor_id = $1`;
        params.push(usuario_id);
      } else {
        query += ` AND p.local_destino = $1`;
        params.push(local_id);
      }
    }
    query += ` ORDER BY p.created_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listar pedidos:', error);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
};

// ── Crear pedido ──────────────────────────────────────────
exports.crearPedido = async (req, res) => {
  const client = await pool.connect();
  try {
    const { local_destino, items, notas } = req.body;
    const usuario_id = req.user.id;
    const codigo     = Math.floor(1000 + Math.random() * 9000).toString();
    await client.query('BEGIN');
    const pedido = await client.query(
      `INSERT INTO pedidos (local_destino, repartidor_id, notas, codigo_confirmacion, estado)
       VALUES ($1, $2, $3, $4, 'pendiente') RETURNING id, numero`,
      [local_destino, null, notas, codigo]
    );
    const pedidoId = pedido.rows[0].id;
    for (const item of items) {
      await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unit)
         VALUES ($1,$2,$3,$4)`,
        [pedidoId, item.producto_id, item.cantidad, item.precio_unit || 0]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ pedido: pedido.rows[0], codigo_confirmacion: codigo });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error crearPedido:', error);
    res.status(500).json({ error: 'Error al crear pedido' });
  } finally { client.release(); }
};

// ── Confirmar entrega con codigo ──────────────────────────
exports.confirmarEntrega = async (req, res) => {
  const client = await pool.connect();
  try {
    const { pedido_id, codigo } = req.body;
    const repartidor_id = req.user.id;
    const admin = await esAdmin(req.user.rol_id);
    await client.query('BEGIN');
    const q = admin
      ? `SELECT * FROM pedidos WHERE id=$1 AND confirmado=false`
      : `SELECT * FROM pedidos WHERE id=$1 AND repartidor_id=$2 AND confirmado=false`;
    const params = admin ? [pedido_id] : [pedido_id, repartidor_id];
    const pedido = await client.query(q, params);
    if (!pedido.rows.length) return res.status(404).json({ error: 'Pedido no encontrado o ya confirmado' });
    if (pedido.rows[0].codigo_confirmacion !== codigo) return res.status(401).json({ error: 'Codigo invalido' });
    await client.query(
      `UPDATE pedidos SET estado='entregado', confirmado=true, confirmado_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [pedido_id]
    );
    const items = await client.query(`SELECT * FROM pedido_items WHERE pedido_id=$1`, [pedido_id]);
    for (const item of items.rows) {
      await client.query(
        `INSERT INTO movimientos_stock
           (producto_id, local_id, tipo, cantidad, referencia_id, usuario_id, notas)
         VALUES ($1,$2,'venta',$3,$4,$5,'Pedido entregado')`,
        [item.producto_id, pedido.rows[0].local_destino, item.cantidad, pedido_id, repartidor_id]
      );
      await client.query(
        `UPDATE stock SET cantidad=cantidad-$1, updated_at=NOW()
         WHERE producto_id=$2 AND local_id=$3`,
        [item.cantidad, item.producto_id, pedido.rows[0].local_destino]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Entrega confirmada' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error confirmarEntrega:', error);
    res.status(500).json({ error: 'Error al confirmar entrega' });
  } finally { client.release(); }
};

// ── Actualizar GPS ────────────────────────────────────────
exports.actualizarGPS = async (req, res) => {
  try {
    const { pedido_id, lat, lng, estado } = req.body;
    const usuario_id = req.user.id;
    if (pedido_id) {
      await pool.query(
        `UPDATE pedidos SET
           lat_actual = $1, lng_actual = $2, ultima_ubicacion_at = NOW(),
           estado = COALESCE($3, estado), updated_at = NOW()
         WHERE id = $4`,
        [lat, lng, estado || null, pedido_id]
      );
    }
    try {
      await pool.query(
        `INSERT INTO ubicaciones (usuario_id, latitud, longitud, timestamp)
         VALUES ($1,$2,$3,NOW())`,
        [usuario_id, lat, lng]
      );
    } catch {}
    res.json({ message: 'Ubicacion actualizada' });
  } catch (error) {
    console.error('Error GPS:', error);
    res.status(500).json({ error: 'Error al actualizar GPS' });
  }
};

// ── Reportar problema ─────────────────────────────────────
exports.reportarProblema = async (req, res) => {
  try {
    const { id } = req.params;
    const { notas } = req.body;
    const repartidor_id = req.user.id;
    const admin = await esAdmin(req.user.rol_id);
    const q = admin
      ? `SELECT id FROM pedidos WHERE id=$1`
      : `SELECT id FROM pedidos WHERE id=$1 AND repartidor_id=$2`;
    const params = admin ? [id] : [id, repartidor_id];
    const existente = await pool.query(q, params);
    if (!existente.rows.length) {
      return res.status(404).json({ error: 'Pedido no encontrado o no te pertenece' });
    }
    await pool.query(
      `UPDATE pedidos SET estado='problema', notas_problema=$1, updated_at=NOW() WHERE id=$2`,
      [notas, id]
    );
    res.json({ message: 'Problema reportado' });
  } catch (error) {
    console.error('Error reportarProblema:', error);
    res.status(500).json({ error: 'Error al reportar problema' });
  }
};

// ── Haversine ─────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Ruta optimizada ────────────────────────────────────────
exports.rutaOptimizada = async (req, res) => {
  try {
    const { lat, lng, origen_lat, origen_lng } = req.body;
    const usuario_id = req.user.id;

    // Determinar origen de la ruta
    let origenLat = parseFloat(origen_lat) || null;
    let origenLng = parseFloat(origen_lng) || null;
    let fabrica = null;

    if (!origenLat || !origenLng) {
      // Si no enviaron origen, ver si el repartidor pertenece a una fabrica
      const userLocal = await pool.query(
        `SELECT l.id, l.nombre, l.lat, l.lng, l.tipo, l.direccion
         FROM locales l JOIN usuarios u ON u.local_id = l.id
         WHERE u.id = $1`, [usuario_id]
      );
      const local = userLocal.rows[0];
      if (local && local.tipo === 'fabrica' && local.lat && local.lng) {
        origenLat = parseFloat(local.lat);
        origenLng = parseFloat(local.lng);
        fabrica = {
          id: local.id,
          nombre: local.nombre,
          direccion: local.direccion,
          lat: parseFloat(local.lat),
          lng: parseFloat(local.lng),
        };
      }
    }

    // Fallback: usar ubicacion actual si no se pudo determinar origen
    if (!origenLat || !origenLng) {
      if (!lat || !lng) {
        return res.status(400).json({ error: 'Envia tu ubicacion actual (lat, lng) o un origen (origen_lat, origen_lng)' });
      }
      origenLat = parseFloat(lat);
      origenLng = parseFloat(lng);
    }

    const pedidos = await pool.query(`
      SELECT p.id, p.numero, p.estado, p.notas,
             l.id AS local_id, l.nombre AS local_nombre,
             l.direccion AS direccion_destino,
             l.lat, l.lng,
             (SELECT COUNT(*) FROM pedido_items WHERE pedido_id = p.id) AS cantidad_items
      FROM pedidos p
      JOIN locales l ON l.id = p.local_destino
      WHERE p.repartidor_id = $1
        AND p.estado IN ('pendiente', 'en_ruta')
        AND l.lat IS NOT NULL AND l.lng IS NOT NULL
      ORDER BY p.created_at
    `, [usuario_id]);

    const conDistancia = pedidos.rows.map(p => ({
      ...p,
      distancia_km: Math.round(haversine(origenLat, origenLng, parseFloat(p.lat), parseFloat(p.lng)) * 100) / 100,
    }));

    conDistancia.sort((a, b) => a.distancia_km - b.distancia_km);

    // Armar geometria para el mapa
    const waypoints = conDistancia.map(p => ({
      pedido_id:  p.id,
      numero:     p.numero,
      local:      p.local_nombre,
      direccion:  p.direccion_destino,
      lat:        parseFloat(p.lat),
      lng:        parseFloat(p.lng),
      items:      parseInt(p.cantidad_items),
      distancia:  p.distancia_km,
    }));

    const ruta = {
      origen:  { lat: origenLat, lng: origenLng },
      fabrica: fabrica,
      paradas: waypoints,
      total_km: waypoints.reduce((s, p) => s + p.distancia, 0),
      total_paradas: waypoints.length,
    };

    res.json(ruta);
  } catch (error) {
    console.error('Error ruta optimizada:', error);
    res.status(500).json({ error: 'Error al calcular ruta' });
  }
};
