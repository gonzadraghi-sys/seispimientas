-- ══════════════════════════════════════════
--  SEIS PIMIENTAS · HISTORIAL DE UBICACIONES
--  ══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ubicaciones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  latitud     DECIMAL(10,8) NOT NULL,
  longitud    DECIMAL(11,8) NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ubicaciones_usuario   ON ubicaciones(usuario_id);
CREATE INDEX idx_ubicaciones_timestamp  ON ubicaciones(timestamp DESC);
