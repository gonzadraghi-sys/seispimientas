-- 016_clientes_reset_token.sql — Token para restablecer contraseña
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clientes' AND column_name = 'reset_token'
  ) THEN
    ALTER TABLE clientes ADD COLUMN reset_token VARCHAR(255);
    ALTER TABLE clientes ADD COLUMN reset_token_expires TIMESTAMPTZ;
  END IF;
END;
$$;
