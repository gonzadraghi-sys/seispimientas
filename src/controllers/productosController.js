// src/controllers/productosController.js — CRUD de productos
const { pool } = require('../config/database');
const { logger } = require('../services/logger');

// ── Listar productos ──────────────────────────────────
exports.listar = async (req, res) => {
  try {
    const { activo, categoria } = req.query;
    let sql = `
      SELECT p.id, p.nombre, p.unidad_medida, p.cantidad_por_unidad,
             p.costo_produccion, p.descripcion, p.categoria,
             p.activo, p.created_at
      FROM productos p WHERE 1=1
    `;
    const params = [];
    let i = 1;
    if (activo !== undefined) {
      sql += ` AND p.activo = $${i++}`;
      params.push(activo === 'true' || activo === '1');
    }
    if (categoria) {
      sql += ` AND p.categoria ILIKE $${i++}`;
      params.push(`%${categoria}%`);
    }
    sql += ' ORDER BY p.nombre';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error listar productos:', error);
    res.status(500).json({ error: 'Error al listar productos' });
  }
};

// ── Obtener producto por ID ──────────────────────────
exports.obtener = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, unidad_medida, cantidad_por_unidad,
              costo_produccion, descripcion, categoria, activo, created_at
       FROM productos WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error obtener producto:', error);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
};

// ── Crear producto ───────────────────────────────────
exports.crear = async (req, res) => {
  try {
    const { nombre, unidad_medida, cantidad_por_unidad, costo_produccion, descripcion, categoria } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const result = await pool.query(
      `INSERT INTO productos (nombre, unidad_medida, cantidad_por_unidad, costo_produccion, descripcion, categoria)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, unidad_medida, cantidad_por_unidad, costo_produccion, descripcion, categoria, activo, created_at`,
      [nombre, unidad_medida || 'kg', cantidad_por_unidad || 1, costo_produccion || null, descripcion || null, categoria || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error crear producto:', error);
    res.status(500).json({ error: 'Error al crear producto' });
  }
};

// ── Actualizar producto ──────────────────────────────
exports.actualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, unidad_medida, cantidad_por_unidad, costo_produccion, descripcion, categoria, activo } = req.body;

    const campos = [];
    const valores = [];
    let i = 1;

    if (nombre !== undefined) { campos.push(`nombre = $${i++}`); valores.push(nombre); }
    if (unidad_medida !== undefined) { campos.push(`unidad_medida = $${i++}`); valores.push(unidad_medida); }
    if (cantidad_por_unidad !== undefined) { campos.push(`cantidad_por_unidad = $${i++}`); valores.push(cantidad_por_unidad); }
    if (costo_produccion !== undefined) { campos.push(`costo_produccion = $${i++}`); valores.push(costo_produccion); }
    if (descripcion !== undefined) { campos.push(`descripcion = $${i++}`); valores.push(descripcion); }
    if (categoria !== undefined) { campos.push(`categoria = $${i++}`); valores.push(categoria); }
    if (activo !== undefined) { campos.push(`activo = $${i++}`); valores.push(activo); }

    if (campos.length === 0) return res.status(400).json({ error: 'Sin campos para actualizar' });

    valores.push(id);
    const result = await pool.query(
      `UPDATE productos SET ${campos.join(', ')}, updated_at = NOW() WHERE id = $${i}
       RETURNING id, nombre, unidad_medida, cantidad_por_unidad, costo_produccion, descripcion, categoria, activo, created_at`,
      valores
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error actualizar producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
};

// ── Eliminar (soft-delete) producto ──────────────────
exports.eliminar = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE productos SET activo = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto desactivado' });
  } catch (error) {
    logger.error('Error eliminar producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
};
