-- ══════════════════════════════════════════════════════════
--  SEIS PIMIENTAS · SCHEMA COMPLETO PostgreSQL
--  Multi-local, multi-provincia, escalable a nacional
-- ══════════════════════════════════════════════════════════

-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Extensión para cifrado de columnas sensibles
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ──────────────────────────────────────────
--  PROVINCIAS
-- ──────────────────────────────────────────
CREATE TABLE provincias (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(100) NOT NULL,
  responsable VARCHAR(150),
  activa      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  LOCALES (multi-tenant base)
-- ──────────────────────────────────────────
CREATE TABLE locales (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(150) NOT NULL,
  tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('fabrica','local','deposito')),
  provincia_id    UUID REFERENCES provincias(id),
  direccion       VARCHAR(255),
  telefono        VARCHAR(50),
  encargado       VARCHAR(150),
  lista_precios   VARCHAR(50) DEFAULT 'base',
  activo          BOOLEAN DEFAULT TRUE,
  lat             DECIMAL(10,8),  -- para GPS
  lng             DECIMAL(11,8),  -- para GPS
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  ROLES
-- ──────────────────────────────────────────
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  -- permisos como JSON: { "stock": true, "produccion": true, ... }
  permisos    JSONB NOT NULL DEFAULT '{}',
  es_sistema  BOOLEAN DEFAULT FALSE,  -- roles predefinidos no se pueden borrar
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  USUARIOS
-- ──────────────────────────────────────────
CREATE TABLE usuarios (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username        VARCHAR(50) NOT NULL UNIQUE,
  -- password hasheado con bcrypt(12) — NUNCA texto plano
  password_hash   VARCHAR(255) NOT NULL,
  nombre_completo VARCHAR(150),
  email           VARCHAR(255) UNIQUE,
  telefono        VARCHAR(50),
  rol_id          UUID NOT NULL REFERENCES roles(id),
  -- NULL = acceso global (admin/gerente general)
  local_id        UUID REFERENCES locales(id),
  activo          BOOLEAN DEFAULT TRUE,
  ultimo_acceso   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  REFRESH TOKENS (para renovar JWT)
-- ──────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token       VARCHAR(500) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revocado    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  LOG DE ACCESOS (auditoría completa)
-- ──────────────────────────────────────────
CREATE TABLE log_accesos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID REFERENCES usuarios(id),
  username    VARCHAR(50),             -- guardamos el username por si se borra el usuario
  accion      VARCHAR(50) NOT NULL,    -- 'login', 'logout', 'login_failed', 'token_refresh'
  modulo      VARCHAR(100),
  descripcion TEXT,
  ip          INET,
  user_agent  TEXT,
  local_id    UUID REFERENCES locales(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  CATEGORÍAS DE PRODUCTOS
-- ──────────────────────────────────────────
CREATE TABLE categorias (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activa      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  PRODUCTOS
-- ──────────────────────────────────────────
CREATE TABLE productos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(200) NOT NULL,
  categoria_id    UUID REFERENCES categorias(id),
  unidad_medida   VARCHAR(20) DEFAULT 'kg',
  cantidad_por_unidad DECIMAL(10,3) DEFAULT 1,
  costo_produccion DECIMAL(12,2),
  descripcion     TEXT,
  activo          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  LISTAS DE PRECIOS
-- ──────────────────────────────────────────
CREATE TABLE listas_precios (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(150) NOT NULL,
  tipo        VARCHAR(30) CHECK (tipo IN ('base','local','mayorista','promocional','especial')),
  ajuste_pct  DECIMAL(5,2) DEFAULT 0,   -- % sobre la lista base
  local_id    UUID REFERENCES locales(id),  -- NULL = global
  vigencia_desde DATE,
  vigencia_hasta DATE,
  activa      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  PRECIOS (producto x lista)
-- ──────────────────────────────────────────
CREATE TABLE precios (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  lista_id        UUID NOT NULL REFERENCES listas_precios(id),
  precio          DECIMAL(12,2) NOT NULL,
  usuario_id      UUID REFERENCES usuarios(id),  -- quién lo modificó
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(producto_id, lista_id)
);

-- ──────────────────────────────────────────
--  HISTORIAL DE PRECIOS (trazabilidad)
-- ──────────────────────────────────────────
CREATE TABLE historial_precios (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  lista_id        UUID NOT NULL REFERENCES listas_precios(id),
  precio_anterior DECIMAL(12,2),
  precio_nuevo    DECIMAL(12,2) NOT NULL,
  usuario_id      UUID REFERENCES usuarios(id),
  motivo          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  STOCK (por local)
-- ──────────────────────────────────────────
CREATE TABLE stock (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  local_id        UUID NOT NULL REFERENCES locales(id),
  cantidad        DECIMAL(10,3) DEFAULT 0,
  stock_minimo    DECIMAL(10,3) DEFAULT 0,
  stock_critico   DECIMAL(10,3) DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(producto_id, local_id)
);

-- ──────────────────────────────────────────
--  MOVIMIENTOS DE STOCK (trazabilidad)
-- ──────────────────────────────────────────
CREATE TABLE movimientos_stock (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  local_id        UUID NOT NULL REFERENCES locales(id),
  tipo            VARCHAR(30) NOT NULL CHECK (tipo IN (
                    'entrada','salida','ajuste','transferencia_entrada',
                    'transferencia_salida','produccion','venta')),
  cantidad        DECIMAL(10,3) NOT NULL,
  cantidad_antes  DECIMAL(10,3),
  cantidad_despues DECIMAL(10,3),
  referencia_id   UUID,   -- ID de la orden/transferencia relacionada
  usuario_id      UUID REFERENCES usuarios(id),
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  ÓRDENES DE FABRICACIÓN
-- ──────────────────────────────────────────
CREATE TABLE ordenes_fabricacion (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL UNIQUE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  local_destino   UUID NOT NULL REFERENCES locales(id),
  cantidad_pedida DECIMAL(10,3) NOT NULL,
  cantidad_real   DECIMAL(10,3),    -- puede diferir al completarse
  estado          VARCHAR(30) NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','aprobada','en_produccion',
                                    'control_calidad','completada','cancelada')),
  prioridad       VARCHAR(20) DEFAULT 'normal' CHECK (prioridad IN ('normal','alta','urgente')),
  solicitado_por  UUID REFERENCES usuarios(id),
  aprobado_por    UUID REFERENCES usuarios(id),
  notas           TEXT,
  motivo_cancelacion TEXT,
  fecha_aprobacion   TIMESTAMPTZ,
  fecha_inicio       TIMESTAMPTZ,
  fecha_completado   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  TRANSFERENCIAS ENTRE LOCALES
-- ──────────────────────────────────────────
CREATE TABLE transferencias (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  local_origen    UUID NOT NULL REFERENCES locales(id),
  local_destino   UUID NOT NULL REFERENCES locales(id),
  cantidad        DECIMAL(10,3) NOT NULL,
  estado          VARCHAR(20) DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','en_transito','completada','cancelada')),
  solicitado_por  UUID REFERENCES usuarios(id),
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  PEDIDOS / ENTREGAS (logística)
-- ──────────────────────────────────────────
CREATE TABLE pedidos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero              SERIAL UNIQUE,
  local_destino       UUID NOT NULL REFERENCES locales(id),
  repartidor_id       UUID REFERENCES usuarios(id),
  estado              VARCHAR(30) DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente','en_ruta','entregado','problema','cancelado')),
  -- código de confirmación de 4 dígitos — cifrado en tránsito
  codigo_confirmacion VARCHAR(10),
  confirmado          BOOLEAN DEFAULT FALSE,
  confirmado_at       TIMESTAMPTZ,
  -- GPS tracking
  lat_actual          DECIMAL(10,8),
  lng_actual          DECIMAL(11,8),
  ultima_ubicacion_at TIMESTAMPTZ,
  notas               TEXT,
  notas_problema      TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
--  ÍTEMS DE PEDIDOS
-- ──────────────────────────────────────────
CREATE TABLE pedido_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id   UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  cantidad    DECIMAL(10,3) NOT NULL,
  precio_unit DECIMAL(12,2)
);

-- ──────────────────────────────────────────
--  ÍNDICES para performance
-- ──────────────────────────────────────────
CREATE INDEX idx_stock_local         ON stock(local_id);
CREATE INDEX idx_stock_producto       ON stock(producto_id);
CREATE INDEX idx_mov_stock_local      ON movimientos_stock(local_id);
CREATE INDEX idx_mov_stock_fecha      ON movimientos_stock(created_at);
CREATE INDEX idx_ordenes_estado       ON ordenes_fabricacion(estado);
CREATE INDEX idx_ordenes_destino      ON ordenes_fabricacion(local_destino);
CREATE INDEX idx_pedidos_estado       ON pedidos(estado);
CREATE INDEX idx_pedidos_repartidor   ON pedidos(repartidor_id);
CREATE INDEX idx_log_usuario          ON log_accesos(usuario_id);
CREATE INDEX idx_log_fecha            ON log_accesos(created_at);
CREATE INDEX idx_refresh_token        ON refresh_tokens(token);
CREATE INDEX idx_usuarios_username    ON usuarios(username);

-- ──────────────────────────────────────────
--  FUNCIÓN: actualizar updated_at automático
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a tablas con updated_at
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['provincias','locales','roles','usuarios',
  'productos','listas_precios','stock','ordenes_fabricacion','transferencias','pedidos'])
LOOP EXECUTE format('CREATE TRIGGER trg_%s_updated_at
  BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
END LOOP; END $$;
