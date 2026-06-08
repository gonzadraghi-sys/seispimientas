-- =====================================================
-- SEIS PIMIENTAS - Inserción de roles y usuario admin
-- =====================================================

-- Extensión pgcrypto necesaria para bcrypt
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- 1. Roles del sistema (si no existen)
-- =====================================================

INSERT INTO roles (id, nombre, descripcion, permisos, es_sistema)
VALUES (
  gen_random_uuid(),
  'admin',
  'Administrador del sistema - acceso total',
  '{"admin": true, "stock_ver": true, "stock_editar": true, "produccion_ver": true, "produccion_crear": true, "precios_ver": true, "precios_editar": true, "logistica_ver": true, "logistica_confirmar": true, "locales_ver": true, "locales_editar": true}',
  true
)
ON CONFLICT (nombre) DO UPDATE SET
  permisos = EXCLUDED.permisos,
  descripcion = EXCLUDED.descripcion,
  updated_at = NOW()
RETURNING *;

INSERT INTO roles (id, nombre, descripcion, permisos, es_sistema)
VALUES (
  gen_random_uuid(),
  'gerente',
  'Gerente de local - puede gestionar su propio local',
  '{"stock_ver": true, "stock_editar": true, "produccion_ver": true, "produccion_crear": true, "precios_ver": true, "precios_editar": true, "logistica_ver": true, "locales_ver": true}',
  true
)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO roles (id, nombre, descripcion, permisos, es_sistema)
VALUES (
  gen_random_uuid(),
  'vendedor',
  'Vendedor - puede ver stock y precios, registrar ventas',
  '{"stock_ver": true, "precios_ver": true, "ventas_crear": true}',
  true
)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO roles (id, nombre, descripcion, permisos, es_sistema)
VALUES (
  gen_random_uuid(),
  'repartidor',
  'Repartidor - actualiza GPS y confirma entregas',
  '{"logistica_ver": true, "logistica_confirmar": true, "gps_actualizar": true}',
  true
)
ON CONFLICT (nombre) DO NOTHING;

-- =====================================================
-- 2. Usuario administrador: GDRAGHI
-- =====================================================
INSERT INTO usuarios (
  id, username, password_hash, nombre_completo, email, rol_id, local_id, activo
)
VALUES (
  gen_random_uuid(),
  'GDRAGHI',
  crypt('theworldismine', gen_salt('bf', 12)),
  'Gabriel Draghetti',
  'gdragghi@seispimientas.com',
  (SELECT id FROM roles WHERE nombre = 'admin'),
  NULL,
  true
)
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  nombre_completo = EXCLUDED.nombre_completo,
  email = EXCLUDED.email,
  activo = true,
  updated_at = NOW()
RETURNING id, username, nombre_completo;

-- Mostrar usuario recién creado
SELECT id, username, nombre_completo, email, activo
FROM usuarios WHERE username = 'GDRAGHI';
