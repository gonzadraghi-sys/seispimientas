// src/middleware/validate.js — Validación de esquemas con Joi
const Joi = require('joi');

// Wrapper para validar body con esquema Joi
const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    const errores = error.details.map(d => ({
      campo: d.path.join('.'),
      mensaje: d.message.replace(/['"]/g, ''),
    }));
    return res.status(400).json({ error: 'Datos inválidos', detalles: errores });
  }
  next();
};

// ── Esquemas de validación ──

const schemas = {

  // ═══ AUTH ═══
  login: Joi.object({
    username: Joi.string().alphanum().min(3).max(50).required()
      .messages({ 'any.required': 'El usuario es requerido' }),
    password: Joi.string().min(1).required()
      .messages({ 'any.required': 'La contraseña es requerida' }),
  }),

  loginCliente: Joi.object({
    email: Joi.string().email().required()
      .messages({ 'any.required': 'El email es requerido' }),
    password: Joi.string().min(1).required()
      .messages({ 'any.required': 'La contraseña es requerida' }),
  }),

  registroCliente: Joi.object({
    nombre: Joi.string().min(2).max(150).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).max(100).required(),
    telefono: Joi.string().max(50).optional().allow('', null),
    direccion: Joi.string().max(255).optional().allow('', null),
    ciudad: Joi.string().max(100).optional().allow('', null),
    provincia: Joi.string().max(100).optional().allow('', null),
    codigo_postal: Joi.string().max(20).optional().allow('', null),
    tipo: Joi.string().valid('minorista', 'mayorista').optional(),
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required(),
  }),

  olvidePassword: Joi.object({
    email: Joi.string().email().required(),
  }),

  restablecerPassword: Joi.object({
    token: Joi.string().required(),
    password: Joi.string().min(6).max(100).required(),
  }),

  cambiarPassword: Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).max(100).required(),
  }),

  // ═══ USUARIOS ═══
  crearUsuario: Joi.object({
    username: Joi.string().alphanum().min(3).max(50).required(),
    password: Joi.string().min(8).max(100).required(),
    nombre_completo: Joi.string().min(2).max(150).required(),
    email: Joi.string().email().optional().allow('', null),
    telefono: Joi.string().max(50).optional().allow('', null),
    rol_id: Joi.string().uuid().required(),
    local_id: Joi.string().uuid().optional().allow(null, ''),
  }),

  actualizarUsuario: Joi.object({
    nombre_completo: Joi.string().min(2).max(150).optional(),
    email: Joi.string().email().optional().allow('', null),
    telefono: Joi.string().max(50).optional().allow('', null),
    rol_id: Joi.string().uuid().optional(),
    local_id: Joi.string().uuid().optional().allow(null, ''),
    activo: Joi.boolean().optional(),
  }),

  resetPasswordUsuario: Joi.object({
    nueva_password: Joi.string().min(8).max(100).required(),
  }),

  // ═══ PRODUCTOS ═══
  crearProducto: Joi.object({
    nombre: Joi.string().min(2).max(200).required(),
    categoria_id: Joi.string().uuid().required(),
    unidad_medida: Joi.string().max(20).default('kg'),
    cantidad_por_unidad: Joi.number().positive().default(1),
    costo_produccion: Joi.number().positive().optional().allow(null),
    descripcion: Joi.string().max(500).optional().allow('', null),
  }),

  actualizarProducto: Joi.object({
    nombre: Joi.string().min(2).max(200).optional(),
    categoria_id: Joi.string().uuid().optional(),
    unidad_medida: Joi.string().max(20).optional(),
    cantidad_por_unidad: Joi.number().positive().optional(),
    costo_produccion: Joi.number().positive().optional().allow(null),
    descripcion: Joi.string().max(500).optional().allow('', null),
    activo: Joi.boolean().optional(),
  }),

  // ═══ STOCK ═══
  movimientoStock: Joi.object({
    producto_id: Joi.string().uuid().required(),
    local_id: Joi.string().uuid().required(),
    cantidad: Joi.number().required(),
    tipo: Joi.string().valid('entrada', 'salida', 'ajuste').required(),
    notas: Joi.string().max(500).optional().allow('', null),
  }),

  transferenciaStock: Joi.object({
    producto_id: Joi.string().uuid().required(),
    local_origen: Joi.string().uuid().required(),
    local_destino: Joi.string().uuid().required(),
    cantidad: Joi.number().positive().required(),
    notas: Joi.string().max(500).optional().allow('', null),
  }),

  // ═══ PRODUCCIÓN ═══
  ordenFabricacion: Joi.object({
    producto_id: Joi.string().uuid().required(),
    local_destino: Joi.string().uuid().required(),
    cantidad_pedida: Joi.number().positive().required(),
    prioridad: Joi.string().valid('normal', 'alta', 'urgente').default('normal'),
    notas: Joi.string().max(500).optional().allow('', null),
  }),

  completarOF: Joi.object({
    cantidad_real: Joi.number().positive().optional(),
    motivo_cancelacion: Joi.string().max(500).optional().allow('', null),
  }),

  // ═══ VENTAS ═══
  crearVenta: Joi.object({
    items: Joi.array().items(Joi.object({
      producto_id: Joi.string().uuid().required(),
      cantidad: Joi.number().positive().required(),
      precio_unitario: Joi.number().positive().required(),
    })).min(1).required(),
    notas: Joi.string().max(500).optional().allow('', null),
  }),

  // ═══ SHOP / PEDIDOS WEB ═══
  crearPedidoWeb: Joi.object({
    items: Joi.array().items(Joi.object({
      producto_id: Joi.string().uuid().required(),
      cantidad: Joi.number().positive().required(),
    })).min(1).required(),
    metodo_pago: Joi.string().valid('mercadopago', 'transferencia').required(),
    direccion_envio: Joi.string().max(255).optional().allow('', null),
    ciudad_envio: Joi.string().max(100).optional().allow('', null),
    provincia_envio: Joi.string().max(100).optional().allow('', null),
    codigo_postal_envio: Joi.string().max(20).optional().allow('', null),
    notas: Joi.string().max(500).optional().allow('', null),
  }),

  crearPreferenciaMP: Joi.object({
    pedidoId: Joi.string().uuid().required(),
  }),

  cambiarEstadoPedidoWeb: Joi.object({
    estado: Joi.string().valid(
      'pendiente_pago', 'confirmado', 'en_preparacion',
      'enviado', 'entregado', 'cancelado'
    ).required(),
  }),

  // ═══ PRECIOS ═══
  actualizarPrecio: Joi.object({
    producto_id: Joi.string().uuid().required(),
    lista_id: Joi.string().uuid().required(),
    precio: Joi.number().positive().required(),
    motivo: Joi.string().max(500).optional().allow('', null),
  }),

  batchPrecios: Joi.object({
    accion: Joi.string().valid('eliminar', 'actualizar').required(),
    items: Joi.array().items(Joi.object({
      producto_id: Joi.string().uuid().required(),
      lista_id: Joi.string().uuid().required(),
    })).min(1).required(),
    precio: Joi.number().positive().optional(),
    motivo: Joi.string().max(500).optional().allow('', null),
  }),

  ajusteMasivo: Joi.object({
    lista_id: Joi.string().uuid().required(),
    porcentaje: Joi.number().required(),
    tipo: Joi.string().valid('aumento', 'descuento').required(),
    categoria: Joi.string().optional().allow('', null),
  }),

  crearListaPrecios: Joi.object({
    nombre: Joi.string().min(2).max(150).required(),
    tipo: Joi.string().valid('base', 'local', 'mayorista', 'promocional', 'especial').default('base'),
    ajuste_pct: Joi.number().default(0),
    local_id: Joi.string().uuid().optional().allow(null, ''),
    vigencia_desde: Joi.date().optional().allow(null, ''),
    vigencia_hasta: Joi.date().optional().allow(null, ''),
  }),

  // ═══ LOCALES ═══
  crearLocal: Joi.object({
    nombre: Joi.string().min(2).max(150).required(),
    tipo: Joi.string().valid('fabrica', 'local', 'deposito').required(),
    provincia_id: Joi.string().uuid().required(),
    direccion: Joi.string().max(255).optional().allow('', null),
    telefono: Joi.string().max(50).optional().allow('', null),
    encargado: Joi.string().max(150).optional().allow('', null),
    lat: Joi.number().min(-90).max(90).optional().allow(null),
    lng: Joi.number().min(-180).max(180).optional().allow(null),
  }),

  actualizarLocal: Joi.object({
    nombre: Joi.string().min(2).max(150).optional(),
    tipo: Joi.string().valid('fabrica', 'local', 'deposito').optional(),
    provincia_id: Joi.string().uuid().optional(),
    direccion: Joi.string().max(255).optional().allow('', null),
    telefono: Joi.string().max(50).optional().allow('', null),
    encargado: Joi.string().max(150).optional().allow('', null),
    lat: Joi.number().min(-90).max(90).optional().allow(null),
    lng: Joi.number().min(-180).max(180).optional().allow(null),
    activo: Joi.boolean().optional(),
  }),

  // ═══ LOGÍSTICA ═══
  crearPedidoLogistica: Joi.object({
    local_destino: Joi.string().uuid().required(),
    items: Joi.array().items(Joi.object({
      producto_id: Joi.string().uuid().required(),
      cantidad: Joi.number().positive().required(),
      precio_unit: Joi.number().optional().default(0),
    })).min(1).required(),
    notas: Joi.string().max(500).optional().allow('', null),
  }),

  confirmarEntrega: Joi.object({
    pedido_id: Joi.string().uuid().required(),
    codigo: Joi.string().max(10).required(),
  }),

  asignarRepartidor: Joi.object({
    repartidor_id: Joi.string().uuid().required(),
  }),

  actualizarGPS: Joi.object({
    pedido_id: Joi.string().uuid().optional().allow(null),
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    estado: Joi.string().valid('pendiente', 'en_ruta', 'entregado', 'problema', 'cancelado').optional(),
  }),

  reportarProblema: Joi.object({
    notas: Joi.string().max(500).required(),
  }),

  // ═══ UNIDADES DE MEDIDA ═══
  crearUnidadMedida: Joi.object({
    nombre: Joi.string().min(1).max(50).required(),
    simbolo: Joi.string().max(10).optional().allow('', null),
  }),

  actualizarUnidadMedida: Joi.object({
    nombre: Joi.string().min(1).max(50).optional(),
    simbolo: Joi.string().max(10).optional().allow('', null),
    activa: Joi.boolean().optional(),
  }),

};

module.exports = { validate, schemas };
