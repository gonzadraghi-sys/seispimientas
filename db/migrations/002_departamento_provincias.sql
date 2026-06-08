-- ══════════════════════════════════════════════════════════
--  MIGRACIÓN 002 · Departamento en locales + seed provincias
-- ══════════════════════════════════════════════════════════

-- 1. Agregar columna departamento a locales (si no existe)
ALTER TABLE locales
  ADD COLUMN IF NOT EXISTS departamento VARCHAR(150);

-- 2. Seed de las 24 provincias/jurisdicciones de Argentina
--    Inserta solo las que no existen todavía (evita duplicados)
INSERT INTO provincias (nombre, activa)
SELECT v.nombre, true
FROM (VALUES
  ('Buenos Aires'),
  ('Ciudad Autónoma de Buenos Aires'),
  ('Catamarca'),
  ('Chaco'),
  ('Chubut'),
  ('Córdoba'),
  ('Corrientes'),
  ('Entre Ríos'),
  ('Formosa'),
  ('Jujuy'),
  ('La Pampa'),
  ('La Rioja'),
  ('Mendoza'),
  ('Misiones'),
  ('Neuquén'),
  ('Río Negro'),
  ('Salta'),
  ('San Juan'),
  ('San Luis'),
  ('Santa Cruz'),
  ('Santa Fe'),
  ('Santiago del Estero'),
  ('Tierra del Fuego, Antártida e Islas del Atlántico Sur'),
  ('Tucumán')
) AS v(nombre)
WHERE NOT EXISTS (
  SELECT 1 FROM provincias WHERE LOWER(nombre) = LOWER(v.nombre)
);
