-- 012_clientes.sql — Tabla de clientes web (e-commerce)
-- Requiere: uuid-ossp extension ya habilitada

CREATE TABLE IF NOT EXISTS clientes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre        VARCHAR(150) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  telefono      VARCHAR(50),
  password_hash VARCHAR(255) NOT NULL,
  direccion     TEXT,
  ciudad        VARCHAR(100),
  provincia     VARCHAR(100),
  codigo_postal VARCHAR(20),
  activo        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clientes_updated_at'
  ) THEN
    CREATE TRIGGER trg_clientes_updated_at
      BEFORE UPDATE ON clientes
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;
