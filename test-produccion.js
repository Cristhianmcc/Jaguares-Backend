/**
 * SUITE DE PRUEBAS DE PRODUCCIÓN - SISTEMA JAGUARES
 * Ejecuta pruebas completas para verificar que el sistema esté listo
 */

const API_BASE = 'http://localhost:3002';

// Colores para consola
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

// Resultados
const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: []
};

/**
 * Ejecutar prueba
 */
async function test(name, fn) {
    try {
        await fn();
        results.passed++;
        results.tests.push({ name, status: 'PASS' });
        console.log(`${colors.green}✓${colors.reset} ${name}`);
    } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'FAIL', error: error.message });
        console.log(`${colors.red}✗${colors.reset} ${name}`);
        console.log(`  ${colors.red}Error: ${error.message}${colors.reset}`);
    }
}

/**
 * Aserción
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║     SUITE DE PRUEBAS DE PRODUCCIÓN - JAGUARES             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ==================== PRUEBAS DE API ====================
console.log(`${colors.cyan}📡 PRUEBAS DE API${colors.reset}\n`);

await test('GET /api/health - Health check', async () => {
    const response = await fetch(`${API_BASE}/api/health`);
    const data = await response.json();
    assert(response.ok, 'Health check falló');
    assert(data.status === 'ok', 'Status no es ok');
});

await test('GET /api/horarios - Obtener todos los horarios', async () => {
    const response = await fetch(`${API_BASE}/api/horarios`);
    const data = await response.json();
    assert(response.ok, 'Request falló');
    assert(data.success, 'Success es false');
    assert(data.horarios.length === 153, `Esperaba 153 horarios, obtuvo ${data.horarios.length}`);
});

await test('GET /api/horarios?ano_nacimiento=2010 - Filtrar por edad', async () => {
    const response = await fetch(`${API_BASE}/api/horarios?ano_nacimiento=2010`);
    const data = await response.json();
    assert(response.ok, 'Request falló');
    assert(data.success, 'Success es false');
    assert(data.horarios.length > 0, 'No retornó horarios');
    assert(data.filtradoPorEdad === true, 'No filtró por edad');
});

await test('GET /api/validar-dni/:dni - Validar DNI existente', async () => {
    const response = await fetch(`${API_BASE}/api/validar-dni/86100159`);
    const data = await response.json();
    assert(response.ok, 'Request falló');
    assert(data.existe === true, 'DNI debería existir');
});

await test('GET /api/validar-dni/:dni - Validar DNI inexistente', async () => {
    const response = await fetch(`${API_BASE}/api/validar-dni/99999999`);
    const data = await response.json();
    assert(response.ok, 'Request falló');
    assert(data.existe === false, 'DNI no debería existir');
});

await test('GET /api/mis-inscripciones/:dni - Consultar inscripciones', async () => {
    const response = await fetch(`${API_BASE}/api/mis-inscripciones/86100159`);
    const data = await response.json();
    assert(response.ok, 'Request falló');
    assert(data.success, 'Success es false');
});

// ==================== PRUEBAS DE SEGURIDAD ====================
console.log(`\n${colors.cyan}🔒 PRUEBAS DE SEGURIDAD${colors.reset}\n`);

await test('Rate limiting - Bloquea exceso de requests', async () => {
    const promises = [];
    for (let i = 0; i < 120; i++) {
        promises.push(fetch(`${API_BASE}/api/horarios`));
    }
    const responses = await Promise.all(promises);
    const blocked = responses.filter(r => r.status === 429);
    assert(blocked.length > 0, 'Rate limiting no bloqueó requests');
});

await test('Endpoints protegidos - Rechazan sin token', async () => {
    const response = await fetch(`${API_BASE}/api/admin/inscritos`);
    assert(response.status === 401 || response.status === 403, 'Debería rechazar sin token');
});

await test('Validación de DNI - Rechaza DNI inválido', async () => {
    const response = await fetch(`${API_BASE}/api/validar-dni/123`);
    assert(!response.ok || response.status === 400, 'Debería rechazar DNI inválido');
});

// ==================== PRUEBAS DE BASE DE DATOS ====================
console.log(`\n${colors.cyan}💾 PRUEBAS DE BASE DE DATOS${colors.reset}\n`);

await test('Deportes - Verifica 8 deportes activos', async () => {
    const response = await fetch(`${API_BASE}/api/horarios`);
    const data = await response.json();
    const deportes = [...new Set(data.horarios.map(h => h.deporte))];
    assert(deportes.length === 8, `Esperaba 8 deportes, obtuvo ${deportes.length}`);
});

await test('Horarios - Verifica 153 horarios activos', async () => {
    const response = await fetch(`${API_BASE}/api/horarios`);
    const data = await response.json();
    assert(data.total === 153, `Esperaba 153 horarios, obtuvo ${data.total}`);
});

await test('Categorías - Verifica estructura correcta', async () => {
    const response = await fetch(`${API_BASE}/api/horarios`);
    const data = await response.json();
    const primerHorario = data.horarios[0];
    assert(primerHorario.categoria !== undefined, 'Falta campo categoria');
    assert(primerHorario.ano_min !== undefined, 'Falta campo ano_min');
    assert(primerHorario.ano_max !== undefined, 'Falta campo ano_max');
});

// ==================== PRUEBAS DE RENDIMIENTO ====================
console.log(`\n${colors.cyan}⚡ PRUEBAS DE RENDIMIENTO${colors.reset}\n`);

await test('Tiempo de respuesta - GET /api/horarios < 2s', async () => {
    const inicio = Date.now();
    const response = await fetch(`${API_BASE}/api/horarios`);
    const tiempo = Date.now() - inicio;
    assert(response.ok, 'Request falló');
    assert(tiempo < 2000, `Tiempo de respuesta: ${tiempo}ms (máximo 2000ms)`);
});

await test('Caché - Segunda consulta más rápida', async () => {
    // Primera consulta (sin caché)
    const inicio1 = Date.now();
    await fetch(`${API_BASE}/api/horarios`);
    const tiempo1 = Date.now() - inicio1;

    // Segunda consulta (con caché)
    const inicio2 = Date.now();
    await fetch(`${API_BASE}/api/horarios`);
    const tiempo2 = Date.now() - inicio2;

    assert(tiempo2 <= tiempo1, `Caché no mejoró rendimiento (${tiempo1}ms vs ${tiempo2}ms)`);
});

// ==================== PRUEBAS DE INTEGRACIÓN ====================
console.log(`\n${colors.cyan}🔗 PRUEBAS DE INTEGRACIÓN${colors.reset}\n`);

await test('Inscripción completa - Flujo end-to-end', async () => {
    const alumno = {
        dni: '99999999',
        nombres: 'Test Producción',
        apellido_paterno: 'Sistema',
        apellido_materno: 'Jaguares',
        fecha_nacimiento: '2010-01-01',
        sexo: 'Masculino',
        telefono: '999999999',
        email: 'test.produccion@jaguares.test',
        direccion: 'Av. Test 123',
        seguro_tipo: 'SIS',
        condicion_medica: 'Ninguna',
        apoderado: 'Apoderado Test',
        telefono_apoderado: '999999998'
    };

    // Obtener horarios
    const horariosRes = await fetch(`${API_BASE}/api/horarios?ano_nacimiento=2010`);
    const horariosData = await horariosRes.json();
    assert(horariosData.horarios.length > 0, 'No hay horarios disponibles');

    const horario = horariosData.horarios[0];

    // Inscribir
    const inscripcionRes = await fetch(`${API_BASE}/api/inscribir-multiple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            alumno,
            horarios: [{
                horario_id: horario.horario_id,
                deporte: horario.deporte,
                dia: horario.dia,
                hora_inicio: horario.hora_inicio,
                hora_fin: horario.hora_fin,
                precio: horario.precio
            }],
            pago: {
                metodo_pago: 'transferencia',
                monto: horario.precio,
                comprobante_url: 'https://drive.google.com/file/d/test/view'
            }
        })
    });

    const inscripcionData = await inscripcionRes.json();
    assert(inscripcionData.success, `Inscripción falló: ${inscripcionData.error}`);
});

// ==================== RESULTADOS FINALES ====================
console.log('\n\n╔════════════════════════════════════════════════════════════╗');
console.log('║                   RESULTADOS FINALES                      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const total = results.passed + results.failed + results.skipped;
const porcentajeExito = ((results.passed / total) * 100).toFixed(1);

console.log(`📊 Resumen:`);
console.log(`   ${colors.green}✓ Exitosas:${colors.reset}  ${results.passed}/${total} (${porcentajeExito}%)`);
console.log(`   ${colors.red}✗ Fallidas:${colors.reset}  ${results.failed}/${total}`);
console.log(`   ${colors.yellow}⊘ Omitidas:${colors.reset}  ${results.skipped}/${total}`);
console.log('');

// Estado del sistema
console.log('🏥 Estado del Sistema:');
if (porcentajeExito >= 95) {
    console.log(`   ${colors.green}✅ LISTO PARA PRODUCCIÓN${colors.reset}`);
} else if (porcentajeExito >= 80) {
    console.log(`   ${colors.yellow}⚠️  REQUIERE AJUSTES MENORES${colors.reset}`);
} else {
    console.log(`   ${colors.red}❌ NO LISTO PARA PRODUCCIÓN${colors.reset}`);
}
console.log('');

// Tests fallidos
if (results.failed > 0) {
    console.log(`${colors.red}❌ Tests Fallidos:${colors.reset}`);
    results.tests.filter(t => t.status === 'FAIL').forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.name}`);
        console.log(`      ${colors.red}${t.error}${colors.reset}`);
    });
    console.log('');
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║                   PRUEBAS COMPLETADAS                     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Exit code
process.exit(results.failed > 0 ? 1 : 0);
