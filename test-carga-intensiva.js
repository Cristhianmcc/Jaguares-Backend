/**
 * PRUEBAS DE CARGA INTENSIVA - SISTEMA JAGUARES
 * 
 * Este script realiza pruebas de carga progresiva para encontrar
 * los límites del sistema y potenciales errores bajo estrés.
 */

import mysql from 'mysql2/promise';
import { performance } from 'perf_hooks';

const API_URL = 'http://localhost:3002';
const DB_CONFIG = {
  host: 'localhost',
  port: 3307,
  user: 'root',
  password: 'rootpassword123',
  database: 'jaguares_db'
};

// Colores
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = (msg, color = c.reset) => console.log(`${color}${msg}${c.reset}`);

// Estadísticas globales
const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalTime: 0,
  minTime: Infinity,
  maxTime: 0,
  timeouts: 0,
  errors: [],
  memoryUsage: [],
  tiemposPorUsuario: []
};

// Generar datos aleatorios
const genDNI = () => String(10000000 + Math.floor(Math.random() * 90000000));
const genTel = () => '9' + String(10000000 + Math.floor(Math.random() * 90000000));
const genEmail = () => `test${Date.now()}${Math.random().toString(36).substr(2, 5)}@test.com`;

const nombres = ['Juan', 'Carlos', 'Miguel', 'Luis', 'José', 'Ana', 'María', 'Carmen', 'Rosa', 'Elena'];
const apellidos = ['García', 'López', 'Martínez', 'Rodríguez', 'Pérez', 'González', 'Sánchez', 'Torres'];

function generarUsuario() {
  const añoNacimiento = 2010 + Math.floor(Math.random() * 10);
  return {
    dni: genDNI(),
    nombres: nombres[Math.floor(Math.random() * nombres.length)],
    apellido_paterno: apellidos[Math.floor(Math.random() * apellidos.length)],
    apellido_materno: apellidos[Math.floor(Math.random() * apellidos.length)],
    fecha_nacimiento: `${añoNacimiento}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-15`,
    año_nacimiento: añoNacimiento,
    sexo: Math.random() > 0.5 ? 'Masculino' : 'Femenino',
    telefono: genTel(),
    email: genEmail(),
    direccion: `Av. Test ${Math.floor(Math.random() * 1000)}`,
    seguro_tipo: 'EsSalud',
    apoderado: 'Test Apoderado',
    telefono_apoderado: genTel()
  };
}

/**
 * Realizar una inscripción directo en MySQL (sin Apps Script)
 */
async function inscribirUsuario(usuario, horarios) {
  const inicio = performance.now();
  
  try {
    stats.totalRequests++;
    
    const connection = await mysql.createConnection(DB_CONFIG);
    
    // Insertar alumno
    const [resultAlumno] = await connection.execute(
      `INSERT INTO alumnos (
        dni, nombres, apellido_paterno, apellido_materno,
        fecha_nacimiento, sexo, telefono, email,
        direccion, seguro_tipo, apoderado, telefono_apoderado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuario.dni,
        usuario.nombres,
        usuario.apellido_paterno,
        usuario.apellido_materno,
        usuario.fecha_nacimiento,
        usuario.sexo,
        usuario.telefono,
        usuario.email,
        usuario.direccion,
        usuario.seguro_tipo,
        usuario.apoderado,
        usuario.telefono_apoderado
      ]
    );
    
    const alumnoId = resultAlumno.insertId;
    
    // Agrupar horarios por deporte
    const deportesMap = {};
    horarios.forEach(h => {
      const deporte = h.deporte || 'Fútbol';
      if (!deportesMap[deporte]) {
        deportesMap[deporte] = [];
      }
      deportesMap[deporte].push(h);
    });
    
    // Insertar inscripciones
    for (const [deporte, horariosDeporte] of Object.entries(deportesMap)) {
      const [deporteRow] = await connection.execute(
        'SELECT deporte_id FROM deportes WHERE nombre LIKE ? LIMIT 1',
        [`%${deporte}%`]
      );
      
      if (deporteRow.length === 0) continue;
      
      const deporteId = deporteRow[0].deporte_id;
      const cantidadDias = horariosDeporte.length;
      const precioMensual = cantidadDias * 30; // Precio simplificado
      
      const [resultInscripcion] = await connection.execute(
        `INSERT INTO inscripciones (alumno_id, deporte_id, plan, precio_mensual, matricula_pagada, estado)
         VALUES (?, ?, 'Económico', ?, 0, 'pendiente')`,
        [alumnoId, deporteId, precioMensual]
      );
      
      const inscripcionId = resultInscripcion.insertId;
      
      // Insertar horarios
      for (const horario of horariosDeporte) {
        if (horario.horario_id) {
          await connection.execute(
            `INSERT INTO inscripciones_horarios (inscripcion_id, horario_id)
             VALUES (?, ?)`,
            [inscripcionId, horario.horario_id]
          );
        }
      }
    }
    
    await connection.end();
    
    const tiempo = performance.now() - inicio;
    stats.successfulRequests++;
    stats.totalTime += tiempo;
    stats.minTime = Math.min(stats.minTime, tiempo);
    stats.maxTime = Math.max(stats.maxTime, tiempo);
    stats.tiemposPorUsuario.push(tiempo);
    
    return { success: true, tiempo, dni: usuario.dni };
    
  } catch (error) {
    const tiempo = performance.now() - inicio;
    stats.failedRequests++;
    stats.errors.push({ dni: usuario.dni, error: error.message, tiempo });
    return { success: false, tiempo, error: error.message };
  }
}

/**
 * Obtener horarios disponibles
 */
async function obtenerHorarios(añoNacimiento) {
  try {
    const response = await fetch(`${API_URL}/api/horarios?año_nacimiento=${añoNacimiento}`);
    const data = await response.json();
    return data.horarios || [];
  } catch (error) {
    return [];
  }
}

/**
 * Seleccionar horarios aleatorios
 */
function seleccionarHorarios(horarios, cantidad = 3) {
  if (horarios.length === 0) return [];
  
  const diasUsados = new Set();
  const seleccionados = [];
  
  for (const h of horarios) {
    if (seleccionados.length >= cantidad) break;
    if (!diasUsados.has(h.dia)) {
      seleccionados.push({
        horario_id: h.horario_id,
        deporte: h.deporte,
        dia: h.dia,
        hora_inicio: h.hora_inicio,
        hora_fin: h.hora_fin,
        plan: h.plan || 'Económico'
      });
      diasUsados.add(h.dia);
    }
  }
  
  return seleccionados;
}

/**
 * Registrar uso de memoria
 */
function registrarMemoria() {
  const mem = process.memoryUsage();
  stats.memoryUsage.push({
    timestamp: Date.now(),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    rss: Math.round(mem.rss / 1024 / 1024)
  });
}

/**
 * TEST 1: Carga Progresiva
 */
async function testCargaProgresiva() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 1: CARGA PROGRESIVA', c.bright);
  log('='.repeat(70), c.bright);
  
  const niveles = [
    { usuarios: 10, nombre: 'Carga Baja' },
    { usuarios: 25, nombre: 'Carga Media' },
    { usuarios: 50, nombre: 'Carga Alta' },
    { usuarios: 100, nombre: 'Carga Extrema' }
  ];
  
  for (const nivel of niveles) {
    log(`\n📊 ${nivel.nombre}: ${nivel.usuarios} usuarios simultáneos`, c.cyan);
    
    // Reset stats para este nivel
    const statsNivel = {
      exitosos: 0,
      fallidos: 0,
      tiempos: [],
      tiempoInicio: Date.now()
    };
    
    registrarMemoria();
    
    // Crear promesas de inscripción
    const promesas = [];
    for (let i = 0; i < nivel.usuarios; i++) {
      const usuario = generarUsuario();
      
      // Obtener horarios y preparar inscripción
      const promesa = (async () => {
        const horarios = await obtenerHorarios(usuario.año_nacimiento);
        const horariosSeleccionados = seleccionarHorarios(horarios, 2);
        
        if (horariosSeleccionados.length === 0) {
          return { success: false, error: 'Sin horarios' };
        }
        
        return await inscribirUsuario(usuario, horariosSeleccionados);
      })();
      
      promesas.push(promesa);
    }
    
    // Ejecutar todas simultáneamente
    log(`   ⏳ Ejecutando ${nivel.usuarios} inscripciones simultáneas...`, c.yellow);
    const resultados = await Promise.all(promesas);
    
    const tiempoTotal = Date.now() - statsNivel.tiempoInicio;
    registrarMemoria();
    
    // Analizar resultados
    resultados.forEach(r => {
      if (r.success) {
        statsNivel.exitosos++;
        statsNivel.tiempos.push(r.tiempo);
      } else {
        statsNivel.fallidos++;
      }
    });
    
    const tiempoPromedio = statsNivel.tiempos.reduce((a, b) => a + b, 0) / statsNivel.tiempos.length;
    const tiempoMin = Math.min(...statsNivel.tiempos);
    const tiempoMax = Math.max(...statsNivel.tiempos);
    
    // Reporte del nivel
    log(`   ✅ Exitosos: ${statsNivel.exitosos}`, c.green);
    log(`   ❌ Fallidos: ${statsNivel.fallidos}`, statsNivel.fallidos > 0 ? c.red : c.reset);
    log(`   ⏱️  Tiempo promedio: ${tiempoPromedio.toFixed(2)}ms`, c.cyan);
    log(`   ⚡ Tiempo mínimo: ${tiempoMin.toFixed(2)}ms`, c.cyan);
    log(`   🐌 Tiempo máximo: ${tiempoMax.toFixed(2)}ms`, c.cyan);
    log(`   🕐 Tiempo total: ${(tiempoTotal / 1000).toFixed(2)}s`, c.cyan);
    log(`   💾 Memoria heap: ${stats.memoryUsage[stats.memoryUsage.length - 1].heapUsed}MB`, c.magenta);
    
    // Esperar un poco antes del siguiente nivel
    if (nivel !== niveles[niveles.length - 1]) {
      log(`\n   ⏸️  Esperando 3 segundos antes del siguiente nivel...`, c.yellow);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

/**
 * TEST 2: Verificar integridad después de carga
 */
async function testIntegridadPostCarga() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 2: INTEGRIDAD POST-CARGA', c.bright);
  log('='.repeat(70), c.bright);
  
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    
    // 1. Verificar inscripciones huérfanas
    const [inscripcionesOrfanas] = await connection.execute(`
      SELECT COUNT(*) as total FROM inscripciones i 
      LEFT JOIN alumnos a ON i.alumno_id = a.alumno_id 
      WHERE a.alumno_id IS NULL
    `);
    
    if (inscripcionesOrfanas[0].total === 0) {
      log('   ✅ Sin inscripciones huérfanas', c.green);
    } else {
      log(`   ❌ ${inscripcionesOrfanas[0].total} inscripciones huérfanas`, c.red);
    }
    
    // 2. Verificar horarios inválidos
    const [horariosInvalidos] = await connection.execute(`
      SELECT COUNT(*) as total FROM inscripciones_horarios ih
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE h.horario_id IS NULL
    `);
    
    if (horariosInvalidos[0].total === 0) {
      log('   ✅ Sin horarios inválidos', c.green);
    } else {
      log(`   ❌ ${horariosInvalidos[0].total} horarios inválidos`, c.red);
    }
    
    // 3. Verificar DNIs duplicados
    const [dnisDuplicados] = await connection.execute(`
      SELECT dni, COUNT(*) as total FROM alumnos 
      GROUP BY dni HAVING total > 1
    `);
    
    if (dnisDuplicados.length === 0) {
      log('   ✅ Sin DNIs duplicados', c.green);
    } else {
      log(`   ❌ ${dnisDuplicados.length} DNIs duplicados`, c.red);
      dnisDuplicados.slice(0, 5).forEach(d => {
        log(`      DNI ${d.dni}: ${d.total} veces`, c.yellow);
      });
    }
    
    // 4. Verificar contadores de cupos
    const [cuposIncorrectos] = await connection.execute(`
      SELECT h.horario_id, h.cupos_ocupados, 
             COUNT(DISTINCT ih.inscripcion_id) as inscripciones_reales
      FROM horarios h
      LEFT JOIN inscripciones_horarios ih ON h.horario_id = ih.horario_id
      GROUP BY h.horario_id
      HAVING h.cupos_ocupados != inscripciones_reales
      LIMIT 10
    `);
    
    if (cuposIncorrectos.length === 0) {
      log('   ✅ Cupos contabilizados correctamente', c.green);
    } else {
      log(`   ⚠️  ${cuposIncorrectos.length} horarios con cupos incorrectos`, c.yellow);
      cuposIncorrectos.slice(0, 5).forEach(h => {
        log(`      Horario ${h.horario_id}: Registrado=${h.cupos_ocupados}, Real=${h.inscripciones_reales}`, c.yellow);
      });
    }
    
    // 5. Verificar datos totales
    const [totales] = await connection.execute(`
      SELECT 
        (SELECT COUNT(*) FROM alumnos) as alumnos,
        (SELECT COUNT(*) FROM inscripciones) as inscripciones,
        (SELECT COUNT(*) FROM inscripciones_horarios) as horarios_inscritos
    `);
    
    log(`\n   📊 Totales en BD:`, c.cyan);
    log(`      Alumnos: ${totales[0].alumnos}`, c.reset);
    log(`      Inscripciones: ${totales[0].inscripciones}`, c.reset);
    log(`      Horarios inscritos: ${totales[0].horarios_inscritos}`, c.reset);
    
    await connection.end();
  } catch (error) {
    log(`   ❌ Error verificando integridad: ${error.message}`, c.red);
  }
}

/**
 * TEST 3: Prueba de cupos limitados (condición de carrera)
 */
async function testCondicionDeCarrera() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 3: CONDICIÓN DE CARRERA (Cupos Limitados)', c.bright);
  log('='.repeat(70), c.bright);
  
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    
    // Crear un horario con solo 5 cupos
    const [resultDeporte] = await connection.execute(
      "SELECT deporte_id FROM deportes LIMIT 1"
    );
    
    if (resultDeporte.length === 0) {
      log('   ⚠️  No hay deportes en la BD', c.yellow);
      await connection.end();
      return;
    }
    
    const deporteId = resultDeporte[0].deporte_id;
    
    // Crear horario de prueba con 5 cupos
    const [resultHorario] = await connection.execute(`
      INSERT INTO horarios (
        deporte_id, dia, hora_inicio, hora_fin, 
        cupo_maximo, cupos_ocupados, estado, 
        categoria, ano_min, ano_max, precio, plan
      ) VALUES (?, 'LUNES', '18:00', '19:00', 5, 0, 'activo', 'Test', 2010, 2020, 60, 'Económico')
    `, [deporteId]);
    
    const horarioId = resultHorario.insertId;
    log(`   🎯 Horario creado: ID ${horarioId} con 5 cupos`, c.cyan);
    
    await connection.end();
    
    // Intentar que 20 usuarios se inscriban simultáneamente
    log(`   ⏳ Intentando inscribir 20 usuarios simultáneamente...`, c.yellow);
    
    const promesas = [];
    for (let i = 0; i < 20; i++) {
      const usuario = generarUsuario();
      usuario.año_nacimiento = 2015; // Asegurar que sea elegible
      
      const horarioTest = {
        horario_id: horarioId,
        deporte: 'Test',
        dia: 'LUNES',
        hora_inicio: '18:00',
        hora_fin: '19:00',
        plan: 'Económico'
      };
      
      promesas.push(inscribirUsuario(usuario, [horarioTest]));
    }
    
    const resultados = await Promise.all(promesas);
    
    const exitosos = resultados.filter(r => r.success).length;
    const fallidos = resultados.filter(r => !r.success).length;
    
    log(`   ✅ Inscripciones exitosas: ${exitosos}`, c.green);
    log(`   ❌ Inscripciones rechazadas: ${fallidos}`, c.red);
    
    // Verificar cupos
    const connVerif = await mysql.createConnection(DB_CONFIG);
    const [cuposActuales] = await connVerif.execute(
      'SELECT cupos_ocupados, cupo_maximo FROM horarios WHERE horario_id = ?',
      [horarioId]
    );
    
    if (cuposActuales.length > 0) {
      const { cupos_ocupados, cupo_maximo } = cuposActuales[0];
      log(`   📊 Cupos finales: ${cupos_ocupados}/${cupo_maximo}`, c.cyan);
      
      if (cupos_ocupados > cupo_maximo) {
        log(`   ❌ PROBLEMA: Se excedió el límite de cupos!`, c.red);
      } else if (cupos_ocupados <= cupo_maximo) {
        log(`   ✅ Límite de cupos respetado`, c.green);
      }
    }
    
    // Limpiar horario de prueba
    await connVerif.execute('DELETE FROM horarios WHERE horario_id = ?', [horarioId]);
    await connVerif.end();
    
  } catch (error) {
    log(`   ❌ Error en prueba: ${error.message}`, c.red);
  }
}

/**
 * TEST 4: Monitoreo de rendimiento bajo carga
 */
async function testRendimientoAPIs() {
  log('\n' + '='.repeat(70), c.bright);
  log('TEST 4: RENDIMIENTO DE APIs', c.bright);
  log('='.repeat(70), c.bright);
  
  const endpoints = [
    { name: 'Health Check', url: '/api/health', method: 'GET' },
    { name: 'Horarios', url: '/api/horarios', method: 'GET' },
    { name: 'Horarios filtrados', url: '/api/horarios?año_nacimiento=2015', method: 'GET' }
  ];
  
  for (const endpoint of endpoints) {
    log(`\n   🔍 ${endpoint.name}`, c.cyan);
    
    const tiempos = [];
    const intentos = 50;
    
    for (let i = 0; i < intentos; i++) {
      const inicio = performance.now();
      try {
        await fetch(`${API_URL}${endpoint.url}`);
        tiempos.push(performance.now() - inicio);
      } catch (error) {
        // Ignorar errores individuales
      }
    }
    
    if (tiempos.length > 0) {
      const promedio = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
      const min = Math.min(...tiempos);
      const max = Math.max(...tiempos);
      const p95 = tiempos.sort((a, b) => a - b)[Math.floor(tiempos.length * 0.95)];
      
      log(`      Promedio: ${promedio.toFixed(2)}ms`, c.reset);
      log(`      Mínimo: ${min.toFixed(2)}ms`, c.reset);
      log(`      Máximo: ${max.toFixed(2)}ms`, c.reset);
      log(`      P95: ${p95.toFixed(2)}ms`, c.reset);
    }
  }
}

/**
 * Reporte Final
 */
function generarReporteFinal() {
  log('\n' + '█'.repeat(70), c.bright);
  log('   REPORTE FINAL - PRUEBAS DE CARGA', c.bright);
  log('█'.repeat(70), c.bright);
  
  log(`\n📊 Estadísticas Generales:`, c.cyan);
  log(`   Total de requests: ${stats.totalRequests}`, c.reset);
  log(`   ✅ Exitosos: ${stats.successfulRequests} (${((stats.successfulRequests/stats.totalRequests)*100).toFixed(2)}%)`, c.green);
  log(`   ❌ Fallidos: ${stats.failedRequests}`, stats.failedRequests > 0 ? c.red : c.green);
  log(`   ⏱️  Timeouts: ${stats.timeouts}`, stats.timeouts > 0 ? c.yellow : c.green);
  
  if (stats.tiemposPorUsuario.length > 0) {
    const promedio = stats.totalTime / stats.successfulRequests;
    const sorted = [...stats.tiemposPorUsuario].sort((a, b) => a - b);
    const mediana = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    
    log(`\n⏱️  Tiempos de Respuesta:`, c.cyan);
    log(`   Promedio: ${promedio.toFixed(2)}ms`, c.reset);
    log(`   Mediana: ${mediana.toFixed(2)}ms`, c.reset);
    log(`   Mínimo: ${stats.minTime.toFixed(2)}ms`, c.reset);
    log(`   Máximo: ${stats.maxTime.toFixed(2)}ms`, c.reset);
    log(`   P95: ${p95.toFixed(2)}ms`, c.reset);
    log(`   P99: ${p99.toFixed(2)}ms`, c.reset);
  }
  
  if (stats.memoryUsage.length > 0) {
    const memInicial = stats.memoryUsage[0];
    const memFinal = stats.memoryUsage[stats.memoryUsage.length - 1];
    const memMax = Math.max(...stats.memoryUsage.map(m => m.heapUsed));
    
    log(`\n💾 Uso de Memoria:`, c.magenta);
    log(`   Inicial: ${memInicial.heapUsed}MB`, c.reset);
    log(`   Final: ${memFinal.heapUsed}MB`, c.reset);
    log(`   Máximo: ${memMax}MB`, c.reset);
    log(`   Incremento: ${(memFinal.heapUsed - memInicial.heapUsed)}MB`, c.reset);
  }
  
  if (stats.errors.length > 0) {
    log(`\n❌ Errores Encontrados (${stats.errors.length}):`, c.red);
    
    // Agrupar errores por tipo
    const erroresPorTipo = {};
    stats.errors.forEach(e => {
      const tipo = e.error || 'Unknown';
      erroresPorTipo[tipo] = (erroresPorTipo[tipo] || 0) + 1;
    });
    
    Object.entries(erroresPorTipo).forEach(([tipo, cantidad]) => {
      log(`   ${tipo}: ${cantidad} ocurrencias`, c.yellow);
    });
    
    // Mostrar primeros 5 errores
    log(`\n   Primeros 5 errores:`, c.yellow);
    stats.errors.slice(0, 5).forEach((e, idx) => {
      log(`   ${idx + 1}. DNI ${e.dni}: ${e.error} (${e.tiempo.toFixed(2)}ms)`, c.reset);
    });
  }
  
  // Veredicto final
  log(`\n${'='.repeat(70)}`, c.bright);
  const tasaExito = (stats.successfulRequests / stats.totalRequests) * 100;
  
  if (tasaExito >= 95) {
    log('   ✅ VEREDICTO: SISTEMA ESTABLE BAJO CARGA', c.green);
  } else if (tasaExito >= 80) {
    log('   ⚠️  VEREDICTO: SISTEMA CON ADVERTENCIAS', c.yellow);
  } else {
    log('   ❌ VEREDICTO: SISTEMA INESTABLE', c.red);
  }
  
  log(`${'='.repeat(70)}\n`, c.bright);
  
  // Guardar reporte JSON
  const reporte = {
    fecha: new Date().toISOString(),
    tasaExito: `${tasaExito.toFixed(2)}%`,
    estadisticas: {
      totalRequests: stats.totalRequests,
      exitosos: stats.successfulRequests,
      fallidos: stats.failedRequests,
      timeouts: stats.timeouts
    },
    tiempos: {
      promedio: stats.totalTime / stats.successfulRequests,
      min: stats.minTime,
      max: stats.maxTime
    },
    memoria: stats.memoryUsage,
    errores: stats.errors.slice(0, 20)
  };
  
  return reporte;
}

/**
 * Ejecutar todas las pruebas
 */
async function ejecutarPruebas() {
  const inicioTotal = Date.now();
  
  log('\n' + '█'.repeat(70), c.magenta);
  log('   🔥 PRUEBAS DE CARGA INTENSIVA - SISTEMA JAGUARES 🔥', c.magenta);
  log('█'.repeat(70) + '\n', c.magenta);
  
  try {
    await testCargaProgresiva();
    await testIntegridadPostCarga();
    await testCondicionDeCarrera();
    await testRendimientoAPIs();
    
    const tiempoTotal = ((Date.now() - inicioTotal) / 1000).toFixed(2);
    log(`\n⏱️  Tiempo total de pruebas: ${tiempoTotal}s`, c.cyan);
    
    const reporte = generarReporteFinal();
    
    // Guardar reporte
    const fs = await import('fs');
    fs.default.writeFileSync(
      'reporte-carga-intensiva.json',
      JSON.stringify(reporte, null, 2)
    );
    
    log(`✅ Reporte guardado en: reporte-carga-intensiva.json\n`, c.green);
    
  } catch (error) {
    log(`\n❌ Error fatal: ${error.message}`, c.red);
    console.error(error);
    process.exit(1);
  }
}

// Ejecutar
ejecutarPruebas();
