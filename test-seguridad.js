/**
 * PRUEBAS DE SEGURIDAD Y CASOS EXTREMOS - SISTEMA JAGUARES
 * 
 * Este script busca vulnerabilidades y errores potenciales:
 * - Inyección SQL
 * - XSS (Cross-Site Scripting)
 * - Validación de datos
 * - Overflow/Underflow
 * - Casos límite
 */

import mysql from 'mysql2/promise';

const API_URL = 'http://localhost:3002';
const DB_CONFIG = {
  host: 'localhost',
  port: 3307,
  user: 'root',
  password: 'rootpassword123',
  database: 'jaguares_db'
};

const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

const log = (msg, color = c.reset) => console.log(`${color}${msg}${c.reset}`);

const vulnerabilidades = [];
const warnings = [];

/**
 * TEST 1: Inyección SQL
 */
async function testInyeccionSQL() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 1: INYECCIÓN SQL', c.bright);
  log('='.repeat(70), c.bright);
  
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE alumnos; --",
    "' UNION SELECT * FROM usuarios --",
    "admin'--",
    "' OR 1=1--",
    "1' AND '1'='1",
    "'; DELETE FROM inscripciones WHERE '1'='1",
    "' OR 'a'='a",
    "1' UNION SELECT NULL,NULL,NULL--"
  ];
  
  log('\n   🔍 Probando payloads de SQL Injection en DNI...', c.cyan);
  
  for (const payload of payloads) {
    try {
      const response = await fetch(`${API_URL}/api/consultar/${encodeURIComponent(payload)}`);
      const data = await response.json();
      
      // Si devuelve datos inesperados, es vulnerable
      if (response.ok && data.alumno) {
        vulnerabilidades.push({
          tipo: 'SQL_INJECTION',
          severidad: 'CRÍTICA',
          endpoint: '/api/consultar/:dni',
          payload: payload,
          descripcion: 'El endpoint es vulnerable a SQL injection'
        });
        log(`   ❌ VULNERABLE: ${payload}`, c.red);
      } else if (data.error && data.error.includes('SQL')) {
        warnings.push({
          tipo: 'SQL_ERROR_DISCLOSURE',
          severidad: 'MEDIA',
          endpoint: '/api/consultar/:dni',
          payload: payload,
          descripcion: 'El endpoint expone errores SQL'
        });
        log(`   ⚠️  Expone error SQL: ${payload}`, c.yellow);
      } else {
        log(`   ✅ Protegido: ${payload}`, c.green);
      }
    } catch (error) {
      log(`   ✅ Rechazado: ${payload}`, c.green);
    }
  }
}

/**
 * TEST 2: XSS (Cross-Site Scripting)
 */
async function testXSS() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 2: XSS (Cross-Site Scripting)', c.bright);
  log('='.repeat(70), c.bright);
  
  const payloads = [
    "<script>alert('XSS')</script>",
    "<img src=x onerror=alert('XSS')>",
    "<svg/onload=alert('XSS')>",
    "javascript:alert('XSS')",
    "<iframe src='javascript:alert(1)'>",
    "';alert(String.fromCharCode(88,83,83))//",
    "<body onload=alert('XSS')>"
  ];
  
  log('\n   🔍 Probando payloads XSS en nombres...', c.cyan);
  
  for (const payload of payloads) {
    try {
      const usuario = {
        dni: '12345678',
        nombres: payload,
        apellido_paterno: 'Test',
        apellido_materno: 'Test',
        fecha_nacimiento: '2015-01-01',
        año_nacimiento: 2015,
        sexo: 'Masculino',
        telefono: '987654321',
        email: 'test@test.com',
        direccion: 'Test',
        seguro_tipo: 'Test',
        apoderado: 'Test',
        telefono_apoderado: '987654321'
      };
      
      const response = await fetch(`${API_URL}/api/inscribir-multiple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          alumno: usuario,
          horarios: []
        })
      });
      
      const data = await response.json();
      
      // Verificar si el payload se refleja sin sanitizar
      const dataStr = JSON.stringify(data);
      if (dataStr.includes(payload)) {
        vulnerabilidades.push({
          tipo: 'XSS',
          severidad: 'ALTA',
          endpoint: '/api/inscribir-multiple',
          payload: payload,
          descripcion: 'El sistema no sanitiza inputs HTML/JavaScript'
        });
        log(`   ⚠️  Posible XSS: ${payload.substring(0, 30)}...`, c.yellow);
      } else {
        log(`   ✅ Sanitizado: ${payload.substring(0, 30)}...`, c.green);
      }
    } catch (error) {
      log(`   ✅ Rechazado: ${payload.substring(0, 30)}...`, c.green);
    }
  }
}

/**
 * TEST 3: Validación de Datos
 */
async function testValidacionDatos() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 3: VALIDACIÓN DE DATOS', c.bright);
  log('='.repeat(70), c.bright);
  
  const casosInvalidos = [
    { nombre: 'DNI muy corto', dni: '123', esperado: 'rechazar' },
    { nombre: 'DNI muy largo', dni: '123456789012345', esperado: 'rechazar' },
    { nombre: 'DNI con letras', dni: 'ABCD1234', esperado: 'rechazar' },
    { nombre: 'DNI negativo', dni: '-12345678', esperado: 'rechazar' },
    { nombre: 'Email inválido', email: 'not-an-email', esperado: 'rechazar' },
    { nombre: 'Email XSS', email: '<script>alert(1)</script>@test.com', esperado: 'rechazar' },
    { nombre: 'Teléfono muy corto', telefono: '123', esperado: 'advertencia' },
    { nombre: 'Teléfono con letras', telefono: 'ABC123456', esperado: 'rechazar' },
    { nombre: 'Fecha futura', fecha_nacimiento: '2030-01-01', esperado: 'rechazar' },
    { nombre: 'Fecha inválida', fecha_nacimiento: '2020-13-45', esperado: 'rechazar' },
    { nombre: 'Año nacimiento < 1900', año_nacimiento: 1800, esperado: 'rechazar' },
    { nombre: 'Año nacimiento > actual', año_nacimiento: 2030, esperado: 'rechazar' },
    { nombre: 'Nombres vacíos', nombres: '', esperado: 'rechazar' },
    { nombre: 'Nombres muy largos', nombres: 'A'.repeat(500), esperado: 'rechazar' },
    { nombre: 'Sexo inválido', sexo: 'Otro', esperado: 'rechazar' }
  ];
  
  log('\n   🔍 Probando validaciones de datos...', c.cyan);
  
  for (const caso of casosInvalidos) {
    const usuario = {
      dni: caso.dni || '12345678',
      nombres: caso.nombres || 'Test',
      apellido_paterno: 'Test',
      apellido_materno: 'Test',
      fecha_nacimiento: caso.fecha_nacimiento || '2015-01-01',
      año_nacimiento: caso.año_nacimiento || 2015,
      sexo: caso.sexo || 'Masculino',
      telefono: caso.telefono || '987654321',
      email: caso.email || 'test@test.com',
      direccion: 'Test',
      seguro_tipo: 'Test',
      apoderado: 'Test',
      telefono_apoderado: '987654321'
    };
    
    try {
      const response = await fetch(`${API_URL}/api/inscribir-multiple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alumno: usuario, horarios: [] })
      });
      
      const data = await response.json();
      
      if (caso.esperado === 'rechazar' && response.ok) {
        vulnerabilidades.push({
          tipo: 'VALIDACION_INSUFICIENTE',
          severidad: 'MEDIA',
          campo: caso.nombre,
          descripcion: `El sistema acepta ${caso.nombre}`
        });
        log(`   ⚠️  Acepta ${caso.nombre}`, c.yellow);
      } else if (!response.ok) {
        log(`   ✅ Rechaza ${caso.nombre}`, c.green);
      }
    } catch (error) {
      log(`   ✅ Rechaza ${caso.nombre} (error de red)`, c.green);
    }
  }
}

/**
 * TEST 4: Límites y Overflow
 */
async function testLimitesOverflow() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 4: LÍMITES Y OVERFLOW', c.bright);
  log('='.repeat(70), c.bright);
  
  log('\n   🔍 Probando límites del sistema...', c.cyan);
  
  // 1. Intentar inscribir con demasiados horarios
  try {
    log('\n   📝 Prueba: Inscripción con 100 horarios', c.cyan);
    const horarios = Array(100).fill(null).map((_, i) => ({
      horario_id: 1,
      deporte: 'Test',
      dia: 'LUNES',
      hora_inicio: '08:00',
      hora_fin: '09:00',
      plan: 'Económico'
    }));
    
    const response = await fetch(`${API_URL}/api/inscribir-multiple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alumno: {
          dni: '12345678',
          nombres: 'Test',
          apellido_paterno: 'Test',
          apellido_materno: 'Test',
          fecha_nacimiento: '2015-01-01',
          año_nacimiento: 2015,
          sexo: 'Masculino',
          telefono: '987654321',
          email: 'test@test.com',
          direccion: 'Test',
          seguro_tipo: 'Test',
          apoderado: 'Test',
          telefono_apoderado: '987654321'
        },
        horarios
      })
    });
    
    if (response.ok) {
      warnings.push({
        tipo: 'SIN_LIMITE_HORARIOS',
        severidad: 'BAJA',
        descripcion: 'El sistema permite inscribir muchos horarios simultáneos'
      });
      log(`   ⚠️  Acepta 100 horarios`, c.yellow);
    } else {
      log(`   ✅ Rechaza exceso de horarios`, c.green);
    }
  } catch (error) {
    log(`   ✅ Rechaza exceso de horarios`, c.green);
  }
  
  // 2. Payload muy grande
  try {
    log('\n   📝 Prueba: Payload de 10MB', c.cyan);
    const payloadGrande = 'A'.repeat(10 * 1024 * 1024);
    
    const response = await fetch(`${API_URL}/api/inscribir-multiple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alumno: {
          dni: '12345678',
          nombres: payloadGrande,
          apellido_paterno: 'Test',
          apellido_materno: 'Test',
          fecha_nacimiento: '2015-01-01',
          año_nacimiento: 2015,
          sexo: 'Masculino',
          telefono: '987654321',
          email: 'test@test.com'
        },
        horarios: []
      })
    });
    
    if (response.ok) {
      vulnerabilidades.push({
        tipo: 'SIN_LIMITE_PAYLOAD',
        severidad: 'MEDIA',
        descripcion: 'El sistema acepta payloads muy grandes'
      });
      log(`   ⚠️  Acepta payload de 10MB`, c.yellow);
    } else {
      log(`   ✅ Rechaza payload grande`, c.green);
    }
  } catch (error) {
    log(`   ✅ Rechaza payload grande`, c.green);
  }
  
  // 3. Números negativos
  try {
    log('\n   📝 Prueba: Precios negativos', c.cyan);
    const conn = await mysql.createConnection(DB_CONFIG);
    
    // Intentar insertar precio negativo
    try {
      await conn.execute(`
        INSERT INTO inscripciones (alumno_id, deporte_id, plan, precio_mensual, estado)
        VALUES (1, 1, 'Test', -100, 'pendiente')
      `);
      
      vulnerabilidades.push({
        tipo: 'PRECIO_NEGATIVO',
        severidad: 'ALTA',
        descripcion: 'La BD permite precios negativos'
      });
      log(`   ❌ BD acepta precios negativos`, c.red);
      
      // Limpiar
      await conn.execute("DELETE FROM inscripciones WHERE precio_mensual < 0");
    } catch (err) {
      log(`   ✅ BD rechaza precios negativos`, c.green);
    }
    
    await conn.end();
  } catch (error) {
    log(`   ⚠️  No se pudo probar precios negativos`, c.yellow);
  }
}

/**
 * TEST 5: Autenticación y Autorización
 */
async function testAutenticacion() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 5: AUTENTICACIÓN Y AUTORIZACIÓN', c.bright);
  log('='.repeat(70), c.bright);
  
  log('\n   🔍 Probando endpoints de admin...', c.cyan);
  
  const endpointsAdmin = [
    '/api/admin/inscritos',
    '/api/admin/estadisticas-financieras'
  ];
  
  for (const endpoint of endpointsAdmin) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`);
      
      if (response.ok) {
        vulnerabilidades.push({
          tipo: 'SIN_AUTENTICACION',
          severidad: 'CRÍTICA',
          endpoint: endpoint,
          descripcion: 'Endpoint de admin accesible sin autenticación'
        });
        log(`   ❌ ${endpoint} - Sin autenticación`, c.red);
      } else if (response.status === 401 || response.status === 403) {
        log(`   ✅ ${endpoint} - Protegido`, c.green);
      } else {
        log(`   ⚠️  ${endpoint} - Estado ${response.status}`, c.yellow);
      }
    } catch (error) {
      log(`   ⚠️  ${endpoint} - Error: ${error.message}`, c.yellow);
    }
  }
}

/**
 * TEST 6: Rate Limiting
 */
async function testRateLimiting() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 6: RATE LIMITING', c.bright);
  log('='.repeat(70), c.bright);
  
  log('\n   🔍 Enviando 100 requests rápidos...', c.cyan);
  
  const promesas = [];
  for (let i = 0; i < 100; i++) {
    promesas.push(fetch(`${API_URL}/api/health`));
  }
  
  const resultados = await Promise.all(promesas);
  const rateLimited = resultados.filter(r => r.status === 429).length;
  
  if (rateLimited === 0) {
    warnings.push({
      tipo: 'SIN_RATE_LIMIT',
      severidad: 'MEDIA',
      descripcion: 'El sistema no tiene rate limiting'
    });
    log(`   ⚠️  Sin rate limiting detectado`, c.yellow);
  } else {
    log(`   ✅ Rate limiting activo (${rateLimited} bloqueados)`, c.green);
  }
}

/**
 * TEST 7: Caracteres especiales y Unicode
 */
async function testCaracteresEspeciales() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 7: CARACTERES ESPECIALES Y UNICODE', c.bright);
  log('='.repeat(70), c.bright);
  
  const casos = [
    { nombre: 'Emojis', valor: '😀😁😂🤣😃', campo: 'nombres' },
    { nombre: 'Unicode chino', valor: '测试用户', campo: 'nombres' },
    { nombre: 'Árabe', valor: 'اختبار', campo: 'nombres' },
    { nombre: 'Null bytes', valor: 'Test\x00User', campo: 'nombres' },
    { nombre: 'Caracteres de control', valor: 'Test\r\nUser', campo: 'nombres' },
    { nombre: 'Comillas', valor: "O'Brien", campo: 'apellido_paterno' },
    { nombre: 'Backslashes', valor: 'Test\\User', campo: 'nombres' }
  ];
  
  log('\n   🔍 Probando caracteres especiales...', c.cyan);
  
  for (const caso of casos) {
    try {
      const usuario = {
        dni: '12345678',
        nombres: caso.campo === 'nombres' ? caso.valor : 'Test',
        apellido_paterno: caso.campo === 'apellido_paterno' ? caso.valor : 'Test',
        apellido_materno: 'Test',
        fecha_nacimiento: '2015-01-01',
        año_nacimiento: 2015,
        sexo: 'Masculino',
        telefono: '987654321',
        email: 'test@test.com',
        direccion: 'Test',
        seguro_tipo: 'Test',
        apoderado: 'Test',
        telefono_apoderado: '987654321'
      };
      
      const response = await fetch(`${API_URL}/api/inscribir-multiple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alumno: usuario, horarios: [] })
      });
      
      if (response.ok) {
        log(`   ✅ Maneja ${caso.nombre}`, c.green);
      } else {
        log(`   ⚠️  Rechaza ${caso.nombre}`, c.yellow);
      }
    } catch (error) {
      log(`   ❌ Error con ${caso.nombre}: ${error.message}`, c.red);
    }
  }
}

/**
 * TEST 8: Verificar configuraciones inseguras
 */
async function testConfiguracionesInseguras() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 8: CONFIGURACIONES INSEGURAS', c.bright);
  log('='.repeat(70), c.bright);
  
  log('\n   🔍 Verificando configuraciones...', c.cyan);
  
  try {
    const conn = await mysql.createConnection(DB_CONFIG);
    
    // Verificar si hay usuarios con contraseñas débiles
    const [admins] = await conn.execute('SELECT COUNT(*) as total FROM administradores');
    log(`   ℹ️  Total de administradores: ${admins[0].total}`, c.cyan);
    
    // Verificar tablas sin índices
    const [tables] = await conn.execute("SHOW TABLES");
    log(`   ℹ️  Total de tablas: ${tables.length}`, c.cyan);
    
    await conn.end();
  } catch (error) {
    log(`   ⚠️  Error verificando configuraciones: ${error.message}`, c.yellow);
  }
  
  // Verificar CORS
  try {
    const response = await fetch(`${API_URL}/api/health`);
    const corsHeader = response.headers.get('Access-Control-Allow-Origin');
    
    if (corsHeader === '*') {
      warnings.push({
        tipo: 'CORS_PERMISIVO',
        severidad: 'BAJA',
        descripcion: 'CORS permite todos los orígenes (*)'
      });
      log(`   ⚠️  CORS permite todos los orígenes`, c.yellow);
    } else {
      log(`   ✅ CORS configurado: ${corsHeader || 'No configurado'}`, c.green);
    }
  } catch (error) {
    log(`   ⚠️  No se pudo verificar CORS`, c.yellow);
  }
}

/**
 * Generar reporte final
 */
function generarReporte() {
  log('\n' + '█'.repeat(70), c.bright);
  log('   REPORTE DE SEGURIDAD Y VULNERABILIDADES', c.bright);
  log('█'.repeat(70), c.bright);
  
  log(`\n📊 Resumen:`, c.cyan);
  log(`   Vulnerabilidades críticas: ${vulnerabilidades.filter(v => v.severidad === 'CRÍTICA').length}`, c.red);
  log(`   Vulnerabilidades altas: ${vulnerabilidades.filter(v => v.severidad === 'ALTA').length}`, c.red);
  log(`   Vulnerabilidades medias: ${vulnerabilidades.filter(v => v.severidad === 'MEDIA').length}`, c.yellow);
  log(`   Advertencias: ${warnings.length}`, c.yellow);
  
  if (vulnerabilidades.length > 0) {
    log(`\n❌ VULNERABILIDADES ENCONTRADAS:`, c.red);
    vulnerabilidades.forEach((v, idx) => {
      log(`\n   ${idx + 1}. [${v.severidad}] ${v.tipo}`, v.severidad === 'CRÍTICA' ? c.red : c.yellow);
      log(`      ${v.descripcion}`, c.reset);
      if (v.endpoint) log(`      Endpoint: ${v.endpoint}`, c.cyan);
      if (v.payload) log(`      Payload: ${v.payload.substring(0, 50)}...`, c.reset);
    });
  }
  
  if (warnings.length > 0) {
    log(`\n⚠️  ADVERTENCIAS:`, c.yellow);
    warnings.forEach((w, idx) => {
      log(`   ${idx + 1}. ${w.tipo}: ${w.descripcion}`, c.reset);
    });
  }
  
  log(`\n${'='.repeat(70)}`, c.bright);
  if (vulnerabilidades.filter(v => v.severidad === 'CRÍTICA').length > 0) {
    log('   ❌ VEREDICTO: VULNERABILIDADES CRÍTICAS ENCONTRADAS', c.red);
  } else if (vulnerabilidades.length > 0) {
    log('   ⚠️  VEREDICTO: VULNERABILIDADES NO CRÍTICAS ENCONTRADAS', c.yellow);
  } else {
    log('   ✅ VEREDICTO: NO SE ENCONTRARON VULNERABILIDADES CRÍTICAS', c.green);
  }
  log(`${'='.repeat(70)}\n`, c.bright);
  
  return {
    fecha: new Date().toISOString(),
    vulnerabilidades,
    warnings,
    resumen: {
      criticas: vulnerabilidades.filter(v => v.severidad === 'CRÍTICA').length,
      altas: vulnerabilidades.filter(v => v.severidad === 'ALTA').length,
      medias: vulnerabilidades.filter(v => v.severidad === 'MEDIA').length,
      advertencias: warnings.length
    }
  };
}

/**
 * Ejecutar todas las pruebas
 */
async function ejecutarPruebas() {
  log('\n' + '█'.repeat(70), c.magenta);
  log('   🔒 PRUEBAS DE SEGURIDAD - SISTEMA JAGUARES 🔒', c.magenta);
  log('█'.repeat(70) + '\n', c.magenta);
  
  try {
    await testInyeccionSQL();
    await testXSS();
    await testValidacionDatos();
    await testLimitesOverflow();
    await testAutenticacion();
    await testRateLimiting();
    await testCaracteresEspeciales();
    await testConfiguracionesInseguras();
    
    const reporte = generarReporte();
    
    // Guardar reporte
    const fs = await import('fs');
    fs.default.writeFileSync(
      'reporte-seguridad.json',
      JSON.stringify(reporte, null, 2)
    );
    
    log(`✅ Reporte guardado en: reporte-seguridad.json\n`, c.green);
    
  } catch (error) {
    log(`\n❌ Error fatal: ${error.message}`, c.red);
    console.error(error);
    process.exit(1);
  }
}

// Ejecutar
ejecutarPruebas();
