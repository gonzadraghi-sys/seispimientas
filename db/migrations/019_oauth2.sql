-- 019_oauth2.sql — OAuth 2.0 Server: client apps + authorization codes
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS oauth_clients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       VARCHAR(100) NOT NULL UNIQUE,
  client_secret   VARCHAR(255),  -- NULL para SPAs sin secret (PKCE)
  name            VARCHAR(150) NOT NULL,
  description     TEXT,
  redirect_uris   TEXT[] NOT NULL DEFAULT '{}',
  grant_types     TEXT[] NOT NULL DEFAULT '{"authorization_code","refresh_token"}',
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  logo_url        VARCHAR(500),
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(200) NOT NULL UNIQUE,
  client_id       UUID NOT NULL REFERENCES oauth_clients(id),
  usuario_id      UUID REFERENCES usuarios(id),
  cliente_id      UUID REFERENCES clientes(id),
  redirect_uri    TEXT NOT NULL,
  code_challenge  VARCHAR(200),
  code_challenge_method VARCHAR(10) DEFAULT 'S256',
  scopes          TEXT[] DEFAULT '{}',
  expires_at      TIMESTAMPTZ NOT NULL,
  used            BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_authorization_codes(code);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

-- Trigger para updated_at en oauth_clients
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_oauth_clients_updated_at') THEN
    CREATE TRIGGER trg_oauth_clients_updated_at
      BEFORE UPDATE ON oauth_clients
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;

-- Seed: client para el frontend Admin
INSERT INTO oauth_clients (client_id, name, description, redirect_uris, grant_types, scopes, active)
VALUES (
  'seispimientas-admin',
  'Admin Dashboard',
  'Panel de administración web',
  ARRAY['http://localhost:5173/callback', 'http://localhost:5173'],
  ARRAY['authorization_code', 'refresh_token'],
  ARRAY['admin', 'stock', 'produccion', 'ventas', 'precios', 'logistica', 'usuarios'],
  true
) ON CONFLICT (client_id) DO NOTHING;

-- Seed: client para el Shop
INSERT INTO oauth_clients (client_id, name, description, redirect_uris, grant_types, scopes, active)
VALUES (
  'seispimientas-shop',
  'Shop E-commerce',
  'Tienda online pública',
  ARRAY['http://localhost:5174/callback', 'http://localhost:5174'],
  ARRAY['authorization_code', 'refresh_token'],
  ARRAY['shop', 'clientes'],
  true
) ON CONFLICT (client_id) DO NOTHING;
