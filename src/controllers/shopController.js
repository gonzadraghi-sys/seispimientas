// src/controllers/shopController.js — E-commerce API endpoints
const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const { Router } = require('express');
const { auth, can } = require('../middleware/auth');
const { authCliente, generarAccessToken, generarRefreshToken } = require('../middleware/authCliente');
const { descontarStock } = require('../services/stockService');

const router = Router();

// ── Helper: datos bancarios para transferencia ──────────────
const DATOS_BANCARIOS = {
  banco:     process.env.SHOP_BANCO || 'Banco Galicia',
  titular:   process.env.SHOP_TITULAR || 'Seis Pimientas S.A.',
  cbu:       process.env.SHOP_CBU || '0070001234567890123456',
  alias:     process.env.SHOP_ALIAS || 'SEISPIMIENTAS.MP',
  cuil:      process.env.SHOP_CUIL || '30-12345678-9',
};

const rateLimit = require('express-rate-limit');

// Rate limiter para login de clientes: 5 intentos cada 15 min
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const crypto = require('crypto');

// ══════════════════════════════════════════════════════════════
//  A) ENDPOINTS PÚBLICOS (sin autenticación)
// ══════════════════════════════════════════════════════════════

// ── GET /shop/productos — catálogo público ──────────────────
const LISTA_PRECIOS_WEB_ID = process.env.LISTA_PRECIOS_WEB_ID;

// Helper para obtener ID de lista según tipo
async function getListaIdPorTipo(tipo) {
  if (tipo === 'mayorista') {
    if (process.env.LISTA_PRECIOS_MAYORISTA_ID) return process.env.LISTA_PRECIOS_MAYORISTA_ID;
    const r = await pool.query("SELECT id FROM listas_precios WHERE tipo = 'mayorista' AND activa = true LIMIT 1");
    return r.rows[0]?.id || LISTA_PRECIOS_WEB_ID;
  }
  return LISTA_PRECIOS_WEB_ID;
}

router.get('/productos', async (req, res) => {
  try {
    const { q, categoria, lista_id } = req.query;

    const listaActiva = lista_id || LISTA_PRECIOS_WEB_ID;
    if (!listaActiva) {
      return res.status(500).json({ error: 'No hay lista de precios configurada' });
    }

    let sql = `
      SELECT
        p.id, p.nombre, p.unidad_medida, p.cantidad_por_unidad,
        p.categoria, pr.precio,
        CASE WHEN pr.precio IS NOT NULL THEN true ELSE false END AS tiene_precio
      FROM productos p
      LEFT JOIN precios pr ON pr.producto_id = p.id AND pr.lista_id = $1
      WHERE p.activo = true
    `;
    const params = [listaActiva];
    let i = 2;

    if (q) {
      sql += ` AND p.nombre ILIKE $${i++}`;
      params.push(`%${q}%`);
    }
    if (categoria) {
      sql += ` AND p.categoria = $${i++}`;
      params.push(categoria);
    }

    sql += ' ORDER BY p.nombre';

    const result = await pool.query(sql, params);
    res.json({ productos: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('Error listar productos shop:', error);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

// ── GET /shop/productos/:id — detalle de producto ────────────
router.get('/productos/:id', async (req, res) => {
  try {
    const listaActiva = req.query.lista_id || LISTA_PRECIOS_WEB_ID;
    if (!listaActiva) {
      return res.status(500).json({ error: 'No hay lista de precios configurada' });
    }
    const result = await pool.query(`
      SELECT p.id, p.nombre, p.unidad_medida, p.cantidad_por_unidad,
             p.categoria, p.costo_produccion, p.descripcion,
             pr.precio
      FROM productos p
      LEFT JOIN precios pr ON pr.producto_id = p.id AND pr.lista_id = $1
      WHERE p.id = $2 AND p.activo = true
    `, [listaActiva, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obtener producto shop:', error);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// ── GET /shop/categorias — listar categorías disponibles ────
router.get('/categorias', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT categoria FROM productos
      WHERE activo = true AND categoria IS NOT NULL
      ORDER BY categoria
    `);
    res.json(result.rows.map(r => r.categoria));
  } catch (error) {
    res.status(500).json({ error: 'Error al listar categorías' });
  }
});

// ── GET /shop/datos-bancarios — datos para transferencia ────
router.get('/datos-bancarios', (req, res) => {
  res.json(DATOS_BANCARIOS);
});

// ── GET /shop/lista-por-tipo — obtener lista_id según tipo ──
router.get('/lista-por-tipo', async (req, res) => {
  try {
    const { tipo } = req.query;
    if (!tipo) return res.status(400).json({ error: 'tipo requerido (minorista | mayorista)' });
    if (tipo === 'minorista') {
      return res.json({ lista_id: LISTA_PRECIOS_WEB_ID, tipo: 'minorista' });
    }
    const listaId = await getListaIdPorTipo('mayorista');
    res.json({ lista_id: listaId, tipo: 'mayorista' });
  } catch (error) {
    console.error('Error lista-por-tipo:', error);
    res.status(500).json({ error: 'Error al obtener lista' });
  }
});

// ── POST /shop/auth/registro — registrar nuevo cliente ──────
router.post('/auth/registro', async (req, res) => {
  try {
    const { nombre, email, password, telefono, direccion, ciudad, provincia, codigo_postal, tipo } = req.body;

    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Verificar email único
    const existe = await pool.query('SELECT id FROM clientes WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
    }

    const password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    const tipoCliente = (tipo === 'mayorista') ? 'mayorista' : 'minorista';

    const result = await pool.query(
      `INSERT INTO clientes (nombre, email, telefono, password_hash, direccion, ciudad, provincia, codigo_postal, tipo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, nombre, email, telefono, direccion, ciudad, provincia, tipo, created_at`,
      [nombre, email, telefono || null, password_hash, direccion || null, ciudad || null, provincia || null, codigo_postal || null, tipoCliente]
    );

    const cliente = result.rows[0];

    // Pasar tipo al token
    const clienteToken = { ...cliente, type: 'cliente' };
    const accessToken = generarAccessToken(clienteToken);
    const refreshToken = generarRefreshToken(clienteToken);

    res.status(201).json({ cliente, accessToken, refreshToken });
  } catch (error) {
    console.error('Error registro cliente:', error);
    res.status(500).json({ error: 'Error al registrar cliente' });
  }
});

// ── POST /shop/auth/login — login de cliente ────────────────
router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const result = await pool.query(
      'SELECT id, nombre, email, telefono, password_hash, direccion, ciudad, provincia, codigo_postal, tipo, created_at FROM clientes WHERE email = $1 AND activo = true',
      [email]
    );
    const cliente = result.rows[0];
    if (!cliente) {
      return res.status(401).json({ error: 'Email no registrado' });
    }

    const valido = await bcrypt.compare(password, cliente.password_hash);
    if (!valido) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const accessToken = generarAccessToken(cliente);
    const refreshToken = generarRefreshToken(cliente);

    delete cliente.password_hash;
    res.json({ cliente: { ...cliente, tipo: cliente.tipo || 'minorista' }, accessToken, refreshToken });
  } catch (error) {
    console.error('Error login cliente:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ── POST /shop/auth/refresh — renovar token ────────────────
router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token requerido' });

    const { verificarToken } = require('../middleware/authCliente');
    const decoded = verificarToken(refreshToken);
    if (decoded.type !== 'cliente_refresh') {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const result = await pool.query(
      'SELECT id, nombre, email, telefono, direccion, ciudad, provincia FROM clientes WHERE id = $1 AND activo = true',
      [decoded.id]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Cliente no encontrado' });
    }

    const accessToken = generarAccessToken(result.rows[0]);
    res.json({ accessToken });
  } catch (error) {
    res.status(401).json({ error: 'Refresh token inválido o expirado' });
  }
});

// ── POST /shop/auth/olvide-password — generar token de reseteo ──
router.post('/auth/olvide-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const cliente = await pool.query('SELECT id FROM clientes WHERE email = $1 AND activo = true', [email]);
    if (cliente.rows.length === 0) {
      return res.json({ ok: true, message: 'Si el email existe, recibirás instrucciones' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await pool.query(
      'UPDATE clientes SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [resetToken, expires, cliente.rows[0].id]
    );

    // En producción acá se enviaría un email con el link
    // Por ahora mostramos el token en la respuesta para testing
    res.json({
      ok: true,
      message: 'Si el email existe, recibirás instrucciones',
      reset_token: process.env.NODE_ENV === 'development' ? resetToken : undefined,
    });
  } catch (error) {
    console.error('Error olvide-password:', error);
    res.status(500).json({ error: 'Error al procesar solicitud' });
  }
});

// ── POST /shop/auth/restablecer-password — cambiar contraseña con token ──
router.post('/auth/restablecer-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const cliente = await pool.query(
      'SELECT id FROM clientes WHERE reset_token = $1 AND reset_token_expires > NOW() AND activo = true',
      [token]
    );
    if (cliente.rows.length === 0) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    const password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    await pool.query(
      'UPDATE clientes SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [password_hash, cliente.rows[0].id]
    );

    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error restablecer-password:', error);
    res.status(500).json({ error: 'Error al restablecer contraseña' });
  }
});

// ── GET /shop/admin/clientes — listar clientes ──
router.get('/admin/clientes', auth, can('ventas_ver'), async (req, res) => {
  try {
    const { q } = req.query;
    let sql = 'SELECT id, nombre, email, telefono, direccion, ciudad, provincia, activo, created_at FROM clientes';
    const params = [];
    if (q) {
      sql += ' WHERE nombre ILIKE $1 OR email ILIKE $1';
      params.push(`%${q}%`);
    }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const r = await pool.query(sql, params);
    res.json({ clientes: r.rows });
  } catch (error) {
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

// ── POST /shop/admin/clientes — crear cliente desde admin ──
router.post('/admin/clientes', auth, can('usuarios'), async (req, res) => {
  try {
    const { nombre, email, password, telefono, direccion, ciudad, provincia } = req.body;
    if (!nombre || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'Contraseña debe tener al menos 6 caracteres' });

    const existe = await pool.query('SELECT id FROM clientes WHERE email = $1', [email]);
    if (existe.rows.length > 0) return res.status(409).json({ error: 'Ya existe un cliente con ese email' });

    const hash = require('bcryptjs').hashSync(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    const r = await pool.query(
      `INSERT INTO clientes (nombre, email, telefono, password_hash, direccion, ciudad, provincia)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nombre, email, telefono, direccion, ciudad, provincia, activo, created_at`,
      [nombre, email, telefono || null, hash, direccion || null, ciudad || null, provincia || null]
    );
    res.status(201).json({ cliente: r.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear cliente: ' + error.message });
  }
});

// ── POST /shop/admin/clientes/:id/reset-password — admin resetea pass de cliente ──
router.post('/admin/clientes/:id/reset-password', auth, can('usuarios'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Contraseña debe tener al menos 6 caracteres' });
    }
    const password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    await pool.query(
      'UPDATE clientes SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [password_hash, req.params.id]
    );
    res.json({ ok: true, message: 'Contraseña actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al restablecer contraseña' });
  }
});

// ══════════════════════════════════════════════════════════════
//  B) ENDPOINTS PROTEGIDOS (authCliente)
// ══════════════════════════════════════════════════════════════

// ── GET /shop/clientes/me — perfil del cliente ──────────────
router.get('/clientes/me', authCliente, (req, res) => {
  res.json({ ...req.cliente, tipo: req.cliente.tipo || 'minorista' });
});

// ── PUT /shop/clientes/me — actualizar perfil ──────────────
router.put('/clientes/me', authCliente, async (req, res) => {
  try {
    const { nombre, telefono, direccion, ciudad, provincia, codigo_postal } = req.body;
    const result = await pool.query(
      `UPDATE clientes SET
        nombre = COALESCE($1, nombre),
        telefono = COALESCE($2, telefono),
        direccion = COALESCE($3, direccion),
        ciudad = COALESCE($4, ciudad),
        provincia = COALESCE($5, provincia),
        codigo_postal = COALESCE($6, codigo_postal)
       WHERE id = $7 RETURNING id, nombre, email, telefono, direccion, ciudad, provincia, codigo_postal`,
      [nombre, telefono, direccion, ciudad, provincia, codigo_postal, req.cliente.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// ── POST /shop/mercadopago/crear-preferencia — crear preferencia MP ──
router.post('/mercadopago/crear-preferencia', authCliente, async (req, res) => {
  try {
    const { pedidoId } = req.body;
    if (!pedidoId) return res.status(400).json({ error: 'pedidoId requerido' });

    // Verificar que el pedido exista y pertenezca al cliente
    const pedido = await pool.query(
      'SELECT id, total, estado FROM pedidos_web WHERE id = $1 AND cliente_id = $2 AND estado = $3',
      [pedidoId, req.cliente.id, 'pendiente_pago']
    );
    if (pedido.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' });
    }

    // Obtener detalles del pedido
    const detalles = await pool.query(
      `SELECT pd.cantidad, pd.precio_unitario, p.nombre
       FROM pedidos_web_detalles pd
       JOIN productos p ON p.id = pd.producto_id
       WHERE pd.pedido_id = $1`,
      [pedidoId]
    );

    // Crear preferencia en Mercado Pago
    const { crearPreferencia } = require('../services/mercadopago');
    const items = detalles.rows.map(d => ({
      nombre: d.nombre,
      cantidad: Number(d.cantidad),
      precio_unitario: Number(d.precio_unitario),
    }));

    const mpResult = await crearPreferencia(items, pedidoId, req.cliente.email);

    // Guardar preference_id
    await pool.query(
      'UPDATE pedidos_web SET mp_preference_id = $1 WHERE id = $2',
      [mpResult.id, pedidoId]
    );

    res.json({
      mp_preference_id: mpResult.id,
      init_point: mpResult.init_point || mpResult.sandbox_init_point,
    });
  } catch (error) {
    console.error('Error crear preferencia MP:', error);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

// ── POST /shop/pedidos — crear pedido (checkout) ──────────
let VENTAS_WEB_LOCAL_ID = process.env.VENTAS_WEB_LOCAL_ID;
let USUARIO_WEB_ID = process.env.USUARIO_WEB_ID;

// Si no están configurados, buscar automáticamente
async function ensureWebConfig() {
  if (!USUARIO_WEB_ID) {
    try {
      const r = await pool.query("SELECT id FROM usuarios WHERE username = 'GDRAGHI' AND activo = true LIMIT 1");
      if (r.rows.length) USUARIO_WEB_ID = r.rows[0].id;
    } catch {}
  }
  if (!VENTAS_WEB_LOCAL_ID) {
    try {
      const r = await pool.query('SELECT id FROM locales WHERE activo = true ORDER BY created_at LIMIT 1');
      if (r.rows.length) VENTAS_WEB_LOCAL_ID = r.rows[0].id;
    } catch {}
  }
}

router.post('/pedidos', authCliente, async (req, res) => {
  try {
    const { items, metodo_pago, direccion_envio, ciudad_envio, provincia_envio, codigo_postal_envio, notas } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: 'Debe incluir al menos un producto' });
    }
    if (!metodo_pago || !['mercadopago', 'transferencia'].includes(metodo_pago)) {
      return res.status(400).json({ error: 'Método de pago inválido' });
    }

    // Calcular total con precios actuales de la lista web
    if (!LISTA_PRECIOS_WEB_ID) {
      return res.status(500).json({ error: 'LISTA_PRECIOS_WEB_ID no configurada' });
    }

    let total = 0;
    const itemsConPrecio = [];

    for (const item of items) {
      const precioRow = await pool.query(
        'SELECT precio FROM precios WHERE producto_id = $1 AND lista_id = $2',
        [item.producto_id, LISTA_PRECIOS_WEB_ID]
      );
      const precio = parseFloat(precioRow.rows[0]?.precio || 0);
      if (precio <= 0) {
        return res.status(400).json({
          error: `Producto sin precio en la lista web: ${item.producto_id}`
        });
      }
      const subtotal = precio * parseFloat(item.cantidad || 0);
      total += subtotal;
      itemsConPrecio.push({
        producto_id: item.producto_id,
        cantidad: parseFloat(item.cantidad),
        precio_unitario: precio,
        subtotal,
      });
    }

    // Crear pedido
    const cliente = req.cliente;

    let transferenciaDatos = null;
    if (metodo_pago === 'transferencia') {
      transferenciaDatos = JSON.stringify(DATOS_BANCARIOS);
    }

    const pedidoResult = await pool.query(
      `INSERT INTO pedidos_web
         (cliente_id, total, metodo_pago, direccion_envio, ciudad_envio,
          provincia_envio, codigo_postal_envio, notas, transferencia_datos_bancarios)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [cliente.id, total, metodo_pago,
       direccion_envio || cliente.direccion, ciudad_envio || cliente.ciudad,
       provincia_envio || cliente.provincia, codigo_postal_envio || cliente.codigo_postal,
       notas || null, transferenciaDatos]
    );
    const pedido = pedidoResult.rows[0];

    // Insertar detalles
    for (const item of itemsConPrecio) {
      await pool.query(
        `INSERT INTO pedidos_web_detalles (pedido_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedido.id, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal]
      );
    }

    const response = {
      pedido: {
        id: pedido.id,
        numero: pedido.numero,
        total: pedido.total,
        estado: pedido.estado,
        metodo_pago: pedido.metodo_pago,
        created_at: pedido.created_at,
      },
    };

    // Si es transferencia, incluir datos bancarios
    if (metodo_pago === 'transferencia') {
      response.datos_bancarios = DATOS_BANCARIOS;
    }

    // Si es MP, crear preferencia automáticamente
    if (metodo_pago === 'mercadopago') {
      try {
        const { crearPreferencia } = require('../services/mercadopago');
        // Obtener nombres de productos
        const nombresMap = {};
        for (const item of itemsConPrecio) {
          if (!nombresMap[item.producto_id]) {
            const r = await pool.query('SELECT nombre FROM productos WHERE id = $1', [item.producto_id]);
            nombresMap[item.producto_id] = r.rows[0]?.nombre || 'Producto';
          }
        }
        const mpItems = itemsConPrecio.map(item => ({
          nombre: nombresMap[item.producto_id],
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
        }));
        const mpResult = await crearPreferencia(mpItems, pedido.id, cliente.email);
        await pool.query('UPDATE pedidos_web SET mp_preference_id = $1 WHERE id = $2', [mpResult.id, pedido.id]);
        response.init_point = mpResult.init_point || mpResult.sandbox_init_point;
      } catch (mpErr) {
        console.error('Error al crear preferencia MP automática:', mpErr.message);
        // No falla el pedido, el frontend puede reintentar con POST /mercadopago/crear-preferencia
      }
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Error crear pedido web:', error);
    res.status(500).json({ error: 'Error al crear pedido: ' + error.message });
  }
});

// ── GET /shop/pedidos — historial de pedidos del cliente ──
router.get('/pedidos', authCliente, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, numero, total, estado, metodo_pago, created_at
      FROM pedidos_web
      WHERE cliente_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.cliente.id]);

    res.json({ pedidos: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// ── GET /shop/pedidos/:id — detalle de pedido ──────────────
router.get('/pedidos/:id', authCliente, async (req, res) => {
  try {
    const pedido = await pool.query(
      'SELECT * FROM pedidos_web WHERE id = $1 AND cliente_id = $2',
      [req.params.id, req.cliente.id]
    );
    if (pedido.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const detalles = await pool.query(
      `SELECT pd.*, p.nombre AS producto, p.unidad_medida
       FROM pedidos_web_detalles pd
       JOIN productos p ON p.id = pd.producto_id
       WHERE pd.pedido_id = $1`,
      [req.params.id]
    );

    res.json({ pedido: pedido.rows[0], items: detalles.rows });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pedido' });
  }
});

// ══════════════════════════════════════════════════════════════
//  C) ENDPOINTS ADMIN (auth + permisos internos)
// ══════════════════════════════════════════════════════════════

// ── GET /shop/admin/pedidos — listar todos los pedidos web ──
router.get('/admin/pedidos', auth, can('ventas_ver'), async (req, res) => {
  try {
    const { estado, metodo_pago, limit = 50 } = req.query;
    let sql = `
      SELECT pw.id, pw.numero, pw.total, pw.estado, pw.metodo_pago,
             pw.created_at, pw.confirmado_at,
             c.nombre AS cliente_nombre, c.email AS cliente_email
      FROM pedidos_web pw
      JOIN clientes c ON c.id = pw.cliente_id
      WHERE 1=1
    `;
    const params = [];
    let i = 1;

    if (estado) { sql += ` AND pw.estado = $${i++}`; params.push(estado); }
    if (metodo_pago) { sql += ` AND pw.metodo_pago = $${i++}`; params.push(metodo_pago); }

    sql += ' ORDER BY pw.created_at DESC LIMIT $' + i;
    params.push(parseInt(limit));

    const result = await pool.query(sql, params);
    res.json({ pedidos: result.rows, total: result.rows.length });
  } catch (error) {
    res.status(500).json({ error: 'Error al listar pedidos web' });
  }
});

// ── GET /shop/admin/pedidos/:id — detalle de pedido web ────
router.get('/admin/pedidos/:id', auth, can('ventas_ver'), async (req, res) => {
  try {
    const pedido = await pool.query(`
      SELECT pw.*, c.nombre AS cliente_nombre, c.email AS cliente_email,
             c.telefono AS cliente_telefono, c.direccion AS cliente_direccion
      FROM pedidos_web pw
      JOIN clientes c ON c.id = pw.cliente_id
      WHERE pw.id = $1
    `, [req.params.id]);
    if (pedido.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const detalles = await pool.query(
      `SELECT pd.*, p.nombre AS producto, p.unidad_medida
       FROM pedidos_web_detalles pd
       JOIN productos p ON p.id = pd.producto_id
       WHERE pd.pedido_id = $1`,
      [req.params.id]
    );

    res.json({ pedido: pedido.rows[0], items: detalles.rows });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pedido' });
  }
});

// ── PUT /shop/admin/pedidos/:id/estado — cambiar estado ────
router.put('/admin/pedidos/:id/estado', auth, can('ventas_crear'), async (req, res) => {
  try {
    const { estado } = req.body;
    const estadosValidos = ['pendiente_pago', 'confirmado', 'en_preparacion', 'enviado', 'entregado', 'cancelado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido. Válidos: ${estadosValidos.join(', ')}` });
    }

    const result = await pool.query(
      'UPDATE pedidos_web SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    res.json({ pedido: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// ── POST /shop/admin/pedidos/:id/confirmar-pago — confirmar pago (transferencia) ──
router.post('/admin/pedidos/:id/confirmar-pago', auth, can('ventas_crear'), async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureWebConfig();
    await client.query('BEGIN');

    const pedido = await client.query(
      'SELECT * FROM pedidos_web WHERE id = $1 AND estado = $2 FOR UPDATE',
      [req.params.id, 'pendiente_pago']
    );
    if (pedido.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado o ya confirmado' });
    }

    const pw = pedido.rows[0];

    if (!VENTAS_WEB_LOCAL_ID) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'VENTAS_WEB_LOCAL_ID no configurada en .env' });
    }

    if (!USUARIO_WEB_ID) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'USUARIO_WEB_ID no configurada en .env' });
    }

    // Obtener detalles
    const detalles = await client.query(
      'SELECT * FROM pedidos_web_detalles WHERE pedido_id = $1',
      [pw.id]
    );

    // 1. Crear venta interna
    const venta = await client.query(
      `INSERT INTO ventas (local_id, usuario_id, total, notas)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [VENTAS_WEB_LOCAL_ID, USUARIO_WEB_ID, pw.total, `Pedido web #${pw.numero} - ${pw.metodo_pago}`]
    );
    const ventaId = venta.rows[0].id;

    // 2. Insertar detalles de venta
    for (const det of detalles.rows) {
      await client.query(
        `INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [ventaId, det.producto_id, det.cantidad, det.precio_unitario, det.subtotal]
      );
    }

    // 3. Descontar stock
    try {
      await descontarStock(client, detalles.rows, VENTAS_WEB_LOCAL_ID, ventaId, req.user.id, 'venta', `Pedido web #${pw.numero}`);
    } catch (stockErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: stockErr.message });
    }

    // 4. Actualizar pedido web
    await client.query(
      `UPDATE pedidos_web SET
        estado = 'confirmado', venta_id = $1,
        usuario_confirmo_id = $2, confirmado_at = NOW()
       WHERE id = $3`,
      [ventaId, req.user.id, pw.id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      mensaje: `Pedido #${pw.numero} confirmado. Venta #${ventaId} generada. Stock descontado.`,
      pedido_id: pw.id,
      venta_id: ventaId,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error confirmar pago:', error);
    res.status(500).json({ error: 'Error al confirmar pago: ' + error.message });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════
//  D) WEBHOOK MERCADO PAGO
// ══════════════════════════════════════════════════════════════

// ── POST /shop/mercadopago/webhook — notificación de MP ─────
router.post('/mercadopago/webhook', async (req, res) => {
  try {
    // Responder siempre 200 a MP para que no reintente
    res.status(200).send('OK');

    const { type, data } = req.body;
    if (type !== 'payment' || !data?.id) return;

    const paymentId = data.id;
    console.log('Webhook MP recibido: payment_id =', paymentId);

    await ensureWebConfig();

    // Consultar el pago en MP
    const { obtenerPago } = require('../services/mercadopago');
    const payment = await obtenerPago(paymentId);

    if (!payment || payment.status !== 'approved') {
      console.log('Pago no aprobado:', payment?.status);
      return;
    }

    const pedidoId = payment.external_reference;
    if (!pedidoId) {
      console.log('Webhook MP: sin external_reference');
      return;
    }

    // Procesar confirmación en transacción
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pedido = await client.query(
        'SELECT * FROM pedidos_web WHERE id = $1 AND estado = $2 FOR UPDATE',
        [pedidoId, 'pendiente_pago']
      );
      if (pedido.rows.length === 0) {
        await client.query('ROLLBACK');
        console.log('Pedido no encontrado o ya confirmado:', pedidoId);
        return;
      }

      const pw = pedido.rows[0];

      if (!VENTAS_WEB_LOCAL_ID || !USUARIO_WEB_ID) {
        await client.query('ROLLBACK');
        console.error('VENTAS_WEB_LOCAL_ID o USUARIO_WEB_ID no configurados');
        return;
      }

      // Actualizar datos MP
      await client.query(
        `UPDATE pedidos_web SET mp_payment_id = $1, mp_status = $2, mp_status_detail = $3
         WHERE id = $4`,
        [String(paymentId), payment.status, payment.status_detail || '', pedidoId]
      );

      const detalles = await client.query(
        'SELECT * FROM pedidos_web_detalles WHERE pedido_id = $1', [pedidoId]
      );

      // Crear venta
      const venta = await client.query(
        `INSERT INTO ventas (local_id, usuario_id, total, notas)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [VENTAS_WEB_LOCAL_ID, USUARIO_WEB_ID, pw.total, `Pedido web #${pw.numero} - Mercado Pago`]
      );
      const ventaId = venta.rows[0].id;

      for (const det of detalles.rows) {
        await client.query(
          `INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [ventaId, det.producto_id, det.cantidad, det.precio_unitario, det.subtotal]
        );
      }

      try {
        await descontarStock(client, detalles.rows, VENTAS_WEB_LOCAL_ID, ventaId, USUARIO_WEB_ID, 'venta', `Pedido web #${pw.numero} - MP`);
      } catch (stockErr) {
        await client.query('ROLLBACK');
        console.error('Error stock en webhook MP:', stockErr.message);
        return;
      }

      await client.query(
        `UPDATE pedidos_web SET estado = 'confirmado', venta_id = $1, confirmado_at = NOW()
         WHERE id = $2`,
        [ventaId, pedidoId]
      );

      await client.query('COMMIT');
      console.log(`✅ Pedido web #${pw.numero} confirmado por MP. Venta: ${ventaId}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Error procesando webhook MP:', err.message);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error en webhook MP:', error.message);
  }
});

module.exports = router;
