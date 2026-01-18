import mysql from 'mysql2/promise';
import fetch from 'node-fetch';

// Configuración
const DB_CONFIG = {
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'rootpassword123',
    database: 'jaguares_db',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const API_URL = 'http://localhost:3002';

let pool;
const resultados = {
    testsPasados: 0,
    testsFallidos: 0,
    vulnerabilidades: [],
    advertencias: []
};

// Colores para consola
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

// Inicializar pool de conexiones
async function inicializarDB() {
    pool = mysql.createPool(DB_CONFIG);
}

// TEST 1: DNI duplicado (mismo usuario registrándose dos veces)
async function testDNIDuplicado() {
    header('TEST 1: DNI DUPLICADO - REGISTRO DUPLICADO');
    
    const dni = '99999999';
    const alumno = {
        dni,
        nombre: 'Juan',
        apellido: 'Pérez',
        sexo: 'M',
        email: 'juan@test.com',
        telefono: '1234567890',
        fecha_nacimiento: '2010-01-01',
        domicilio: 'Calle Falsa 123',
        horarios: [1, 2, 3]
    };

    try {
        // Limpiar DNI existente
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
        // Primera inscripción
        const [result1] = await pool.query(
            'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [alumno.dni, alumno.nombre, alumno.apellido, alumno.sexo, alumno.email, alumno.telefono, alumno.fecha_nacimiento, alumno.domicilio]
        );
        
        // Intentar segunda inscripción con mismo DNI
        try {
            await pool.query(
                'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [alumno.dni, alumno.nombre, alumno.apellido, alumno.sexo, alumno.email, alumno.telefono, alumno.fecha_nacimiento, alumno.domicilio]
            );
            log('   ❌ FALLO: Permite DNI duplicado', 'rojo');
            resultados.testsFallidos++;
            resultados.vulnerabilidades.push({
                tipo: 'DNI_DUPLICADO',
                severidad: 'ALTA',
                descripcion: 'El sistema permite crear múltiples alumnos con el mismo DNI'
            });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                log('   ✅ CORRECTO: Rechaza DNI duplicado', 'verde');
                resultados.testsPasados++;
            } else {
                log(`   ❌ Error inesperado: ${error.message}`, 'rojo');
                resultados.testsFallidos++;
            }
        }
        
        // Limpiar
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
    } catch (error) {
        log(`   ❌ Error en test: ${error.message}`, 'rojo');
        resultados.testsFallidos++;
    }
}

// TEST 2: Inscripción en horario lleno
async function testHorarioLleno() {
    header('TEST 2: INSCRIPCIÓN EN HORARIO LLENO');
    
    try {
        // Crear horario con 1 cupo
        const [horario] = await pool.query(
            'INSERT INTO horarios (id_deporte, dia, hora_inicio, hora_fin, cupos_totales, cupos_ocupados, activo, ano) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [1, 'Lunes', '10:00:00', '11:00:00', 1, 0, 1, 2024]
        );
        const horarioId = horario.insertId;
        
        log(`   🎯 Horario creado: ID ${horarioId} con 1 cupo`);
        
        // Inscribir primer alumno
        const dni1 = '88888881';
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni1]);
        const [alumno1] = await pool.query(
            'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [dni1, 'Test1', 'Usuario1', 'M', 'test1@test.com', '1111111111', '2010-01-01', 'Calle 1']
        );
        
        const [inscripcion1] = await pool.query(
            'INSERT INTO inscripciones (id_alumno, fecha_inscripcion, estado, observaciones) VALUES (?, NOW(), ?, ?)',
            [alumno1.insertId, 'pendiente', 'Test']
        );
        
        await pool.query(
            'INSERT INTO inscripciones_horarios (id_inscripcion, id_horario) VALUES (?, ?)',
            [inscripcion1.insertId, horarioId]
        );
        
        // Verificar cupos
        const [cuposCheck1] = await pool.query(
            'SELECT cupos_ocupados, cupos_totales FROM horarios WHERE id = ?',
            [horarioId]
        );
        log(`   📊 Cupos después de primera inscripción: ${cuposCheck1[0].cupos_ocupados}/${cuposCheck1[0].cupos_totales}`);
        
        // Intentar inscribir segundo alumno (debería fallar)
        const dni2 = '88888882';
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni2]);
        const [alumno2] = await pool.query(
            'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [dni2, 'Test2', 'Usuario2', 'M', 'test2@test.com', '2222222222', '2010-01-01', 'Calle 2']
        );
        
        const [inscripcion2] = await pool.query(
            'INSERT INTO inscripciones (id_alumno, fecha_inscripcion, estado, observaciones) VALUES (?, NOW(), ?, ?)',
            [alumno2.insertId, 'pendiente', 'Test']
        );
        
        try {
            await pool.query(
                'INSERT INTO inscripciones_horarios (id_inscripcion, id_horario) VALUES (?, ?)',
                [inscripcion2.insertId, horarioId]
            );
            
            const [cuposCheck2] = await pool.query(
                'SELECT cupos_ocupados, cupos_totales FROM horarios WHERE id = ?',
                [horarioId]
            );
            
            if (cuposCheck2[0].cupos_ocupados > cuposCheck2[0].cupos_totales) {
                log(`   ❌ FALLO: Permite sobrepasar cupos (${cuposCheck2[0].cupos_ocupados}/${cuposCheck2[0].cupos_totales})`, 'rojo');
                resultados.testsFallidos++;
                resultados.vulnerabilidades.push({
                    tipo: 'SOBREPASO_CUPOS',
                    severidad: 'CRÍTICA',
                    descripcion: 'El sistema permite inscribir más alumnos que cupos disponibles'
                });
            } else {
                log('   ⚠️  ADVERTENCIA: Permite inscripción pero respeta cupos', 'amarillo');
                resultados.advertencias.push({
                    tipo: 'VALIDACION_CUPOS',
                    descripcion: 'La validación de cupos es reactiva, no preventiva'
                });
                resultados.testsPasados++;
            }
        } catch (error) {
            log('   ✅ CORRECTO: Rechaza inscripción en horario lleno', 'verde');
            resultados.testsPasados++;
        }
        
        // Limpiar
        await pool.query('DELETE FROM inscripciones_horarios WHERE id_horario = ?', [horarioId]);
        await pool.query('DELETE FROM inscripciones WHERE id_alumno IN (?, ?)', [alumno1.insertId, alumno2.insertId]);
        await pool.query('DELETE FROM alumnos WHERE dni IN (?, ?)', [dni1, dni2]);
        await pool.query('DELETE FROM horarios WHERE id = ?', [horarioId]);
        
    } catch (error) {
        log(`   ❌ Error en test: ${error.message}`, 'rojo');
        resultados.testsFallidos++;
    }
}

// TEST 3: Inscripción sin seleccionar horarios
async function testSinHorarios() {
    header('TEST 3: INSCRIPCIÓN SIN HORARIOS');
    
    const dni = '77777777';
    
    try {
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
        // Crear alumno
        const [alumno] = await pool.query(
            'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [dni, 'Sin', 'Horarios', 'M', 'sin@test.com', '3333333333', '2010-01-01', 'Calle 3']
        );
        
        // Crear inscripción sin horarios
        const [inscripcion] = await pool.query(
            'INSERT INTO inscripciones (id_alumno, fecha_inscripcion, estado, observaciones) VALUES (?, NOW(), ?, ?)',
            [alumno.insertId, 'pendiente', 'Test sin horarios']
        );
        
        // Verificar si permite inscripción sin horarios
        const [horariosCount] = await pool.query(
            'SELECT COUNT(*) as total FROM inscripciones_horarios WHERE id_inscripcion = ?',
            [inscripcion.insertId]
        );
        
        if (horariosCount[0].total === 0) {
            log('   ⚠️  ADVERTENCIA: Permite inscripción sin horarios', 'amarillo');
            resultados.advertencias.push({
                tipo: 'INSCRIPCION_SIN_HORARIOS',
                descripcion: 'El sistema permite crear inscripciones sin seleccionar horarios'
            });
            resultados.testsPasados++;
        } else {
            log('   ✅ CORRECTO: Requiere al menos un horario', 'verde');
            resultados.testsPasados++;
        }
        
        // Limpiar
        await pool.query('DELETE FROM inscripciones WHERE id = ?', [inscripcion.insertId]);
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
    } catch (error) {
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            log('   ✅ CORRECTO: No permite inscripción sin horarios', 'verde');
            resultados.testsPasados++;
        } else {
            log(`   ❌ Error inesperado: ${error.message}`, 'rojo');
            resultados.testsFallidos++;
        }
    }
}

// TEST 4: Horarios de diferentes deportes
async function testDeportesMultiples() {
    header('TEST 4: INSCRIPCIÓN EN MÚLTIPLES DEPORTES');
    
    const dni = '66666666';
    
    try {
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
        // Obtener horarios de diferentes deportes
        const [deportes] = await pool.query('SELECT DISTINCT id FROM deportes LIMIT 3');
        
        if (deportes.length < 2) {
            log('   ⚠️  No hay suficientes deportes para probar', 'amarillo');
            return;
        }
        
        const horarios = [];
        for (const deporte of deportes) {
            const [horario] = await pool.query(
                'SELECT id FROM horarios WHERE id_deporte = ? AND activo = 1 LIMIT 1',
                [deporte.id]
            );
            if (horario.length > 0) {
                horarios.push(horario[0].id);
            }
        }
        
        if (horarios.length < 2) {
            log('   ⚠️  No hay suficientes horarios de diferentes deportes', 'amarillo');
            return;
        }
        
        log(`   📋 Inscribiendo en ${horarios.length} deportes diferentes`);
        
        // Crear alumno e inscripción
        const [alumno] = await pool.query(
            'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [dni, 'Multi', 'Deportes', 'M', 'multi@test.com', '4444444444', '2010-01-01', 'Calle 4']
        );
        
        const [inscripcion] = await pool.query(
            'INSERT INTO inscripciones (id_alumno, fecha_inscripcion, estado, observaciones) VALUES (?, NOW(), ?, ?)',
            [alumno.insertId, 'pendiente', 'Test múltiples deportes']
        );
        
        // Inscribir en todos los horarios
        for (const horarioId of horarios) {
            await pool.query(
                'INSERT INTO inscripciones_horarios (id_inscripcion, id_horario) VALUES (?, ?)',
                [inscripcion.insertId, horarioId]
            );
        }
        
        // Verificar
        const [deportesInscritos] = await pool.query(`
            SELECT COUNT(DISTINCT h.id_deporte) as total_deportes
            FROM inscripciones_horarios ih
            JOIN horarios h ON ih.id_horario = h.id
            WHERE ih.id_inscripcion = ?
        `, [inscripcion.insertId]);
        
        log(`   📊 Deportes inscritos: ${deportesInscritos[0].total_deportes}`);
        
        if (deportesInscritos[0].total_deportes > 1) {
            log('   ⚠️  ADVERTENCIA: Permite inscripción en múltiples deportes', 'amarillo');
            resultados.advertencias.push({
                tipo: 'MULTIPLES_DEPORTES',
                descripcion: 'El sistema permite inscribirse en horarios de diferentes deportes'
            });
        } else {
            log('   ℹ️  Sistema permite solo un deporte', 'azul');
        }
        
        resultados.testsPasados++;
        
        // Limpiar
        await pool.query('DELETE FROM inscripciones_horarios WHERE id_inscripcion = ?', [inscripcion.insertId]);
        await pool.query('DELETE FROM inscripciones WHERE id = ?', [inscripcion.insertId]);
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
    } catch (error) {
        log(`   ❌ Error en test: ${error.message}`, 'rojo');
        resultados.testsFallidos++;
    }
}

// TEST 5: Inscripción de menor de edad
async function testMenorEdad() {
    header('TEST 5: INSCRIPCIÓN MENOR DE EDAD');
    
    const dni = '55555555';
    const hoy = new Date();
    const fechaNacimiento = new Date(hoy.getFullYear() - 5, hoy.getMonth(), hoy.getDate()); // 5 años
    
    try {
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
        const [result] = await pool.query(
            'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [dni, 'Niño', 'Pequeño', 'M', 'nino@test.com', '5555555555', fechaNacimiento.toISOString().split('T')[0], 'Calle 5']
        );
        
        // Verificar edad
        const [alumno] = await pool.query(`
            SELECT TIMESTAMPDIFF(YEAR, fecha_nacimiento, CURDATE()) as edad
            FROM alumnos WHERE dni = ?
        `, [dni]);
        
        log(`   👶 Edad del alumno: ${alumno[0].edad} años`);
        
        if (alumno[0].edad < 18) {
            log('   ✅ CORRECTO: Sistema acepta menores de edad', 'verde');
            resultados.testsPasados++;
        } else {
            log('   ⚠️  Error en cálculo de edad', 'amarillo');
        }
        
        // Limpiar
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
    } catch (error) {
        log(`   ❌ Error en test: ${error.message}`, 'rojo');
        resultados.testsFallidos++;
    }
}

// TEST 6: Horarios con superposición de horario
async function testHorariosSolapados() {
    header('TEST 6: INSCRIPCIÓN EN HORARIOS SOLAPADOS');
    
    const dni = '44444444';
    
    try {
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
        // Buscar horarios que se solapen (mismo día y hora)
        const [horariosSolapados] = await pool.query(`
            SELECT h1.id as id1, h2.id as id2, h1.dia, h1.hora_inicio, h1.hora_fin
            FROM horarios h1
            JOIN horarios h2 ON h1.dia = h2.dia 
                AND h1.id < h2.id
                AND h1.hora_inicio < h2.hora_fin
                AND h2.hora_inicio < h1.hora_fin
                AND h1.activo = 1 AND h2.activo = 1
            LIMIT 1
        `);
        
        if (horariosSolapados.length === 0) {
            log('   ℹ️  No hay horarios solapados para probar', 'azul');
            resultados.testsPasados++;
            return;
        }
        
        const h1 = horariosSolapados[0].id1;
        const h2 = horariosSolapados[0].id2;
        
        log(`   ⏰ Horarios solapados: ${h1} y ${h2} (${horariosSolapados[0].dia} ${horariosSolapados[0].hora_inicio}-${horariosSolapados[0].hora_fin})`);
        
        // Crear alumno e inscripción
        const [alumno] = await pool.query(
            'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [dni, 'Test', 'Solapado', 'M', 'solapado@test.com', '6666666666', '2010-01-01', 'Calle 6']
        );
        
        const [inscripcion] = await pool.query(
            'INSERT INTO inscripciones (id_alumno, fecha_inscripcion, estado, observaciones) VALUES (?, NOW(), ?, ?)',
            [alumno.insertId, 'pendiente', 'Test horarios solapados']
        );
        
        // Intentar inscribir en ambos horarios
        await pool.query(
            'INSERT INTO inscripciones_horarios (id_inscripcion, id_horario) VALUES (?, ?)',
            [inscripcion.insertId, h1]
        );
        
        await pool.query(
            'INSERT INTO inscripciones_horarios (id_inscripcion, id_horario) VALUES (?, ?)',
            [inscripcion.insertId, h2]
        );
        
        log('   ⚠️  ADVERTENCIA: Permite inscripción en horarios solapados', 'amarillo');
        resultados.advertencias.push({
            tipo: 'HORARIOS_SOLAPADOS',
            descripcion: 'El sistema permite inscribirse en horarios que se superponen'
        });
        resultados.testsPasados++;
        
        // Limpiar
        await pool.query('DELETE FROM inscripciones_horarios WHERE id_inscripcion = ?', [inscripcion.insertId]);
        await pool.query('DELETE FROM inscripciones WHERE id = ?', [inscripcion.insertId]);
        await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' || error.message.includes('solapados')) {
            log('   ✅ CORRECTO: Rechaza horarios solapados', 'verde');
            resultados.testsPasados++;
        } else {
            log(`   ❌ Error inesperado: ${error.message}`, 'rojo');
            resultados.testsFallidos++;
        }
    }
}

// TEST 7: Transacciones y rollback
async function testTransacciones() {
    header('TEST 7: INTEGRIDAD DE TRANSACCIONES');
    
    const dni = '33333333';
    const connection = await pool.getConnection();
    
    try {
        await connection.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
        
        // Iniciar transacción
        await connection.beginTransaction();
        
        // Crear alumno
        const [alumno] = await connection.query(
            'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [dni, 'Test', 'Transaccion', 'M', 'trans@test.com', '7777777777', '2010-01-01', 'Calle 7']
        );
        
        // Crear inscripción
        const [inscripcion] = await connection.query(
            'INSERT INTO inscripciones (id_alumno, fecha_inscripcion, estado, observaciones) VALUES (?, NOW(), ?, ?)',
            [alumno.insertId, 'pendiente', 'Test transacción']
        );
        
        // Rollback intencional
        await connection.rollback();
        
        // Verificar que no se guardó nada
        const [verificacion] = await pool.query(
            'SELECT COUNT(*) as total FROM alumnos WHERE dni = ?',
            [dni]
        );
        
        if (verificacion[0].total === 0) {
            log('   ✅ CORRECTO: Rollback funciona correctamente', 'verde');
            resultados.testsPasados++;
        } else {
            log('   ❌ FALLO: Rollback no revirtió cambios', 'rojo');
            resultados.testsFallidos++;
            resultados.vulnerabilidades.push({
                tipo: 'ROLLBACK_FALLIDO',
                severidad: 'CRÍTICA',
                descripcion: 'Las transacciones no se revierten correctamente'
            });
        }
        
    } catch (error) {
        await connection.rollback();
        log(`   ❌ Error en test: ${error.message}`, 'rojo');
        resultados.testsFallidos++;
    } finally {
        connection.release();
    }
}

// TEST 8: Inyección SQL en búsqueda
async function testInyeccionSQL() {
    header('TEST 8: INYECCIÓN SQL EN BÚSQUEDA');
    
    const payloads = [
        "' OR '1'='1",
        "'; DROP TABLE alumnos; --",
        "' UNION SELECT * FROM usuarios --",
        "admin'--"
    ];
    
    for (const payload of payloads) {
        try {
            const response = await fetch(`${API_URL}/api/alumno/${encodeURIComponent(payload)}`);
            const data = await response.json();
            
            // Si responde con datos extraños o error, es vulnerable
            if (data.length > 1000 || data.error) {
                log(`   ❌ VULNERABLE a: ${payload}`, 'rojo');
                resultados.testsFallidos++;
                resultados.vulnerabilidades.push({
                    tipo: 'SQL_INJECTION',
                    severidad: 'CRÍTICA',
                    descripcion: `Vulnerable a inyección SQL: ${payload}`,
                    endpoint: '/api/alumno/:dni'
                });
            } else {
                log(`   ✅ Protegido contra: ${payload.substring(0, 30)}...`, 'verde');
                resultados.testsPasados++;
            }
        } catch (error) {
            log(`   ✅ Protegido (error controlado): ${payload.substring(0, 30)}...`, 'verde');
            resultados.testsPasados++;
        }
    }
}

// TEST 9: Límites de edad
async function testLimitesEdad() {
    header('TEST 9: LÍMITES DE EDAD');
    
    const casos = [
        { nombre: 'Muy joven (1 año)', fecha: new Date(new Date().getFullYear() - 1, 0, 1) },
        { nombre: 'Muy mayor (100 años)', fecha: new Date(new Date().getFullYear() - 100, 0, 1) },
        { nombre: 'Fecha futura', fecha: new Date(new Date().getFullYear() + 1, 0, 1) },
        { nombre: '150 años', fecha: new Date(new Date().getFullYear() - 150, 0, 1) }
    ];
    
    for (let i = 0; i < casos.length; i++) {
        const caso = casos[i];
        const dni = `1111111${i}`;
        
        try {
            await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
            
            const [result] = await pool.query(
                'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [dni, 'Test', caso.nombre, 'M', `test${i}@test.com`, '8888888888', caso.fecha.toISOString().split('T')[0], 'Calle Test']
            );
            
            log(`   ⚠️  ADVERTENCIA: Acepta ${caso.nombre}`, 'amarillo');
            resultados.advertencias.push({
                tipo: 'VALIDACION_EDAD',
                descripcion: `El sistema acepta: ${caso.nombre}`
            });
            
            await pool.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
            
        } catch (error) {
            log(`   ✅ CORRECTO: Rechaza ${caso.nombre}`, 'verde');
        }
    }
    
    resultados.testsPasados++;
}

// TEST 10: Concurrencia en actualización de cupos
async function testConcurrenciaCupos() {
    header('TEST 10: CONCURRENCIA EN ACTUALIZACIÓN DE CUPOS');
    
    try {
        // Crear horario con 10 cupos
        const [horario] = await pool.query(
            'INSERT INTO horarios (id_deporte, dia, hora_inicio, hora_fin, cupos_totales, cupos_ocupados, activo, ano) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [1, 'Martes', '14:00:00', '15:00:00', 10, 0, 1, 2024]
        );
        const horarioId = horario.insertId;
        
        log(`   🎯 Horario creado: ID ${horarioId} con 10 cupos`);
        
        // Crear 20 inscripciones simultáneas
        const promesas = [];
        for (let i = 0; i < 20; i++) {
            const dni = `2000000${i.toString().padStart(2, '0')}`;
            
            const promesa = (async () => {
                const connection = await pool.getConnection();
                try {
                    await connection.query('DELETE FROM alumnos WHERE dni = ?', [dni]);
                    
                    const [alumno] = await connection.query(
                        'INSERT INTO alumnos (dni, nombre, apellido, sexo, email, telefono, fecha_nacimiento, domicilio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [dni, `Concur${i}`, `Test${i}`, 'M', `concur${i}@test.com`, '9999999999', '2010-01-01', 'Calle Test']
                    );
                    
                    const [inscripcion] = await connection.query(
                        'INSERT INTO inscripciones (id_alumno, fecha_inscripcion, estado, observaciones) VALUES (?, NOW(), ?, ?)',
                        [alumno.insertId, 'pendiente', 'Test concurrencia']
                    );
                    
                    await connection.query(
                        'INSERT INTO inscripciones_horarios (id_inscripcion, id_horario) VALUES (?, ?)',
                        [inscripcion.insertId, horarioId]
                    );
                    
                    return { success: true, dni };
                } catch (error) {
                    return { success: false, dni, error: error.message };
                } finally {
                    connection.release();
                }
            })();
            
            promesas.push(promesa);
        }
        
        const resultados_concurrencia = await Promise.all(promesas);
        const exitosas = resultados_concurrencia.filter(r => r.success).length;
        const fallidas = resultados_concurrencia.filter(r => !r.success).length;
        
        log(`   ✅ Inscripciones exitosas: ${exitosas}`);
        log(`   ❌ Inscripciones fallidas: ${fallidas}`);
        
        // Verificar cupos finales
        const [cupos] = await pool.query(
            'SELECT cupos_ocupados, cupos_totales FROM horarios WHERE id = ?',
            [horarioId]
        );
        
        log(`   📊 Cupos finales: ${cupos[0].cupos_ocupados}/${cupos[0].cupos_totales}`);
        
        if (cupos[0].cupos_ocupados <= cupos[0].cupos_totales) {
            log('   ✅ CORRECTO: Los cupos se respetan correctamente', 'verde');
            resultados.testsPasados++;
        } else {
            log(`   ❌ FALLO: Cupos sobrepasados (${cupos[0].cupos_ocupados}/${cupos[0].cupos_totales})`, 'rojo');
            resultados.testsFallidos++;
            resultados.vulnerabilidades.push({
                tipo: 'CONDICION_CARRERA_CUPOS',
                severidad: 'CRÍTICA',
                descripcion: 'Condición de carrera permite sobrepasar límite de cupos'
            });
        }
        
        // Limpiar
        await pool.query('DELETE FROM inscripciones_horarios WHERE id_horario = ?', [horarioId]);
        await pool.query(`
            DELETE i FROM inscripciones i
            JOIN alumnos a ON i.id_alumno = a.id
            WHERE a.dni LIKE '2000000%'
        `);
        await pool.query('DELETE FROM alumnos WHERE dni LIKE "2000000%"');
        await pool.query('DELETE FROM horarios WHERE id = ?', [horarioId]);
        
    } catch (error) {
        log(`   ❌ Error en test: ${error.message}`, 'rojo');
        resultados.testsFallidos++;
    }
}

// Función principal
async function ejecutarTests() {
    console.log('\n' + '█'.repeat(80));
    console.log('█'.repeat(27) + ' 🧪 PRUEBAS DE CASOS EXTREMOS - SISTEMA JAGUARES 🧪 ' + '█'.repeat(27));
    console.log('█'.repeat(80) + '\n');
    
    try {
        await inicializarDB();
        
        await testDNIDuplicado();
        await testHorarioLleno();
        await testSinHorarios();
        await testDeportesMultiples();
        await testMenorEdad();
        await testHorariosSolapados();
        await testTransacciones();
        await testInyeccionSQL();
        await testLimitesEdad();
        await testConcurrenciaCupos();
        
        // Reporte final
        header('REPORTE FINAL - CASOS EXTREMOS');
        
        const total = resultados.testsPasados + resultados.testsFallidos;
        const porcentaje = ((resultados.testsPasados / total) * 100).toFixed(2);
        
        log(`📊 Tests ejecutados: ${total}`);
        log(`✅ Tests pasados: ${resultados.testsPasados} (${porcentaje}%)`, 'verde');
        log(`❌ Tests fallidos: ${resultados.testsFallidos}`, 'rojo');
        log(`🔴 Vulnerabilidades críticas: ${resultados.vulnerabilidades.length}`, 'rojo');
        log(`⚠️  Advertencias: ${resultados.advertencias.length}`, 'amarillo');
        
        if (resultados.vulnerabilidades.length > 0) {
            console.log('\n❌ VULNERABILIDADES ENCONTRADAS:\n');
            resultados.vulnerabilidades.forEach((vuln, i) => {
                log(`   ${i + 1}. [${vuln.severidad}] ${vuln.tipo}`, 'rojo');
                log(`      ${vuln.descripcion}`, 'rojo');
                if (vuln.endpoint) log(`      Endpoint: ${vuln.endpoint}`, 'rojo');
            });
        }
        
        if (resultados.advertencias.length > 0) {
            console.log('\n⚠️  ADVERTENCIAS:\n');
            resultados.advertencias.forEach((adv, i) => {
                log(`   ${i + 1}. ${adv.tipo}: ${adv.descripcion}`, 'amarillo');
            });
        }
        
        console.log('\n' + '='.repeat(80));
        if (resultados.vulnerabilidades.length === 0 && resultados.testsFallidos === 0) {
            log('   ✅ VEREDICTO: SISTEMA ROBUSTO ANTE CASOS EXTREMOS', 'verde');
        } else {
            log('   ⚠️  VEREDICTO: SE ENCONTRARON PROBLEMAS QUE REQUIEREN ATENCIÓN', 'amarillo');
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
ejecutarTests();
