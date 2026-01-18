/**
 * TEST COMPLETO DE FUNCIONALIDADES DE ADMINISTRADOR
 * Verifica todos los endpoints protegidos y operaciones admin
 */

const BASE_URL = 'http://localhost:3002';

console.log('');
console.log('═'.repeat(70));
console.log(' 🔐 TEST COMPLETO DE ADMINISTRADOR - SISTEMA JAGUARES');
console.log('═'.repeat(70));
console.log('');

let authToken = null;

// ==================== TEST 1: LOGIN ====================
async function testLogin() {
    console.log('═'.repeat(70));
    console.log('TEST 1: AUTENTICACIÓN Y LOGIN');
    console.log('═'.repeat(70));
    
    try {
        // Login correcto
        console.log('   📍 Login con credenciales correctas...');
        const res = await fetch(`${BASE_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usuario: 'admin',
                contrasena: 'jaguares2025'
            })
        });
        
        const data = await res.json();
        
        if (data.success && data.token) {
            authToken = data.token;
            console.log('   ✅ Login exitoso');
            console.log(`   👤 Usuario: ${data.admin.usuario}`);
            console.log(`   📧 Email: ${data.admin.email}`);
            console.log(`   🎭 Rol: ${data.admin.rol}`);
            console.log(`   🔑 Token generado: ${data.token.substring(0, 20)}...`);
            return true;
        } else {
            console.log('   ❌ Login falló:', data.error);
            return false;
        }
        
    } catch (error) {
        console.log(`   ❌ Error en login: ${error.message}`);
        return false;
    }
}

// ==================== TEST 2: LISTAR INSCRITOS ====================
async function testListarInscritos() {
    console.log('');
    console.log('═'.repeat(70));
    console.log('TEST 2: LISTAR INSCRITOS');
    console.log('═'.repeat(70));
    
    try {
        console.log('   📍 Obteniendo lista de inscritos...');
        
        const res = await fetch(`${BASE_URL}/api/admin/inscritos`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            console.log('   ✅ Lista obtenida correctamente');
            console.log(`   📊 Total de inscritos: ${data.inscritos.length}`);
            
            if (data.inscritos.length > 0) {
                const primero = data.inscritos[0];
                console.log('');
                console.log('   📝 Ejemplo de inscrito:');
                console.log(`      DNI: ${primero.dni}`);
                console.log(`      Nombre: ${primero.nombre_completo || primero.nombres}`);
                console.log(`      Deporte: ${primero.deporte || 'N/A'}`);
                console.log(`      Plan: ${primero.plan || 'N/A'}`);
                console.log(`      Precio: S/ ${primero.precio_mensual || 'N/A'}`);
            }
            
            return true;
        } else {
            console.log('   ❌ Error al obtener inscritos:', data.error);
            return false;
        }
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

// ==================== TEST 3: ESTADÍSTICAS FINANCIERAS ====================
async function testEstadisticasFinancieras() {
    console.log('');
    console.log('═'.repeat(70));
    console.log('TEST 3: ESTADÍSTICAS FINANCIERAS');
    console.log('═'.repeat(70));
    
    try {
        console.log('   📍 Obteniendo estadísticas financieras...');
        
        const res = await fetch(`${BASE_URL}/api/admin/estadisticas-financieras`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            console.log('   ✅ Estadísticas obtenidas correctamente');
            console.log('');
            console.log('   💰 INGRESOS:');
            console.log(`      Total esperado: S/ ${data.estadisticas.ingresos_totales || 0}`);
            console.log(`      Matrículas pagadas: S/ ${data.estadisticas.matriculas_pagadas || 0}`);
            console.log(`      Pendiente de cobro: S/ ${data.estadisticas.pendiente_cobro || 0}`);
            
            console.log('');
            console.log('   📊 INSCRIPCIONES:');
            console.log(`      Total: ${data.estadisticas.total_inscripciones || 0}`);
            console.log(`      Activas: ${data.estadisticas.inscripciones_activas || 0}`);
            console.log(`      Pendientes: ${data.estadisticas.inscripciones_pendientes || 0}`);
            
            if (data.estadisticas.por_deporte && data.estadisticas.por_deporte.length > 0) {
                console.log('');
                console.log('   🏆 TOP 3 DEPORTES:');
                data.estadisticas.por_deporte.slice(0, 3).forEach((d, i) => {
                    console.log(`      ${i + 1}. ${d.deporte}: ${d.total_inscritos} inscritos (S/ ${d.ingresos_totales})`);
                });
            }
            
            return true;
        } else {
            console.log('   ❌ Error al obtener estadísticas:', data.error);
            return false;
        }
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

// ==================== TEST 4: BÚSQUEDA DE ALUMNO ESPECÍFICO ====================
async function testBuscarAlumno() {
    console.log('');
    console.log('═'.repeat(70));
    console.log('TEST 4: BÚSQUEDA DE ALUMNO ESPECÍFICO');
    console.log('═'.repeat(70));
    
    try {
        // Primero obtener lista de inscritos para tener un DNI válido
        const resInscritos = await fetch(`${BASE_URL}/api/admin/inscritos`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const dataInscritos = await resInscritos.json();
        
        if (dataInscritos.inscritos && dataInscritos.inscritos.length > 0) {
            const dniPrueba = dataInscritos.inscritos[0].dni;
            
            console.log(`   📍 Buscando alumno con DNI: ${dniPrueba}...`);
            
            const res = await fetch(`${BASE_URL}/api/mis-inscripciones/${dniPrueba}`);
            const data = await res.json();
            
            if (res.ok) {
                console.log('   ✅ Alumno encontrado');
                
                if (data.inscripciones && data.inscripciones.length > 0) {
                    console.log(`   📚 Total inscripciones: ${data.inscripciones.length}`);
                    console.log('');
                    console.log('   📝 Detalle de inscripciones:');
                    data.inscripciones.forEach((ins, i) => {
                        console.log(`      ${i + 1}. ${ins.deporte} - ${ins.plan} (S/ ${ins.precio_mensual})`);
                    });
                } else {
                    console.log('   ℹ️  Alumno sin inscripciones activas');
                }
                
                return true;
            } else {
                console.log('   ❌ Error al buscar alumno:', data.error);
                return false;
            }
        } else {
            console.log('   ⚠️  No hay inscritos en el sistema para probar');
            return true; // No es un error crítico
        }
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

// ==================== TEST 5: VALIDACIÓN DE DATOS ====================
async function testValidacionDatos() {
    console.log('');
    console.log('═'.repeat(70));
    console.log('TEST 5: VALIDACIÓN DE DATOS EN BD');
    console.log('═'.repeat(70));
    
    try {
        console.log('   📍 Obteniendo todos los inscritos para validar...');
        
        const res = await fetch(`${BASE_URL}/api/admin/inscritos`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await res.json();
        
        if (res.ok && data.inscritos) {
            const inscritos = data.inscritos;
            
            // Validaciones
            let problemasEncontrados = 0;
            
            // 1. Verificar que no haya precios negativos
            const preciosNegativos = inscritos.filter(i => i.precio_mensual < 0);
            if (preciosNegativos.length > 0) {
                console.log(`   ❌ Encontrados ${preciosNegativos.length} inscritos con precios negativos`);
                problemasEncontrados++;
            } else {
                console.log('   ✅ Sin precios negativos');
            }
            
            // 2. Verificar que todos tengan DNI
            const sinDNI = inscritos.filter(i => !i.dni);
            if (sinDNI.length > 0) {
                console.log(`   ❌ Encontrados ${sinDNI.length} inscritos sin DNI`);
                problemasEncontrados++;
            } else {
                console.log('   ✅ Todos los inscritos tienen DNI');
            }
            
            // 3. Verificar que todos tengan nombre
            const sinNombre = inscritos.filter(i => !i.nombre_completo && !i.nombres);
            if (sinNombre.length > 0) {
                console.log(`   ❌ Encontrados ${sinNombre.length} inscritos sin nombre`);
                problemasEncontrados++;
            } else {
                console.log('   ✅ Todos los inscritos tienen nombre');
            }
            
            // 4. Verificar rangos de precios lógicos
            const preciosAnormales = inscritos.filter(i => i.precio_mensual > 500 || (i.precio_mensual > 0 && i.precio_mensual < 40));
            if (preciosAnormales.length > 0) {
                console.log(`   ⚠️  ${preciosAnormales.length} inscritos con precios fuera de rango normal (40-500)`);
                problemasEncontrados++;
            } else {
                console.log('   ✅ Todos los precios en rango lógico');
            }
            
            console.log('');
            if (problemasEncontrados === 0) {
                console.log('   🎉 TODOS LOS DATOS SON VÁLIDOS');
                return true;
            } else {
                console.log(`   ⚠️  Se encontraron ${problemasEncontrados} tipos de problemas`);
                return false;
            }
        } else {
            console.log('   ❌ No se pudieron obtener los inscritos');
            return false;
        }
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        return false;
    }
}

// ==================== EJECUTAR TODOS LOS TESTS ====================
async function ejecutarTests() {
    const resultados = {
        login: false,
        listarInscritos: false,
        estadisticasFinancieras: false,
        buscarAlumno: false,
        validacionDatos: false
    };
    
    resultados.login = await testLogin();
    
    if (resultados.login) {
        resultados.listarInscritos = await testListarInscritos();
        resultados.estadisticasFinancieras = await testEstadisticasFinancieras();
        resultados.buscarAlumno = await testBuscarAlumno();
        resultados.validacionDatos = await testValidacionDatos();
    } else {
        console.log('');
        console.log('❌ Login falló - No se pueden ejecutar tests protegidos');
    }
    
    // ==================== RESUMEN ====================
    console.log('');
    console.log('═'.repeat(70));
    console.log(' 📊 RESUMEN DE TESTS DE ADMINISTRADOR');
    console.log('═'.repeat(70));
    console.log('');
    
    const total = Object.keys(resultados).length;
    const exitosos = Object.values(resultados).filter(v => v).length;
    const porcentaje = ((exitosos / total) * 100).toFixed(1);
    
    for (const [test, resultado] of Object.entries(resultados)) {
        const icono = resultado ? '✅' : '❌';
        const nombre = test.charAt(0).toUpperCase() + test.slice(1).replace(/([A-Z])/g, ' $1');
        console.log(`   ${icono} ${nombre.padEnd(30)} ${resultado ? 'PASS' : 'FAIL'}`);
    }
    
    console.log('');
    console.log(`   📊 TOTAL: ${exitosos}/${total} tests exitosos (${porcentaje}%)`);
    console.log('');
    
    if (exitosos === total) {
        console.log('   🎉 TODAS LAS FUNCIONALIDADES DE ADMIN OPERATIVAS');
    } else if (exitosos >= total * 0.8) {
        console.log('   ⚠️  Sistema mayormente funcional, revisar fallos');
    } else {
        console.log('   ❌ Problemas críticos en funcionalidades de admin');
    }
    
    console.log('');
    console.log('═'.repeat(70));
    console.log('');
    
    process.exit(exitosos === total ? 0 : 1);
}

// Ejecutar
ejecutarTests().catch(console.error);
