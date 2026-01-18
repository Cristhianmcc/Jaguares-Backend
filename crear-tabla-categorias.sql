-- Script para crear tabla de categorías asociadas a deportes
-- Ejecutar este script en MySQL

USE jaguares_db;

-- Crear tabla de categorías
CREATE TABLE IF NOT EXISTS categorias (
    categoria_id INT PRIMARY KEY AUTO_INCREMENT,
    deporte_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    ano_min INT,
    ano_max INT,
    icono VARCHAR(50),
    orden INT DEFAULT 0,
    estado ENUM('activo', 'inactivo') DEFAULT 'activo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (deporte_id) REFERENCES deportes(deporte_id) ON DELETE CASCADE,
    UNIQUE KEY unique_deporte_categoria (deporte_id, nombre),
    INDEX idx_deporte (deporte_id),
    INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comentarios de las columnas
ALTER TABLE categorias 
    MODIFY COLUMN nombre VARCHAR(100) NOT NULL COMMENT 'Nombre de la categoría (ej: 2011-2012, Juvenil)',
    MODIFY COLUMN descripcion TEXT COMMENT 'Descripción adicional de la categoría',
    MODIFY COLUMN ano_min INT COMMENT 'Año de nacimiento mínimo permitido',
    MODIFY COLUMN ano_max INT COMMENT 'Año de nacimiento máximo permitido',
    MODIFY COLUMN orden INT DEFAULT 0 COMMENT 'Orden de visualización (menor primero)';

-- Agregar índice para búsquedas por rango de edad
ALTER TABLE categorias 
    ADD INDEX idx_rango_edad (ano_min, ano_max);

-- Insertar categorías de ejemplo para los deportes existentes
-- Nota: Ajusta los deporte_id según tu base de datos

-- Categorías para Fútbol (asumiendo deporte_id = 1)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden) VALUES
(1, '2019-2020', 'Categoría 2019-2020 (4-5 años)', 2019, 2020, 1),
(1, '2017-2018', 'Categoría 2017-2018 (6-7 años)', 2017, 2018, 2),
(1, '2015-2016', 'Categoría 2015-2016 (8-9 años)', 2015, 2016, 3),
(1, '2013-2014', 'Categoría 2013-2014 (10-11 años)', 2013, 2014, 4),
(1, '2011-2012', 'Categoría 2011-2012 (12-13 años)', 2011, 2012, 5),
(1, '2009-2010', 'Categoría 2009-2010 (14-15 años)', 2009, 2010, 6)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Categorías para Vóley (asumiendo deporte_id = 2)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden) VALUES
(2, 'Infantil', 'Categoría Infantil (7-10 años)', 2014, 2017, 1),
(2, 'Juvenil', 'Categoría Juvenil (11-14 años)', 2010, 2013, 2),
(2, 'Adolescente', 'Categoría Adolescente (15-17 años)', 2007, 2009, 3)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Categorías para Básquet (asumiendo deporte_id = 3)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden) VALUES
(3, 'Mini', 'Categoría Mini (6-9 años)', 2015, 2018, 1),
(3, 'Pre-Infantil', 'Categoría Pre-Infantil (10-11 años)', 2013, 2014, 2),
(3, 'Infantil', 'Categoría Infantil (12-13 años)', 2011, 2012, 3),
(3, 'Cadete', 'Categoría Cadete (14-15 años)', 2009, 2010, 4)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Mostrar categorías creadas
SELECT 
    c.categoria_id,
    d.nombre as deporte,
    c.nombre as categoria,
    c.ano_min,
    c.ano_max,
    c.estado
FROM categorias c
INNER JOIN deportes d ON c.deporte_id = d.deporte_id
ORDER BY d.nombre, c.orden;

-- Verificación de la estructura
DESCRIBE categorias;
