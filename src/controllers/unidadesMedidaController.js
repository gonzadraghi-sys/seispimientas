// src/controllers/unidadesMedidaController.js — CRUD de unidades de medida
const { pool } = require('../config/database');
const { logger } = require('../services/logger');

exports.listar = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre, simbolo, activa, created_at FROM unidades_medida ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Error listar unidades:', error);
    res.status(500).json({ error: 'Error al listar unidades de medida' });
  }
};

exports.crear = async (req, res) => {
  try {
    const { nombre, simbolo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const result = await pool.query(
      'INSERT INTO unidades_medida (nombre, simbolo) VALUES ($1, $2) RETURNING *',
      [nombre, simbolo || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una unidad con ese nombre' });
    logger.error('Error crear unidad:', error);
    res.status(500).json({ error: 'Error al crear unidad de medida' });
  }
};

exports.actualizar = async (req, res) => {
  try {
    const { nombre, simbolo, activa } = req.body;
    const campos = [], valores = [];
    let i = 1;
    if (nombre !== undefined) { campos.push(`nombre = $${i++}`); valores.push(nombre); }
    if (simbolo !== undefined) { campos.push(`simbolo = $${i++}`); valores.push(simbolo); }
    if (activa !== undefined) { campos.push(`activa = $${i++}`); valores.push(activa); }
    if (campos.length === 0) return res.status(400).json({ error: 'Sin campos para actualizar' });
    valores.push(req.params.id);
    const result = await pool.query(
      `UPDATE unidades_medida SET ${campos.join(', ')} WHERE id = $${i} RETURNING *`,
      valores
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Unidad no encontrada' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error actualizar unidad:', error);
    res.status(500).json({ error: 'Error al actualizar unidad' });
  }
};

exports.eliminar = async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE unidades_medida SET activa = false WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Unidad no encontrada' });
    res.json({ message: 'Unidad desactivada' });
  } catch (error) {
    logger.error('Error eliminar unidad:', error);
    res.status(500).json({ error: 'Error al eliminar unidad' });
  }
};
