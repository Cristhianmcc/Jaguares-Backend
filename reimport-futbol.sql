-- Reimportar horarios de Fútbol desde el Sheet corregido
-- Primero eliminar todos los horarios de Fútbol
DELETE FROM horarios WHERE deporte_id = (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol');

-- Reimportar según el Sheet corregido
INSERT INTO horarios (horario_id, deporte_id, dia, hora_inicio, hora_fin, cupo_maximo, cupos_ocupados, estado, precio, plan, categoria, nivel, ano_min, ano_max, genero) VALUES
(3, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '08:10:00', '09:20:00', 20, 1, 'activo', 60, 'Económico', '2011-2012', NULL, 2011, 2012, 'Mixto'),
(4, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '08:10:00', '09:20:00', 20, 2, 'activo', 60, 'Económico', '2014-2013', NULL, 2013, 2014, 'Mixto'),
(6, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '10:30:00', '11:40:00', 20, 0, 'activo', 60, 'Económico', '2016-2015', NULL, 2015, 2016, 'Mixto'),
(7, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '10:30:00', '11:40:00', 20, 1, 'activo', 60, 'Económico', '2009-2010', NULL, 2009, 2010, 'Mixto'),
(8, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '11:40:00', '12:50:00', 20, 0, 'activo', 60, 'Económico', '2018-2017', NULL, 2017, 2018, 'Mixto'),
(11, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '08:10:00', '09:20:00', 20, 0, 'activo', 60, 'Económico', '2011-2012', NULL, 2011, 2012, 'Mixto'),
(12, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '08:10:00', '09:20:00', 20, 2, 'activo', 60, 'Económico', '2014-2013', NULL, 2013, 2014, 'Mixto'),
(14, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '10:30:00', '11:40:00', 20, 0, 'activo', 60, 'Económico', '2016-2015', NULL, 2015, 2016, 'Mixto'),
(15, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '10:30:00', '11:40:00', 20, 2, 'activo', 60, 'Económico', '2009-2010', NULL, 2009, 2010, 'Mixto'),
(16, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '11:40:00', '12:50:00', 20, 0, 'activo', 60, 'Económico', '2018-2017', NULL, 2017, 2018, 'Mixto'),
(37, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '08:10:00', '09:20:00', 20, 0, 'activo', 60, 'Económico', '2011-2012', NULL, 2011, 2012, 'Mixto'),
(38, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '08:10:00', '09:20:00', 20, 0, 'activo', 60, 'Económico', '2014-2013', NULL, 2013, 2014, 'Mixto'),
(40, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '10:30:00', '11:40:00', 20, 0, 'activo', 60, 'Económico', '2016-2015', NULL, 2015, 2016, 'Mixto'),
(41, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '10:30:00', '11:40:00', 20, 0, 'activo', 60, 'Económico', '2009-2010', NULL, 2009, 2010, 'Mixto'),
(42, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '11:40:00', '12:50:00', 20, 0, 'activo', 60, 'Económico', '2018-2017', NULL, 2017, 2018, 'Mixto'),
(61, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto'),
(62, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2019-2020', 'I', 2019, 2020, 'Mixto'),
(63, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2017', 'PC', 2017, 2017, 'Mixto'),
(64, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2016', 'PC', 2016, 2016, 'Mixto'),
(65, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2014', 'I', 2014, 2014, 'Mixto'),
(66, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2015', 'NF', 2015, 2015, 'Mixto'),
(67, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2014', 'PC', 2014, 2014, 'Mixto'),
(68, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2015', 'PC', 2015, 2015, 'Mixto'),
(69, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'LUNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2013-2014-2015', 'PC', 2013, 2015, 'Mixto'),
(70, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto'),
(71, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '15:30:00', '16:55:00', 20, 1, 'activo', 120, 'Estándar', '2019', 'I', 2019, 2019, 'Mixto'),
(72, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2017', 'PC', 2017, 2017, 'Mixto'),
(73, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2016', 'PC', 2016, 2016, 'Mixto'),
(74, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '17:00:00', '18:25:00', 20, 1, 'activo', 120, 'Estándar', '2014', 'I', 2014, 2014, 'Mixto'),
(75, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2015', 'NF', 2015, 2015, 'Mixto'),
(76, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '18:30:00', '19:55:00', 20, 1, 'activo', 200, 'Premium', '2014', 'PC', 2014, 2014, 'Mixto'),
(77, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2015', 'PC', 2015, 2015, 'Mixto'),
(78, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MIERCOLES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2013-2014-2015', 'PREMIUM', 2013, 2015, 'Mixto'),
(79, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2017', 'PC', 2017, 2017, 'Mixto'),
(80, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2016', 'PC', 2016, 2016, 'Mixto'),
(81, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2014', 'I', 2014, 2014, 'Mixto'),
(82, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2015', 'NF', 2015, 2015, 'Mixto'),
(83, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2014', 'PC', 2014, 2014, 'Mixto'),
(84, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '18:30:00', '19:55:00', 20, 0, 'activo', 200, 'Premium', '2015', 'PC', 2015, 2015, 'Mixto'),
(85, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'VIERNES', '18:30:00', '19:55:00', 20, 2, 'activo', 200, 'Premium', '2013-2014-2015', 'PREMIUM', 2013, 2015, 'Mixto'),
(86, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MARTES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2018-2019', 'NF', 2018, 2019, 'Mixto'),
(87, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MARTES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto'),
(88, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MARTES', '15:30:00', '16:50:00', 20, 1, 'activo', 120, 'Estándar', '2008-2009-2010-2011', 'NF', 2008, 2011, 'Mixto'),
(89, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MARTES', '17:00:00', '18:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(90, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MARTES', '17:00:00', '18:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(91, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MARTES', '17:00:00', '18:20:00', 20, 2, 'activo', 120, 'Estándar', '2014-2013-2012', 'NF', 2012, 2014, 'Mixto'),
(92, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'MARTES', '18:30:00', '19:50:00', 20, 0, 'activo', 200, 'Premium', '2009-2010-2011-2012', 'PC', 2009, 2012, 'Mixto'),
(93, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'JUEVES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2018-2019', 'NF', 2018, 2019, 'Mixto'),
(94, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'JUEVES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto'),
(95, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'JUEVES', '15:30:00', '16:50:00', 20, 1, 'activo', 120, 'Estándar', '2008-2009-2010-2011', 'NF', 2008, 2011, 'Mixto'),
(96, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'JUEVES', '17:00:00', '18:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(97, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'JUEVES', '17:00:00', '18:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(98, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'JUEVES', '17:00:00', '18:20:00', 20, 2, 'activo', 120, 'Estándar', '2014-2013-2012', 'NF', 2012, 2014, 'Mixto'),
(99, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'JUEVES', '18:30:00', '19:50:00', 20, 0, 'activo', 200, 'Premium', '2009-2010-2011-2012', 'PREMIUM', 2009, 2012, 'Mixto'),
(100, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'SABADO', '08:30:00', '09:50:00', 20, 0, 'activo', 0, NULL, '2008-2009', NULL, 2008, 2009, 'Mixto'),
(101, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'SABADO', '08:30:00', '09:50:00', 20, 1, 'activo', 120, 'Estándar', '2010-2011', 'NF', 2010, 2011, 'Mixto'),
(102, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'SABADO', '08:30:00', '09:50:00', 20, 2, 'activo', 120, 'Estándar', '2012-2013', 'NF', 2012, 2013, 'Mixto'),
(103, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'SABADO', '08:30:00', '09:50:00', 20, 0, 'activo', 120, 'Estándar', '2014', 'NF', 2014, 2014, 'Mixto'),
(104, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'SABADO', '10:00:00', '11:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto'),
(105, (SELECT deporte_id FROM deportes WHERE nombre = 'Fútbol'), 'SABADO', '10:00:00', '11:20:00', 20, 0, 'activo', 120, 'Estándar', '2017-2016', 'NF', 2016, 2017, 'Mixto');

-- Verificar horarios para 2019 (deberían ser EXACTAMENTE 4)
SELECT 
  h.horario_id,
  h.dia,
  TIME_FORMAT(h.hora_inicio, '%H:%i') as hora,
  h.categoria,
  h.nivel,
  h.ano_min,
  h.ano_max
FROM horarios h
INNER JOIN deportes d ON h.deporte_id = d.deporte_id
WHERE d.nombre = 'Fútbol' 
  AND h.estado = 'activo'
  AND 2019 BETWEEN h.ano_min AND h.ano_max
ORDER BY h.dia, h.hora_inicio;
