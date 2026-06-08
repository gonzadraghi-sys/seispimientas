jest.mock('pg', () => require('./helpers/mockPool').createMockPool());
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'token-falso'),
  verify: jest.fn(() => ({
    id: 'u-admin',
    username: 'ADMIN',
    rol_id: 'r-admin',
    local_id: null,
  })),
}));

const request = require('supertest');
const { mockQuery, mockConnect, mockRelease, resetMocks, mockResolve } = require('./helpers/mockPool');
const app = require('../src/server');

const TOKEN = 'Bearer token-falso';

function mockearAuth({ admin = true, local_id = null } = {}) {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM usuarios WHERE')) return mockResolve([{
      id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin',
      email: 'a@a.com', rol_id: 'r-admin', local_id, activo: true,
    }]);
    if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin, produccion_ver: true, produccion_crear: true, produccion_editar: true } }]);
    if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: String(admin) }]);
    return mockResolve([]);
  });
}

function mockearTransaccion() {
  const cq = jest.fn();
  mockConnect.mockImplementation(() => Promise.resolve({ query: cq, release: mockRelease }));
  return cq;
}

describe('Produccion API', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/produccion', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/produccion');
      expect(res.status).toBe(401);
    });

    it('lista ordenes para admin', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u1', username: 'ADMIN', nombre_completo: 'A', email: 'a@a.com', rol_id: 'r1', local_id: null, activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, produccion_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM ordenes_fabricacion')) return mockResolve([
          { id: 'of1', numero: 1, producto_id: 'p1', producto_nombre: 'Tallarines', local_nombre: 'Central', estado: 'pendiente', prioridad: 'normal', cantidad_pedida: 10 },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/produccion').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/produccion', () => {
    it('crea una orden de fabricacion', async () => {
      mockearAuth();
      const cq = mockearTransaccion();
      cq.mockResolvedValueOnce()                                                               // BEGIN
        .mockResolvedValueOnce(mockResolve([{ id: 'of1', numero: 1 }]))                        // INSERT orden
        .mockResolvedValueOnce();                                                              // COMMIT

      const res = await request(app)
        .post('/api/produccion')
        .set('Authorization', TOKEN)
        .send({ producto_id: 'p1', local_destino: 'l1', cantidad_pedida: 10 });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message', 'Orden creada');
      expect(res.body.orden).toHaveProperty('id');
    });

    it('rechaza si falta producto_id', async () => {
      mockearAuth();
      const res = await request(app)
        .post('/api/produccion')
        .set('Authorization', TOKEN)
        .send({ cantidad_pedida: 10 });

      expect(res.status).toBe(500);
    });
  });

  describe('PUT /api/produccion/:id/estado', () => {
    const ordenPendiente = {
      id: 'of1', numero: 1, producto_id: 'p1', local_destino: 'l1',
      cantidad_pedida: 10, estado: 'pendiente', prioridad: 'normal',
    };

    it('aprueba una orden pendiente', async () => {
      mockearAuth();
      const cq = mockearTransaccion();
      cq.mockResolvedValueOnce()                                                               // BEGIN
        .mockResolvedValueOnce(mockResolve([{ ...ordenPendiente, estado: 'pendiente' }]))       // SELECT orden
        .mockResolvedValueOnce()                                                               // UPDATE
        .mockResolvedValueOnce();                                                              // COMMIT

      const res = await request(app)
        .put('/api/produccion/of1/aprobar')
        .set('Authorization', TOKEN)
        .send({ estado: 'aprobada' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
    });

    it('rechaza completar una orden que no esta en produccion', async () => {
      mockearAuth();
      const cq = mockearTransaccion();
      cq.mockResolvedValueOnce()                                                               // BEGIN
        .mockResolvedValueOnce(mockResolve([{
          ...ordenPendiente, estado: 'pendiente',
        }]))                                                                                   // SELECT orden
        .mockResolvedValueOnce();                                                              // ROLLBACK

      const res = await request(app)
        .put('/api/produccion/of1/completar')
        .set('Authorization', TOKEN)
        .send({ estado: 'completada' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('cancela una orden', async () => {
      mockearAuth();
      const cq = mockearTransaccion();
      cq.mockResolvedValueOnce()                                                               // BEGIN
        .mockResolvedValueOnce(mockResolve([{ ...ordenPendiente, estado: 'pendiente' }]))       // SELECT orden
        .mockResolvedValueOnce()                                                               // UPDATE
        .mockResolvedValueOnce();                                                              // COMMIT

      const res = await request(app)
        .put('/api/produccion/of1/cancelar')
        .set('Authorization', TOKEN)
        .send({ estado: 'cancelada', motivo_cancelacion: 'Test cancelacion' });

      expect(res.status).toBe(200);
    });
  });
});
