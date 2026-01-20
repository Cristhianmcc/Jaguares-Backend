/**
 * SCRIPT DE PRUEBA DE CARGA - SISTEMA JAGUARES
 * Simula inscripciones de usuarios para probar el sistema
 */

const API_BASE = 'http://localhost:3002';

// Datos de prueba realistas
const nombres = ['Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Carmen', 'Pedro', 'Laura', 'Miguel', 'Sofia'];
const apellidosPaternos = ['García', 'Rodríguez', 'López', 'Martínez', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores'];
const apellidosMaternos = ['Silva', 'Rojas', 'Mendoza', 'Castro', 'Vargas', 'Reyes', 'Morales', 'Ortiz', 'Gutiérrez', 'Chávez'];

// Configuración de la prueba
const CONFIG = {
    totalUsuarios: 20,        // Número de usuarios a crear
    concurrencia: 5,          // Usuarios simultáneos
    delayEntreGrupos: 2000,   // Delay entre grupos (ms)
    timeout: 30000            // Timeout por request (ms)
};

// Estadísticas
const stats = {
    exitosos: 0,
    fallidos: 0,
    tiempos: [],
    errores: []
};

/**
 * Generar DNI único
 */
function generarDNI() {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return (timestamp.slice(-5) + random).slice(0, 8);
}

/**
 * Generar fecha de nacimiento aleatoria
 */
function generarFechaNacimiento() {
    const year = 2000 + Math.floor(Math.random() * 15); // 2000-2014
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * 28) + 1;
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/**
 * Generar teléfono aleatorio
 */
function generarTelefono() {
    return '9' + Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
}

/**
 * Obtener horarios disponibles
 */
async function obtenerHorarios(añoNacimiento) {
    try {
        const response = await fetch(`${API_BASE}/api/horarios?ano_nacimiento=${añoNacimiento}`, {
            signal: AbortSignal.timeout(CONFIG.timeout)
        });
        const data = await response.json();
        return data.horarios || [];
    } catch (error) {
        console.error('❌ Error obteniendo horarios:', error.message);
        return [];
    }
}

/**
 * Crear datos de alumno de prueba
 */
function crearDatosAlumno(index) {
    const nombre = nombres[Math.floor(Math.random() * nombres.length)];
    const apellidoP = apellidosPaternos[Math.floor(Math.random() * apellidosPaternos.length)];
    const apellidoM = apellidosMaternos[Math.floor(Math.random() * apellidosMaternos.length)];
    const sexo = Math.random() > 0.5 ? 'Masculino' : 'Femenino';
    const fechaNac = generarFechaNacimiento();

    return {
        dni: generarDNI(),
        nombres: `${nombre} Test${index}`,
        apellido_paterno: apellidoP,
        apellido_materno: apellidoM,
        fecha_nacimiento: fechaNac,
        sexo: sexo,
        telefono: generarTelefono(),
        email: `test${index}_${Date.now()}@jaguares.test`,
        direccion: `Av. Prueba ${index}, Lima`,
        seguro_tipo: 'SIS',
        condicion_medica: 'Ninguna',
        apoderado: `Apoderado ${apellidoP}`,
        telefono_apoderado: generarTelefono()
    };
}

/**
 * Simular inscripción de un usuario
 */
async function inscribirUsuario(index) {
    const inicio = Date.now();

    try {
        console.log(`\n🔄 [${index}] Iniciando inscripción...`);

        // 1. Crear datos del alumno
        const alumno = crearDatosAlumno(index);
        console.log(`   📝 DNI: ${alumno.dni} | Nombre: ${alumno.nombres} ${alumno.apellido_paterno}`);

        // 2. Obtener año de nacimiento
        const añoNacimiento = new Date(alumno.fecha_nacimiento).getFullYear();
        console.log(`   📅 Año nacimiento: ${añoNacimiento}`);

        // 3. Obtener horarios disponibles
        console.log(`   🔍 Buscando horarios disponibles...`);
        const horarios = await obtenerHorarios(añoNacimiento);

        if (horarios.length === 0) {
            throw new Error('No hay horarios disponibles para esta edad');
        }

        console.log(`   ✅ ${horarios.length} horarios disponibles`);

        // 4. Seleccionar 1-3 horarios aleatorios
        const numHorarios = Math.min(Math.floor(Math.random() * 3) + 1, horarios.length);
        const horariosSeleccionados = [];
        const horariosDisponibles = [...horarios];

        for (let i = 0; i < numHorarios; i++) {
            const randomIndex = Math.floor(Math.random() * horariosDisponibles.length);
            horariosSeleccionados.push(horariosDisponibles.splice(randomIndex, 1)[0]);
        }

        console.log(`   🎯 Seleccionados ${horariosSeleccionados.length} horarios`);
        horariosSeleccionados.forEach(h => {
            console.log(`      - ${h.deporte} | ${h.dia} ${h.hora_inicio}`);
        });

        // 5. Preparar datos de inscripción
        const inscripcionData = {
            alumno: alumno,
            horarios: horariosSeleccionados.map(h => ({
                horario_id: h.horario_id,
                deporte: h.deporte,
                dia: h.dia,
                hora_inicio: h.hora_inicio,
                hora_fin: h.hora_fin,
                precio: h.precio
            })),
            pago: {
                metodo_pago: 'transferencia',
                monto: horariosSeleccionados.reduce((sum, h) => sum + parseFloat(h.precio), 0),
                comprobante_url: `https://drive.google.com/file/d/test_${Date.now()}/view`
            }
        };

        // 6. Enviar inscripción
        console.log(`   📤 Enviando inscripción...`);
        const response = await fetch(`${API_BASE}/api/inscribir-multiple`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(inscripcionData),
            signal: AbortSignal.timeout(CONFIG.timeout)
        });

        const resultado = await response.json();
        const tiempo = Date.now() - inicio;

        if (resultado.success) {
            stats.exitosos++;
            stats.tiempos.push(tiempo);
            console.log(`   ✅ [${index}] ÉXITO en ${tiempo}ms`);
            console.log(`   💾 Inscripción ID: ${resultado.inscripcion_id || 'N/A'}`);
            return { success: true, tiempo, dni: alumno.dni };
        } else {
            stats.fallidos++;
            stats.errores.push(resultado.error);
            console.log(`   ❌ [${index}] FALLO: ${resultado.error}`);
            return { success: false, error: resultado.error };
        }

    } catch (error) {
        const tiempo = Date.now() - inicio;
        stats.fallidos++;
        stats.errores.push(error.message);
        console.log(`   ❌ [${index}] ERROR: ${error.message} (${tiempo}ms)`);
        return { success: false, error: error.message };
    }
}

/**
 * Ejecutar prueba de carga
 */
async function ejecutarPrueba() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       PRUEBA DE CARGA - SISTEMA JAGUARES                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📊 Configuración:`);
    console.log(`   • Total usuarios: ${CONFIG.totalUsuarios}`);
    console.log(`   • Concurrencia: ${CONFIG.concurrencia}`);
    console.log(`   • Delay entre grupos: ${CONFIG.delayEntreGrupos}ms`);
    console.log(`   • Timeout: ${CONFIG.timeout}ms`);
    console.log('');
    console.log('🚀 Iniciando prueba...\n');

    const inicioTotal = Date.now();

    // Ejecutar en grupos concurrentes
    for (let i = 0; i < CONFIG.totalUsuarios; i += CONFIG.concurrencia) {
        const grupo = [];
        const numEnGrupo = Math.min(CONFIG.concurrencia, CONFIG.totalUsuarios - i);

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📦 GRUPO ${Math.floor(i / CONFIG.concurrencia) + 1} - Procesando ${numEnGrupo} usuarios simultáneos`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        for (let j = 0; j < numEnGrupo; j++) {
            grupo.push(inscribirUsuario(i + j + 1));
        }

        await Promise.all(grupo);

        // Delay entre grupos (excepto el último)
        if (i + CONFIG.concurrencia < CONFIG.totalUsuarios) {
            console.log(`\n⏳ Esperando ${CONFIG.delayEntreGrupos}ms antes del siguiente grupo...\n`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.delayEntreGrupos));
        }
    }

    const tiempoTotal = Date.now() - inicioTotal;

    // Mostrar resultados
    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                   RESULTADOS FINALES                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📊 Estadísticas Generales:`);
    console.log(`   ✅ Exitosos:        ${stats.exitosos}/${CONFIG.totalUsuarios} (${((stats.exitosos / CONFIG.totalUsuarios) * 100).toFixed(1)}%)`);
    console.log(`   ❌ Fallidos:        ${stats.fallidos}/${CONFIG.totalUsuarios} (${((stats.fallidos / CONFIG.totalUsuarios) * 100).toFixed(1)}%)`);
    console.log(`   ⏱️  Tiempo total:    ${(tiempoTotal / 1000).toFixed(2)}s`);
    console.log('');

    if (stats.tiempos.length > 0) {
        const tiempoPromedio = stats.tiempos.reduce((a, b) => a + b, 0) / stats.tiempos.length;
        const tiempoMin = Math.min(...stats.tiempos);
        const tiempoMax = Math.max(...stats.tiempos);

        console.log(`⚡ Rendimiento:`);
        console.log(`   • Tiempo promedio:  ${tiempoPromedio.toFixed(0)}ms`);
        console.log(`   • Tiempo mínimo:    ${tiempoMin}ms`);
        console.log(`   • Tiempo máximo:    ${tiempoMax}ms`);
        console.log(`   • Throughput:       ${(stats.exitosos / (tiempoTotal / 1000)).toFixed(2)} inscripciones/segundo`);
        console.log('');
    }

    if (stats.errores.length > 0) {
        console.log(`❌ Errores encontrados:`);
        const erroresUnicos = [...new Set(stats.errores)];
        erroresUnicos.forEach((error, index) => {
            const count = stats.errores.filter(e => e === error).length;
            console.log(`   ${index + 1}. ${error} (${count}x)`);
        });
        console.log('');
    }

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                   PRUEBA COMPLETADA                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    // Resumen de salud del sistema
    const tasaExito = (stats.exitosos / CONFIG.totalUsuarios) * 100;
    console.log('🏥 Salud del Sistema:');
    if (tasaExito >= 95) {
        console.log('   ✅ EXCELENTE - Sistema funcionando óptimamente');
    } else if (tasaExito >= 80) {
        console.log('   ⚠️  BUENO - Sistema funcional con algunos problemas menores');
    } else if (tasaExito >= 50) {
        console.log('   ⚠️  REGULAR - Sistema con problemas significativos');
    } else {
        console.log('   ❌ CRÍTICO - Sistema con fallas graves');
    }
    console.log('');
}

// Ejecutar prueba
ejecutarPrueba().catch(error => {
    console.error('💥 Error fatal en la prueba:', error);
    process.exit(1);
});
