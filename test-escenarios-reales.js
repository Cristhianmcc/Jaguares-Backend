/**
 * PRUEBAS DE ESCENARIOS REALES - SISTEMA JAGUARES
 * 
 * Simula escenarios reales de uso que podrían encontrarse en producción
 */

import mysql from 'mysql2/promise';
import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

const API_URL = 'http://localhost:3002';
const DB_CONFIG = {
  host: 'localhost',
  port: 3307,
  user: 'root',
  password: 'rootpassword123',
  database: 'jaguares_db'
};

let pool;
const resultados = {
    escenariosPasados: 0,
    escenariosProblematicos: 0,
    observaciones: []
};

// Colores
const colores = {
    reset: '\x1b[0m',
    rojo: '\x1b[31m',
    verde: '\x1b[32m',
    amarillo: '\x1b[33m',
    azul: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(mensaje, color = 'reset') {
    console.log(`${colores[color]}${mensaje}${colores.reset}`);
}

function header(titulo) {
    console.log('\n' + '='.repeat(80));
    console.log(titulo.padStart((80 + titulo.length) / 2));
    console.log('='.repeat(80) + '\n');
}

async function inicializarDB() {
    pool = mysql.createPool(DB_CONFIG);
}

// ESCENARIO 1: Familia completa (mamá inscribe 3 hijos)
async function escenarioFamiliaCompleta() {
    header('ESCENARIO 1: FAMILIA INSCRIBE 3 HIJOS');
    
    const inicio = performance.now();
    const hijos = [
        { dni: '45000001', nombres: 'Juan', apellido_paterno: 'García', apellido_materno: 'López', fecha_nacimiento: '2010-03-15' },
        { dni: '45000002', nombres: 'María', apellido_paterno: 'García', apellido_materno: 'López', fecha_nacimiento: '2012-06-20' },
        { dni: '45000003', nombres: 'Pedro', apellido_paterno: 'García', apellido_materno: 'López', fecha_nacimiento: '2014-09-10' }
    ];
    
    try {
        log('   👨‍👩‍👧‍👦 Inscribiendo familia de 3 hermanos...');
        
        // Limpiar datos anteriores
        for (const hijo of hijos) {
            await pool.query('DELETE FROM alumnos WHERE dni = ?', [hijo.dni]);
        }
        
        // Obtener horarios disponibles
        const [horarios] = await pool.query(`
            SELECT horario_id, cupo_maximo, cupos_ocupados 
            FROM horarios 
            WHERE estado = 'activo' AND cupos_ocupados < cupo_maximo
            LIMIT 5
        `);
        
        if (horarios.length === 0) {
            log('   ⚠️  No hay horarios disponibles', 'amarillo');
            resultados.observaciones.push({
                escenario: 'FAMILIA_COMPLETA',
                tipo: 'SIN_HORARIOS',
                descripcion: 'No hay horarios con cupos disponibles'
            });
            return;
        }
        
        const horariosIds = horarios.slice(0, 3).map(h => h.horario_id);
        let inscripcionesExitosas = 0;
        
        for (const hijo of hijos) {
            try {
                // Insertar alumno
                const [alumno] = await pool.query(`
                    INSERT INTO alumnos 
                    (dni, nombres, apellido_paterno, apellido_materno, sexo, email, telefono, 
                     fecha_nacimiento, domicilio, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `, [
                    hijo.dni,
                    hijo.nombres,
                    hijo.apellido_paterno,
                    hijo.apellido_materno,
                    hijo.nombres === 'María' ? 'F' : 'M',
                    `${hijo.nombres.toLowerCase()}@familia.com`,
                    '1234567890',
                    hijo.fecha_nacimiento,
                    'Av. Principal 123'
                ]);
                
                // Crear inscripción
                const [inscripcion] = await pool.query(`
                    INSERT INTO inscripciones 
                    (alumno_id, fecha_inscripcion, estado_inscripcion, created_at)
                    VALUES (?, NOW(), 'pendiente', NOW())
                `, [alumno.insertId]);
                
                // Asignar horarios
                for (const horarioId of horariosIds) {
                    await pool.query(`
                        INSERT INTO inscripcion_horarios (inscripcion_id, horario_id)
                        VALUES (?, ?)
                    `, [inscripcion.insertId, horarioId]);
                }
                
                inscripcionesExitosas++;
                log(`   ✅ ${hijo.nombres} inscrito exitosamente`, 'verde');
                
            } catch (error) {
                log(`   ❌ Error inscribiendo a ${hijo.nombres}: ${error.message}`, 'rojo');
                resultados.observaciones.push({
                    escenario: 'FAMILIA_COMPLETA',
                    tipo: 'ERROR_INSCRIPCION',
                    descripcion: `Fallo al inscribir a ${hijo.nombres}: ${error.message}`
                });
            }
        }
        
        const fin = performance.now();
        const tiempo = ((fin - inicio) / 1000).toFixed(2);
        
        log(`\n   📊 Resultado: ${inscripcionesExitosas}/${hijos.length} hermanos inscritos`);
        log(`   ⏱️  Tiempo total: ${tiempo}s`);
        
        if (inscripcionesExitosas === hijos.length) {
            log('   ✅ ESCENARIO EXITOSO', 'verde');
            resultados.escenariosPasados++;
        } else {
            log('   ⚠️  ESCENARIO CON PROBLEMAS', 'amarillo');
            resultados.escenariosProblematicos++;
        }
        
    } catch (error) {
        log(`   ❌ Error general: ${error.message}`, 'rojo');
        resultados.escenariosProblematicos++;
    }
}

// ESCENARIO 2: Llegada de 10 personas al mismo tiempo (horario de oficina)
async function escenarioHoraPico() {
    header('ESCENARIO 2: HORA PICO - 10 INSCRIPCIONES SIMULTÁNEAS');
    
    const inicio = performance.now();
    
    try {
        log('   🕐 Simulando llegada simultánea de 10 personas...');
        
        // Obtener horarios con cupos
        const [horarios] = await pool.query(`
            SELECT horario_id, cupo_maximo, cupos_ocupados 
            FROM horarios 
            WHERE estado = 'activo' AND cupos_ocupados < cupo_maximo
            LIMIT 3
        `);
        
        if (horarios.length === 0) {
            log('   ⚠️  No hay horarios disponibles', 'amarillo');
            return;
        }
        
        const horariosIds = horarios.map(h => h.horario_id);
        
        // Crear 10 inscripciones simultáneas
        const promesas = [];
        for (let i = 0; i < 10; i++) {
            const promesa = (async () => {
                const dni = `46000${i.toString().padStart(3, '0')}`;
                
                try {
                    await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
                    
                    const [alumno] = await pool.query(`
                        INSERT INTO alumnos 
                        (dni, nombres, apellido_paterno, apellido_materno, sexo, email, telefono, 
                         fecha_nacimiento, domicilio, created_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                    `, [
                        dni,
                        `Persona${i}`,
                        'Test',
                        'Simultaneo',
                        i % 2 === 0 ? 'M' : 'F',
                        `persona${i}@test.com`,
                        '9876543210',
                        '2008-01-01',
                        `Calle ${i}`
                    ]);
                    
                    const [inscripcion] = await pool.query(`
                        INSERT INTO inscripciones 
                        (alumno_id, fecha_inscripcion, estado_inscripcion, created_at)
                        VALUES (?, NOW(), 'pendiente', NOW())
                    `, [alumno.insertId]);
                    
                    // Seleccionar 2-3 horarios aleatorios
                    const numHorarios = Math.floor(Math.random() * 2) + 2;
                    const horariosSeleccionados = horariosIds.slice(0, numHorarios);
                    
                    for (const horarioId of horariosSeleccionados) {
                        await pool.query(`
                            INSERT INTO inscripcion_horarios (inscripcion_id, horario_id)
                            VALUES (?, ?)
                        `, [inscripcion.insertId, horarioId]);
                    }
                    
                    return { success: true, dni, numHorarios: horariosSeleccionados.length };
                } catch (error) {
                    return { success: false, dni, error: error.message };
                }
            })();
            
            promesas.push(promesa);
        }
        
        const resultados_inscrip = await Promise.all(promesas);
        const exitosos = resultados_inscrip.filter(r => r.success).length;
        const fallidos = resultados_inscrip.filter(r => !r.success).length;
        
        const fin = performance.now();
        const tiempo = ((fin - inicio) / 1000).toFixed(2);
        const tiempoPromedio = ((fin - inicio) / exitosos).toFixed(2);
        
        log(`\n   📊 Resultados:`);
        log(`   ✅ Exitosos: ${exitosos}/10`, exitosos === 10 ? 'verde' : 'amarillo');
        log(`   ❌ Fallidos: ${fallidos}/10`, fallidos === 0 ? 'verde' : 'rojo');
        log(`   ⏱️  Tiempo total: ${tiempo}s`);
        log(`   ⚡ Tiempo promedio por inscripción: ${tiempoPromedio}ms`);
        
        if (fallidos > 0) {
            log('\n   ⚠️  Errores encontrados:', 'amarillo');
            resultados_inscrip
                .filter(r => !r.success)
                .forEach(r => log(`      - DNI ${r.dni}: ${r.error}`, 'rojo'));
        }
        
        if (exitosos >= 8) {
            log('\n   ✅ ESCENARIO EXITOSO (≥80% éxito)', 'verde');
            resultados.escenariosPasados++;
        } else {
            log('\n   ❌ ESCENARIO PROBLEMÁTICO (<80% éxito)', 'rojo');
            resultados.escenariosProblematicos++;
        }
        
    } catch (error) {
        log(`   ❌ Error general: ${error.message}`, 'rojo');
        resultados.escenariosProblematicos++;
    }
}

// ESCENARIO 3: Alumno cambia de deporte (cancela y re-inscribe)
async function escenarioCambioDeporte() {
    header('ESCENARIO 3: ALUMNO CAMBIA DE DEPORTE');
    
    const dni = '47000001';
    
    try {
        log('   🔄 Simulando cambio de deporte...');
        
        // Limpiar
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
        // Obtener 2 deportes diferentes
        const [deportes] = await pool.query('SELECT deporte_id, nombre FROM deportes LIMIT 2');
        
        if (deportes.length < 2) {
            log('   ⚠️  No hay suficientes deportes', 'amarillo');
            return;
        }
        
        log(`   📋 Deporte original: ${deportes[0].nombre}`);
        log(`   📋 Deporte nuevo: ${deportes[1].nombre}`);
        
        // Crear alumno
        const [alumno] = await pool.query(`
            INSERT INTO alumnos 
            (dni, nombres, apellido_paterno, apellido_materno, sexo, email, telefono, 
             fecha_nacimiento, domicilio, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [dni, 'Cambio', 'Deporte', 'Test', 'M', 'cambio@test.com', '1111111111', '2009-05-15', 'Calle Cambio']);
        
        // Inscribir en primer deporte
        const [horario1] = await pool.query(`
            SELECT horario_id FROM horarios 
            WHERE deporte_id = ? AND estado = 'activo' AND cupos_ocupados < cupo_maximo
            LIMIT 1
        `, [deportes[0].deporte_id]);
        
        if (horario1.length === 0) {
            log('   ⚠️  No hay horarios del primer deporte', 'amarillo');
            return;
        }
        
        const [inscripcion1] = await pool.query(`
            INSERT INTO inscripciones 
            (alumno_id, fecha_inscripcion, estado_inscripcion, created_at)
            VALUES (?, NOW(), 'confirmado', NOW())
        `, [alumno.insertId]);
        
        await pool.query(`
            INSERT INTO inscripcion_horarios (inscripcion_id, horario_id)
            VALUES (?, ?)
        `, [inscripcion1.insertId, horario1[0].horario_id]);
        
        log(`   ✅ Inscrito en ${deportes[0].nombre}`, 'verde');
        
        // Cancelar inscripción
        await pool.query(`
            UPDATE inscripciones 
            SET estado_inscripcion = 'cancelado'
            WHERE inscripcion_id = ?
        `, [inscripcion1.insertId]);
        
        log(`   🚫 Inscripción cancelada`, 'amarillo');
        
        // Nueva inscripción en segundo deporte
        const [horario2] = await pool.query(`
            SELECT horario_id FROM horarios 
            WHERE deporte_id = ? AND estado = 'activo' AND cupos_ocupados < cupo_maximo
            LIMIT 1
        `, [deportes[1].deporte_id]);
        
        if (horario2.length === 0) {
            log('   ⚠️  No hay horarios del segundo deporte', 'amarillo');
            return;
        }
        
        const [inscripcion2] = await pool.query(`
            INSERT INTO inscripciones 
            (alumno_id, fecha_inscripcion, estado_inscripcion, created_at)
            VALUES (?, NOW(), 'pendiente', NOW())
        `, [alumno.insertId]);
        
        await pool.query(`
            INSERT INTO inscripcion_horarios (inscripcion_id, horario_id)
            VALUES (?, ?)
        `, [inscripcion2.insertId, horario2[0].horario_id]);
        
        log(`   ✅ Re-inscrito en ${deportes[1].nombre}`, 'verde');
        
        // Verificar estado
        const [verificacion] = await pool.query(`
            SELECT 
                i.estado_inscripcion,
                d.nombre as deporte,
                h.dia,
                h.hora_inicio
            FROM inscripciones i
            JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
            JOIN horarios h ON ih.horario_id = h.horario_id
            JOIN deportes d ON h.deporte_id = d.deporte_id
            WHERE i.alumno_id = ?
            ORDER BY i.created_at DESC
        `, [alumno.insertId]);
        
        log(`\n   📊 Historial de inscripciones:`);
        verificacion.forEach((v, idx) => {
            log(`      ${idx + 1}. ${v.deporte} - ${v.dia} ${v.hora_inicio} [${v.estado_inscripcion}]`);
        });
        
        log('\n   ✅ ESCENARIO EXITOSO', 'verde');
        resultados.escenariosPasados++;
        
    } catch (error) {
        log(`   ❌ Error: ${error.message}`, 'rojo');
        resultados.escenariosProblematicos++;
    }
}

// ESCENARIO 4: Consulta de alumno existente
async function escenarioConsultaAlumno() {
    header('ESCENARIO 4: CONSULTA DE ALUMNO EXISTENTE');
    
    try {
        log('   🔍 Consultando alumnos inscritos...');
        
        const [alumnos] = await pool.query(`
            SELECT 
                a.dni,
                a.nombres,
                a.apellido_paterno,
                COUNT(DISTINCT i.inscripcion_id) as total_inscripciones,
                COUNT(DISTINCT ih.horario_id) as total_horarios
            FROM alumnos a
            LEFT JOIN inscripciones i ON a.alumno_id = i.alumno_id
            LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
            GROUP BY a.alumno_id
            LIMIT 5
        `);
        
        log(`\n   📊 Encontrados ${alumnos.length} alumnos:`);
        
        for (const alumno of alumnos) {
            log(`\n   👤 ${alumno.nombres} ${alumno.apellido_paterno}`);
            log(`      DNI: ${alumno.dni}`);
            log(`      Inscripciones: ${alumno.total_inscripciones}`);
            log(`      Horarios: ${alumno.total_horarios}`);
            
            // Consultar via API
            try {
                const response = await fetch(`${API_URL}/api/alumno/${alumno.dni}`);
                const data = await response.json();
                
                if (response.ok) {
                    log(`      ✅ API responde correctamente`, 'verde');
                } else {
                    log(`      ⚠️  API error: ${data.message}`, 'amarillo');
                }
            } catch (error) {
                log(`      ❌ API no disponible: ${error.message}`, 'rojo');
            }
        }
        
        log('\n   ✅ ESCENARIO COMPLETADO', 'verde');
        resultados.escenariosPasados++;
        
    } catch (error) {
        log(`   ❌ Error: ${error.message}`, 'rojo');
        resultados.escenariosProblematicos++;
    }
}

// ESCENARIO 5: Verificación de cupos
async function escenarioVerificacionCupos() {
    header('ESCENARIO 5: VERIFICACIÓN DE CUPOS');
    
    try {
        log('   📊 Analizando cupos en horarios...');
        
        const [estadisticas] = await pool.query(`
            SELECT 
                h.horario_id,
                d.nombre as deporte,
                h.dia,
                h.hora_inicio,
                h.cupo_maximo,
                h.cupos_ocupados,
                COUNT(ih.horario_id) as inscripciones_reales,
                (h.cupo_maximo - h.cupos_ocupados) as cupos_disponibles
            FROM horarios h
            JOIN deportes d ON h.deporte_id = d.deporte_id
            LEFT JOIN inscripcion_horarios ih ON h.horario_id = ih.horario_id
            WHERE h.estado = 'activo'
            GROUP BY h.horario_id
            ORDER BY h.cupos_ocupados DESC
            LIMIT 10
        `);
        
        log(`\n   📋 Top 10 horarios más demandados:\n`);
        
        let inconsistencias = 0;
        
        estadisticas.forEach((stat, idx) => {
            const porcentaje = ((stat.cupos_ocupados / stat.cupo_maximo) * 100).toFixed(0);
            const inconsistente = stat.cupos_ocupados !== stat.inscripciones_reales;
            
            log(`   ${idx + 1}. ${stat.deporte} - ${stat.dia} ${stat.hora_inicio}`);
            log(`      Cupos: ${stat.cupos_ocupados}/${stat.cupo_maximo} (${porcentaje}%)`);
            log(`      Inscripciones reales: ${stat.inscripciones_reales}`);
            
            if (inconsistente) {
                log(`      ⚠️  INCONSISTENCIA DETECTADA`, 'amarillo');
                inconsistencias++;
                resultados.observaciones.push({
                    escenario: 'VERIFICACION_CUPOS',
                    tipo: 'INCONSISTENCIA',
                    descripcion: `Horario ${stat.horario_id}: Registrado=${stat.cupos_ocupados}, Real=${stat.inscripciones_reales}`
                });
            }
            log('');
        });
        
        if (inconsistencias === 0) {
            log('   ✅ Todos los cupos son consistentes', 'verde');
            resultados.escenariosPasados++;
        } else {
            log(`   ⚠️  Se encontraron ${inconsistencias} inconsistencias`, 'amarillo');
            resultados.escenariosProblematicos++;
        }
        
    } catch (error) {
        log(`   ❌ Error: ${error.message}`, 'rojo');
        resultados.escenariosProblematicos++;
    }
}

// Función principal
async function ejecutarEscenarios() {
    console.log('\n' + '█'.repeat(80));
    console.log('█'.repeat(23) + ' 📋 PRUEBAS DE ESCENARIOS REALES - SISTEMA JAGUARES 📋 ' + '█'.repeat(23));
    console.log('█'.repeat(80) + '\n');
    
    const inicioTotal = performance.now();
    
    try {
        await inicializarDB();
        
        await escenarioFamiliaCompleta();
        await escenarioHoraPico();
        await escenarioCambioDeporte();
        await escenarioConsultaAlumno();
        await escenarioVerificacionCupos();
        
        const finTotal = performance.now();
        const tiempoTotal = ((finTotal - inicioTotal) / 1000).toFixed(2);
        
        // Reporte final
        header('REPORTE FINAL - ESCENARIOS REALES');
        
        const total = resultados.escenariosPasados + resultados.escenariosProblematicos;
        const porcentaje = total > 0 ? ((resultados.escenariosPasados / total) * 100).toFixed(2) : 0;
        
        log(`📊 Escenarios ejecutados: ${total}`);
        log(`✅ Exitosos: ${resultados.escenariosPasados} (${porcentaje}%)`, 'verde');
        log(`⚠️  Problemáticos: ${resultados.escenariosProblematicos}`, 'amarillo');
        log(`⏱️  Tiempo total: ${tiempoTotal}s`);
        
        if (resultados.observaciones.length > 0) {
            console.log('\n📝 OBSERVACIONES:\n');
            resultados.observaciones.forEach((obs, idx) => {
                log(`   ${idx + 1}. [${obs.escenario}] ${obs.tipo}`, 'amarillo');
                log(`      ${obs.descripcion}`, 'amarillo');
            });
        }
        
        console.log('\n' + '='.repeat(80));
        if (resultados.escenariosProblematicos === 0) {
            log('   ✅ VEREDICTO: TODOS LOS ESCENARIOS FUNCIONAN CORRECTAMENTE', 'verde');
        } else {
            log('   ⚠️  VEREDICTO: ALGUNOS ESCENARIOS REQUIEREN ATENCIÓN', 'amarillo');
        }
        console.log('='.repeat(80));
        
    } catch (error) {
        log(`\n❌ Error fatal: ${error.message}`, 'rojo');
        console.error(error);
    } finally {
        if (pool) {
            await pool.end();
        }
        process.exit(0);
    }
}

// Ejecutar
ejecutarEscenarios();
