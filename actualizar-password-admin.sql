-- Actualizar contraseña del admin con hash bcrypt correcto
-- Contraseña: jaguares2025

UPDATE administradores 
SET password_hash = '$2b$10$BggPNMbTn6riuH1b0YmuBeKMmxmY7KGPWgfbBhq9yQ4yqI/554FB6',
    failed_login_attempts = 0,
    locked_until = NULL
WHERE usuario = 'admin';

-- Verificar
SELECT 
    admin_id, 
    usuario,
    email,
    nombre_completo,
    rol,
    LENGTH(password_hash) as hash_length,
    failed_login_attempts,
    estado
FROM administradores
WHERE usuario = 'admin';
