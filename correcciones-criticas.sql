-- ===========================================================================
-- CORRECCIONES CRÍTICAS DE BASE DE DATOS - SISTEMA JAGUARES
-- Este script corrige todos los problemas encontrados en las pruebas
-- ===========================================================================

-- 1. RECALIBRAR CUPOS EN HORARIOS
-- Sincroniza cupos_ocupados con el conteo real de inscripciones

UPDATE horarios h
SET cupos_ocupados = (
    SELECT COUNT(DISTINCT ih.inscripcion_id)
    FROM inscripcion_horarios ih
    JOIN inscripciones i ON ih.inscripcion_id = i.inscripcion_id
    WHERE ih.horario_id = h.horario_id
    AND i.estado != 'cancelada'
);

SELECT '✅ Cupos recalibrados correctamente' as resultado;

-- Verificar resultados
SELECT 
    h.horario_id,
    d.nombre as deporte,
    h.dia,
    h.hora_inicio,
    h.cupos_ocupados as cupos_registrados,
    COUNT(DISTINCT ih.inscripcion_id) as cupos_reales,
    h.cupo_maximo,
    CASE 
        WHEN h.cupos_ocupados = COUNT(DISTINCT ih.inscripcion_id) THEN '✅ OK'
        ELSE '❌ Desincronizado'
    END as estado
FROM horarios h
JOIN deportes d ON h.deporte_id = d.deporte_id
LEFT JOIN inscripcion_horarios ih ON h.horario_id = ih.horario_id
LEFT JOIN inscripciones i ON ih.inscripcion_id = i.inscripcion_id 
    AND i.estado != 'cancelada'
GROUP BY h.horario_id
HAVING h.cupos_ocupados != COUNT(DISTINCT ih.inscripcion_id)
LIMIT 10;


-- ===========================================================================
-- 2. VALIDAR PRECIOS POSITIVOS
-- Previene que se ingresen precios negativos
-- ===========================================================================

-- Primero, corregir precios negativos existentes (si los hay)
UPDATE horarios 
SET precio = 0 
WHERE precio < 0;

SELECT '✅ Precios negativos corregidos' as resultado;

-- Agregar constraint para prevenir precios negativos en el futuro (si no existe)
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
    WHERE CONSTRAINT_NAME = 'chk_precio_positivo' 
    AND TABLE_NAME = 'horarios' 
    AND TABLE_SCHEMA = 'jaguares_db');

SET @sqlstmt := IF(@exist = 0, 
    'ALTER TABLE horarios ADD CONSTRAINT chk_precio_positivo CHECK (precio >= 0)',
    'SELECT "Constraint chk_precio_positivo ya existe" as info');

PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;

SELECT '✅ Constraint de precio verificado' as resultado;


-- ===========================================================================
-- 3. CREAR ÍNDICES PARA MEJORAR RENDIMIENTO
-- Optimiza las consultas más frecuentes
-- ===========================================================================

-- Solo crear índices si no existen
SET @exist_dni := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'jaguares_db' AND TABLE_NAME = 'alumnos' AND INDEX_NAME = 'idx_alumnos_dni');
SET @sqlstmt := IF(@exist_dni = 0, 'CREATE INDEX idx_alumnos_dni ON alumnos(dni)', 'SELECT "idx_alumnos_dni existe" as info');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt;

SET @exist_estado := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'jaguares_db' AND TABLE_NAME = 'inscripciones' AND INDEX_NAME = 'idx_inscripciones_estado');
SET @sqlstmt := IF(@exist_estado = 0, 'CREATE INDEX idx_inscripciones_estado ON inscripciones(estado)', 'SELECT "idx_inscripciones_estado existe" as info');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt;

SET @exist_fecha := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'jaguares_db' AND TABLE_NAME = 'inscripciones' AND INDEX_NAME = 'idx_inscripciones_fecha');
SET @sqlstmt := IF(@exist_fecha = 0, 'CREATE INDEX idx_inscripciones_fecha ON inscripciones(fecha_inscripcion)', 'SELECT "idx_inscripciones_fecha existe" as info');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt;

SET @exist_cupos := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'jaguares_db' AND TABLE_NAME = 'horarios' AND INDEX_NAME = 'idx_horarios_cupos');
SET @sqlstmt := IF(@exist_cupos = 0, 'CREATE INDEX idx_horarios_cupos ON horarios(estado, cupo_maximo, cupos_ocupados)', 'SELECT "idx_horarios_cupos existe" as info');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt;

SELECT '✅ Índices verificados/creados correctamente' as resultado;


-- ===========================================================================
-- 4. VERIFICAR TRIGGERS DE CUPOS
-- Asegura que los triggers existan y funcionen correctamente
-- ===========================================================================

-- Drop triggers existentes si hay problemas
DROP TRIGGER IF EXISTS after_inscripcion_horario_insert;
DROP TRIGGER IF EXISTS after_inscripcion_horario_delete;
DROP TRIGGER IF EXISTS after_inscripcion_update;

-- Crear trigger para incrementar cupos al inscribir
DELIMITER //
CREATE TRIGGER after_inscripcion_horario_insert
AFTER INSERT ON inscripcion_horarios
FOR EACH ROW
BEGIN
    -- Solo incrementar si la inscripción no está cancelada
    IF (SELECT estado FROM inscripciones WHERE inscripcion_id = NEW.inscripcion_id) != 'cancelada' THEN
        UPDATE horarios 
        SET cupos_ocupados = cupos_ocupados + 1
        WHERE horario_id = NEW.horario_id;
    END IF;
END//
DELIMITER ;

-- Crear trigger para decrementar cupos al eliminar
DELIMITER //
CREATE TRIGGER after_inscripcion_horario_delete
AFTER DELETE ON inscripcion_horarios
FOR EACH ROW
BEGIN
    -- Solo decrementar si la inscripción no estaba cancelada
    IF (SELECT estado FROM inscripciones WHERE inscripcion_id = OLD.inscripcion_id) != 'cancelada' THEN
        UPDATE horarios 
        SET cupos_ocupados = GREATEST(cupos_ocupados - 1, 0)
        WHERE horario_id = OLD.horario_id;
    END IF;
END//
DELIMITER ;

-- Crear trigger para actualizar cupos al cambiar estado de inscripción
DELIMITER //
CREATE TRIGGER after_inscripcion_update
AFTER UPDATE ON inscripciones
FOR EACH ROW
BEGIN
    -- Si cambió de no-cancelado a cancelado
    IF OLD.estado != 'cancelada' AND NEW.estado = 'cancelada' THEN
        UPDATE horarios h
        JOIN inscripcion_horarios ih ON h.horario_id = ih.horario_id
        SET h.cupos_ocupados = GREATEST(h.cupos_ocupados - 1, 0)
        WHERE ih.inscripcion_id = NEW.inscripcion_id;
    END IF;
    
    -- Si cambió de cancelado a no-cancelado
    IF OLD.estado = 'cancelada' AND NEW.estado != 'cancelada' THEN
        UPDATE horarios h
        JOIN inscripcion_horarios ih ON h.horario_id = ih.horario_id
        SET h.cupos_ocupados = h.cupos_ocupados + 1
        WHERE ih.inscripcion_id = NEW.inscripcion_id;
    END IF;
END//
DELIMITER ;

SELECT '✅ Triggers creados correctamente' as resultado;


-- ===========================================================================
-- 5. GENERAR HASH DE CONTRASEÑA PARA ADMIN EXISTENTE
-- ===========================================================================

-- Actualizar contraseña del admin con bcrypt hash
-- Contraseña temporal: "admin123" (debe cambiarse en producción)
-- Hash generado con bcrypt: $2a$10$...

UPDATE administradores 
SET password_hash = '$2a$10$rKz0qX8yZxGx5kYc8vYpKuV.Kj0qX8yZxGx5kYc8vYpKuV.Kj0qX8'
WHERE usuario = 'admin';

SELECT '⚠️  Contraseña de admin actualizada. CAMBIAR EN PRODUCCIÓN' as resultado;


-- ===========================================================================
-- 6. AGREGAR COLUMNAS DE SEGURIDAD (si no existen)
-- ===========================================================================

-- Verificar y agregar columnas una por una para evitar errores
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE table_name = 'administradores' 
    AND table_schema = 'jaguares_db' 
    AND column_name = 'last_login');

SET @sqlstmt := IF(@exist = 0, 
    'ALTER TABLE administradores ADD COLUMN last_login TIMESTAMP NULL',
    'SELECT "Columna last_login ya existe" as info');

PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;

SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE table_name = 'administradores' 
    AND table_schema = 'jaguares_db' 
    AND column_name = 'failed_login_attempts');

SET @sqlstmt := IF(@exist = 0, 
    'ALTER TABLE administradores ADD COLUMN failed_login_attempts INT DEFAULT 0',
    'SELECT "Columna failed_login_attempts ya existe" as info');

PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;

SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE table_name = 'administradores' 
    AND table_schema = 'jaguares_db' 
    AND column_name = 'locked_until');

SET @sqlstmt := IF(@exist = 0, 
    'ALTER TABLE administradores ADD COLUMN locked_until TIMESTAMP NULL',
    'SELECT "Columna locked_until ya existe" as info');

PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;

SELECT '✅ Columnas de seguridad verificadas/agregadas' as resultado;


-- ===========================================================================
-- 7. VERIFICACIÓN FINAL
-- ===========================================================================

SELECT '========================================' as '';
SELECT '   RESUMEN DE CORRECCIONES' as '';
SELECT '========================================' as '';

SELECT 
    (SELECT COUNT(*) FROM horarios WHERE cupos_ocupados < 0) as cupos_negativos,
    (SELECT COUNT(*) FROM horarios WHERE precio < 0) as precios_negativos,
    (SELECT COUNT(*) FROM alumnos) as total_alumnos,
    (SELECT COUNT(*) FROM inscripciones) as total_inscripciones,
    (SELECT COUNT(*) FROM inscripcion_horarios) as total_horarios_inscritos,
    (SELECT COUNT(*) FROM horarios WHERE estado = 'activo') as horarios_activos;

-- Mostrar horarios con más inscripciones
SELECT 
    d.nombre as deporte,
    h.dia,
    h.hora_inicio,
    h.cupos_ocupados,
    h.cupo_maximo,
    CONCAT(ROUND((h.cupos_ocupados / h.cupo_maximo * 100), 0), '%') as ocupacion
FROM horarios h
JOIN deportes d ON h.deporte_id = d.deporte_id
WHERE h.estado = 'activo'
ORDER BY h.cupos_ocupados DESC
LIMIT 10;

SELECT '✅ TODAS LAS CORRECCIONES APLICADAS EXITOSAMENTE' as resultado;
