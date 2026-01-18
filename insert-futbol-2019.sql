-- Insertar solo los horarios de Fútbol necesarios para 2019
-- deporte_id = 14 (Fútbol)

-- LUNES 15:30-16:55
INSERT INTO horarios VALUES (62, 14, 'LUNES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2019-2020', 'I', 2019, 2020, 'Mixto');
INSERT INTO horarios VALUES (61, 14, 'LUNES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto');

-- MIÉRCOLES 15:30-16:55
INSERT INTO horarios VALUES (71, 14, 'MIERCOLES', '15:30:00', '16:55:00', 20, 1, 'activo', 120, 'Estándar', '2019', 'I', 2019, 2019, 'Mixto');
INSERT INTO horarios VALUES (70, 14, 'MIERCOLES', '15:30:00', '16:55:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto');

-- MARTES 15:30-16:50
INSERT INTO horarios VALUES (86, 14, 'MARTES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2018-2019', 'NF', 2018, 2019, 'Mixto');
INSERT INTO horarios VALUES (87, 14, 'MARTES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto');
INSERT INTO horarios VALUES (88, 14, 'MARTES', '15:30:00', '16:50:00', 20, 1, 'activo', 120, 'Estándar', '2008-2009-2010-2011', 'NF', 2008, 2011, 'Mixto');

-- JUEVES 15:30-16:50
INSERT INTO horarios VALUES (93, 14, 'JUEVES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2018-2019', 'NF', 2018, 2019, 'Mixto');
INSERT INTO horarios VALUES (94, 14, 'JUEVES', '15:30:00', '16:50:00', 20, 0, 'activo', 120, 'Estándar', '2020-2021', 'NF', 2020, 2021, 'Mixto');
INSERT INTO horarios VALUES (95, 14, 'JUEVES', '15:30:00', '16:50:00', 20, 1, 'activo', 120, 'Estándar', '2008-2009-2010-2011', 'NF', 2008, 2011, 'Mixto');

-- Otros horarios de tarde/noche (no afectan 2019)
INSERT INTO horarios VALUES (63, 14, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2017', 'PC', 2017, 2017, 'Mixto');
INSERT INTO horarios VALUES (64, 14, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2016', 'PC', 2016, 2016, 'Mixto');
INSERT INTO horarios VALUES (65, 14, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2014', 'I', 2014, 2014, 'Mixto');
INSERT INTO horarios VALUES (66, 14, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2015', 'NF', 2015, 2015, 'Mixto');

-- Verificar: Deberían aparecer SOLO 4 horarios para 2019
SELECT horario_id, dia, TIME_FORMAT(hora_inicio, '%H:%i') as hora, categoria, nivel, ano_min, ano_max
FROM horarios
WHERE deporte_id = 14 AND estado = 'activo' AND 2019 BETWEEN ano_min AND ano_max
ORDER BY dia, hora_inicio;
