-- ══════════════════════════════════════════════════════════
--  MIGRACIÓN 003 · Seed de productos reales Seis Pimientas
-- ══════════════════════════════════════════════════════════

-- 1. Agregar columna categoria si no existe
ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria VARCHAR(100);

-- 2. Insertar productos (solo los que no existen)
INSERT INTO productos (nombre, categoria, unidad_medida, activo)
SELECT v.nombre, v.categoria, v.unidad_medida, true
FROM (VALUES
  ('Sorrentinos Jamon Y Muzzarella',                         'Sorrentinos',   'pack'),
  ('Sorrentinos Calabaza Y Muzzarella',                      'Sorrentinos',   'pack'),
  ('Sorrentinos 4 Quesos Con Roquefort',                     'Sorrentinos',   'pack'),
  ('Sorrentinos Capresse',                                   'Sorrentinos',   'pack'),
  ('Sorrentinos 4 Quesos',                                   'Sorrentinos',   'pack'),
  ('Sorrentinos Ricota Y Nuez',                              'Sorrentinos',   'pack'),
  ('Sorrentinos Ricota Jamon',                               'Sorrentinos',   'pack'),
  ('Sorrentinos Verdura',                                    'Sorrentinos',   'pack'),
  ('Sorrentinos Verdura Y Nuez',                             'Sorrentinos',   'pack'),
  ('Sorrentinos Calabaza Muzzarella Y Roquefort',            'Sorrentinos',   'pack'),
  ('Sorrentinos Osobuco Braseado Al Malbec',                 'Sorrentinos',   'pack'),
  ('Sorrentinos Jamon Crudo Rucula Y Parmesano',             'Sorrentinos',   'pack'),
  ('Sorrentinos Salmon Blanco Y Rosado Con Tinta De Calamar','Sorrentinos',   'pack'),
  ('Sorrentinos Panceta Esparragos Y Parmesano',             'Sorrentinos',   'pack'),
  ('Ravioles Carne Braseada',                                'Ravioles',      'pack'),
  ('Ravioles Cerdo Braseado',                                'Ravioles',      'pack'),
  ('Ravioles Pollo Braseado',                                'Ravioles',      'pack'),
  ('Ravioles Verdura',                                       'Ravioles',      'pack'),
  ('Ravioles Ricota Y Nuez',                                 'Ravioles',      'pack'),
  ('Ravioles Calabaza Y Muzzarella',                         'Ravioles',      'pack'),
  ('Ravioles Ricota Y Jamon',                                'Ravioles',      'pack'),
  ('Noqui Papa',                                             'Noquis',        'pack'),
  ('Noqui Espinaca',                                         'Noquis',        'pack'),
  ('Tallarines',                                             'Pastas Largas', 'pack'),
  ('Tallarines Espinaca',                                    'Pastas Largas', 'pack'),
  ('Mix De Tallarines',                                      'Pastas Largas', 'pack'),
  ('Tallarines Morron',                                      'Pastas Largas', 'pack'),
  ('Spaghetti',                                              'Pastas Largas', 'pack'),
  ('Spaghetti Espinaca',                                     'Pastas Largas', 'pack'),
  ('Mix De Spaghetti',                                       'Pastas Largas', 'pack'),
  ('Papardelle',                                             'Pastas Largas', 'pack'),
  ('Papardelle Espinaca',                                    'Pastas Largas', 'pack'),
  ('Papardelle Morron',                                      'Pastas Largas', 'pack'),
  ('Mix De Papardelle',                                      'Pastas Largas', 'pack'),
  ('Salsa Filetto',                                          'Salsas',        'pack'),
  ('Salsa Bolognesa',                                        'Salsas',        'pack'),
  ('Salsa Blanca Y Crema',                                   'Salsas',        'pack'),
  ('Salsa Con Albondigas',                                   'Salsas',        'pack'),
  ('Queso Rallado Reggianito',                               'Quesos',        'pack'),
  ('Lasagna Jamon Y Queso Con Salsa Bolognesa',              'Lasagna',       'pack'),
  ('Lasagna Jamon Y Queso Con Salsa Filetto',                'Lasagna',       'pack'),
  ('Lasagna Jamon Y Queso Con Salsa Blanca Y Crema',         'Lasagna',       'pack')
) AS v(nombre, categoria, unidad_medida)
WHERE NOT EXISTS (
  SELECT 1 FROM productos WHERE LOWER(nombre) = LOWER(v.nombre)
);
