-- Recrear categorías con encoding correcto UTF-8
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- Fútbol (deporte_id: 1)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
(1, '2019-2020', 'Categoría 2019-2020 (4-5 años)', 2019, 2020, 1, 'activo'),
(1, '2017-2018', 'Categoría 2017-2018 (6-7 años)', 2017, 2018, 2, 'activo'),
(1, '2015-2016', 'Categoría 2015-2016 (8-9 años)', 2015, 2016, 3, 'activo'),
(1, '2013-2014', 'Categoría 2013-2014 (10-11 años)', 2013, 2014, 4, 'activo'),
(1, '2011-2012', 'Categoría 2011-2012 (12-13 años)', 2011, 2012, 5, 'activo'),
(1, '2009-2010', 'Categoría 2009-2010 (14-15 años)', 2009, 2010, 6, 'activo');

-- Fútbol Femenino (deporte_id: 2)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
(2, 'Infantil', 'Categoría Infantil (7-10 años)', 2014, 2017, 1, 'activo'),
(2, 'Juvenil', 'Categoría Juvenil (11-14 años)', 2010, 2013, 2, 'activo'),
(2, 'Adolescente', 'Categoría Adolescente (15-17 años)', 2007, 2009, 3, 'activo');

-- Vóley (deporte_id: 3)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
(3, 'Mini', 'Categoría Mini (6-9 años)', 2015, 2018, 1, 'activo'),
(3, 'Pre-Infantil', 'Categoría Pre-Infantil (10-11 años)', 2013, 2014, 2, 'activo'),
(3, 'Infantil', 'Categoría Infantil (12-13 años)', 2011, 2012, 3, 'activo'),
(3, 'Cadete', 'Categoría Cadete (14-15 años)', 2009, 2010, 4, 'activo');

-- MAMAS FIT (deporte_id: 5)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, icono, orden, estado) VALUES
(5, 'adulto +18', 'Categoría adultos mayores de 18 años', 1900, 2008, 'fitness_center', 1, 'activo');

-- ASODE (deporte_id: 10)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
(10, '2009-2010', 'Categoría 2009-2010', 2009, 2010, 1, 'activo'),
(10, '2011-2012', 'Categoría 2011-2012', 2011, 2012, 2, 'activo'),
(10, '2012-2013', 'Categoría 2012-2013', 2012, 2013, 3, 'activo'),
(10, '2014', 'Categoría 2014', 2014, 2014, 4, 'activo'),
(10, '2015-2016', 'Categoría 2015-2016', 2015, 2016, 5, 'activo'),
(10, '2017', 'Categoría 2017', 2017, 2017, 6, 'activo');

-- Entrenamiento Funcional Mixto (deporte_id: 11)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, icono, orden, estado) VALUES
(11, 'adulto +18', 'Categoría adultos mayores de 18 años', 1900, 2008, 'fitness_center', 1, 'activo');

-- GYM JUVENIL (deporte_id: 12)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, icono, orden, estado) VALUES
(12, '2005-2009', 'Categoría 2005-2009 juvenil', 2005, 2009, 'sports', 1, 'activo');

-- Básquet (deporte_id: 17)
INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
(17, '2017', 'Categoría 2017', 2017, 2017, 1, 'activo'),
(17, '2015-2016', 'Categoría 2015-2016', 2015, 2016, 2, 'activo'),
(17, '2014', 'Categoría 2014', 2014, 2014, 3, 'activo'),
(17, '2012-2013', 'Categoría 2012-2013', 2012, 2013, 4, 'activo'),
(17, '2011', 'Categoría 2011', 2011, 2011, 5, 'activo'),
(17, '2010-2011', 'Categoría 2010-2011', 2010, 2011, 6, 'activo'),
(17, '2010', 'Categoría 2010', 2010, 2010, 7, 'activo'),
(17, '2009-2008', 'Categoría 2009-2008', 2008, 2009, 8, 'activo'),
(17, '2009', 'Categoría 2009', 2009, 2009, 9, 'activo');
