-- ══════════════════════════════════════════════════════════
--  SEIS PIMIENTAS · cantidad_por_unidad en productos
-- ══════════════════════════════════════════════════════════

ALTER TABLE productos ADD COLUMN IF NOT EXISTS cantidad_por_unidad DECIMAL(10,3) DEFAULT 1;
