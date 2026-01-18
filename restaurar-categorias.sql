-- Restaurar las categorías originales de los horarios de Fútbol
-- Estas deben coincidir con el Google Sheet corregido

-- LUNES 15:30-16:55
UPDATE horarios SET categoria = '2020-2021', nivel = 'NF', ano_min = 2020, ano_max = 2021 WHERE horario_id = 61;
UPDATE horarios SET categoria = '2019-2020', nivel = 'I', ano_min = 2019, ano_max = 2020 WHERE horario_id = 62;
UPDATE horarios SET categoria = '2020-2021', nivel = NULL, ano_min = 2020, ano_max = 2021 WHERE horario_id = 63;
UPDATE horarios SET categoria = '2019', nivel = NULL, ano_min = 2019, ano_max = 2019 WHERE horario_id = 64;

-- MIERCOLES 15:30-16:55  
UPDATE horarios SET categoria = '2020-2021', nivel = 'NF', ano_min = 2020, ano_max = 2021 WHERE horario_id = 72;
UPDATE horarios SET categoria = '2019', nivel = 'I', ano_min = 2019, ano_max = 2019 WHERE horario_id = 73;
UPDATE horarios SET categoria = '2020-2021', nivel = NULL, ano_min = 2020, ano_max = 2021 WHERE horario_id = 74;
UPDATE horarios SET categoria = '2019', nivel = NULL, ano_min = 2019, ano_max = 2019 WHERE horario_id = 75;

-- MARTES 15:30-16:50
UPDATE horarios SET categoria = '2018-2019', nivel = 'NF', ano_min = 2018, ano_max = 2019 WHERE horario_id = 90;
UPDATE horarios SET categoria = '2020-2021', nivel = 'NF', ano_min = 2020, ano_max = 2021 WHERE horario_id = 91;
UPDATE horarios SET categoria = '2008-2009-2010-2011', nivel = 'NF', ano_min = 2008, ano_max = 2011 WHERE horario_id = 92;

-- JUEVES 15:30-16:50
UPDATE horarios SET categoria = '2018-2019', nivel = 'NF', ano_min = 2018, ano_max = 2019 WHERE horario_id = 97;
UPDATE horarios SET categoria = '2020-2021', nivel = 'NF', ano_min = 2020, ano_max = 2021 WHERE horario_id = 98;
UPDATE horarios SET categoria = '2008-2009-2010-2011', nivel = 'NF', ano_min = 2008, ano_max = 2011 WHERE horario_id = 99;

-- Verificar las actualizaciones para año 2019
SELECT 
  h.horario_id,
  d.nombre as deporte,
  h.dia,
  TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
  TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
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
