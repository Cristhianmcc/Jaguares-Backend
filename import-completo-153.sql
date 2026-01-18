-- IMPORTACIÓN COMPLETA DE 153 HORARIOS
-- Primero eliminamos todos los horarios actuales
DELETE FROM horarios;

-- Reiniciamos el auto_increment
ALTER TABLE horarios AUTO_INCREMENT = 1;

-- Ahora insertamos los 153 horarios exactos de tu hoja
INSERT INTO horarios (deporte_id, dia, hora_inicio, hora_fin, cupo_maximo, cupos_ocupados, estado, precio, plan, categoria, nivel, ano_min, ano_max, genero) VALUES
-- MAMAS FIT (IDs 1-2, 9-10, 29-30, 114, 149, 151-153)
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'LUNES', '06:30:00', '07:40:00', 20, 4, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'LUNES', '07:45:00', '09:00:00', 20, 4, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
-- Fútbol económico LUNES (IDs 3-8)
(1, 'LUNES', '08:10:00', '09:20:00', 20, 1, 'activo', 60, 'Económico', '2011-2012', NULL, 2011, 2012, 'Mixto'),
(1, 'LUNES', '08:10:00', '09:20:00', 20, 2, 'activo', 60, 'Económico', '2014-2013', NULL, 2013, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol Femenino'), 'LUNES', '09:20:00', '10:30:00', 20, 4, 'activo', 60, 'Económico', '2010-2015', NULL, 2010, 2015, 'Femenino'),
(1, 'LUNES', '10:30:00', '11:40:00', 20, 0, 'activo', 60, 'Económico', '2016-2015', NULL, 2015, 2016, 'Mixto'),
(1, 'LUNES', '10:30:00', '11:40:00', 20, 1, 'activo', 60, 'Económico', '2009-2010', NULL, 2009, 2010, 'Mixto'),
(1, 'LUNES', '11:40:00', '12:50:00', 20, 0, 'activo', 60, 'Económico', '2018-2017', NULL, 2017, 2018, 'Mixto'),
-- MAMAS FIT MIERCOLES (IDs 9-10)
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'MIERCOLES', '06:30:00', '07:40:00', 20, 2, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'MIERCOLES', '07:45:00', '09:00:00', 20, 1, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
-- Fútbol económico MIERCOLES (IDs 11-16)
(1, 'MIERCOLES', '08:10:00', '09:20:00', 20, 0, 'activo', 60, 'Económico', '2011-2012', NULL, 2011, 2012, 'Mixto'),
(1, 'MIERCOLES', '08:10:00', '09:20:00', 20, 2, 'activo', 60, 'Económico', '2014-2013', NULL, 2013, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol Femenino'), 'MIERCOLES', '09:20:00', '10:30:00', 20, 4, 'activo', 60, 'Económico', '2010-2015', NULL, 2010, 2015, 'Femenino'),
(1, 'MIERCOLES', '10:30:00', '11:40:00', 20, 0, 'activo', 60, 'Económico', '2016-2015', NULL, 2015, 2016, 'Mixto'),
(1, 'MIERCOLES', '10:30:00', '11:40:00', 20, 2, 'activo', 60, 'Económico', '2009-2010', NULL, 2009, 2010, 'Mixto'),
(1, 'MIERCOLES', '11:40:00', '12:50:00', 20, 0, 'activo', 60, 'Económico', '2018-2017', NULL, 2017, 2018, 'Mixto'),
-- Vóley económico LUNES (IDs 17-22)
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '08:30:00', '09:40:00', 20, 3, 'activo', 60, 'Económico', '2009-2008', NULL, 2008, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '08:30:00', '09:40:00', 20, 1, 'activo', 60, 'Económico', '2010', NULL, 2010, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '09:40:00', '10:50:00', 20, 0, 'activo', 60, 'Económico', '2011', NULL, 2011, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '09:40:00', '10:50:00', 20, 1, 'activo', 60, 'Económico', '2012-2013', NULL, 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '10:50:00', '12:00:00', 20, 0, 'activo', 60, 'Económico', '2014', NULL, 2014, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '10:50:00', '12:00:00', 20, 1, 'activo', 60, 'Económico', '2015-2016', NULL, 2015, 2016, 'Mixto'),
-- Vóley económico MIERCOLES (IDs 23-28)
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '08:30:00', '09:40:00', 20, 1, 'activo', 60, 'Económico', '2009-2008', NULL, 2008, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '08:30:00', '09:40:00', 20, 0, 'activo', 60, 'Económico', '2010', NULL, 2010, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '09:40:00', '10:50:00', 20, 1, 'activo', 60, 'Económico', '2011', NULL, 2011, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '09:40:00', '10:50:00', 20, 0, 'activo', 60, 'Económico', '2012-2013', NULL, 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '10:50:00', '12:00:00', 20, 1, 'activo', 60, 'Económico', '2014', NULL, 2014, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '10:50:00', '12:00:00', 20, 0, 'activo', 60, 'Económico', '2015-2016', NULL, 2015, 2016, 'Mixto'),
-- MAMAS FIT VIERNES (IDs 29-30)
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'VIERNES', '06:30:00', '07:40:00', 20, 0, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'VIERNES', '07:45:00', '09:00:00', 20, 1, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
-- Vóley económico VIERNES (IDs 31-36)
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '08:30:00', '09:40:00', 20, 0, 'activo', 60, 'Económico', '2009-2008', NULL, 2008, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '08:30:00', '09:40:00', 20, 0, 'activo', 60, 'Económico', '2010', NULL, 2010, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '09:40:00', '10:50:00', 20, 0, 'activo', 60, 'Económico', '2011', NULL, 2011, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '09:40:00', '10:50:00', 20, 2, 'activo', 60, 'Económico', '2012-2013', NULL, 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '10:50:00', '12:00:00', 20, 0, 'activo', 60, 'Económico', '2014', NULL, 2014, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '10:50:00', '12:00:00', 20, 0, 'activo', 60, 'Económico', '2015-2016', NULL, 2015, 2016, 'Mixto'),
-- Fútbol económico VIERNES (IDs 37-42)
(1, 'VIERNES', '08:10:00', '09:20:00', 20, 0, 'activo', 60, 'Económico', '2011-2012', NULL, 2011, 2012, 'Mixto'),
(1, 'VIERNES', '08:10:00', '09:20:00', 20, 0, 'activo', 60, 'Económico', '2014-2013', NULL, 2013, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol Femenino'), 'VIERNES', '09:20:00', '10:30:00', 20, 0, 'activo', 60, 'Económico', '2010-2015', NULL, 2010, 2015, 'Femenino'),
(1, 'VIERNES', '10:30:00', '11:40:00', 20, 0, 'activo', 60, 'Económico', '2016-2015', NULL, 2015, 2016, 'Mixto'),
(1, 'VIERNES', '10:30:00', '11:40:00', 20, 0, 'activo', 60, 'Económico', '2009-2010', NULL, 2009, 2010, 'Mixto'),
(1, 'VIERNES', '11:40:00', '12:50:00', 20, 0, 'activo', 60, 'Económico', '2018-2017', NULL, 2017, 2018, 'Mixto'),
-- Básquet económico MARTES (IDs 43-48)
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '08:30:00', '09:40:00', 20, 0, 'activo', 60, 'Económico', '2009-2008', NULL, 2008, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '08:30:00', '09:40:00', 20, 1, 'activo', 60, 'Económico', '2010', NULL, 2010, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '09:40:00', '10:50:00', 20, 0, 'activo', 60, 'Económico', '2011', NULL, 2011, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '09:40:00', '10:50:00', 20, 2, 'activo', 60, 'Económico', '2012-2013', NULL, 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '10:50:00', '12:00:00', 20, 0, 'activo', 60, 'Económico', '2014', NULL, 2014, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '10:50:00', '12:00:00', 20, 0, 'activo', 60, 'Económico', '2015-2016', NULL, 2015, 2016, 'Mixto'),
-- Básquet económico JUEVES (IDs 49-54)
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '08:30:00', '09:40:00', 20, 0, 'activo', 60, 'Económico', '2009-2008', NULL, 2008, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '08:30:00', '09:40:00', 20, 1, 'activo', 60, 'Económico', '2010', NULL, 2010, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '09:40:00', '10:50:00', 20, 0, 'activo', 60, 'Económico', '2011', NULL, 2011, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '09:40:00', '10:50:00', 20, 2, 'activo', 60, 'Económico', '2012-2013', NULL, 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '10:50:00', '12:00:00', 20, 0, 'activo', 60, 'Económico', '2014', NULL, 2014, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '10:50:00', '12:00:00', 20, 0, 'activo', 60, 'Económico', '2015-2016', NULL, 2015, 2016, 'Mixto'),
-- ASODE SABADO (IDs 55-60)
((SELECT deporte_id FROM deportes WHERE nombre = 'ASODE'), 'SABADO', '15:30:00', '16:30:00', 20, 1, 'activo', 200, 'Premium', '2009-2010', 'PC', 2009, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'ASODE'), 'SABADO', '15:30:00', '16:30:00', 20, 0, 'activo', 200, 'Premium', '2011-2012', 'PC', 2011, 2012, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'ASODE'), 'SABADO', '16:30:00', '17:30:00', 20, 2, 'activo', 200, 'Premium', '2012-2013', 'PC', 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'ASODE'), 'SABADO', '16:30:00', '17:30:00', 20, 0, 'activo', 200, 'Premium', '2014', 'PC', 2014, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'ASODE'), 'SABADO', '17:30:00', '18:30:00', 20, 0, 'activo', 200, 'Premium', '2015-2016', 'PC', 2015, 2016, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'ASODE'), 'SABADO', '17:30:00', '18:30:00', 20, 0, 'activo', 200, 'Premium', '2017', 'PC', 2017, 2017, 'Mixto'),
-- Fútbol tarde LUNES (IDs 61-69)
(1, 'LUNES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto'),
(1, 'LUNES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2019-2020', 'I', 2019, 2020, 'Mixto'),
(1, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2017', 'PC', 2017, 2017, 'Mixto'),
(1, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2016', 'PC', 2016, 2016, 'Mixto'),
(1, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2014', 'I', 2014, 2014, 'Mixto'),
(1, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2015', 'NF', 2015, 2015, 'Mixto'),
(1, 'LUNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2014', 'PC', 2014, 2014, 'Mixto'),
(1, 'LUNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2015', 'PC', 2015, 2015, 'Mixto'),
(1, 'LUNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2013-2014-2015', 'PC', 2013, 2015, 'Mixto'),
-- Fútbol tarde MIERCOLES (IDs 70-78)
(1, 'MIERCOLES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto'),
(1, 'MIERCOLES', '15:30:00', '16:55:00', 20, 1, 'activo', 120, 'Estándar', '2019', 'I', 2019, 2019, 'Mixto'),
(1, 'MIERCOLES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2017', 'PC', 2017, 2017, 'Mixto'),
(1, 'MIERCOLES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2016', 'PC', 2016, 2016, 'Mixto'),
(1, 'MIERCOLES', '17:00:00', '18:25:00', 20, 1, 'activo', 120, 'Estándar', '2014', 'I', 2014, 2014, 'Mixto'),
(1, 'MIERCOLES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2015', 'NF', 2015, 2015, 'Mixto'),
(1, 'MIERCOLES', '18:30:00', '19:55:00', 20, 1, 'activo', 200, 'Premium', '2014', 'PC', 2014, 2014, 'Mixto'),
(1, 'MIERCOLES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2015', 'PC', 2015, 2015, 'Mixto'),
(1, 'MIERCOLES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2013-2014-2015', 'PREMIUM', 2013, 2015, 'Mixto'),
-- Fútbol tarde VIERNES (IDs 79-85)
(1, 'VIERNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2017', 'PC', 2017, 2017, 'Mixto'),
(1, 'VIERNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2016', 'PC', 2016, 2016, 'Mixto'),
(1, 'VIERNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2014', 'I', 2014, 2014, 'Mixto'),
(1, 'VIERNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2015', 'NF', 2015, 2015, 'Mixto'),
(1, 'VIERNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2014', 'PC', 2014, 2014, 'Mixto'),
(1, 'VIERNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2015', 'PC', 2015, 2015, 'Mixto'),
(1, 'VIERNES', '18:30:00', '19:55:00', 20, 2, 'activo', 200, 'Premium', '2013-2014-2015', 'PREMIUM', 2013, 2015, 'Mixto'),
-- Fútbol tarde MARTES (IDs 86-92)
(1, 'MARTES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2018-2019', 'NF', 2018, 2019, 'Mixto'),
(1, 'MARTES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto'),
(1, 'MARTES', '15:30:00', '16:50:00', 20, 1, 'activo', 120, 'Estándar', '2008-2009-2010-2011', 'NF', 2008, 2011, 'Mixto'),
(1, 'MARTES', '17:00:00', '18:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(1, 'MARTES', '17:00:00', '18:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(1, 'MARTES', '17:00:00', '18:20:00', 20, 2, 'activo', 120, 'Estándar', '2014-2013-2012', 'NF', 2012, 2014, 'Mixto'),
(1, 'MARTES', '18:30:00', '19:50:00', 20, 0, 'activo', 200, 'Premium', '2009-2010-2011-2012', 'PC', 2009, 2012, 'Mixto'),
-- Fútbol tarde JUEVES (IDs 93-99)
(1, 'JUEVES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2018-2019', 'NF', 2018, 2019, 'Mixto'),
(1, 'JUEVES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto'),
(1, 'JUEVES', '15:30:00', '16:50:00', 20, 1, 'activo', 120, 'Estándar', '2008-2009-2010-2011', 'NF', 2008, 2011, 'Mixto'),
(1, 'JUEVES', '17:00:00', '18:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(1, 'JUEVES', '17:00:00', '18:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(1, 'JUEVES', '17:00:00', '18:20:00', 20, 2, 'activo', 120, 'Estándar', '2014-2013-2012', 'NF', 2012, 2014, 'Mixto'),
(1, 'JUEVES', '18:30:00', '19:50:00', 20, 0, 'activo', 200, 'Premium', '2009-2010-2011-2012', 'PREMIUM', 2009, 2012, 'Mixto'),
-- Fútbol SABADO (IDs 100-105)
(1, 'SABADO', '08:30:00', '09:50:00', 20, 0, 'activo', 0, '', '2008-2009', NULL, 2008, 2009, 'Mixto'),
(1, 'SABADO', '08:30:00', '09:50:00', 20, 1, 'activo', 120, 'Estándar', '2010-2011', 'NF', 2010, 2011, 'Mixto'),
(1, 'SABADO', '08:30:00', '09:50:00', 20, 2, 'activo', 120, 'Estándar', '2012-2013', 'NF', 2012, 2013, 'Mixto'),
(1, 'SABADO', '08:30:00', '09:50:00', 20, 0, 'activo', 120, 'Estándar', '2014', 'NF', 2014, 2014, 'Mixto'),
(1, 'SABADO', '10:00:00', '11:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(1, 'SABADO', '10:00:00', '11:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
-- Vóley tarde LUNES (IDs 106-111)
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2013-2014', 'BÁSICO', 2013, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2015-2016', 'BÁSICO', 2015, 2016, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '16:00:00', '17:30:00', 20, 0, 'activo', 120, 'Estándar', '2010-2009', 'BÁSICO', 2009, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '16:00:00', '17:30:00', 20, 0, 'activo', 120, 'Estándar', '2012-2011', 'BÁSICO', 2011, 2012, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '17:30:00', '19:00:00', 20, 0, 'activo', 120, 'Estándar', '2011-2010', 'AVANZADO', 2010, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'LUNES', '17:30:00', '19:00:00', 20, 0, 'activo', 120, 'Estándar', '2013-2012', 'AVANZADO', 2012, 2013, 'Mixto'),
-- Entrenamiento y Gym LUNES (IDs 112-114)
((SELECT deporte_id FROM deportes WHERE nombre = 'Entrenamiento Funcional Mixto'), 'LUNES', '15:45:00', '16:45:00', 20, 4, 'activo', 100, 'Estándar', 'adulto +18', NULL, 1900, 2008, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'GYM JUVENIL'), 'LUNES', '15:00:00', '16:00:00', 20, 4, 'activo', 100, 'Estándar', '2005-2009', 'AVANZADO', 2005, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'LUNES', '16:00:00', '17:00:00', 20, 0, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
-- Vóley tarde MIERCOLES (IDs 115-120)
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2013-2014', 'BÁSICO', 2013, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2015-2016', 'BÁSICO', 2015, 2016, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '16:00:00', '17:30:00', 20, 0, 'activo', 120, 'Estándar', '2010-2009', 'BÁSICO', 2009, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '16:00:00', '17:30:00', 20, 0, 'activo', 120, 'Estándar', '2012-2011', 'BÁSICO', 2011, 2012, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '17:30:00', '19:00:00', 20, 0, 'activo', 120, 'Estándar', '2011-2010', 'AVANZADO', 2010, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'MIERCOLES', '17:30:00', '19:00:00', 20, 0, 'activo', 120, 'Estándar', '2013-2012', 'AVANZADO', 2012, 2013, 'Mixto'),
-- Entrenamiento MIERCOLES (ID 121)
((SELECT deporte_id FROM deportes WHERE nombre = 'Entrenamiento Funcional Mixto'), 'MIERCOLES', '15:45:00', '16:45:00', 20, 0, 'activo', 100, 'Estándar', 'adulto +18', NULL, 1900, 2008, 'Mixto'),
-- Vóley tarde VIERNES (IDs 122-127)
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2013-2014', 'BÁSICO', 2013, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2015-2016', 'BÁSICO', 2015, 2016, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '16:00:00', '17:30:00', 20, 1, 'activo', 120, 'Estándar', '2010-2009', 'BÁSICO', 2009, 2010, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '16:00:00', '17:30:00', 20, 0, 'activo', 120, 'Estándar', '2012-2011', 'BÁSICO', 2011, 2012, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '17:30:00', '19:00:00', 20, 1, 'activo', 120, 'Estándar', '2011-2010', 'AVANZADO', 2010, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Vóley'), 'VIERNES', '17:30:00', '19:00:00', 20, 0, 'activo', 120, 'Estándar', '2013-2012', 'AVANZADO', 2012, 2013, 'Mixto'),
-- Entrenamiento y Gym VIERNES (IDs 128-130)
((SELECT deporte_id FROM deportes WHERE nombre = 'Entrenamiento Funcional Mixto'), 'VIERNES', '15:45:00', '16:45:00', 20, 0, 'activo', 100, 'Estándar', 'adulto +18', NULL, 1900, 2008, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'GYM JUVENIL'), 'VIERNES', '15:00:00', '16:00:00', 20, 0, 'activo', 100, 'Estándar', '2005-2009', NULL, 2005, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'VIERNES', '16:00:00', '17:00:00', 20, 0, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
-- Básquet tarde MARTES (IDs 131-136)
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2017', NULL, 2017, 2017, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2015-2016', NULL, 2015, 2016, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '16:00:00', '17:30:00', 20, 0, 'activo', 120, 'Estándar', '2014', NULL, 2014, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '16:00:00', '17:30:00', 20, 0, 'activo', 120, 'Estándar', '2012-2013', NULL, 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '17:30:00', '19:00:00', 20, 0, 'activo', 120, 'Estándar', '2009', NULL, 2009, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'MARTES', '17:30:00', '19:00:00', 20, 0, 'activo', 120, 'Estándar', '2010-2011', NULL, 2010, 2011, 'Mixto'),
-- Básquet tarde JUEVES (IDs 137-142)
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2017', NULL, 2017, 2017, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '14:30:00', '16:00:00', 20, 0, 'activo', 120, 'Estándar', '2015-2016', NULL, 2015, 2016, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '16:00:00', '17:30:00', 20, 0, 'activo', 120, 'Estándar', '2011', NULL, 2011, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '16:00:00', '17:30:00', 20, 1, 'activo', 120, 'Estándar', '2012-2013', NULL, 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '17:30:00', '19:00:00', 20, 0, 'activo', 120, 'Estándar', '2009-2008', NULL, 2008, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'JUEVES', '17:30:00', '19:00:00', 20, 1, 'activo', 120, 'Estándar', '2010-2011', NULL, 2010, 2011, 'Mixto'),
-- Básquet SABADO (IDs 143-148)
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'SABADO', '08:30:00', '10:00:00', 20, 0, 'activo', 120, 'Estándar', '2009-2008', NULL, 2008, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'SABADO', '08:30:00', '10:00:00', 20, 1, 'activo', 120, 'Estándar', '2010-2011', NULL, 2010, 2011, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'SABADO', '10:00:00', '11:30:00', 20, 0, 'activo', 120, 'Estándar', '2012-2013', NULL, 2012, 2013, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'SABADO', '10:00:00', '11:30:00', 20, 0, 'activo', 120, 'Estándar', '2014', NULL, 2014, 2014, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'SABADO', '11:30:00', '13:00:00', 20, 0, 'activo', 120, 'Estándar', '2015-2016', NULL, 2015, 2016, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'Básquet'), 'SABADO', '11:30:00', '13:00:00', 20, 0, 'activo', 120, 'Estándar', '2017', NULL, 2017, 2017, 'Mixto'),
-- MAMAS FIT y GYM finales (IDs 149-153)
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'LUNES', '17:00:00', '18:00:00', 20, 0, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
((SELECT deporte_id FROM deportes WHERE nombre = 'GYM JUVENIL'), 'MIERCOLES', '15:00:00', '16:00:00', 20, 1, 'activo', 100, 'Estándar', '2005-2009', NULL, 2005, 2009, 'Mixto'),
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'MIERCOLES', '16:00:00', '17:00:00', 20, 1, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'MIERCOLES', '17:00:00', '18:00:00', 20, 1, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino'),
((SELECT deporte_id FROM deportes WHERE nombre = 'MAMAS FIT'), 'VIERNES', '17:00:00', '18:00:00', 20, 1, 'activo', 60, 'Económico', 'adulto +18', NULL, 1900, 2008, 'Femenino');

-- Verificación final
SELECT 'Importación completa' as status, COUNT(*) as total_horarios FROM horarios WHERE estado = 'activo';
