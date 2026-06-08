-- 015_pedidos_web_venta_link.sql — Vínculo entre pedido web y venta interna

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pedidos_web' AND column_name = 'venta_id'
  ) THEN
    ALTER TABLE pedidos_web ADD COLUMN venta_id UUID REFERENCES ventas(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pedidos_web' AND column_name = 'usuario_confirmo_id'
  ) THEN
    ALTER TABLE pedidos_web ADD COLUMN usuario_confirmo_id UUID REFERENCES usuarios(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pedidos_web' AND column_name = 'confirmado_at'
  ) THEN
    ALTER TABLE pedidos_web ADD COLUMN confirmado_at TIMESTAMPTZ;
  END IF;
END;
$$;
