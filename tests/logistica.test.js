jest.mock('pg', () => require('./helpers/mockPool').createMockPool());
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'token-falso'),
  verify: jest.fn(() => ({ id: 'u-admin', username: 'ADMIN', rol_id: 'r-admin', local_id: null })),
}));

const request = require('supertest');
const { mockQuery, mockConnect, mockRelease, resetMocks, mockResolve } = require('./helpers/mockPool');
const app = require('../src/server');

const TOKEN = 'Bearer token-falso';

function mockearAuth(permisosExtra = {}) {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM usuarios WHERE id = $1') || (sql.includes('FROM usuarios WHERE') && !sql.includes('username'))) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
    if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, logistica_ver: true, logistica_crear: true, logistica_confirmar: true, gps_actualizar: true, locales_ver: true, ...permisosExtra } }]);
    if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
    return mockResolve([]);
  });
}

describe('Logistica API', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/logistica/pedidos', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/logistica/pedidos');
      expect(res.status).toBe(401);
    });

    it('lista pedidos para admin', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, logistica_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM pedidos p')) return mockResolve([
          { id: 'p1', numero: 1, local_destino: 'l1', repartidor_id: null, estado: 'pendiente', codigo_confirmacion: '1234', confirmado: false, lat_actual: null, lng_actual: null, notas: null, notas_problema: null, created_at: new Date(), local_nombre: 'Central', direccion_destino: 'Av Siempre Viva', telefono_destino: '123456', lat: null, lng: null, repartidor_nombre: null, items: null, cantidad_items: 0 },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/logistica/pedidos').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/logistica/pedidos', () => {
    it('crea un pedido', async () => {
      mockearAuth();
      const cq = jest.fn();
      mockConnect.mockImplementation(() => Promise.resolve({ query: cq, release: mockRelease }));

      cq.mockResolvedValueOnce()                                                                   // BEGIN
        .mockResolvedValueOnce(mockResolve([{ id: 'p1', numero: 1 }]))                            // INSERT pedido
        .mockResolvedValueOnce()                                                                   // INSERT items
        .mockResolvedValueOnce();                                                                  // COMMIT

      const res = await request(app)
        .post('/api/logistica/pedidos')
        .set('Authorization', TOKEN)
        .send({ local_destino: 'l1', items: [{ producto_id: 'p1', cantidad: 5, precio_unit: 0 }] });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('pedido');
    });
  });

  describe('POST /api/logistica/gps', () => {
    it('actualiza ubicacion GPS', async () => {
      mockearAuth();
      const res = await request(app)
        .post('/api/logistica/gps')
        .set('Authorization', TOKEN)
        .send({ pedido_id: 'p1', lat: -32.89, lng: -68.83, estado: 'en_ruta' });
      expect(res.status).toBe(200);
    });
  });
});

describe('Locales API', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/locales', () => {
    it('lista locales', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, locales_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM locales l')) return mockResolve([
          { id: 'l1', nombre: 'Central', tipo: 'fabrica', provincia_id: 'pr1', provincia_nombre: 'Mendoza', direccion: 'Las Heras 890', telefono: null, encargado: 'Admin', activo: true, lat: -32.89, lng: -68.83, created_at: new Date(), updated_at: new Date() },
          { id: 'l2', nombre: 'Godoy Cruz', tipo: 'local', provincia_id: 'pr1', provincia_nombre: 'Mendoza', direccion: 'San Martin 765', telefono: null, encargado: 'M. Rodriguez', activo: true, lat: -32.93, lng: -68.84, created_at: new Date(), updated_at: new Date() },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/locales').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });

  describe('GET /api/provincias', () => {
    it('lista provincias', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM provincias')) return mockResolve([{ id: 'pr1', nombre: 'Mendoza' }, { id: 'pr2', nombre: 'Cordoba' }]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/provincias').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/locales/transferencia', () => {
    it('transfiere stock entre locales', async () => {
      mockearAuth();
      const cq = jest.fn();
      mockConnect.mockImplementation(() => Promise.resolve({ query: cq, release: mockRelease }));

      cq.mockResolvedValueOnce()                                                                   // BEGIN
        .mockResolvedValueOnce(mockResolve([{ cantidad: 50 }]))                                    // SELECT stock origen
        .mockResolvedValueOnce(mockResolve([{ id: 't1' }]))                                        // INSERT transferencia
        .mockResolvedValueOnce()                                                                   // INSERT movimiento salida
        .mockResolvedValueOnce()                                                                   // UPDATE stock origen
        .mockResolvedValueOnce()                                                                   // INSERT movimiento entrada
        .mockResolvedValueOnce()                                                                   // INSERT/UPDATE stock destino
        .mockResolvedValueOnce()                                                                   // UPDATE transferencia completada
        .mockResolvedValueOnce();                                                                  // COMMIT

      const res = await request(app)
        .post('/api/locales/transferencia')
        .set('Authorization', TOKEN)
        .send({ producto_id: 'p1', local_origen: 'l1', local_destino: 'l2', cantidad: 10 });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message');
    });

    it('rechaza si no hay stock suficiente', async () => {
      mockearAuth();
      const cq = jest.fn();
      mockConnect.mockImplementation(() => Promise.resolve({ query: cq, release: mockRelease }));

      cq.mockResolvedValueOnce()                                                                   // BEGIN
        .mockResolvedValueOnce(mockResolve([{ cantidad: 5 }]));                                    // SELECT stock (solo 5, se piden 10)

      const res = await request(app)
        .post('/api/locales/transferencia')
        .set('Authorization', TOKEN)
        .send({ producto_id: 'p1', local_origen: 'l1', local_destino: 'l2', cantidad: 10 });

      expect(res.status).toBe(500);
    });
  });
});
