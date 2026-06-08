-- ══════════════════════════════════════════════════════════
--  SEIS PIMIENTAS · Modulo Ventas
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  local_id    UUID NOT NULL REFERENCES locales(id),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id),
  total       DECIMAL(12,2) NOT NULL,
  estado      VARCHAR(20) NOT NULL DEFAULT 'completada'
              CHECK (estado IN ('completada','anulada')),
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venta_detalles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        DECIMAL(10,3) NOT NULL,
  precio_unitario DECIMAL(12,2) NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ventas_local_id    ON ventas(local_id);
CREATE INDEX IF NOT EXISTS idx_ventas_created_at  ON ventas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_venta_detalles_venta_id ON venta_detalles(venta_id);
