-- Sincronizar horarios de Fútbol con el Google Sheet corregido
-- Eliminar horarios duplicados/incorrectos que ya no están en el Sheet

-- Primero, eliminar los IDs que ya no existen o fueron renumerados
DELETE FROM horarios WHERE horario_id IN (63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76, 77, 78);

-- Actualizar IDs de Fútbol según el Sheet corregido
-- LUNES 15:30-16:55
UPDATE horarios SET categoria = '2019-2020', nivel = 'I', ano_min = 2019, ano_max = 2020 WHERE horario_id = 62;

-- LUNES 17:00-18:25 (ID 63 ahora, era 65)
UPDATE horarios SET horario_id = 63, categoria = '2017', nivel = 'PC', ano_min = 2017, ano_max = 2017, precio = 200, plan = 'Premium' WHERE horario_id = 65;
-- ID 64, 65, 66
INSERT INTO horarios (horario_id, deporte_id, dia, hora_inicio, hora_fin, cupo_maximo, cupos_ocupados, estado, precio, plan, categoria, nivel, ano_min, ano_max, genero)
SELECT 64, deporte_id, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 200, 'Premium', '2016', 'PC', 2016, 2016, 'Mixto'
FROM deportes WHERE nombre = 'Fútbol'
WHERE NOT EXISTS (SELECT 1 FROM horarios WHERE horario_id = 64);

INSERT INTO horarios (horario_id, deporte_id, dia, hora_inicio, hora_fin, cupo_maximo, cupos_ocupados, estado, precio, plan, categoria, nivel, ano_min, ano_max, genero)
SELECT 65, deporte_id, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2014', 'I', 2014, 2014, 'Mixto'
FROM deportes WHERE nombre = 'Fútbol'
WHERE NOT EXISTS (SELECT 1 FROM horarios WHERE horario_id = 65);

INSERT INTO horarios (horario_id, deporte_id, dia, hora_inicio, hora_fin, cupo_maximo, cupos_ocupados, estado, precio, plan, categoria, nivel, ano_min, ano_max, genero)
SELECT 66, deporte_id, 'LUNES', '17:00:00', '18:25:00', 20, 0, 'activo', 120, 'Estándar', '2015', 'NF', 2015, 2015, 'Mixto'
FROM deportes WHERE nombre = 'Fútbol'
WHERE NOT EXISTS (SELECT 1 FROM horarios WHERE horario_id = 66);

-- MIÉRCOLES 15:30-16:55 (ID 71 ahora, era 73)
UPDATE horarios SET horario_id = 71, categoria = '2019', nivel = 'I', ano_min = 2019, ano_max = 2019, cupos_ocupados = 1 WHERE horario_id = 73;

-- MARTES 15:30-16:50
UPDATE horarios SET horario_id = 86, categoria = '2018-2019', nivel = 'NF', ano_min = 2018, ano_max = 2019 WHERE horario_id = 90;
UPDATE horarios SET horario_id = 87, categoria = '2020-2021', nivel = 'NF', ano_min = 2020, ano_max = 2021 WHERE horario_id = 91;
UPDATE horarios SET horario_id = 88, categoria = '2008-2009-2010-2011', nivel = 'NF', ano_min = 2008, ano_max = 2011, cupos_ocupados = 1 WHERE horario_id = 92;

-- JUEVES 15:30-16:50
UPDATE horarios SET horario_id = 93, categoria = '2018-2019', nivel = 'NF', ano_min = 2018, ano_max = 2019 WHERE horario_id = 97;
UPDATE horarios SET horario_id = 94, categoria = '2020-2021', nivel = 'NF', ano_min = 2020, ano_max = 2021 WHERE horario_id = 98;
UPDATE horarios SET horario_id = 95, categoria = '2008-2009-2010-2011', nivel = 'NF', ano_min = 2008, ano_max = 2011, cupos_ocupados = 1 WHERE horario_id = 99;

-- Verificar horarios para 2019 (deberían ser solo 4)
SELECT 
  h.horario_id,
  d.nombre as deporte,
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
