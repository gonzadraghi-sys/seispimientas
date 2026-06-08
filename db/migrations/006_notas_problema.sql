-- ══════════════════════════════════════════════════════════
--  SEIS PIMIENTAS · Agregar columna notas_problema a pedidos
-- ══════════════════════════════════════════════════════════

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS notas_problema TEXT;
