jest.mock('pg', () => require('./helpers/mockPool').createMockPool());
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'token-falso'),
  verify: jest.fn(() => ({ id: 'u-admin', username: 'ADMIN', rol_id: 'r-admin', local_id: null })),
}));

const request = require('supertest');
const { mockQuery, resetMocks, mockResolve } = require('./helpers/mockPool');
const app = require('../src/server');

const TOKEN = 'Bearer token-falso';

const USER_ADMIN = { id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true };

// Helper: programa el mock para responder queries de autenticacion
function mockearAdmin(extraImpl) {
  mockQuery.mockImplementation((sql) => {
    // Auth middleware
    if (sql.includes('FROM usuarios WHERE id = $1') || (sql.includes('FROM usuarios WHERE') && !sql.includes('username ='))) return mockResolve([USER_ADMIN]);
    // can() middleware
    if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, usuarios: true } }]);
    // esAdmin()
    if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
    // Si hay implementacion extra, delegar
    if (extraImpl) return extraImpl(sql);
    return mockResolve([]);
  });
}

describe('Usuarios API', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/usuarios', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/usuarios');
      expect(res.status).toBe(401);
    });

    it('lista usuarios', async () => {
      mockearAdmin((sql) => {
        if (sql.includes('FROM usuarios u')) return mockResolve([
          { id: 'u1', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', telefono: null, activo: true, ultimo_acceso: null, created_at: new Date(), local_id: null, rol: 'Administrador', local_nombre: null },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/usuarios').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/usuarios/:id', () => {
    it('obtiene un usuario por ID', async () => {
      mockearAdmin((sql) => {
        if (sql.includes('FROM usuarios u')) return mockResolve([{ id: 'u1', username: 'USER1', nombre_completo: 'User 1', email: 'u@u.com', telefono: null, activo: true, ultimo_acceso: null, created_at: new Date(), local_id: 'l1', rol_id: 'r1', rol: 'Vendedor', permisos: {}, local_nombre: 'Godoy Cruz' }]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/usuarios/u1').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('username');
    });

    it('devuelve 404 si no existe', async () => {
      mockearAdmin((sql) => {
        if (sql.includes('FROM usuarios u')) return mockResolve([]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/usuarios/inexistente').set('Authorization', TOKEN);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/usuarios', () => {
    it('crea un usuario', async () => {
      mockearAdmin((sql) => {
        // Verificar que NO sea la consulta de username duplicado
        if (sql.includes('username = $1')) return mockResolve([]); // no existe
        if (sql.includes('INSERT INTO usuarios')) return mockResolve([{ id: 'nuevo', username: 'NUEVO', nombre_completo: 'Nuevo User', email: 'nuevo@test.com', activo: true, created_at: new Date() }]);
        return mockResolve([]);
      });
      const res = await request(app)
        .post('/api/usuarios')
        .set('Authorization', TOKEN)
        .send({ username: 'NUEVO', password: '12345678', nombre_completo: 'Nuevo User', rol_id: 'r1' });
      expect(res.status).toBe(201);
    });

    it('rechaza username duplicado', async () => {
      mockearAdmin((sql) => {
        if (sql.includes('username = $1')) return mockResolve([{ id: 'existente' }]); // ya existe
        return mockResolve([]);
      });
      const res = await request(app)
        .post('/api/usuarios')
        .set('Authorization', TOKEN)
        .send({ username: 'EXISTENTE', password: '12345678', nombre_completo: 'Ya existe', rol_id: 'r1' });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/usuarios/:id/suspender', () => {
    it('suspende un usuario', async () => {
      mockearAdmin();
      const res = await request(app).post('/api/usuarios/u2/suspender').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Usuario suspendido');
    });

    it('rechaza suspenderse a si mismo', async () => {
      mockearAdmin();
      const res = await request(app).post('/api/usuarios/u-admin/suspender').set('Authorization', TOKEN);
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/usuarios/:id', () => {
    it('elimina un usuario', async () => {
      mockearAdmin();
      const res = await request(app).delete('/api/usuarios/u2').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
    });

    it('rechaza eliminarse a si mismo', async () => {
      mockearAdmin();
      const res = await request(app).delete('/api/usuarios/u-admin').set('Authorization', TOKEN);
      expect(res.status).toBe(400);
    });
  });
});
