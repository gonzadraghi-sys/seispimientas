// Mock pg antes de cualquier import
jest.mock('pg', () => require('./helpers/mockPool').createMockPool());
// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'token-falso'),
  verify: jest.fn(() => ({
    id: '00000000-0000-0000-0000-000000000001',
    username: 'ADMIN',
    rol_id: '00000000-0000-0000-0000-000000000001',
    local_id: null,
  })),
}));

const request = require('supertest');
const { mockQuery, resetMocks, mockResolve, mockConnect, mockRelease } = require('./helpers/mockPool');
const app = require('../src/server');

const TOKEN = 'Bearer token-falso';

// ── Helpers de autenticacion mockeados ─────────────────────

function mockearAuth({ admin = true, local_id = null, permisos_extra = {} } = {}) {
  const user = {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'ADMIN',
    nombre_completo: 'Admin Test',
    email: 'admin@test.com',
    rol_id: '00000000-0000-0000-0000-000000000001',
    local_id,
    activo: true,
  };
  const permisos = admin
    ? { admin: true, stock_ver: true, stock_editar: true, ...permisos_extra }
    : { stock_ver: true, ...permisos_extra };

  mockQuery.mockImplementation((sql) => {
    // Auth middleware: busca usuario por ID
    if (sql.includes('FROM usuarios WHERE')) return mockResolve([user]);
    // can() middleware: SELECT permisos FROM roles WHERE id = $1
    if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos }]);
    // esAdmin(): SELECT permisos->>'admin' as admin FROM roles
    if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: String(admin) }]);
    // Default: vacio
    return mockResolve([]);
  });
}

function mockearTransaccion() {
  const clientQuery = jest.fn();
  mockConnect.mockImplementation(() => Promise.resolve({
    query: clientQuery,
    release: mockRelease,
  }));
  return clientQuery;
}

// ── Tests ─────────────────────────────────────────────────

describe('Stock API', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/stock', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/stock');
      expect(res.status).toBe(401);
    });

    it('lista stock para admin', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{
          id: 'u1', username: 'ADMIN', nombre_completo: 'Admin',
          email: 'a@a.com', rol_id: 'r1', local_id: null, activo: true,
        }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, stock_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM productos')) return mockResolve([
          { producto_id: 'p1', producto: 'Tallarines', unidad_medida: 'kg', categoria: 'Larga',
            cantidad: 50, stock_minimo: 10, local: 'Central', local_id: 'l1', estado: 'ok', pct_minimo: 100 },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/stock').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('devuelve 403 si el rol no tiene stock_ver', async () => {
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{
          id: 'u1', username: 'USER', nombre_completo: 'User',
          email: 'u@u.com', rol_id: 'r2', local_id: 'l1', activo: true,
        }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { dashboard: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'false' }]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/stock').set('Authorization', TOKEN);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/stock/alertas', () => {
    it('retorna alertas de stock bajo', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{
          id: 'u1', username: 'ADMIN', nombre_completo: 'Admin',
          email: 'a@a.com', rol_id: 'r1', local_id: null, activo: true,
        }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, stock_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('stock_minimo')) return mockResolve([
          { producto_id: 'p2', producto: 'Ravioles', cantidad: 3, stock_minimo: 10,
            local: 'Central', local_id: 'l1', estado: 'bajo' },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/stock/alertas').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('criticos');
      expect(res.body).toHaveProperty('bajos');
      expect(res.body).toHaveProperty('items');
    });
  });

  describe('GET /api/stock/consolidado', () => {
    it('retorna consolidado', async () => {
      mockearAuth();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{
          id: 'u1', username: 'ADMIN', nombre_completo: 'Admin',
          email: 'a@a.com', rol_id: 'r1', local_id: null, activo: true,
        }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, stock_ver: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('SUM')) return mockResolve([
          { id: 'p1', nombre: 'Tallarines', unidad_medida: 'kg', categoria: 'Larga', total_stock: '100' },
        ]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/stock/consolidado').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/stock/movimiento', () => {
    const movimiento = {
      producto_id: 'p1',
      local_id: 'l1',
      tipo: 'entrada',
      cantidad: 10,
      notas: ' reposicion',
    };

    function mockAuthYTransaccion() {
      const clientQuery = jest.fn();
      mockConnect.mockImplementation(() => Promise.resolve({
        query: clientQuery,
        release: mockRelease,
      }));
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{
          id: 'u1', username: 'ADMIN', nombre_completo: 'Admin',
          email: 'a@a.com', rol_id: 'r1', local_id: null, activo: true,
        }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true, stock_ver: true, stock_editar: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        return mockResolve([]);
      });
      return clientQuery;
    }

    it('registra entrada de stock', async () => {
      const cq = mockAuthYTransaccion();
      cq.mockResolvedValueOnce()                                  // BEGIN
        .mockResolvedValueOnce(mockResolve([{ cantidad: 20 }]))   // SELECT FOR UPDATE
        .mockResolvedValueOnce()                                  // INSERT/UPDATE stock
        .mockResolvedValueOnce()                                  // INSERT movimientos_stock
        .mockResolvedValueOnce();                                 // COMMIT

      const res = await request(app)
        .post('/api/stock/movimiento')
        .set('Authorization', TOKEN)
        .send(movimiento);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('cantidad_despues');
    });

    it('rechaza body vacio (falla en el controller porque falta todo)', async () => {
      const cq = mockAuthYTransaccion();
      cq.mockResolvedValueOnce(); // BEGIN — luego falla
      const res = await request(app)
        .post('/api/stock/movimiento')
        .set('Authorization', TOKEN)
        .send({});
      expect(res.status).toBe(500);
    });
  });
});
