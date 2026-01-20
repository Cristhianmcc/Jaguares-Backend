/**
 * Script para actualizar manualmente el comprobante de un DNI específico
 * desde Google Sheets a MySQL
 */

import { config } from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '.env') });

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN;

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3308,
    user: process.env.DB_USER || 'jaguares_user',
    password: process.env.DB_PASSWORD || 'jaguares_pass',
    database: process.env.DB_NAME || 'jaguares_db'
};

async function actualizarComprobante(dni) {
    let db;

    try {
        console.log(`\n🔍 Consultando Google Sheets para DNI: ${dni}...`);

        // Consultar Google Sheets
        const url = `${APPS_SCRIPT_URL}?action=consultar_inscripcion&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.success) {
            console.log(`❌ Error: ${data.error}`);
            return;
        }

        console.log(`✅ Datos recibidos de Google Sheets`);
        console.log(`   Nombre: ${data.alumno.nombres} ${data.alumno.apellidos}`);
        console.log(`   Estado pago: ${data.pago.estado}`);

        if (data.pago && data.pago.url_comprobante) {
            const urlComprobante = data.pago.url_comprobante;
            console.log(`   URL Comprobante: ${urlComprobante.substring(0, 60)}...`);

            // Conectar a MySQL
            console.log(`\n📡 Conectando a MySQL...`);
            db = await mysql.createConnection(dbConfig);
            console.log(`✅ Conectado`);

            // Actualizar en MySQL
            const [result] = await db.query(
                'UPDATE alumnos SET comprobante_pago_url = ? WHERE dni = ?',
                [urlComprobante, dni]
            );

            if (result.affectedRows > 0) {
                console.log(`\n✅ Comprobante actualizado exitosamente en MySQL`);
                console.log(`   Filas afectadas: ${result.affectedRows}`);
            } else {
                console.log(`\n⚠️  No se encontró alumno con DNI ${dni} en MySQL`);
            }

        } else {
            console.log(`\n⚠️  No se encontró URL de comprobante en Google Sheets`);
        }

    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
    } finally {
        if (db) {
            await db.end();
            console.log(`\n🔌 Conexión cerrada`);
        }
    }
}

// DNI a actualizar
const dni = process.argv[2] || '25446484';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     ACTUALIZAR COMPROBANTE DESDE GOOGLE SHEETS            ║');
console.log('╚════════════════════════════════════════════════════════════╝');

actualizarComprobante(dni).catch(console.error);
