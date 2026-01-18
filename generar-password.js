/**
 * Genera un hash bcrypt para la contraseña del admin
 */
import bcrypt from 'bcryptjs';

const password = 'jaguares2025';
const hash = await bcrypt.hash(password, 10);

console.log('');
console.log('Password:', password);
console.log('Hash:', hash);
console.log('');
console.log('SQL para actualizar:');
console.log(`UPDATE administradores SET password_hash = '${hash}' WHERE usuario = 'admin';`);
console.log('');
