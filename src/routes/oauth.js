// src/routes/oauth.js — OAuth 2.0 routes
const { Router } = require('express');
const { auth, can, adminOnly } = require('../middleware/auth');
const { authCliente } = require('../middleware/authCliente');
const oauthController = require('../controllers/oauthController');

const router = Router();

// ── Authorization endpoint ──
// GET: público — devuelve metadata del cliente
router.get('/authorize', oauthController.authorizeGet);
// POST: público (acepta Bearer token O body con username+password)
router.post('/authorize', oauthController.authorizePost);

// ── Token endpoint — público (valida internamente) ──
router.post('/token', oauthController.token);

// ── Admin: CRUD de clientes ──
router.get('/clients', auth, adminOnly, oauthController.listClients);
router.post('/clients', auth, adminOnly, oauthController.createClient);
router.put('/clients/:id', auth, adminOnly, oauthController.updateClient);
router.delete('/clients/:id', auth, adminOnly, oauthController.deleteClient);

module.exports = router;
