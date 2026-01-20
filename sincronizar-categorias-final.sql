-- Sincronizar categorías finales basadas en la data real de horarios (AWS RDS)
-- IDs de deportes mapeados:
-- 1: Fútbol, 2: Fútbol Femenino, 3: Vóley, 4: Básquet, 5: MAMAS FIT, 6: ASODE, 7: Funcional, 8: GYM JUVENIL

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- TRUNCATE seguro deshabilitando foreign keys temporalmente
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE categorias;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
-- 1: Fútbol
(1, '2011-2012', 'Categoría 2011-2012', 2011, 2012, 10, 'activo'),
(1, '2014-2013', 'Categoría 2013-2014', 2013, 2014, 20, 'activo'),
(1, '2016-2015', 'Categoría 2015-2016', 2015, 2016, 30, 'activo'),
(1, '2009-2010', 'Categoría 2009-2010', 2009, 2010, 40, 'activo'),
(1, '2018-2017', 'Categoría 2017-2018', 2017, 2018, 50, 'activo'),
(1, '2020-2021', 'Categoría 2020-2021', 2020, 2021, 60, 'activo'),
(1, '2019-2020', 'Categoría 2019-2020', 2019, 2020, 70, 'activo'),
(1, '2019', 'Categoría 2019', 2019, 2019, 80, 'activo'),
(1, '2017', 'Categoría 2017', 2017, 2017, 90, 'activo'),
(1, '2016', 'Categoría 2016', 2016, 2016, 100, 'activo'),
(1, '2014', 'Categoría 2014', 2014, 2014, 110, 'activo'),
(1, '2015', 'Categoría 2015', 2015, 2015, 120, 'activo'),
(1, '2013-2014-2015', 'Categoría 2013-2015', 2013, 2015, 130, 'activo'),
(1, '2018-2019', 'Categoría 2018-2019', 2018, 2019, 140, 'activo'),
(1, '2008-2009-2010-2011', 'Categoría 2008-2011', 2008, 2011, 150, 'activo'),
(1, '2017-2016', 'Categoría 2016-2017', 2016, 2017, 160, 'activo'),
(1, '2014-2013-2012', 'Categoría 2012-2014', 2012, 2014, 170, 'activo'),
(1, '2009-2010-2011-2012', 'Categoría 2009-2012', 2009, 2012, 180, 'activo'),
(1, '2008-2009', 'Categoría 2008-2009', 2008, 2009, 190, 'activo'),
(1, '2010-2011', 'Categoría 2010-2011', 2010, 2011, 200, 'activo'),
(1, '2012-2013', 'Categoría 2012-2013', 2012, 2013, 210, 'activo'),

-- 2: Fútbol Femenino
(2, '2010-2015', 'Categoría 2010-2015', 2010, 2015, 10, 'activo'),

-- 3: Vóley
(3, '2009-2008', 'Categoría 2008-2009', 2008, 2009, 10, 'activo'),
(3, '2010', 'Categoría 2010', 2010, 2010, 20, 'activo'),
(3, '2011', 'Categoría 2011', 2011, 2011, 30, 'activo'),
(3, '2012-2013', 'Categoría 2012-2013', 2012, 2013, 40, 'activo'),
(3, '2014', 'Categoría 2014', 2014, 2014, 50, 'activo'),
(3, '2015-2016', 'Categoría 2015-2016', 2015, 2016, 60, 'activo'),
(3, '2013-2014', 'Categoría 2013-2014', 2013, 2014, 70, 'activo'),
(3, '2010-2009', 'Categoría 2009-2010', 2009, 2010, 80, 'activo'),
(3, '2012-2011', 'Categoría 2011-2012', 2011, 2012, 90, 'activo'),
(3, '2011-2010', 'Categoría 2010-2011', 2010, 2011, 100, 'activo'),
(3, '2013-2012', 'Categoría 2012-2013', 2012, 2013, 110, 'activo'),

-- 4: Básquet
(4, '2009-2008', 'Categoría 2008-2009', 2008, 2009, 10, 'activo'),
(4, '2010', 'Categoría 2010', 2010, 2010, 20, 'activo'),
(4, '2011', 'Categoría 2011', 2011, 2011, 30, 'activo'),
(4, '2012-2013', 'Categoría 2012-2013', 2012, 2013, 40, 'activo'),
(4, '2014', 'Categoría 2014', 2014, 2014, 50, 'activo'),
(4, '2015-2016', 'Categoría 2015-2016', 2015, 2016, 60, 'activo'),
(4, '2017', 'Categoría 2017', 2017, 2017, 70, 'activo'),
(4, '2009', 'Categoría 2009', 2009, 2009, 80, 'activo'),
(4, '2010-2011', 'Categoría 2010-2011', 2010, 2011, 90, 'activo'),

-- 5: MAMAS FIT
(5, 'adulto +18', 'Adulto +18', 1900, 2008, 10, 'activo'),

-- 6: ASODE (Corregido ID 6)
(6, '2009-2010', 'Categoría 2009-2010', 2009, 2010, 10, 'activo'),
(6, '2011-2012', 'Categoría 2011-2012', 2011, 2012, 20, 'activo'),
(6, '2012-2013', 'Categoría 2012-2013', 2012, 2013, 30, 'activo'),
(6, '2014', 'Categoría 2014', 2014, 2014, 40, 'activo'),
(6, '2015-2016', 'Categoría 2015-2016', 2015, 2016, 50, 'activo'),
(6, '2017', 'Categoría 2017', 2017, 2017, 60, 'activo'),

-- 7: Entrenamiento Funcional Mixto (Corregido ID 7)
(7, 'adulto +18', 'Adulto +18', 1900, 2008, 10, 'activo'),

-- 8: GYM JUVENIL (Corregido ID 8)
(8, '2005-2009', 'Categoría 2005-2009', 2005, 2009, 10, 'activo');
