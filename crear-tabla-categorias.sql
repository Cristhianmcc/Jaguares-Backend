-- ============================================
-- CREAR TABLA DE CATEGORÍAS (VERSIÓN CORREGIDA)
-- Extrae categorías únicas de los horarios existentes
-- ============================================

SET NAMES utf8mb4;

-- Crear tabla de categorías si no existe
CREATE TABLE IF NOT EXISTS categorias (
    categoria_id INT PRIMARY KEY AUTO_INCREMENT,
    deporte_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    ano_min INT,
    ano_max INT,
    orden INT DEFAULT 0,
    estado ENUM('activo', 'inactivo') DEFAULT 'activo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (deporte_id) REFERENCES deportes(deporte_id) ON DELETE CASCADE,
    UNIQUE KEY unique_categoria_deporte (deporte_id, nombre, ano_min, ano_max),
    INDEX idx_deporte (deporte_id),
    INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Limpiar categorías existentes
DELETE FROM categorias;
ALTER TABLE categorias AUTO_INCREMENT = 1;

-- Insertar categorías únicas extraídas de los horarios
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado)
SELECT DISTINCT
    h.deporte_id,
    h.categoria as nombre,
    CONCAT('Categoría ', h.categoria, ' - ', d.nombre) as descripcion,
    h.ano_min,
    h.ano_max,
    h.ano_min as orden,
    'activo' as estado
FROM horarios h
INNER JOIN deportes d ON h.deporte_id = d.deporte_id
WHERE h.categoria IS NOT NULL
ORDER BY h.deporte_id, h.ano_min;

-- Verificar categorías insertadas
SELECT 
    c.categoria_id,
    d.nombre as deporte,
    c.nombre as categoria,
    CONCAT(c.ano_min, '-', c.ano_max) as rango_años,
    c.estado
FROM categorias c
INNER JOIN deportes d ON c.deporte_id = d.deporte_id
ORDER BY d.nombre, c.orden;

-- Mostrar resumen
SELECT 
    d.nombre as deporte,
    COUNT(c.categoria_id) as total_categorias
FROM deportes d
LEFT JOIN categorias c ON d.deporte_id = c.deporte_id
GROUP BY d.deporte_id, d.nombre
ORDER BY d.deporte_id;
