-- Agregar campos de pago a la tabla alumnos existente
USE jaguares_db;

ALTER TABLE alumnos
ADD COLUMN comprobante_pago_url TEXT AFTER foto_carnet_url,
ADD COLUMN estado_pago ENUM('pendiente', 'confirmado', 'rechazado') DEFAULT 'pendiente' AFTER estado,
ADD COLUMN fecha_pago TIMESTAMP NULL AFTER estado_pago,
ADD COLUMN monto_pago DECIMAL(10,2) NULL AFTER fecha_pago,
ADD COLUMN numero_operacion VARCHAR(50) NULL AFTER monto_pago,
ADD COLUMN notas_pago TEXT NULL AFTER numero_operacion;

-- Agregar índice para búsquedas por estado de pago
CREATE INDEX idx_estado_pago ON alumnos(estado_pago);

-- Mostrar estructura actualizada
DESCRIBE alumnos;
