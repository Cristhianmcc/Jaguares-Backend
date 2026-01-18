const bcrypt = require('bcryptjs');

async function genHash() {
    const password = 'admin123';
    const hash = await bcrypt.hash(password, 10);
    console.log('\n✅ Hash generado para password: admin123');
    console.log('\nEjecuta este comando en PowerShell:\n');
    console.log(`$env:MYSQL_PWD='jaguares_pass'; mysql -u jaguares_user -h 127.0.0.1 -P 3307 -D jaguares_db -e "UPDATE administradores SET password_hash = '${hash}' WHERE usuario = 'admin';"`);
    console.log('\n');
}

genHash();
