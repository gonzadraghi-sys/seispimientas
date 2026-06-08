// src/services/stockService.js — Lógica compartida de descuento/reversión de stock
// Usada por ventasController y shopController para mantener consistencia

/**
  * Descuenta stock de uno o varios productos dentro de una transacción existente.
  *
  * @param {import('pg').PoolClient} client - Cliente de pool en medio de una transacción
  * @param {Array<{producto_id: string, cantidad: number}>} items - Productos a descontar
  * @param {string} localId - Local del cual descontar stock
  * @param {string} referenciaId - ID de la venta/pedido (se guarda en movimientos_stock)
  * @param {string|null} usuarioId - ID del usuario que realizó la operación
  * @param {string} tipo - Tipo de movimiento ('venta' por defecto)
  * @param {string} notas - Notas del movimiento
  * @throws {Error} Si algún producto no tiene stock suficiente
  */
async function descontarStock(client, items, localId, referenciaId, usuarioId, tipo = 'venta', notas = '') {
  for (const item of items) {
    const stockRow = await client.query(
      'SELECT cantidad FROM stock WHERE producto_id = $1 AND local_id = $2 FOR UPDATE',
      [item.producto_id, localId]
    );
    const stockActual = parseFloat(stockRow.rows[0]?.cantidad || 0);
    const cantidad = parseFloat(item.cantidad);

    if (stockActual < cantidad) {
      const prod = await client.query('SELECT nombre FROM productos WHERE id = $1', [item.producto_id]);
      throw new Error(
        `Stock insuficiente para "${prod.rows[0]?.nombre || 'producto'}": disponible ${stockActual}, requerido ${cantidad}`
      );
    }

    const cantidadDespues = stockActual - cantidad;
    await client.query(
      'UPDATE stock SET cantidad = $1, updated_at = NOW() WHERE producto_id = $2 AND local_id = $3',
      [cantidadDespues, item.producto_id, localId]
    );

    await client.query(
      `INSERT INTO movimientos_stock
         (producto_id, local_id, tipo, cantidad, cantidad_antes, cantidad_despues,
          referencia_id, usuario_id, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [item.producto_id, localId, tipo, cantidad, stockActual, cantidadDespues,
       referenciaId, usuarioId, notas]
    );
  }
}

/**
  * Revierte stock (ej: al anular una venta) dentro de una transacción existente.
  */
async function revertirStock(client, items, localId, referenciaId, usuarioId, notas = 'Devolución') {
  for (const item of items) {
    const stockRow = await client.query(
      'SELECT cantidad FROM stock WHERE producto_id = $1 AND local_id = $2 FOR UPDATE',
      [item.producto_id, localId]
    );
    const stockActual = parseFloat(stockRow.rows[0]?.cantidad || 0);
    const cantidad = parseFloat(item.cantidad);
    const cantidadDespues = stockActual + cantidad;

    await client.query(
      'UPDATE stock SET cantidad = $1, updated_at = NOW() WHERE producto_id = $2 AND local_id = $3',
      [cantidadDespues, item.producto_id, localId]
    );

    await client.query(
      `INSERT INTO movimientos_stock
         (producto_id, local_id, tipo, cantidad, cantidad_antes, cantidad_despues,
          referencia_id, usuario_id, notas)
       VALUES ($1, $2, 'ajuste', $3, $4, $5, $6, $7, $8)`,
      [item.producto_id, localId, cantidad, stockActual, cantidadDespues,
       referenciaId, usuarioId, notas]
    );
  }
}

module.exports = { descontarStock, revertirStock };
