-- Script para corregir las categorías de los horarios
-- La categoría debe coincidir con el rango ano_min - ano_max

-- Actualizar categorías basándose en los rangos reales
UPDATE horarios
SET categoria = CONCAT(ano_min, '-', ano_max)
WHERE ano_min IS NOT NULL 
  AND ano_max IS NOT NULL
  AND (
    categoria IS NULL 
    OR categoria != CONCAT(ano_min, '-', ano_max)
  );

-- Verificar las actualizaciones
SELECT 
  horario_id,
  dia,
  hora_inicio,
  categoria AS categoria_actualizada,
  ano_min,
  ano_max,
  CONCAT(ano_min, '-', ano_max) AS deberia_ser
FROM horarios
WHERE estado = 'activo'
ORDER BY dia, hora_inicio;
