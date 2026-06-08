// src/middleware/validate.js
const Joi = require('joi');

// Wrapper para validar body con esquema Joi
const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    const errores = error.details.map(d => ({
      campo: d.path.join('.'),
      mensaje: d.message.replace(/['"]/g, '')
    }));
    return res.status(400).json({ error: 'Datos inválidos', detalles: errores });
  }
  next();
};

// ── Esquemas de validación ──

const schemas = {

  login: Joi.object({
    username: Joi.string().alphanum().min(3).max(50).required()
      .messages({ 'any.required': 'El usuario es requerido' }),
    password: Joi.string().min(6).required()
      .messages({ 'any.required': 'La contraseña es requerida' }),
  }),

  crearUsuario: Joi.object({
    username:       Joi.string().alphanum().min(3).max(50).required(),
    password:       Joi.string().min(8).max(100).required(),
    nombre_completo:Joi.string().min(2).max(150).required(),
    email:          Joi.string().email().optional().allow(''),
    telefono:       Joi.string().max(50).optional().allow(''),
    rol_id:         Joi.string().uuid().required(),
    local_id:       Joi.string().uuid().optional().allow(null, ''),
  }),

  cambiarPassword: Joi.object({
    password_actual: Joi.string().required(),
    password_nuevo:  Joi.string().min(8).max(100).required(),
    confirmar:       Joi.string().valid(Joi.ref('password_nuevo')).required()
      .messages({ 'any.only': 'Las contraseñas no coinciden' }),
  }),

  crearProducto: Joi.object({
    nombre:           Joi.string().min(2).max(200).required(),
    categoria_id:     Joi.string().uuid().required(),
    unidad_medida:    Joi.string().max(20).default('kg'),
    costo_produccion: Joi.number().positive().optional(),
    descripcion:      Joi.string().max(500).optional().allow(''),
  }),

  ordenFabricacion: Joi.object({
    producto_id:    Joi.string().uuid().required(),
    local_destino:  Joi.string().uuid().required(),
    cantidad_pedida:Joi.number().positive().required(),
    prioridad:      Joi.string().valid('normal','alta','urgente').default('normal'),
    notas:          Joi.string().max(500).optional().allow(''),
  }),

  actualizarStock: Joi.object({
    producto_id: Joi.string().uuid().required(),
    local_id:    Joi.string().uuid().required(),
    cantidad:    Joi.number().required(),
    tipo:        Joi.string().valid('entrada','salida','ajuste').required(),
    notas:       Joi.string().max(500).optional().allow(''),
  }),

};

module.exports = { validate, schemas };
