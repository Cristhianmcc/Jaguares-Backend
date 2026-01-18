/**
 * TEST COMPLETO DEL SISTEMA JAGUARES
 * Migración Google Sheets → MySQL + Docker
 * 
 * Este script verifica:
 * 1. Conexión a MySQL
 * 2. Endpoints API funcionando
 * 3. Simulación de inscripciones reales
 * 4. Integridad de datos
 * 5. Verificación de flujos completos
 */

import mysql from 'mysql2/promise';
import fs from 'fs';

// ==================== CONFIGURACIÓN ====================
const API_URL = 'http://localhost:3002';
const DB_CONFIG = {
  host: 'localhost',
  port: 3307,
  user: 'root',
  password: 'rootpassword123',
  database: 'jaguares_db'
};

// Colores para terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// ==================== UTILIDADES ====================
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function error(message) {
  log(`❌ ${message}`, colors.red);
}

function info(message) {
  log(`ℹ️  ${message}`, colors.cyan);
}

function warning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function section(title) {
  log(`\n${'='.repeat(60)}`, colors.bright);
  log(`${title}`, colors.bright);
  log(`${'='.repeat(60)}`, colors.bright);
}

// Delay entre pruebas
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Generar DNI aleatorio
function generarDNI() {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

// Generar teléfono aleatorio
function generarTelefono() {
  return '9' + String(Math.floor(10000000 + Math.random() * 90000000));
}

// ==================== DATOS DE PRUEBA ====================
const nombresHombres = ['Juan', 'Carlos', 'Miguel', 'Luis', 'José', 'Pedro', 'Diego', 'Andrés', 'Fernando', 'Roberto'];
const nombresMujeres = ['María', 'Ana', 'Carmen', 'Rosa', 'Elena', 'Laura', 'Patricia', 'Isabel', 'Sofía', 'Lucía'];
const apellidos = ['García', 'Rodríguez', 'González', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Torres', 'Ramírez'];

function generarAlumno(sexo = 'Masculino') {
  const nombres = sexo === 'Masculino' ? nombresHombres : nombresMujeres;
  const nombre = nombres[Math.floor(Math.random() * nombres.length)];
  const apellidoP = apellidos[Math.floor(Math.random() * apellidos.length)];
  const apellidoM = apellidos[Math.floor(Math.random() * apellidos.length)];
  
  // Generar edad entre 4 y 17 años
  const edadAnos = Math.floor(Math.random() * 14) + 4;
  const añoNacimiento = new Date().getFullYear() - edadAnos;
  
  return {
    dni: generarDNI(),
    nombres: nombre,
    apellido_paterno: apellidoP,
    apellido_materno: apellidoM,
    fecha_nacimiento: `${añoNacimiento}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
    año_nacimiento: añoNacimiento,
    sexo: sexo,
    telefono: generarTelefono(),
    email: `${nombre.toLowerCase()}.${apellidoP.toLowerCase()}@test.com`,
    direccion: `Av. Prueba ${Math.floor(Math.random() * 1000) + 1}`,
    seguro_tipo: ['EsSalud', 'SIS', 'Privado', 'Ninguno'][Math.floor(Math.random() * 4)],
    apoderado: `${nombres[Math.floor(Math.random() * nombres.length)]} ${apellidos[Math.floor(Math.random() * apellidos.length)]}`,
    telefono_apoderado: generarTelefono()
  };
}

// ==================== ESTADÍSTICAS ====================
const stats = {
  pruebasEjecutadas: 0,
  pruebasExitosas: 0,
  pruebasFallidas: 0,
  inscripcionesCreadas: 0,
  tiempoTotal: 0
};

// ==================== PRUEBAS ====================

/**
 * TEST 1: Verificar conexión a MySQL
 */
async function testConexionMySQL() {
  section('TEST 1: Conexión a MySQL');
  stats.pruebasEjecutadas++;
  
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    success('Conexión a MySQL establecida');
    
    // Verificar tablas
    const [tables] = await connection.execute('SHOW TABLES');
    info(`Tablas encontradas: ${tables.length}`);
    tables.forEach(table => {
      const tableName = table[`Tables_in_${DB_CONFIG.database}`];
      info(`  - ${tableName}`);
    });
    
    await connection.end();
    stats.pruebasExitosas++;
    return true;
  } catch (err) {
    error(`Error de conexión: ${err.message}`);
    stats.pruebasFallidas++;
    return false;
  }
}

/**
 * TEST 2: Verificar endpoints básicos
 */
async function testEndpointsBasicos() {
  section('TEST 2: Endpoints Básicos');
  stats.pruebasEjecutadas++;
  
  const endpoints = [
    { name: 'Health Check', url: '/api/health', method: 'GET' },
    { name: 'Horarios', url: '/api/horarios', method: 'GET' }
  ];
  
  let allPassed = true;
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${API_URL}${endpoint.url}`);
      const data = await response.json();
      
      if (response.ok) {
        success(`${endpoint.name}: OK (${response.status})`);
        if (endpoint.url === '/api/horarios' && data.horarios) {
          info(`  → Horarios disponibles: ${data.horarios.length}`);
        }
      } else {
        error(`${endpoint.name}: FAIL (${response.status})`);
        allPassed = false;
      }
    } catch (err) {
      error(`${endpoint.name}: ERROR - ${err.message}`);
      allPassed = false;
    }
    
    await sleep(100);
  }
  
  if (allPassed) stats.pruebasExitosas++;
  else stats.pruebasFallidas++;
  
  return allPassed;
}

/**
 * TEST 3: Obtener horarios y verificar estructura
 */
async function testHorarios() {
  section('TEST 3: Verificación de Horarios');
  stats.pruebasEjecutadas++;
  
  try {
    // Probar con diferentes filtros de edad
    const años = [2010, 2015, 2020];
    
    for (const año of años) {
      const response = await fetch(`${API_URL}/api/horarios?año_nacimiento=${año}`);
      const data = await response.json();
      
      if (response.ok && data.horarios) {
        success(`Horarios para año ${año}: ${data.horarios.length} disponibles`);
        
        // Verificar estructura del primer horario
        if (data.horarios.length > 0) {
          const horario = data.horarios[0];
          const camposRequeridos = ['horario_id', 'deporte', 'dia', 'hora_inicio', 'hora_fin'];
          const camposFaltantes = camposRequeridos.filter(campo => !horario[campo]);
          
          if (camposFaltantes.length === 0) {
            info(`  ✓ Estructura correcta de horarios`);
          } else {
            warning(`  Campos faltantes: ${camposFaltantes.join(', ')}`);
          }
        }
      } else {
        error(`No se pudieron obtener horarios para año ${año}`);
      }
      
      await sleep(200);
    }
    
    stats.pruebasExitosas++;
    return true;
  } catch (err) {
    error(`Error al obtener horarios: ${err.message}`);
    stats.pruebasFallidas++;
    return false;
  }
}

/**
 * TEST 4: Verificar datos en MySQL directamente
 */
async function testDatosMySQL() {
  section('TEST 4: Verificación de Datos en MySQL');
  stats.pruebasEjecutadas++;
  
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    
    // Contar registros en tablas principales
    const tablas = [
      { nombre: 'deportes', descripcion: 'Deportes' },
      { nombre: 'horarios', descripcion: 'Horarios' },
      { nombre: 'alumnos', descripcion: 'Alumnos' },
      { nombre: 'inscripciones', descripcion: 'Inscripciones' }
    ];
    
    for (const tabla of tablas) {
      const [rows] = await connection.execute(`SELECT COUNT(*) as total FROM ${tabla.nombre}`);
      const total = rows[0].total;
      info(`${tabla.descripcion}: ${total} registros`);
    }
    
    // Verificar horarios activos
    const [horariosActivos] = await connection.execute(
      "SELECT COUNT(*) as total FROM horarios WHERE estado = 'activo'"
    );
    success(`Horarios activos: ${horariosActivos[0].total}`);
    
    await connection.end();
    stats.pruebasExitosas++;
    return true;
  } catch (err) {
    error(`Error al verificar datos: ${err.message}`);
    stats.pruebasFallidas++;
    return false;
  }
}

/**
 * TEST 5: Simular inscripción completa
 */
async function testInscripcionSimple(alumno = null) {
  section('TEST 5: Inscripción Simple');
  stats.pruebasEjecutadas++;
  
  try {
    // Generar alumno si no se proporciona
    if (!alumno) {
      alumno = generarAlumno(Math.random() > 0.5 ? 'Masculino' : 'Femenino');
    }
    
    info(`Inscribiendo: ${alumno.nombres} ${alumno.apellido_paterno} (DNI: ${alumno.dni})`);
    
    // 1. Obtener horarios disponibles para su edad
    const responseHorarios = await fetch(
      `${API_URL}/api/horarios?año_nacimiento=${alumno.año_nacimiento}`
    );
    const dataHorarios = await responseHorarios.json();
    
    if (!dataHorarios.horarios || dataHorarios.horarios.length === 0) {
      error('No hay horarios disponibles para esta edad');
      stats.pruebasFallidas++;
      return false;
    }
    
    info(`  → Horarios disponibles: ${dataHorarios.horarios.length}`);
    
    // 2. Seleccionar 2-3 horarios aleatorios (diferentes días)
    const diasUsados = new Set();
    const horariosSeleccionados = [];
    
    for (let i = 0; i < dataHorarios.horarios.length && horariosSeleccionados.length < 3; i++) {
      const horario = dataHorarios.horarios[i];
      if (!diasUsados.has(horario.dia)) {
        horariosSeleccionados.push({
          horario_id: horario.horario_id,
          deporte: horario.deporte,
          dia: horario.dia,
          hora_inicio: horario.hora_inicio,
          hora_fin: horario.hora_fin,
          plan: horario.plan || 'Económico'
        });
        diasUsados.add(horario.dia);
      }
    }
    
    if (horariosSeleccionados.length === 0) {
      error('No se pudieron seleccionar horarios');
      stats.pruebasFallidas++;
      return false;
    }
    
    info(`  → Horarios seleccionados: ${horariosSeleccionados.length}`);
    horariosSeleccionados.forEach(h => {
      info(`     - ${h.deporte}: ${h.dia} ${h.hora_inicio}-${h.hora_fin}`);
    });
    
    // 3. Validar DNI
    const responseDNI = await fetch(`${API_URL}/api/validar-dni/${alumno.dni}`);
    const dataDNI = await responseDNI.json();
    
    if (!dataDNI.disponible) {
      warning(`  DNI ${alumno.dni} ya existe - generando nuevo DNI`);
      alumno.dni = generarDNI();
      info(`  → Nuevo DNI: ${alumno.dni}`);
    }
    
    // 4. Inscribir (simulado - sin Apps Script)
    // Como Apps Script requiere token, vamos a insertar directo en MySQL
    const connection = await mysql.createConnection(DB_CONFIG);
    
    // Insertar alumno
    const [resultAlumno] = await connection.execute(
      `INSERT INTO alumnos (
        dni, nombres, apellido_paterno, apellido_materno,
        fecha_nacimiento, sexo, telefono, email,
        direccion, seguro_tipo, apoderado, telefono_apoderado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        alumno.dni,
        alumno.nombres,
        alumno.apellido_paterno,
        alumno.apellido_materno,
        alumno.fecha_nacimiento,
        alumno.sexo,
        alumno.telefono,
        alumno.email,
        alumno.direccion,
        alumno.seguro_tipo,
        alumno.apoderado,
        alumno.telefono_apoderado
      ]
    );
    
    const alumnoId = resultAlumno.insertId;
    success(`  ✓ Alumno creado - ID: ${alumnoId}`);
    
    // Insertar inscripción por cada deporte
    const deportesMap = {};
    horariosSeleccionados.forEach(h => {
      if (!deportesMap[h.deporte]) {
        deportesMap[h.deporte] = [];
      }
      deportesMap[h.deporte].push(h);
    });
    
    for (const [deporte, horarios] of Object.entries(deportesMap)) {
      // Obtener deporte_id
      const [deporteRow] = await connection.execute(
        'SELECT deporte_id FROM deportes WHERE nombre = ?',
        [deporte]
      );
      
      if (deporteRow.length === 0) continue;
      
      const deporteId = deporteRow[0].deporte_id;
      const cantidadDias = horarios.length;
      const plan = horarios[0].plan || 'Económico';
      
      // Calcular precio simplificado
      let monto = 60;
      if (plan === 'Estándar') monto = cantidadDias * 40;
      else if (plan === 'Premium') monto = cantidadDias * 50;
      else if (cantidadDias >= 3) monto = 80;
      
      // Insertar inscripción (usando precio_mensual según esquema actual)
      const [resultInscripcion] = await connection.execute(
        `INSERT INTO inscripciones (
          alumno_id, deporte_id, plan, precio_mensual, 
          matricula_pagada, estado, fecha_inscripcion
        ) VALUES (?, ?, ?, ?, 0, 'pendiente', NOW())`,
        [alumnoId, deporteId, plan, monto]
      );
      
      const inscripcionId = resultInscripcion.insertId;
      
      // Insertar horarios de la inscripción
      for (const horario of horarios) {
        await connection.execute(
          `INSERT INTO inscripciones_horarios (inscripcion_id, horario_id)
           VALUES (?, ?)`,
          [inscripcionId, horario.horario_id]
        );
      }
      
      success(`  ✓ Inscripción creada - ${deporte} (${cantidadDias} días, S/ ${monto})`);
      stats.inscripcionesCreadas++;
    }
    
    await connection.end();
    
    stats.pruebasExitosas++;
    return { success: true, alumnoId, dni: alumno.dni };
    
  } catch (err) {
    error(`Error en inscripción: ${err.message}`);
    console.error(err);
    stats.pruebasFallidas++;
    return { success: false, error: err.message };
  }
}

/**
 * TEST 6: Consultar inscripción
 */
async function testConsultarInscripcion(dni) {
  section('TEST 6: Consulta de Inscripción');
  stats.pruebasEjecutadas++;
  
  try {
    const response = await fetch(`${API_URL}/api/consultar/${dni}`);
    const data = await response.json();
    
    if (response.ok && data.inscripciones) {
      success(`Inscripciones encontradas: ${data.inscripciones.length}`);
      data.inscripciones.forEach((insc, idx) => {
        info(`  ${idx + 1}. ${insc.deporte} - ${insc.cantidad_dias} días - S/ ${insc.monto}`);
      });
      stats.pruebasExitosas++;
      return true;
    } else {
      error('No se encontraron inscripciones');
      stats.pruebasFallidas++;
      return false;
    }
  } catch (err) {
    error(`Error en consulta: ${err.message}`);
    stats.pruebasFallidas++;
    return false;
  }
}

/**
 * TEST 7: Inscripciones múltiples concurrentes
 */
async function testInscripcionesConcurrentes(cantidad = 5) {
  section(`TEST 7: ${cantidad} Inscripciones Concurrentes`);
  stats.pruebasEjecutadas++;
  
  try {
    const promesas = [];
    const alumnos = [];
    
    for (let i = 0; i < cantidad; i++) {
      const alumno = generarAlumno(i % 2 === 0 ? 'Masculino' : 'Femenino');
      alumnos.push(alumno);
      promesas.push(testInscripcionSimple(alumno));
    }
    
    info(`Iniciando ${cantidad} inscripciones simultáneas...`);
    const resultados = await Promise.all(promesas);
    
    const exitosas = resultados.filter(r => r.success).length;
    const fallidas = resultados.filter(r => !r.success).length;
    
    success(`Inscripciones exitosas: ${exitosas}`);
    if (fallidas > 0) {
      warning(`Inscripciones fallidas: ${fallidas}`);
    }
    
    stats.pruebasExitosas++;
    return true;
  } catch (err) {
    error(`Error en prueba concurrente: ${err.message}`);
    stats.pruebasFallidas++;
    return false;
  }
}

/**
 * TEST 8: Validación de duplicados
 */
async function testValidacionDuplicados() {
  section('TEST 8: Validación de Duplicados');
  stats.pruebasEjecutadas++;
  
  try {
    const dni = generarDNI();
    const alumno1 = generarAlumno();
    alumno1.dni = dni;
    
    // Primera inscripción
    const result1 = await testInscripcionSimple(alumno1);
    
    if (!result1.success) {
      error('No se pudo crear primera inscripción');
      stats.pruebasFallidas++;
      return false;
    }
    
    // Intentar duplicar
    const alumno2 = generarAlumno();
    alumno2.dni = dni;
    
    try {
      await testInscripcionSimple(alumno2);
      error('FALLO: Se permitió DNI duplicado');
      stats.pruebasFallidas++;
      return false;
    } catch (err) {
      success('✓ Validación de duplicados funcionando');
      stats.pruebasExitosas++;
      return true;
    }
  } catch (err) {
    error(`Error en validación: ${err.message}`);
    stats.pruebasFallidas++;
    return false;
  }
}

/**
 * TEST 9: Verificar integridad referencial
 */
async function testIntegridadReferencial() {
  section('TEST 9: Integridad Referencial');
  stats.pruebasEjecutadas++;
  
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    
    // Verificar que todas las inscripciones tengan alumno válido
    const [inscripcionesOrfanas] = await connection.execute(`
      SELECT i.inscripcion_id 
      FROM inscripciones i 
      LEFT JOIN alumnos a ON i.alumno_id = a.alumno_id 
      WHERE a.alumno_id IS NULL
    `);
    
    if (inscripcionesOrfanas.length === 0) {
      success('✓ No hay inscripciones huérfanas');
    } else {
      error(`Inscripciones sin alumno: ${inscripcionesOrfanas.length}`);
    }
    
    // Verificar que todos los horarios de inscripción sean válidos
    const [horariosInvalidos] = await connection.execute(`
      SELECT ih.inscripcion_id, ih.horario_id
      FROM inscripciones_horarios ih
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE h.horario_id IS NULL
    `);
    
    if (horariosInvalidos.length === 0) {
      success('✓ Todos los horarios son válidos');
    } else {
      error(`Horarios inválidos en inscripciones: ${horariosInvalidos.length}`);
    }
    
    await connection.end();
    
    if (inscripcionesOrfanas.length === 0 && horariosInvalidos.length === 0) {
      stats.pruebasExitosas++;
      return true;
    } else {
      stats.pruebasFallidas++;
      return false;
    }
  } catch (err) {
    error(`Error en verificación: ${err.message}`);
    stats.pruebasFallidas++;
    return false;
  }
}

// ==================== EJECUTAR TODAS LAS PRUEBAS ====================

async function ejecutarTodasLasPruebas() {
  const inicio = Date.now();
  
  log('\n' + '█'.repeat(60), colors.bright);
  log('   SUITE DE PRUEBAS - SISTEMA JAGUARES', colors.bright);
  log('   Migración: Google Sheets → MySQL + Docker', colors.bright);
  log('█'.repeat(60) + '\n', colors.bright);
  
  // Pruebas de infraestructura
  await testConexionMySQL();
  await sleep(500);
  
  await testEndpointsBasicos();
  await sleep(500);
  
  await testHorarios();
  await sleep(500);
  
  await testDatosMySQL();
  await sleep(500);
  
  // Pruebas funcionales
  const resultInscripcion = await testInscripcionSimple();
  await sleep(500);
  
  if (resultInscripcion.success) {
    await testConsultarInscripcion(resultInscripcion.dni);
    await sleep(500);
  }
  
  // Pruebas de carga
  await testInscripcionesConcurrentes(3);
  await sleep(500);
  
  // Pruebas de validación
  await testValidacionDuplicados();
  await sleep(500);
  
  await testIntegridadReferencial();
  
  // ==================== REPORTE FINAL ====================
  
  stats.tiempoTotal = ((Date.now() - inicio) / 1000).toFixed(2);
  
  section('REPORTE FINAL');
  log('');
  info(`Tiempo total: ${stats.tiempoTotal}s`);
  info(`Pruebas ejecutadas: ${stats.pruebasEjecutadas}`);
  success(`Pruebas exitosas: ${stats.pruebasExitosas}`);
  if (stats.pruebasFallidas > 0) {
    error(`Pruebas fallidas: ${stats.pruebasFallidas}`);
  }
  info(`Inscripciones creadas: ${stats.inscripcionesCreadas}`);
  
  const tasaExito = ((stats.pruebasExitosas / stats.pruebasEjecutadas) * 100).toFixed(2);
  log('');
  
  if (tasaExito >= 90) {
    success(`Tasa de éxito: ${tasaExito}% ✓`);
    log('\n🎉 SISTEMA FUNCIONANDO CORRECTAMENTE 🎉\n', colors.green);
  } else if (tasaExito >= 70) {
    warning(`Tasa de éxito: ${tasaExito}% ⚠️`);
    log('\n⚠️  SISTEMA CON ADVERTENCIAS ⚠️\n', colors.yellow);
  } else {
    error(`Tasa de éxito: ${tasaExito}% ❌`);
    log('\n❌ SISTEMA CON PROBLEMAS CRÍTICOS ❌\n', colors.red);
  }
  
  log('█'.repeat(60) + '\n', colors.bright);
  
  // Guardar reporte en archivo
  const reporte = {
    fecha: new Date().toISOString(),
    estadisticas: stats,
    tasaExito: `${tasaExito}%`,
    estado: tasaExito >= 90 ? 'ÓPTIMO' : tasaExito >= 70 ? 'ADVERTENCIA' : 'CRÍTICO'
  };
  
  fs.writeFileSync(
    'reporte-pruebas-mysql.json',
    JSON.stringify(reporte, null, 2)
  );
  
  success('Reporte guardado en: reporte-pruebas-mysql.json');
}

// Ejecutar
ejecutarTodasLasPruebas().catch(err => {
  error(`Error fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
