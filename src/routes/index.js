const express = require('express');
const router  = express.Router();
const { auth, can, adminOnly } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const authController           = require('../controllers/authController');
const stockController          = require('../controllers/stockController');
const produccionController     = require('../controllers/produccionController');
const localesController        = require('../controllers/localesController');
const preciosController        = require('../controllers/preciosController');
const ventasController         = require('../controllers/ventasController');
const logisticaController      = require('../controllers/logisticaController');
const usuariosController       = require('../controllers/usuariosController');
const configController         = require('../controllers/configController');
const productosController      = require('../controllers/productosController');
const unidadesMedidaController = require('../controllers/unidadesMedidaController');
const { pool }                 = require('../config/database');

// ════════════════════════════════════════
// SHOP / E-COMMERCE (web pública)
// ════════════════════════════════════════
const shopController = require('../controllers/shopController');
router.use('/shop', shopController);

// ════════════════════════════════════════
// IMÁGENES IA (generación con APIs)
// ════════════════════════════════════════
const imagenesRouter = require('./imagenes');
router.use('/imagenes', imagenesRouter);

// ════════════════════════════════════
// AUTH
// ════════════════════════════════════
router.post('/auth/login',            validate(schemas.login),            authController.login);
router.post('/auth/refresh',          validate(schemas.refreshToken),     authController.refresh);
router.post('/auth/logout',    auth,  validate(schemas.refreshToken),     authController.logout);
router.get ('/auth/me',        auth,                                      authController.me);
router.post('/auth/cambiar-password', auth, validate(schemas.cambiarPassword), authController.cambiarPassword);

// ── RESETEO DE CONTRASEÑA ──────────
router.post('/auth/olvide-password',                        authController.olvidePassword);
router.post('/auth/restablecer-password',                   authController.restablecerPassword);

// ── MFA (2FA) ──────────────────────
router.get ('/auth/mfa/status',  auth, authController.mfaStatus);
router.post('/auth/mfa/setup',   auth, authController.mfaSetup);
router.post('/auth/mfa/verify',  auth, authController.mfaVerify);
router.post('/auth/mfa/disable', auth, authController.mfaDisable);

// ════════════════════════════════════
// STOCK
// ════════════════════════════════════
router.get ('/stock',             auth, can('stock_ver'),    stockController.listar);
router.get ('/stock/alertas',     auth, can('stock_ver'),    stockController.alertas);
router.get ('/stock/consolidado', auth, can('stock_ver'),    stockController.consolidado);
router.post('/stock/movimiento',  auth, can('stock_editar'), validate(schemas.movimientoStock), stockController.movimiento);

// ════════════════════════════════════
// PRODUCCION
// ════════════════════════════════════
router.get ('/produccion',               auth, can('produccion_ver'),    produccionController.listar);
router.post('/produccion',               auth, can('produccion_crear'),  validate(schemas.ordenFabricacion), produccionController.crear);
router.put ('/produccion/:id/estado',    auth, can('produccion_editar'), produccionController.cambiarEstado);
router.put ('/produccion/:id/aprobar',   auth, can('produccion_editar'), produccionController.cambiarEstado);
router.put ('/produccion/:id/iniciar',   auth, can('produccion_editar'), produccionController.cambiarEstado);
router.put ('/produccion/:id/calidad',   auth, can('produccion_editar'), produccionController.cambiarEstado);
router.put ('/produccion/:id/completar', auth, can('produccion_editar'), produccionController.cambiarEstado);
router.put ('/produccion/:id/cancelar',  auth, can('produccion_editar'), produccionController.cambiarEstado);

// ════════════════════════════════════
// LOCALES
// ════════════════════════════════════
router.get   ('/provincias',            auth, localesController.listarProvincias);
router.get   ('/locales',               auth, can('locales_ver'),       localesController.listar);
router.post  ('/locales',               auth, adminOnly,                validate(schemas.crearLocal),           localesController.crear);
router.put   ('/locales/:id',           auth, adminOnly,                validate(schemas.actualizarLocal),       localesController.actualizar);
router.delete('/locales/:id',           auth, adminOnly,                                                          localesController.eliminar);
router.post  ('/locales/transferencia', auth, can('stock_transferir'),  validate(schemas.transferenciaStock),    localesController.transferir);

// ════════════════════════════════════
// PRECIOS
// ════════════════════════════════════
router.get ('/precios',           auth, can('precios_ver'),    preciosController.listar);
router.get ('/precios/listas',    auth, can('precios_ver'),    preciosController.listarListas);
router.put ('/precios/listas/:id', auth, can('precios_editar'), preciosController.actualizarLista);
router.post('/precios/listas',    auth, can('precios_editar'), validate(schemas.crearListaPrecios),    preciosController.crearLista);
router.get ('/precios/productos', auth, can('precios_ver'),                                             preciosController.listarPorLista);
router.get ('/precios/historial', auth, can('precios_ver'),                                             preciosController.historial);
router.post('/precios',           auth, can('precios_editar'), validate(schemas.actualizarPrecio),       preciosController.actualizar);
router.post('/precios/ajuste',    auth, can('precios_editar'), validate(schemas.ajusteMasivo),           preciosController.ajusteMasivo);
router.post('/precios/batch',     auth, can('precios_editar'), validate(schemas.batchPrecios),           preciosController.batch);
router.delete('/precios/producto/:producto_id/lista/:lista_id', auth, can('precios_editar'), preciosController.eliminar);
router.post('/precios/copiar',                             auth, can('precios_editar'), preciosController.copiarPrecios);

// ════════════════════════════════════
// VENTAS
// ════════════════════════════════════
router.get ('/ventas',              auth, can('ventas_ver'),   ventasController.listar);
router.post('/ventas',              auth, can('ventas_crear'), validate(schemas.crearVenta), ventasController.crear);
router.get ('/ventas/:id',          auth, can('ventas_ver'),   ventasController.obtener);
router.put ('/ventas/:id/anular',   auth, can('ventas_crear'), ventasController.anular);

// ════════════════════════════════════
// LOGISTICA
// ════════════════════════════════════
router.get ('/logistica/pedidos',             auth, can('logistica_ver'),       logisticaController.pedidos);
router.post('/logistica/pedidos',             auth, can('logistica_crear'),     validate(schemas.crearPedidoLogistica), logisticaController.crearPedido);
router.post('/logistica/confirmar',           auth, can('logistica_confirmar'), validate(schemas.confirmarEntrega),     logisticaController.confirmarEntrega);
router.post('/logistica/gps',                 auth,                             validate(schemas.actualizarGPS),       logisticaController.actualizarGPS);
router.post('/logistica/ruta-optimizada',     auth,                                                                    logisticaController.rutaOptimizada);
router.put ('/logistica/pedidos/:id/problema',auth,                             validate(schemas.reportarProblema),    logisticaController.reportarProblema);
router.put ('/logistica/pedidos/:id/asignar', auth, can('logistica_confirmar'), validate(schemas.asignarRepartidor),   logisticaController.asignarRepartidor);

// ════════════════════════════════════
// USUARIOS
// ════════════════════════════════════
router.get ('/usuarios',                    auth, can('usuarios'), usuariosController.listar);
router.get ('/usuarios/:id',                auth, can('usuarios'), usuariosController.obtener);
router.post('/usuarios',                    auth, can('usuarios'), validate(schemas.crearUsuario),          usuariosController.crear);
router.put ('/usuarios/:id',                auth, can('usuarios'), validate(schemas.actualizarUsuario),      usuariosController.actualizar);
router.post('/usuarios/:id/reset-password', auth, can('usuarios'), validate(schemas.resetPasswordUsuario),  usuariosController.resetPassword);
router.post('/usuarios/:id/suspender',      auth, can('usuarios'),                                          usuariosController.suspender);
router.delete('/usuarios/:id',              auth, can('usuarios'),                                          usuariosController.eliminar);

// ════════════════════════════════════
// CONFIG / BACKUPS
// ════════════════════════════════════
router.post('/config/backups',       auth, adminOnly, configController.crearBackup);
router.get ('/config/backups',       auth, adminOnly, configController.listarBackups);
router.get ('/config/backups/:id/download',  auth, adminOnly, configController.descargarBackup);
router.post('/config/backups/:id/restaurar', auth, adminOnly, configController.restaurarBackup);
router.delete('/config/backups/:id',          auth, adminOnly, configController.eliminarBackup);
router.get ('/config/backups/config',   auth, adminOnly, configController.obtenerConfig);
router.put ('/config/backups/config',   auth, adminOnly, configController.guardarConfig);
router.post('/config/backups/limpiar',  auth, adminOnly, configController.limpiarBackups);
router.post('/config/backups/test-cloud', auth, adminOnly, configController.testCloud);
router.get ('/config/backups/rclone-remotes', auth, adminOnly, configController.listarRemotes);
router.post('/config/backups/sistema', auth, adminOnly, configController.crearBackupSistema);
router.get ('/config/backups/sistema/:id/status', auth, adminOnly, configController.obtenerStatusBackupSistema);
router.get ('/config/backups/remotes', auth, adminOnly, configController.listarRemotesMulti);
router.post('/config/backups/remotes', auth, adminOnly, configController.crearRemote);
router.put ('/config/backups/remotes/:id', auth, adminOnly, configController.actualizarRemote);
router.delete('/config/backups/remotes/:id', auth, adminOnly, configController.eliminarRemote);
router.put ('/config/backups/remotes/:id/default', auth, adminOnly, configController.marcarDefaultRemote);
router.post('/config/backups/remotes/:id/test', auth, adminOnly, configController.testRemote);

// ════════════════════════════════════
// PRODUCTOS (CRUD)
// ════════════════════════════════════
router.get('/productos',             auth, can('precios_ver'),    productosController.listar);
router.get('/productos/:id',         auth, can('precios_ver'),    productosController.obtener);
router.post('/productos',            auth, can('precios_editar'), validate(schemas.crearProducto),      productosController.crear);
router.put('/productos/:id',         auth, can('precios_editar'), validate(schemas.actualizarProducto),  productosController.actualizar);
router.delete('/productos/:id',      auth, can('precios_editar'),                                          productosController.eliminar);

// ════════════════════════════════════
// UNIDADES DE MEDIDA (CRUD)
// ════════════════════════════════════
router.get('/unidades-medida',           auth, can('precios_ver'),    unidadesMedidaController.listar);
router.post('/unidades-medida',          auth, can('precios_editar'), unidadesMedidaController.crear);
router.put('/unidades-medida/:id',       auth, can('precios_editar'), unidadesMedidaController.actualizar);
router.delete('/unidades-medida/:id',    auth, can('precios_editar'), unidadesMedidaController.eliminar);

// ════════════════════════════════════
// ROLES
// ════════════════════════════════════
router.get('/roles', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre, permisos FROM roles ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al listar roles' });
  }
});

module.exports = router;
