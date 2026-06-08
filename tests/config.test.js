jest.mock('pg', () => require('./helpers/mockPool').createMockPool());
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'token-falso'),
  verify: jest.fn(() => ({ id: 'u-admin', username: 'ADMIN', rol_id: 'r-admin', local_id: null })),
}));
jest.mock('child_process', () => ({ exec: jest.fn() }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ size: 1024 })),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const request = require('supertest');
const { mockQuery, resetMocks, mockResolve } = require('./helpers/mockPool');
const { exec } = require('child_process');
const fs = require('fs');
const app = require('../src/server');

const TOKEN = 'Bearer token-falso';

function mockearAdmin() {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM usuarios WHERE id = $1') || (sql.includes('FROM usuarios WHERE') && !sql.includes('username'))) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
    if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true } }]);
    if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
    return mockResolve([]);
  });
}

describe('Config / Backups API', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
  });

  describe('GET /config/backups', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/config/backups');
      expect(res.status).toBe(401);
    });

    it('lista backups', async () => {
      mockearAdmin();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM backups')) return mockResolve([
          { id: 'b1', filename: 'manual_2026-05-21.dump', size_bytes: 1024, tipo: 'manual', estado: 'completado', created_at: new Date(), created_by_username: 'ADMIN' },
        ]);
        if (sql.includes('SELECT COUNT(*)')) return mockResolve([{ count: '1' }]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/config/backups').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('backups');
      expect(res.body).toHaveProperty('total');
    });
  });

  describe('GET /config/backups/config', () => {
    it('obtiene configuracion de backups', async () => {
      mockearAdmin();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM config_backup')) return mockResolve([{ id: 1, schedule_activo: false, retention_dias: 30 }]);
        return mockResolve([]);
      });
      const res = await request(app).get('/api/config/backups/config').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
    });
  });

  describe('PUT /config/backups/config', () => {
    it('guarda configuracion', async () => {
      mockearAdmin();
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('UPDATE config_backup')) return mockResolve([{ id: 1, schedule_activo: true, retention_dias: 15 }]);
        return mockResolve([]);
      });
      const res = await request(app)
        .put('/api/config/backups/config')
        .set('Authorization', TOKEN)
        .send({ schedule_activo: true, schedule_tipo: 'diario', schedule_hora: '03:00', retention_dias: 15 });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /config/backups/limpiar', () => {
    it('limpia backups antiguos', async () => {
      mockearAdmin();
      let llamada = 0;
      mockQuery.mockImplementation((sql) => {
        if (sql.includes('FROM usuarios WHERE')) return mockResolve([{ id: 'u-admin', username: 'ADMIN', nombre_completo: 'Admin', email: 'a@a.com', rol_id: 'r-admin', local_id: null, activo: true }]);
        if (sql.includes('SELECT permisos FROM roles')) return mockResolve([{ permisos: { admin: true } }]);
        if (sql.includes("permisos->>'admin'")) return mockResolve([{ admin: 'true' }]);
        if (sql.includes('FROM config_backup')) return mockResolve([{ retention_dias: 30 }]);
        if (sql.includes('FROM backups')) return mockResolve([
          { id: 'b1', filename: 'viejo.dump', ruta_local: '/backups/viejo.dump' },
        ]);
        if (sql.includes('DELETE FROM backups')) return mockResolve([]);
        return mockResolve([]);
      });
      const res = await request(app).post('/api/config/backups/limpiar').set('Authorization', TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok');
    });
  });
});
