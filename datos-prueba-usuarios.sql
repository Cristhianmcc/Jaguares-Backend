-- Insertar usuarios de prueba con diferentes estados de pago
USE jaguares_db;

-- Usuario 1: Con pago pendiente
INSERT INTO usuarios (
    dni, nombres, apellidos, fecha_nacimiento, edad, sexo, 
    telefono, email, apoderado, direccion, seguro_tipo,
    estado_usuario, estado_pago
) VALUES (
    '12345678', 'Juan Carlos', 'Pérez Gómez', '2010-05-15', 14, 'Masculino',
    '987654321', 'juan.perez@example.com', 'María Gómez', 'Av. Los Jaguares 123', 'EsSalud',
    'activo', 'pendiente'
);

-- Inscripción en Fútbol Lunes 16:00
INSERT INTO inscripciones (usuario_id, horario_id, estado)
SELECT u.usuario_id, h.horario_id, 'pendiente_pago'
FROM usuarios u
CROSS JOIN horarios h
INNER JOIN deportes d ON h.deporte_id = d.deporte_id
WHERE u.dni = '12345678'
  AND d.nombre = 'Fútbol'
  AND h.dia = 'LUNES'
  AND h.hora_inicio = '16:00:00'
LIMIT 1;

-- Usuario 2: Con pago confirmado
INSERT INTO usuarios (
    dni, nombres, apellidos, fecha_nacimiento, edad, sexo, 
    telefono, email, apoderado, direccion, seguro_tipo,
    estado_usuario, estado_pago, fecha_pago, monto_pago
) VALUES (
    '87654321', 'María Fernanda', 'López Torres', '2012-08-22', 12, 'Femenino',
    '912345678', 'maria.lopez@example.com', 'Pedro López', 'Jr. Los Tigres 456', 'Privado',
    'activo', 'confirmado', NOW(), 150.00
);

-- Inscripciones activas en Natación
INSERT INTO inscripciones (usuario_id, horario_id, estado)
SELECT u.usuario_id, h.horario_id, 'activa'
FROM usuarios u
CROSS JOIN horarios h
INNER JOIN deportes d ON h.deporte_id = d.deporte_id
WHERE u.dni = '87654321'
  AND d.nombre = 'Natación'
  AND h.dia = 'MARTES'
LIMIT 2;

-- Usuario 3: Inscrito en múltiples deportes - Pendiente
INSERT INTO usuarios (
    dni, nombres, apellidos, fecha_nacimiento, edad, sexo, 
    telefono, email, apoderado, direccion, seguro_tipo,
    url_comprobante, estado_usuario, estado_pago
) VALUES (
    '45678912', 'Carlos Alberto', 'Ramírez Silva', '2009-12-10', 15, 'Masculino',
    '998877665', 'carlos.ramirez@example.com', 'Ana Silva', 'Calle Los Deportes 789', 'EsSalud',
    'https://example.com/comprobante.jpg', 'activo', 'pendiente'
);

-- Inscripciones en Fútbol y Natación
INSERT INTO inscripciones (usuario_id, horario_id, estado)
SELECT u.usuario_id, h.horario_id, 'pendiente_pago'
FROM usuarios u
CROSS JOIN horarios h
INNER JOIN deportes d ON h.deporte_id = d.deporte_id
WHERE u.dni = '45678912'
  AND d.nombre IN ('Fútbol', 'Natación')
  AND h.dia IN ('LUNES', 'MIERCOLES')
LIMIT 3;

-- Usuario 4: Pago confirmado, múltiples horarios activos
INSERT INTO usuarios (
    dni, nombres, apellidos, fecha_nacimiento, edad, sexo, 
    telefono, email, apoderado, direccion, seguro_tipo,
    estado_usuario, estado_pago, fecha_pago, monto_pago, numero_operacion
) VALUES (
    '78912345', 'Sofía Valentina', 'García Mendoza', '2011-03-18', 13, 'Femenino',
    '923456789', 'sofia.garcia@example.com', 'Luis García', 'Av. Las Palmeras 321', 'Privado',
    'activo', 'confirmado', NOW(), 200.00, 'OP-2024-001'
);

-- Inscripciones activas en Fútbol (Lunes, Miércoles, Viernes)
INSERT INTO inscripciones (usuario_id, horario_id, estado)
SELECT u.usuario_id, h.horario_id, 'activa'
FROM usuarios u
CROSS JOIN horarios h
INNER JOIN deportes d ON h.deporte_id = d.deporte_id
WHERE u.dni = '78912345'
  AND d.nombre = 'Fútbol'
  AND h.dia IN ('LUNES', 'MIERCOLES', 'VIERNES')
  AND h.hora_inicio = '17:00:00'
LIMIT 3;

-- Usuario 5: Pendiente de pago
INSERT INTO usuarios (
    dni, nombres, apellidos, fecha_nacimiento, edad, sexo, 
    telefono, email, apoderado, direccion,
    url_comprobante, estado_usuario, estado_pago
) VALUES (
    '32165498', 'Diego Alejandro', 'Martínez Ruiz', '2013-07-25', 11, 'Masculino',
    '987123456', 'diego.martinez@example.com', 'Carmen Ruiz', 'Jr. Los Andes 654',
    'https://example.com/comprobante2.jpg', 'activo', 'pendiente'
);

-- Inscripción en Baloncesto
INSERT INTO inscripciones (usuario_id, horario_id, estado)
SELECT u.usuario_id, h.horario_id, 'pendiente_pago'
FROM usuarios u
CROSS JOIN horarios h
INNER JOIN deportes d ON h.deporte_id = d.deporte_id
WHERE u.dni = '32165498'
  AND d.nombre = 'Baloncesto'
  AND h.dia = 'JUEVES'
LIMIT 1;

-- Verificar datos insertados
SELECT 
    u.dni,
    u.nombres,
    u.apellidos,
    u.estado_pago,
    COUNT(i.inscripcion_id) as total_inscripciones,
    GROUP_CONCAT(DISTINCT d.nombre) as deportes
FROM usuarios u
LEFT JOIN inscripciones i ON u.usuario_id = i.usuario_id
LEFT JOIN horarios h ON i.horario_id = h.horario_id
LEFT JOIN deportes d ON h.deporte_id = d.deporte_id
GROUP BY u.usuario_id
ORDER BY u.created_at DESC;
