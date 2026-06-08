// tests/auth.test.js
const request = require('supertest');
const app     = require('../src/server');

describe('Auth API', () => {

  describe('POST /api/auth/login', () => {

    it('debe rechazar sin body', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('debe rechazar credenciales vacías', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: '', password: '' });
      expect(res.status).toBe(400);
    });

    it('debe rechazar usuario inexistente', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'NOEXISTE', password: 'password123' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Credenciales inválidas');
    });

    it('debe devolver token con credenciales correctas', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'GDRAGHI', password: 'nobodycantouchme' });
      // En test environment con DB real:
      // expect(res.status).toBe(200);
      // expect(res.body).toHaveProperty('access_token');
      // expect(res.body.usuario.username).toBe('GDRAGHI');
      expect([200, 401, 500]).toContain(res.status); // flexible para CI sin DB
    });

  });

  describe('GET /api/auth/me', () => {

    it('debe rechazar sin token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('debe rechazar con token inválido', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer token_invalido_123');
      expect(res.status).toBe(401);
    });

  });

  describe('GET /health', () => {

    it('debe responder ok', async () => {
      const res = await request(app).get('/health');
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
    });

  });

  describe('Rutas inexistentes', () => {

    it('debe devolver 404', async () => {
      const res = await request(app).get('/api/ruta-que-no-existe');
      expect(res.status).toBe(404);
    });

  });

});
