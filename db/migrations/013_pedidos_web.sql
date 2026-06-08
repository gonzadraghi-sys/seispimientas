-- 013_pedidos_web.sql — Pedidos online (e-commerce)
-- Requiere: tabla clientes (012)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_pedido_web') THEN
    CREATE TYPE estado_pedido_web AS ENUM (
      'pendiente_pago', 'confirmado', 'en_preparacion',
      'enviado', 'entregado', 'cancelado'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS pedidos_web (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero            SERIAL UNIQUE,
  cliente_id        UUID NOT NULL REFERENCES clientes(id),
  total             DECIMAL(12,2) NOT NULL,
  estado            estado_pedido_web NOT NULL DEFAULT 'pendiente_pago',
  metodo_pago       VARCHAR(30) NOT NULL CHECK (metodo_pago IN ('mercadopago', 'transferencia')),
  -- MercadoPago
  mp_preference_id  VARCHAR(100),
  mp_payment_id     VARCHAR(100),
  mp_status         VARCHAR(30),
  mp_status_detail  VARCHAR(100),
  -- Transferencia
  transferencia_datos_bancarios TEXT,
  transferencia_comprobante     TEXT,
  -- Direccion de envio
  direccion_envio   TEXT,
  ciudad_envio      VARCHAR(100),
  provincia_envio   VARCHAR(100),
  codigo_postal_envio VARCHAR(20),
  notas             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_web_cliente ON pedidos_web(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_web_estado  ON pedidos_web(estado);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pedidos_web_updated_at'
  ) THEN
    CREATE TRIGGER trg_pedidos_web_updated_at
      BEFORE UPDATE ON pedidos_web
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;
