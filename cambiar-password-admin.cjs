/**
 * Script para cambiar la contraseña del administrador
 * Uso: node cambiar-password-admin.js <nueva_contraseña>
 */

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function cambiarPassword() {
    const nuevaPassword = process.argv[2];
    
    if (!nuevaPassword) {
        console.error('❌ Error: Debes proporcionar una contraseña');
        console.log('\nUso: node cambiar-password-admin.js <tu_nueva_contraseña>');
        console.log('Ejemplo: node cambiar-password-admin.js MiPassword123!');
        process.exit(1);
    }

    if (nuevaPassword.length < 6) {
        console.error('❌ Error: La contraseña debe tener al menos 6 caracteres');
        process.exit(1);
    }

    try {
        // Conectar a MySQL
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3307,
            user: process.env.DB_USER || 'jaguares_user',
            password: process.env.DB_PASSWORD || 'jaguares_pass',
            database: process.env.DB_NAME || 'jaguares_db'
        });

        console.log('✅ Conectado a MySQL');

        // Hashear la nueva contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(nuevaPassword, salt);

        // Actualizar en la base de datos
        const [result] = await connection.execute(
            'UPDATE administradores SET password = ?, updated_at = NOW() WHERE usuario = ?',
            [hashedPassword, 'admin']
        );

        if (result.affectedRows > 0) {
            console.log('\n✅ Contraseña actualizada exitosamente');
            console.log('\n📋 Credenciales de acceso:');
            console.log('   Usuario: admin');
            console.log('   Email:   admin@jaguares.com');
            console.log(`   Password: ${nuevaPassword}`);
            console.log('\n💡 Puedes usar el usuario o el email para iniciar sesión');
        } else {
            console.error('❌ No se encontró el usuario admin');
        }

        await connection.end();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

cambiarPassword();
