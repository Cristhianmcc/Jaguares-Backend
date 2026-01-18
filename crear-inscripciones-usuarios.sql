-- Crear nueva tabla inscripciones_usuarios para trabajar con la tabla usuarios
USE jaguares_db;

-- Eliminar si existe
DROP TABLE IF EXISTS inscripciones_usuarios;

-- Crear tabla
CREATE TABLE inscripciones_usuarios (
  inscripcion_usuario_id INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  horario_id INT NOT NULL,
  estado ENUM('pendiente_pago', 'activa', 'cancelada', 'inactiva') DEFAULT 'pendiente_pago',
  fecha_inscripcion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  FOREIGN KEY (horario_id) REFERENCES horarios(horario_id) ON DELETE CASCADE,
  UNIQUE KEY idx_usuario_horario (usuario_id, horario_id),
  INDEX idx_estado (estado),
  INDEX idx_horario (horario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Tabla inscripciones_usuarios creada exitosamente' as Resultado;
