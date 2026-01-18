/**
 * VERIFICACIÓN RÁPIDA DEL SISTEMA JAGUARES
 * Script de diagnóstico para ejecutar periódicamente
 */

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: 'localhost',
  port: 3307,
  user: 'root',
  password: 'rootpassword123',
  database: 'jaguares_db'
};

const API_URL = 'http://localhost:3002';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

async function verificarSistema() {
  log('\n═══════════════════════════════════════════════════', colors.cyan);
  log('   VERIFICACIÓN RÁPIDA - SISTEMA JAGUARES', colors.cyan);
  log('═══════════════════════════════════════════════════\n', colors.cyan);
  
  const checks = [];
  
  // 1. MySQL
  try {
    const conn = await mysql.createConnection(DB_CONFIG);
    await conn.ping();
    await conn.end();
    log('✅ MySQL: Conectado', colors.green);
    checks.push(true);
  } catch (error) {
    log(`❌ MySQL: Error - ${error.message}`, colors.red);
    checks.push(false);
  }
  
  // 2. Servidor API
  try {
    const response = await fetch(`${API_URL}/api/health`);
    if (response.ok) {
      log('✅ API Server: Activo', colors.green);
      checks.push(true);
    } else {
      log('❌ API Server: Error de respuesta', colors.red);
      checks.push(false);
    }
  } catch (error) {
    log(`❌ API Server: No responde - ${error.message}`, colors.red);
    checks.push(false);
  }
  
  // 3. Datos básicos
  try {
    const conn = await mysql.createConnection(DB_CONFIG);
    
    const [deportes] = await conn.execute('SELECT COUNT(*) as total FROM deportes WHERE estado = "activo"');
    const [horarios] = await conn.execute('SELECT COUNT(*) as total FROM horarios WHERE estado = "activo"');
    const [alumnos] = await conn.execute('SELECT COUNT(*) as total FROM alumnos WHERE estado = "activo"');
    const [inscripciones] = await conn.execute('SELECT COUNT(*) as total FROM inscripciones');
    
    log(`✅ Datos: ${deportes[0].total} deportes, ${horarios[0].total} horarios, ${alumnos[0].total} alumnos, ${inscripciones[0].total} inscripciones`, colors.green);
    
    await conn.end();
    checks.push(true);
  } catch (error) {
    log(`❌ Datos: Error - ${error.message}`, colors.red);
    checks.push(false);
  }
  
  // 4. Integridad referencial
  try {
    const conn = await mysql.createConnection(DB_CONFIG);
    
    const [huerfanas] = await conn.execute(`
      SELECT COUNT(*) as total
      FROM inscripciones i
      LEFT JOIN alumnos a ON i.alumno_id = a.alumno_id
      WHERE a.alumno_id IS NULL
    `);
    
    if (huerfanas[0].total === 0) {
      log('✅ Integridad: Sin registros huérfanos', colors.green);
      checks.push(true);
    } else {
      log(`⚠️  Integridad: ${huerfanas[0].total} inscripciones huérfanas`, colors.yellow);
      checks.push(false);
    }
    
    await conn.end();
  } catch (error) {
    log(`❌ Integridad: Error - ${error.message}`, colors.red);
    checks.push(false);
  }
  
  // 5. Endpoints críticos
  try {
    const response = await fetch(`${API_URL}/api/horarios`);
    const data = await response.json();
    
    if (data.success && data.horarios.length > 0) {
      log(`✅ Endpoint horarios: ${data.horarios.length} disponibles`, colors.green);
      checks.push(true);
    } else {
      log('⚠️  Endpoint horarios: Sin datos', colors.yellow);
      checks.push(false);
    }
  } catch (error) {
    log(`❌ Endpoint horarios: Error - ${error.message}`, colors.red);
    checks.push(false);
  }
  
  // Resumen
  const exitosos = checks.filter(c => c).length;
  const total = checks.length;
  const porcentaje = ((exitosos / total) * 100).toFixed(0);
  
  log('\n═══════════════════════════════════════════════════', colors.cyan);
  log(`   RESULTADO: ${exitosos}/${total} checks exitosos (${porcentaje}%)`, colors.cyan);
  
  if (exitosos === total) {
    log('   🎉 SISTEMA FUNCIONANDO PERFECTAMENTE', colors.green);
  } else if (exitosos >= total * 0.8) {
    log('   ⚠️  SISTEMA FUNCIONANDO CON ADVERTENCIAS', colors.yellow);
  } else {
    log('   ❌ SISTEMA CON PROBLEMAS CRÍTICOS', colors.red);
  }
  
  log('═══════════════════════════════════════════════════\n', colors.cyan);
  
  process.exit(exitosos === total ? 0 : 1);
}

verificarSistema().catch(err => {
  log(`\n❌ Error fatal: ${err.message}`, colors.red);
  process.exit(1);
});
