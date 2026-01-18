-- Actualizar contraseña del admin con hash correcto para "jaguares2025"
UPDATE administradores 
SET password_hash = '$2b$10$2vkWQxvyqMLZrp1PJI11juEWxKfI8EzUJ1QiS7Kuw2edKjCkeXth6',
    failed_login_attempts = 0,
    locked_until = NULL
WHERE admin_id = 1;

SELECT 'Password actualizado correctamente' as resultado;
SELECT admin_id, usuario, email, LEFT(password_hash, 30) as hash_preview 
FROM administradores 
WHERE admin_id = 1;
