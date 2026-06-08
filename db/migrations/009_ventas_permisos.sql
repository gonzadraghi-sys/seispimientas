-- Agregar permisos de ventas a roles existentes
-- Roles con admin=true ya pasan todos los checks automaticamente

-- Administrador
UPDATE roles SET permisos = permisos || '{"ventas_ver": true, "ventas_crear": true}'::jsonb WHERE nombre = 'Administrador';

-- Gerente de Local
UPDATE roles SET permisos = permisos || '{"ventas_ver": true, "ventas_crear": true}'::jsonb WHERE nombre = 'Gerente de Local';

-- Gerente General
UPDATE roles SET permisos = permisos || '{"ventas_ver": true, "ventas_crear": true}'::jsonb WHERE nombre = 'Gerente General';

-- Vendedor
UPDATE roles SET permisos = permisos || '{"ventas_ver": true, "ventas_crear": true}'::jsonb WHERE nombre = 'Vendedor';

-- vendedor (estilo verbo) — ya tiene ventas_crear
UPDATE roles SET permisos = permisos || '{"ventas_ver": true}'::jsonb WHERE nombre = 'vendedor';

-- gerente (estilo verbo)
UPDATE roles SET permisos = permisos || '{"ventas_ver": true, "ventas_crear": true}'::jsonb WHERE nombre = 'gerente';

-- Reportes (solo lectura)
UPDATE roles SET permisos = permisos || '{"ventas_ver": true}'::jsonb WHERE nombre = 'Reportes';

-- Deposito no necesita ventas
