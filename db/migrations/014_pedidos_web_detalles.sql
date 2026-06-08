-- 014_pedidos_web_detalles.sql — Detalle de pedidos online

CREATE TABLE IF NOT EXISTS pedidos_web_detalles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id       UUID NOT NULL REFERENCES pedidos_web(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        DECIMAL(10,3) NOT NULL,
  precio_unitario DECIMAL(12,2) NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedidos_web_detalles_pedido ON pedidos_web_detalles(pedido_id);
