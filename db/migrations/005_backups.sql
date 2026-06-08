-- Migration 005: Backups y configuracion

CREATE TABLE IF NOT EXISTS backups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    VARCHAR(255) NOT NULL,
  size_bytes  BIGINT DEFAULT 0,
  tipo        VARCHAR(20) NOT NULL DEFAULT 'manual',
  estado      VARCHAR(20) NOT NULL DEFAULT 'completado',
  ruta_local  TEXT,
  cloud_status VARCHAR(20) DEFAULT 'pendiente',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  UUID REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS config_backup (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  schedule_activo   BOOLEAN DEFAULT false,
  schedule_cron     VARCHAR(100) DEFAULT '',
  schedule_tipo     VARCHAR(20) DEFAULT '',
  schedule_hora     VARCHAR(5) DEFAULT '03:00',
  retention_dias    INTEGER DEFAULT 30,
  cloud_proveedor   VARCHAR(50) DEFAULT '',
  cloud_config      JSONB DEFAULT '{}',
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT one_row CHECK (id = 1)
);

INSERT INTO config_backup (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups (created_at DESC);
