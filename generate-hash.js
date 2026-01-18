import bcrypt from 'bcryptjs';

const password = 'Jaguares2025!';

bcrypt.hash(password, 10).then(hash => {
    console.log('\n=================================');
    console.log('Password:', password);
    console.log('Hash:', hash);
    console.log('=================================\n');
    
    console.log('Comando MySQL para actualizar:');
    console.log(`UPDATE administradores SET password_hash = '${hash}', failed_login_attempts = 0 WHERE usuario = 'admin';`);
});
