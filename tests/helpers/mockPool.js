// Helpers compartidos para tests con pool mockeado
// Cada test file DEBE llamar jest.mock('pg', ...) antes de importar modulos

const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(() => Promise.resolve({
  query: mockQuery,
  release: mockRelease,
}));

// Factory para crear el mock de pg.Pool
function createMockPool() {
  return {
    Pool: jest.fn(() => ({
      query: mockQuery,
      connect: mockConnect,
      on: jest.fn(),
    })),
  };
}

function resetMocks() {
  mockQuery.mockReset();
  mockConnect.mockClear();
  mockRelease.mockClear();
}

function mockResolve(rows = []) {
  return Promise.resolve({ rows, rowCount: rows.length });
}

function mockReject(message = 'DB error') {
  return Promise.reject(new Error(message));
}

module.exports = {
  mockQuery, mockConnect, mockRelease,
  createMockPool, resetMocks, mockResolve, mockReject,
};
