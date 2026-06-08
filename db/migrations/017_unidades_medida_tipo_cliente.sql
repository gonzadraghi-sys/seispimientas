-- =====================================================
-- 017 — Tabla unidades_medida + tipo en clientes
-- =====================================================

-- 1. Tabla de unidades de medida
CREATE TABLE IF NOT EXISTS unidades_medida (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre     VARCHAR(50) NOT NULL UNIQUE,
  simbolo    VARCHAR(10),
  activa     BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Columna tipo en clientes (minorista / mayorista)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo VARCHAR(20)
  DEFAULT 'minorista'
  CHECK (tipo IN ('minorista', 'mayorista'));

-- 3. Seed de unidades de medida básicas
INSERT INTO unidades_medida (nombre, simbolo) VALUES
  ('kilogramo', 'kg'),
  ('gramo',     'gr'),
  ('unidad',    'un'),
  ('pack',      'pack'),
  ('caja',      'caja'),
  ('litro',     'l'),
  ('mililitro', 'ml'),
  ('docena',    'doc'),
  ('porción',   'porc')
ON CONFLICT (nombre) DO NOTHING;
