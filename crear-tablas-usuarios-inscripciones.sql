-- Tabla de usuarios (datos del formulario de inscripción)
CREATE TABLE IF NOT EXISTS usuarios (
  usuario_id INT PRIMARY KEY AUTO_INCREMENT,
  dni VARCHAR(20) UNIQUE NOT NULL,
  nombres VARCHAR(100) NOT NULL,
  apellidos VARCHAR(100) NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  edad INT,
  sexo ENUM('Masculino', 'Femenino', 'Mixto') NOT NULL,
  telefono VARCHAR(20),
  email VARCHAR(100),
  apoderado VARCHAR(200),
  direccion TEXT,
  seguro_tipo VARCHAR(50),
  condicion_medica TEXT,
  telefono_apoderado VARCHAR(20),
  url_dni_frontal TEXT,
  url_dni_reverso TEXT,
  url_foto_carnet TEXT,
  url_comprobante TEXT,
  estado_usuario ENUM('pendiente', 'activo', 'inactivo') DEFAULT 'pendiente',
  estado_pago ENUM('pendiente', 'confirmado', 'rechazado') DEFAULT 'pendiente',
  fecha_pago DATETIME NULL,
  monto_pago DECIMAL(10,2) NULL,
  numero_operacion VARCHAR(50) NULL,
  notas_pago TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dni (dni),
  INDEX idx_estado_pago (estado_pago),
  INDEX idx_estado_usuario (estado_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de inscripciones (relación usuario-horario)
CREATE TABLE IF NOT EXISTS inscripciones (
  inscripcion_id INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  horario_id INT NOT NULL,
  estado ENUM('activa', 'pendiente_pago', 'cancelada', 'inactiva') DEFAULT 'pendiente_pago',
  fecha_inscripcion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  FOREIGN KEY (horario_id) REFERENCES horarios(horario_id) ON DELETE CASCADE,
  UNIQUE KEY unique_inscripcion (usuario_id, horario_id),
  INDEX idx_usuario (usuario_id),
  INDEX idx_horario (horario_id),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agregar índices adicionales para mejorar performance en reportes
ALTER TABLE horarios ADD INDEX idx_dia (dia);
ALTER TABLE horarios ADD INDEX idx_categoria (categoria);
ALTER TABLE deportes ADD INDEX idx_nombre (nombre);
