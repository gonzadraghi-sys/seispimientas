-- Agregar columna schedule_dias para seleccion de dias especificos
ALTER TABLE config_backup ADD COLUMN IF NOT EXISTS schedule_dias INTEGER[] DEFAULT '{}';
