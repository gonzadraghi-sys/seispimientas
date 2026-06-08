// src/routes/imagenes.js — Endpoints para generar imágenes con IA
const { Router } = require('express');
const { pool } = require('../config/database');
const { auth, can } = require('../middleware/auth');
const { generarImagenProducto, generarHero, estadoAPIs } = require('../services/imagenes');

const router = Router();

// ── Obtener keys desde .env ──
function getKeys() {
  return {
    stability: process.env.STABILITY_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    clipdrop: process.env.CLIPDROP_API_KEY,
  };
}

// GET /api/imagenes/estado — ver estado de APIs y pendientes
router.get('/estado', auth, can('config'), async (req, res) => {
  const claves = getKeys();
  const apis = estadoAPIs(claves);

  // Productos sin imagen
  const sinImagen = await pool.query(`
    SELECT p.id, p.nombre, p.categoria FROM productos p
    WHERE p.activo = true
    ORDER BY p.nombre
  `);

  res.json({
    apis,
    productos_sin_imagen: sinImagen.rows.length,
  });
});

// POST /api/imagenes/generar — generar imágenes para productos sin foto
router.post('/generar', auth, can('config'), async (req, res) => {
  const { producto_id, cantidad = 5 } = req.body;
  const claves = getKeys();

  let productos;
  if (producto_id) {
    const r = await pool.query('SELECT id, nombre, categoria FROM productos WHERE id = $1 AND activo = true', [producto_id]);
    productos = r.rows;
  } else {
    const r = await pool.query('SELECT id, nombre, categoria FROM productos WHERE activo = true ORDER BY random() LIMIT $1', [cantidad]);
    productos = r.rows;
  }

  if (!productos.length) return res.status(404).json({ error: 'No hay productos para generar' });

  // Responder ya, procesar en background
  res.json({
    ok: true,
    procesando: productos.map(p => p.nombre),
    apis_disponibles: estadoAPIs(claves),
  });

  // Procesar en background
  for (const p of productos) {
    try {
      const r = await generarImagenProducto(p, claves);
      console.log(`[${r.usada}] ${p.nombre} → ${r.filename}${r.cache ? ' (cache)' : ''}`);
    } catch (e) {
      console.error(`Error con ${p.nombre}: ${e.message}`);
    }
  }
});

// POST /api/imagenes/generar-hero — generar banner principal
router.post('/generar-hero', auth, can('config'), async (req, res) => {
  const claves = getKeys();
  const resultado = await generarHero('hero', claves);
  res.json(resultado);
});

module.exports = router;
