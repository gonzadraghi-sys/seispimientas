jest.mock('pg', () => require('./helpers/mockPool').createMockPool());
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'token-falso'),
  verify: jest.fn(() => ({ id: 'u-admin', username: 'ADMIN', rol_id: 'r-admin', local_id: 'l1' })),
}));

const request = require('supertest');
const { mockQuery, mockConnect, mockRelease, resetMocks, mockResolve } = require('./helpers/mockPool');
const app = require('../src/server');

const TOKEN = 'Bearer token-falso';

function mockearAuth(permisosExtra = {}) {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM usuarios WHERE id = $1') || (sql.includes('FROM usuarios WHERE') && !sql.includes('username'))) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: 'l1', activo: true }]);
    if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, ventas_ver: true, ventas_crear: true, precios_ver: true, precios_editar: true, ...permisosExtra } }]);
    if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
    return mockResolve([]);
  });
}

describe('Ventas API', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/ventas', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/ventas');
      expect(res.status).toBe(401);
    });

    it('lista ventas', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: 'l1', activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, ventas_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM ventas v')) return mockResolve([
          { id: 'v1', local_id: 'l1', usuario_id: 'u1', total: 1000, estado: 'completada', notas: null, created_at: new Date(), usuario: 'ADMIN', local_nombre: 'Central', items: null },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/ventas').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/ventas', () => {
    it('crea una venta con descuento de stock', async () => {
      mockearAuth();
      const cq = jest.fn();
      mockConnect.mockImplementation(() => Promise.resolve({ query: cq, release: mockRelease }));

      cq.mockResolvedValueOnce()                                                                   // BEGIN
        .mockResolvedValueOnce(mockResolve([{ id: 'v1', local_id: 'l1', usuario_id: 'u1', total: 500, notas: null, created_at: new Date(), estado: 'completada' }])) // INSERT venta
        .mockResolvedValueOnce()                                                                   // INSERT detalle
        .mockResolvedValueOnce(mockResolve([{ cantidad: 20 }]))                                   // SELECT stock FOR UPDATE
        .mockResolvedValueOnce()                                                                   // UPDATE stock
        .mockResolvedValueOnce()                                                                   // INSERT movimiento_stock
        .mockResolvedValueOnce();                                                                  // COMMIT

      const res = await request(app)
        .post('/api/ventas')
        .set('Authorization', TOKEN)
        .send({ items: [{ producto_id: 'p1', cantidad: 2, precio_unitario: 250 }] });

      expect(res.status).toBe(201);
    });

    it('rechaza venta sin items', async () => {
      mockearAuth();
      const res = await request(app)
        .post('/api/ventas')
        .set('Authorization', TOKEN)
        .send({ items: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/ventas/:id/anular', () => {
    it('anula una venta y revierte stock', async () => {
      mockearAuth();
      const cq = jest.fn();
      mockConnect.mockImplementation(() => Promise.resolve({ query: cq, release: mockRelease }));

      cq.mockResolvedValueOnce()                                                                   // BEGIN
        .mockResolvedValueOnce(mockResolve([{ id: 'v1', local_id: 'l1', usuario_id: 'u1', total: 500, estado: 'completada' }])) // SELECT FOR UPDATE
        .mockResolvedValueOnce(mockResolve([{ producto_id: 'p1', cantidad: 2, precio_unitario: 250, subtotal: 500 }])) // SELECT detalles
        .mockResolvedValueOnce(mockResolve([{ cantidad: 18 }]))                                   // SELECT stock FOR UPDATE
        .mockResolvedValueOnce()                                                                   // UPDATE stock (+2)
        .mockResolvedValueOnce()                                                                   // INSERT movimiento_stock
        .mockResolvedValueOnce();                                                                  // UPDATE venta estado=anulada

      const res = await request(app)
        .put('/api/ventas/v1/anular')
        .set('Authorization', TOKEN);

      expect(res.status).toBe(200);
    });
  });
});

describe('Precios API', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/precios/listas', () => {
    it('lista listas de precios', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-a', username: 'ADMIN', nombre_completo: 'A', email: 'a@a.com', rol_id: 'r-a', local_id: 'l1', activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, precios_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM listas_precios')) return mockResolve([
          { id: 'lp1', nombre: 'Lista Base', tipo: 'base', ajuste_pct: 0, activa: true, local_nombre: null, cantidad_productos: '10' },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/precios/listas').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/precios/ajuste', () => {
    it('aplica ajuste masivo', async () => {
      mockearAuth();
      const cq = jest.fn();
      mockConnect.mockImplementation(() => Promise.resolve({ query: cq, release: mockRelease }));

      cq.mockResolvedValueOnce()                                                                   // BEGIN
        .mockResolvedValueOnce(mockResolve([{ producto_id: 'p1', precio: 100 }, { producto_id: 'p2', precio: 200 }])) // SELECT precios
        .mockResolvedValueOnce()                                                                   // UPDATE p1
        .mockResolvedValueOnce()                                                                   // INSERT historial p1
        .mockResolvedValueOnce()                                                                   // UPDATE p2
        .mockResolvedValueOnce()                                                                   // INSERT historial p2
        .mockResolvedValueOnce();                                                                  // COMMIT

      const res = await request(app)
        .post('/api/precios/ajuste')
        .set('Authorization', TOKEN)
        .send({ lista_id: 'lp1', porcentaje: 10 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
    });
  });

  describe('GET /api/precios/historial', () => {
    it('retorna historial de precios', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-a', username: 'ADMIN', nombre_completo: 'A', email: 'a@a.com', rol_id: 'r-a', local_id: 'l1', activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, precios_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM historial_precios')) return mockResolve([
          { id: 'h1', producto_id: 'p1', lista_id: 'lp1', precio_anterior: 100, precio_nuevo: 110, created_at: new Date(), producto: 'Tallarines', lista: 'Base', modificado_por: 'ADMIN' },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/precios/historial').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
