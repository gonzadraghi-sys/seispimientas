// src/services/mercadopago.js — Integración con Mercado Pago
const axios = require('axios');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_API_BASE = 'https://api.mercadopago.com';

/**
 * Crea una preferencia de pago en Mercado Pago
 *
 * @param {Array<{nombre: string, cantidad: number, precio_unitario: number}>} items
 * @param {string} pedidoId - ID del pedido en nuestra BD (external_reference)
 * @param {string} clienteEmail - Email del cliente para el payer
 * @returns {Promise<{id: string, init_point: string, sandbox_init_point: string}>}
 */
async function crearPreferencia(items, pedidoId, clienteEmail) {
  if (!MP_ACCESS_TOKEN) {
    throw new Error('MP_ACCESS_TOKEN no configurado en .env');
  }

  const body = {
    items: items.map(item => ({
      title: item.nombre,
      quantity: Number(item.cantidad),
      unit_price: Number(item.precio_unitario),
      currency_id: 'ARS',
    })),
    external_reference: String(pedidoId),
    notification_url: `${process.env.SHOP_URL || 'http://localhost:5174'}/api/shop/mercadopago/webhook`,
    payer: {
      email: clienteEmail,
    },
    back_urls: {
      success: `${process.env.SHOP_URL || 'http://localhost:5174'}/pedidos/${pedidoId}`,
      failure: `${process.env.SHOP_URL || 'http://localhost:5174'}/checkout?error=mp_failure`,
      pending: `${process.env.SHOP_URL || 'http://localhost:5174'}/checkout?error=mp_pending`,
    },
    auto_return: 'approved',
    payment_methods: {
      excluded_payment_types: [],
      installments: 1,
    },
  };

  try {
    const { data } = await axios.post(
      `${MP_API_BASE}/checkout/preferences`,
      body,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return data;
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    throw new Error(`Error Mercado Pago al crear preferencia: ${msg}`);
  }
}

/**
 * Obtiene los detalles de un pago por ID
 */
async function obtenerPago(paymentId) {
  if (!MP_ACCESS_TOKEN) {
    throw new Error('MP_ACCESS_TOKEN no configurado en .env');
  }

  try {
    const { data } = await axios.get(
      `${MP_API_BASE}/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        },
        timeout: 10000,
      }
    );
    return data;
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    throw new Error(`Error Mercado Pago al obtener pago: ${msg}`);
  }
}

module.exports = { crearPreferencia, obtenerPago };
