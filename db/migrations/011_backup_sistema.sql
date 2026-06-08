-- Migration 011: Backup completo del sistema + multi-remote

-- ── 1. Columna tipo_backup en backups ─────────────────────────
ALTER TABLE backups ADD COLUMN IF NOT EXISTS tipo_backup VARCHAR(20) DEFAULT 'db';
ALTER TABLE backups ADD COLUMN IF NOT EXISTS ambito VARCHAR(20) DEFAULT NULL;
ALTER TABLE backups ADD COLUMN IF NOT EXISTS remote_id UUID DEFAULT NULL;
ALTER TABLE backups ADD COLUMN IF NOT EXISTS tamano_bytes BIGINT DEFAULT 0;

-- ── 2. Tabla de remotos (multi-remote) ────────────────────────
CREATE TABLE IF NOT EXISTS backup_remotes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(100) NOT NULL,
  proveedor     VARCHAR(50) NOT NULL,
  remote_rclone VARCHAR(255) NOT NULL,
  ruta_destino  VARCHAR(500) DEFAULT '',
  es_default    BOOLEAN DEFAULT false,
  activo        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Solo un default
CREATE UNIQUE INDEX IF NOT EXISTS idx_remotes_unico_default
  ON backup_remotes (es_default) WHERE es_default = true;

-- ── 3. Migrar remotes existentes a la nueva tabla ─────────────
INSERT INTO backup_remotes (nombre, proveedor, remote_rclone, ruta_destino, es_default, activo)
SELECT
  COALESCE(c.cloud_config->>'remote', c.cloud_proveedor, 'Migrado'),
  COALESCE(c.cloud_proveedor, ''),
  COALESCE(c.cloud_config->>'remote', c.cloud_proveedor, ''),
  COALESCE(c.cloud_config->>'ruta', 'seispimientas-backups'),
  true,
  true
FROM config_backup c
WHERE c.cloud_proveedor IS NOT NULL AND c.cloud_proveedor != ''
ON CONFLICT DO NOTHING;

-- ── 4. Columna para carpetas incluidas en backup de sistema ──
ALTER TABLE config_backup ADD COLUMN IF NOT EXISTS carpetas_sistema JSONB DEFAULT '["src","db","config"]';
ALTER TABLE config_backup ADD COLUMN IF NOT EXISTS ambito_backup VARCHAR(20) DEFAULT 'api';
