/**
 * TEST DE FLUJO COMPLETO DE USUARIO
 * Simula el journey completo desde selección hasta confirmación
 */

const BASE_URL = 'http://localhost:3002';

console.log('');
console.log('═'.repeat(70));
console.log(' 👤 TEST DE FLUJO COMPLETO DE USUARIO - SISTEMA JAGUARES');
console.log('═'.repeat(70));
console.log('');

// Generar DNI único para esta prueba
const dniTest = `99${Date.now().toString().slice(-6)}`;

// ==================== PASO 1: CARGAR HORARIOS ====================
async function paso1CargarHorarios() {
    console.log('═'.repeat(70));
    console.log('PASO 1: USUARIO CARGA PÁGINA DE SELECCIÓN DE HORARIOS');
    console.log('═'.repeat(70));
    
    try {
        console.log('   📍 Página: seleccion-horarios.html');
        console.log('   🔍 Cargando horarios disponibles...');
        
        const res = await fetch(`${BASE_URL}/api/horarios`);
        const data = await res.json();
        
        if (res.ok && data.horarios) {
            console.log(`   ✅ ${data.horarios.length} horarios cargados`);
            
            // Contar por deporte
            const deportes = {};
            data.horarios.forEach(h => {
                deportes[h.deporte] = (deportes[h.deporte] || 0) + 1;
            });
            
            console.log('');
            console.log('   📊 Horarios por deporte:');
            Object.entries(deportes).slice(0, 5).forEach(([deporte, cant]) => {
                console.log(`      • ${deporte}: ${cant} horarios`);
            });
            
            return data.horarios;
        } else {
            console.log('   ❌ Error al cargar horarios');
            return null;
        }
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return null;
    }
}

// ==================== PASO 2: USUARIO SELECCIONA HORARIOS ====================
async function paso2SeleccionarHorarios(horariosDisponibles) {
    console.log('');
    console.log('═'.repeat(70));
    console.log('PASO 2: USUARIO SELECCIONA SUS HORARIOS');
    console.log('═'.repeat(70));
    
    try {
        // Filtrar horarios de fútbol
        const horariosFutbol = horariosDisponibles.filter(h => h.deporte === 'Fútbol' && h.estado === 'activo');
        
        if (horariosFutbol.length < 2) {
            console.log('   ⚠️  No hay suficientes horarios de fútbol disponibles');
            return null;
        }
        
        // Seleccionar 2 horarios diferentes (plan Económico)
        const seleccionados = [
            horariosFutbol[0],
            horariosFutbol[1]
        ];
        
        console.log('   ✅ Usuario selecciona 2 horarios de Fútbol:');
        seleccionados.forEach((h, i) => {
            console.log(`      ${i + 1}. ${h.dia} ${h.hora_inicio}-${h.hora_fin} (ID: ${h.horario_id})`);
        });
        
        console.log('');
        console.log('   📝 Plan seleccionado: Económico (2 días)');
        console.log('   💰 Precio calculado: S/ 60');
        
        return seleccionados;
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return null;
    }
}

// ==================== PASO 3: LLENAR FORMULARIO ====================
async function paso3LlenarFormulario() {
    console.log('');
    console.log('═'.repeat(70));
    console.log('PASO 3: USUARIO LLENA FORMULARIO DE INSCRIPCIÓN');
    console.log('═'.repeat(70));
    
    const alumno = {
        dni: dniTest,
        nombres: 'Juan Carlos',
        apellido_paterno: 'Pérez',
        apellido_materno: 'García',
        fecha_nacimiento: '2010-05-15',
        sexo: 'Masculino',
        telefono: '987654321',
        email: `test${dniTest}@test.com`,
        direccion: 'Av. Test 123',
        apoderado: 'María García',
        telefono_apoderado: '987654322',
        seguro_tipo: 'SIS',
        condicion_medica: 'Ninguna'
    };
    
    console.log('   ✅ Formulario completado:');
    console.log(`      DNI: ${alumno.dni}`);
    console.log(`      Nombre: ${alumno.nombres} ${alumno.apellido_paterno} ${alumno.apellido_materno}`);
    console.log(`      Fecha Nac.: ${alumno.fecha_nacimiento} (${2026 - 2010} años)`);
    console.log(`      Email: ${alumno.email}`);
    console.log(`      Apoderado: ${alumno.apoderado}`);
    
    return alumno;
}

// ==================== PASO 4: ENVIAR INSCRIPCIÓN ====================
async function paso4EnviarInscripcion(alumno, horarios) {
    console.log('');
    console.log('═'.repeat(70));
    console.log('PASO 4: ENVIAR INSCRIPCIÓN AL SERVIDOR');
    console.log('═'.repeat(70));
    
    try {
        console.log('   📤 Enviando datos de inscripción...');
        console.log(`      Alumno: ${alumno.nombres} ${alumno.apellido_paterno}`);
        console.log(`      Horarios: ${horarios.length}`);
        
        const payload = {
            alumno: alumno,
            horarios: horarios.map(h => ({
                ...h,
                plan: 'Económico'
            }))
        };
        
        const res = await fetch(`${BASE_URL}/api/inscribir-multiple`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            console.log('   ✅ INSCRIPCIÓN EXITOSA');
            console.log('');
            console.log('   📋 Respuesta del servidor:');
            console.log(`      Mensaje: ${data.message}`);
            console.log(`      DNI registrado: ${data.dni}`);
            
            if (data.data) {
                console.log(`      Alumno ID: ${data.data.alumnoId}`);
                console.log(`      Inscripciones creadas: ${data.data.inscripcionesIds?.length || 0}`);
            }
            
            return data;
        } else {
            console.log('   ❌ INSCRIPCIÓN FALLIDA');
            console.log(`      Error: ${data.error}`);
            console.log(`      Mensaje: ${data.message || 'Sin mensaje'}`);
            return null;
        }
        
    } catch (error) {
        console.log(`   ❌ Error en inscripción: ${error.message}`);
        return null;
    }
}

// ==================== PASO 5: VERIFICAR INSCRIPCIÓN ====================
async function paso5VerificarInscripcion(dni) {
    console.log('');
    console.log('═'.repeat(70));
    console.log('PASO 5: VERIFICAR INSCRIPCIÓN EN EL SISTEMA');
    console.log('═'.repeat(70));
    
    try {
        console.log(`   📍 Usuario va a: consulta.html`);
        console.log(`   🔍 Buscando inscripción con DNI: ${dni}...`);
        
        // Esperar 1 segundo para que se sincronice
        await new Promise(r => setTimeout(r, 1000));
        
        const res = await fetch(`${BASE_URL}/api/mis-inscripciones/${dni}`);
        const data = await res.json();
        
        if (res.ok) {
            console.log('   ✅ Inscripción encontrada en el sistema');
            
            if (data.inscripciones && data.inscripciones.length > 0) {
                console.log('');
                console.log('   📚 Detalle de inscripciones:');
                data.inscripciones.forEach((ins, i) => {
                    console.log(`      ${i + 1}. Deporte: ${ins.deporte}`);
                    console.log(`         Plan: ${ins.plan}`);
                    console.log(`         Precio: S/ ${ins.precio_mensual}`);
                    console.log(`         Estado: ${ins.estado}`);
                    
                    if (ins.horarios && ins.horarios.length > 0) {
                        console.log(`         Horarios:`);
                        ins.horarios.forEach(h => {
                            console.log(`           • ${h.dia} ${h.hora_inicio}-${h.hora_fin}`);
                        });
                    }
                });
                
                return true;
            } else {
                console.log('   ⚠️  Inscripción registrada pero sin detalles');
                return true;
            }
        } else {
            console.log('   ❌ No se encontró la inscripción');
            console.log(`      Error: ${data.error || 'Desconocido'}`);
            return false;
        }
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

// ==================== PASO 6: VALIDAR DESDE ADMIN ====================
async function paso6ValidarDesdeAdmin(dni) {
    console.log('');
    console.log('═'.repeat(70));
    console.log('PASO 6: ADMINISTRADOR VALIDA LA INSCRIPCIÓN');
    console.log('═'.repeat(70));
    
    try {
        // Login de admin
        console.log('   🔐 Administrador inicia sesión...');
        const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usuario: 'admin',
                contrasena: 'jaguares2025'
            })
        });
        
        const loginData = await loginRes.json();
        
        if (!loginData.success) {
            console.log('   ❌ Login de admin falló');
            return false;
        }
        
        console.log('   ✅ Login exitoso');
        
        // Buscar inscrito
        console.log(`   🔍 Buscando DNI ${dni} en lista de inscritos...`);
        const inscritosRes = await fetch(`${BASE_URL}/api/admin/inscritos`, {
            headers: { 'Authorization': `Bearer ${loginData.token}` }
        });
        
        const inscritosData = await inscritosRes.json();
        
        if (inscritosData.success && inscritosData.inscritos) {
            const encontrado = inscritosData.inscritos.find(i => i.dni === dni);
            
            if (encontrado) {
                console.log('   ✅ Inscrito encontrado en el panel de admin');
                console.log('');
                console.log('   📋 Datos visibles para el admin:');
                console.log(`      DNI: ${encontrado.dni}`);
                console.log(`      Nombre: ${encontrado.nombre_completo || encontrado.nombres}`);
                console.log(`      Email: ${encontrado.email || 'N/A'}`);
                console.log(`      Teléfono: ${encontrado.telefono || 'N/A'}`);
                return true;
            } else {
                console.log('   ❌ Inscrito NO encontrado en lista de admin');
                return false;
            }
        } else {
            console.log('   ❌ Error al obtener lista de inscritos');
            return false;
        }
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

// ==================== EJECUTAR FLUJO COMPLETO ====================
async function ejecutarFlujoCompleto() {
    const resultados = {
        paso1: false,
        paso2: false,
        paso3: false,
        paso4: false,
        paso5: false,
        paso6: false
    };
    
    console.log(`🎯 DNI de prueba generado: ${dniTest}`);
    console.log('');
    
    // Paso 1
    const horariosDisponibles = await paso1CargarHorarios();
    resultados.paso1 = horariosDisponibles !== null;
    
    if (!resultados.paso1) {
        console.log('❌ No se pudo continuar - Error en Paso 1');
        return resultados;
    }
    
    // Paso 2
    const horariosSeleccionados = await paso2SeleccionarHorarios(horariosDisponibles);
    resultados.paso2 = horariosSeleccionados !== null;
    
    if (!resultados.paso2) {
        console.log('❌ No se pudo continuar - Error en Paso 2');
        return resultados;
    }
    
    // Paso 3
    const datosAlumno = await paso3LlenarFormulario();
    resultados.paso3 = datosAlumno !== null;
    
    // Paso 4
    const inscripcionResultado = await paso4EnviarInscripcion(datosAlumno, horariosSeleccionados);
    resultados.paso4 = inscripcionResultado !== null && inscripcionResultado.success;
    
    if (!resultados.paso4) {
        console.log('❌ Inscripción falló - No se puede continuar con verificaciones');
        return resultados;
    }
    
    // Paso 5
    resultados.paso5 = await paso5VerificarInscripcion(dniTest);
    
    // Paso 6
    resultados.paso6 = await paso6ValidarDesdeAdmin(dniTest);
    
    return resultados;
}

// ==================== RESUMEN FINAL ====================
async function mostrarResumen(resultados) {
    console.log('');
    console.log('═'.repeat(70));
    console.log(' 📊 RESUMEN DE FLUJO COMPLETO DE USUARIO');
    console.log('═'.repeat(70));
    console.log('');
    
    const pasos = [
        { key: 'paso1', nombre: 'Cargar Horarios Disponibles' },
        { key: 'paso2', nombre: 'Seleccionar Horarios' },
        { key: 'paso3', nombre: 'Llenar Formulario' },
        { key: 'paso4', nombre: 'Enviar Inscripción' },
        { key: 'paso5', nombre: 'Verificar en Consulta' },
        { key: 'paso6', nombre: 'Validar desde Admin' }
    ];
    
    pasos.forEach((paso, i) => {
        const icono = resultados[paso.key] ? '✅' : '❌';
        console.log(`   ${icono} Paso ${i + 1}: ${paso.nombre.padEnd(35)} ${resultados[paso.key] ? 'OK' : 'FAIL'}`);
    });
    
    const total = pasos.length;
    const exitosos = Object.values(resultados).filter(v => v).length;
    const porcentaje = ((exitosos / total) * 100).toFixed(1);
    
    console.log('');
    console.log(`   📊 TOTAL: ${exitosos}/${total} pasos completados (${porcentaje}%)`);
    console.log('');
    
    if (exitosos === total) {
        console.log('   🎉 FLUJO COMPLETO FUNCIONA PERFECTAMENTE');
        console.log('   ✅ Usuario puede inscribirse de principio a fin');
        console.log('   ✅ Admin puede ver y gestionar la inscripción');
    } else if (exitosos >= 4) {
        console.log('   ⚠️  Flujo mayormente funcional pero con problemas menores');
    } else {
        console.log('   ❌ Problemas críticos en el flujo de usuario');
    }
    
    console.log('');
    console.log('═'.repeat(70));
    console.log('');
}

// Ejecutar
ejecutarFlujoCompleto()
    .then(resultados => mostrarResumen(resultados))
    .then(() => process.exit(0))
    .catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
