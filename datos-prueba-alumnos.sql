-- Insertar datos de prueba de alumnos con pagos
USE jaguares_db;

-- Insertar alumnos de prueba
INSERT INTO alumnos (
  dni, nombres, apellido_paterno, apellido_materno, 
  fecha_nacimiento, sexo, telefono, email,
  apoderado, telefono_apoderado,
  estado, estado_pago, monto_pago, numero_operacion
) VALUES
-- Alumno 1: Pago pendiente
('12345678', 'Juan Carlos', 'Pérez', 'González', 
 '2010-05-15', 'Masculino', '987654321', 'juan.perez@email.com',
 'María González', '987654322',
 'activo', 'pendiente', NULL, NULL),

-- Alumno 2: Pago confirmado
('87654321', 'Ana María', 'López', 'Torres', 
 '2012-08-20', 'Femenino', '987654323', 'ana.lopez@email.com',
 'Pedro López', '987654324',
 'activo', 'confirmado', 150.00, 'OP-2024-001'),

-- Alumno 3: Pago pendiente
('11223344', 'Carlos Alberto', 'Rodríguez', 'Silva', 
 '2011-03-10', 'Masculino', '987654325', 'carlos.rodriguez@email.com',
 'Rosa Silva', '987654326',
 'activo', 'pendiente', NULL, NULL),

-- Alumno 4: Pago confirmado
('44332211', 'Sofía', 'Martínez', 'Ramírez', 
 '2013-11-05', 'Femenino', '987654327', 'sofia.martinez@email.com',
 'Luis Martínez', '987654328',
 'activo', 'confirmado', 180.00, 'OP-2024-002');

-- Obtener los alumno_id recién insertados
SET @alumno1 = (SELECT alumno_id FROM alumnos WHERE dni = '12345678');
SET @alumno2 = (SELECT alumno_id FROM alumnos WHERE dni = '87654321');
SET @alumno3 = (SELECT alumno_id FROM alumnos WHERE dni = '11223344');
SET @alumno4 = (SELECT alumno_id FROM alumnos WHERE dni = '44332211');

-- Obtener deporte_id
SET @futbol = (SELECT deporte_id FROM deportes WHERE nombre LIKE 'F%tbol%' AND nombre NOT LIKE '%Femenino%' LIMIT 1);
SET @futbol_fem = (SELECT deporte_id FROM deportes WHERE nombre LIKE '%F%tbol Femenino%' LIMIT 1);

-- Insertar inscripciones
-- Alumno 1 (pago pendiente): inscripciones pendientes/inactivas
INSERT INTO inscripciones (alumno_id, deporte_id, estado, plan, precio_mensual, fecha_inscripcion) VALUES
(@alumno1, @futbol, 'pendiente', 'Mensual', 150.00, NOW());

-- Alumno 2 (pago confirmado): inscripciones activas
INSERT INTO inscripciones (alumno_id, deporte_id, estado, plan, precio_mensual, fecha_inscripcion) VALUES
(@alumno2, @futbol, 'activa', 'Mensual', 150.00, NOW()),
(@alumno2, @futbol_fem, 'activa', 'Mensual', 150.00, NOW());

-- Alumno 3 (pago pendiente): inscripciones pendientes
INSERT INTO inscripciones (alumno_id, deporte_id, estado, plan, precio_mensual, fecha_inscripcion) VALUES
(@alumno3, @futbol, 'pendiente', 'Mensual', 150.00, NOW());

-- Alumno 4 (pago confirmado): inscripciones activas
INSERT INTO inscripciones (alumno_id, deporte_id, estado, plan, precio_mensual, fecha_inscripcion) VALUES
(@alumno4, @futbol_fem, 'activa', 'Mensual', 150.00, NOW()),
(@alumno4, @futbol, 'activa', 'Mensual', 150.00, NOW());

-- Mostrar resumen
SELECT 'ALUMNOS INSERTADOS' as Resumen;
SELECT dni, nombres, CONCAT(apellido_paterno, ' ', apellido_materno) as apellidos, estado_pago 
FROM alumnos 
WHERE dni IN ('12345678', '87654321', '11223344', '44332211');

SELECT 'INSCRIPCIONES CREADAS' as Resumen;
SELECT 
  a.dni,
  a.nombres,
  d.nombre as deporte,
  i.estado,
  i.precio_mensual
FROM inscripciones i
JOIN alumnos a ON i.alumno_id = a.alumno_id
JOIN deportes d ON i.deporte_id = d.deporte_id
WHERE a.dni IN ('12345678', '87654321', '11223344', '44332211')
ORDER BY a.dni, d.nombre;
