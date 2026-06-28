-- 018_mfa.sql — Autenticación de 2 Factores (TOTP)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'mfa_secret'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN mfa_secret VARCHAR(100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'mfa_enabled'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'mfa_backup_codes'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN mfa_backup_codes TEXT[];
  END IF;
END;
$$;
