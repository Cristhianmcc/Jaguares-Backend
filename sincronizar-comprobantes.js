/**
 * SCRIPT PARA SINCRONIZAR COMPROBANTES DESDE GOOGLE SHEETS A MYSQL
 * 
 * Este script consulta Google Sheets y actualiza los comprobantes_pago_url
 * en la tabla alumnos de MySQL
 */

import { config } from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
config({ path: path.join(__dirname, '.env') });

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN;

// Configuración MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3308,
    user: process.env.DB_USER || 'jaguares_user',
    password: process.env.DB_PASSWORD || 'jaguares_pass',
    database: process.env.DB_NAME || 'jaguares_db',
    charset: 'utf8mb4'
};

async function sincronizarComprobantes() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     SINCRONIZACIÓN DE COMPROBANTES - SHEETS → MYSQL      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    let db;

    try {
        // Conectar a MySQL
        console.log('📡 Conectando a MySQL...');
        db = await mysql.createConnection(dbConfig);
        console.log('✅ Conectado a MySQL\n');

        // Obtener todos los alumnos que NO tienen comprobante en MySQL
        console.log('🔍 Buscando alumnos sin comprobante en MySQL...');
        const [alumnos] = await db.query(`
      SELECT a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.comprobante_pago_url
      FROM alumnos a
      INNER JOIN inscripciones i ON a.alumno_id = i.alumno_id
      WHERE a.comprobante_pago_url IS NULL
      AND i.estado = 'activa'
      ORDER BY a.dni
    `);

        console.log(`📊 Encontrados ${alumnos.length} alumnos sin comprobante\n`);

        if (alumnos.length === 0) {
            console.log('✅ Todos los alumnos activos tienen comprobante');
            return;
        }

        let actualizados = 0;
        let errores = 0;

        // Consultar cada alumno en Google Sheets
        for (const alumno of alumnos) {
            try {
                console.log(`🔍 Consultando DNI ${alumno.dni} (${alumno.nombres} ${alumno.apellido_paterno})...`);

                // Consultar Google Sheets
                const url = `${APPS_SCRIPT_URL}?action=consultar_inscripcion&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(alumno.dni)}`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.success && data.pago && data.pago.comprobante_url) {
                    const comprobanteUrl = data.pago.comprobante_url;

                    // Actualizar en MySQL
                    await db.query(
                        'UPDATE alumnos SET comprobante_pago_url = ? WHERE alumno_id = ?',
                        [comprobanteUrl, alumno.alumno_id]
                    );

                    console.log(`   ✅ Comprobante actualizado: ${comprobanteUrl.substring(0, 50)}...`);
                    actualizados++;
                } else {
                    console.log(`   ⚠️  No se encontró comprobante en Sheets`);
                }

                // Pequeña pausa para no saturar la API
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                errores++;
            }
        }

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                   RESULTADOS FINALES                      ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        console.log(`📊 Total alumnos procesados: ${alumnos.length}`);
        console.log(`✅ Comprobantes actualizados: ${actualizados}`);
        console.log(`❌ Errores: ${errores}`);
        console.log('');

    } catch (error) {
        console.error('❌ Error fatal:', error);
    } finally {
        if (db) {
            await db.end();
            console.log('🔌 Conexión MySQL cerrada');
        }
    }
}

// Ejecutar
sincronizarComprobantes().catch(console.error);
