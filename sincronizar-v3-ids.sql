-- Sincronización V3: IDs Exactos del Entorno Local
-- Fuente: Datos proporcionados por el usuario
-- IDs de Deportes: 1:Fútbol, 2:Fem, 3:Vóley, 4:Básquet, 5:MAMAS, 6:ASODE, 7:Funcional, 8:GYM
-- Orden de columnas: id, deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE categorias;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO categorias (id, deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
-- ASODE (6)
(44, 6, '2009-2010', 'Categoría 2009-2010 - ASODE', 2009, 2010, 2009, 'Activo'),
(45, 6, '2011-2012', 'Categoría 2011-2012 - ASODE', 2011, 2012, 2011, 'Activo'),
(46, 6, '2012-2013', 'Categoría 2012-2013 - ASODE', 2012, 2013, 2012, 'Activo'),
(47, 6, '2014', 'Categoría 2014 - ASODE', 2014, 2014, 2014, 'Activo'),
(48, 6, '2015-2016', 'Categoría 2015-2016 - ASODE', 2015, 2016, 2015, 'Activo'),
(49, 6, '2017', 'Categoría 2017 - ASODE', 2017, 2017, 2017, 'Activo'),

-- Básquet (4)
(34, 4, '2009-2008', 'Categoría 2009-2008 - Básquet', 2008, 2009, 2008, 'Activo'),
(35, 4, '2009', 'Categoría 2009 - Básquet', 2009, 2009, 2009, 'Activo'),
(37, 4, '2010', 'Categoría 2010 - Básquet', 2010, 2010, 2010, 'Activo'),
(36, 4, '2010-2011', 'Categoría 2010-2011 - Básquet', 2010, 2011, 2010, 'Activo'),
(38, 4, '2011', 'Categoría 2011 - Básquet', 2011, 2011, 2011, 'Activo'),
(39, 4, '2012-2013', 'Categoría 2012-2013 - Básquet', 2012, 2013, 2012, 'Activo'),
(40, 4, '2014', 'Categoría 2014 - Básquet', 2014, 2014, 2014, 'Activo'),
(41, 4, '2015-2016', 'Categoría 2015-2016 - Básquet', 2015, 2016, 2015, 'Activo'),
(42, 4, '2017', 'Categoría 2017 - Básquet', 2017, 2017, 2017, 'Activo'),

-- Entrenamiento Funcional Mixto (7)
(50, 7, 'adulto +18', 'Categoría adulto +18 - Entrenamiento Funcional Mixto', 1900, 2008, 1900, 'Activo'),

-- Fútbol (1)
(2, 1, '2008-2009', 'Categoría 2008-2009 - Fútbol', 2008, 2009, 2008, 'Activo'),
(1, 1, '2008-2009-2010-2011', 'Categoría 2008-2009-2010-2011 - Fútbol', 2008, 2011, 2008, 'Activo'),
(3, 1, '2009-2010', 'Categoría 2009-2010 - Fútbol', 2009, 2010, 2009, 'Activo'),
(4, 1, '2009-2010-2011-2012', 'Categoría 2009-2010-2011-2012 - Fútbol', 2009, 2012, 2009, 'Activo'),
(5, 1, '2010-2011', 'Categoría 2010-2011 - Fútbol', 2010, 2011, 2010, 'Activo'),
(6, 1, '2011-2012', 'Categoría 2011-2012 - Fútbol', 2011, 2012, 2011, 'Activo'),
(7, 1, '2012-2013', 'Categoría 2012-2013 - Fútbol', 2012, 2013, 2012, 'Activo'),
(8, 1, '2014-2013-2012', 'Categoría 2014-2013-2012 - Fútbol', 2012, 2014, 2012, 'Activo'),
(9, 1, '2013-2014-2015', 'Categoría 2013-2014-2015 - Fútbol', 2013, 2015, 2013, 'Activo'),
(10, 1, '2014-2013', 'Categoría 2014-2013 - Fútbol', 2013, 2014, 2013, 'Activo'),
(11, 1, '2014', 'Categoría 2014 - Fútbol', 2014, 2014, 2014, 'Activo'),
(12, 1, '2015', 'Categoría 2015 - Fútbol', 2015, 2015, 2015, 'Activo'),
(13, 1, '2016-2015', 'Categoría 2016-2015 - Fútbol', 2015, 2016, 2015, 'Activo'),
(15, 1, '2016', 'Categoría 2016 - Fútbol', 2016, 2016, 2016, 'Activo'),
(14, 1, '2017-2016', 'Categoría 2017-2016 - Fútbol', 2016, 2017, 2016, 'Activo'),
(17, 1, '2017', 'Categoría 2017 - Fútbol', 2017, 2017, 2017, 'Activo'),
(16, 1, '2018-2017', 'Categoría 2018-2017 - Fútbol', 2017, 2018, 2017, 'Activo'),
(18, 1, '2018-2019', 'Categoría 2018-2019 - Fútbol', 2018, 2019, 2018, 'Activo'),
(19, 1, '2019', 'Categoría 2019 - Fútbol', 2019, 2019, 2019, 'Activo'),
(20, 1, '2019-2020', 'Categoría 2019-2020 - Fútbol', 2019, 2020, 2019, 'Activo'),
(21, 1, '2020-2021', 'Categoría 2020-2021 - Fútbol', 2020, 2021, 2020, 'Activo'),

-- Fútbol Femenino (2)
(22, 2, '2010-2015', 'Categoría 2010-2015 - Fútbol Femenino', 2010, 2015, 2010, 'Activo'),

-- GYM JUVENIL (8)
(51, 8, '2005-2009', 'Categoría 2005-2009 - GYM JUVENIL', 2005, 2009, 2005, 'Activo'),

-- MAMAS FIT (5)
(43, 5, 'adulto +18', 'Categoría adulto +18 - MAMAS FIT', 1900, 2008, 1900, 'Activo'),

-- Vóley (3)
(23, 3, '2009-2008', 'Categoría 2009-2008 - Vóley', 2008, 2009, 2008, 'Activo'),
(24, 3, '2010-2009', 'Categoría 2010-2009 - Vóley', 2009, 2010, 2009, 'Activo'),
(25, 3, '2010', 'Categoría 2010 - Vóley', 2010, 2010, 2010, 'Activo'),
(26, 3, '2011-2010', 'Categoría 2011-2010 - Vóley', 2010, 2011, 2010, 'Activo'),
(27, 3, '2011', 'Categoría 2011 - Vóley', 2011, 2011, 2011, 'Activo'),
(28, 3, '2012-2011', 'Categoría 2012-2011 - Vóley', 2011, 2012, 2011, 'Activo'),
(30, 3, '2012-2013', 'Categoría 2012-2013 - Vóley', 2012, 2013, 2012, 'Activo'),
(29, 3, '2013-2012', 'Categoría 2013-2012 - Vóley', 2012, 2013, 2012, 'Activo'),
(31, 3, '2013-2014', 'Categoría 2013-2014 - Vóley', 2013, 2014, 2013, 'Activo'),
(32, 3, '2014', 'Categoría 2014 - Vóley', 2014, 2014, 2014, 'Activo'),
(33, 3, '2015-2016', 'Categoría 2015-2016 - Vóley', 2015, 2016, 2015, 'Activo');
