/**
 * SIMULADOR DE USUARIOS REALES - SISTEMA JAGUARES
 * Simula el flujo completo de inscripción desde la perspectiva del usuario
 */

import fetch from 'node-fetch';

const API_URL = 'http://localhost:3002';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

// Datos de prueba realistas
const usuariosPrueba = [
  {
    nombres: 'Juan Pablo',
    apellido_paterno: 'García',
    apellido_materno: 'López',
    dni: '98765432',
    fecha_nacimiento: '2015-03-15',
    año_nacimiento: 2015,
    sexo: 'Masculino',
    telefono: '987654321',
    email: 'juan.garcia@example.com',
    direccion: 'Av. Los Pinos 123, San Borja',
    seguro_tipo: 'EsSalud',
    apoderado: 'María López de García',
    telefono_apoderado: '987654322',
    deportePreferido: 'Fútbol'
  },
  {
    nombres: 'María Fernanda',
    apellido_paterno: 'Torres',
    apellido_materno: 'Ramírez',
    dni: '87654321',
    fecha_nacimiento: '2016-07-22',
    año_nacimiento: 2016,
    sexo: 'Femenino',
    telefono: '987654323',
    email: 'maria.torres@example.com',
    direccion: 'Jr. Las Flores 456, Surco',
    seguro_tipo: 'SIS',
    apoderado: 'Carlos Torres Ruiz',
    telefono_apoderado: '987654324',
    deportePreferido: 'Fútbol'
  },
  {
    nombres: 'Carlos Andrés',
    apellido_paterno: 'Mendoza',
    apellido_materno: 'Silva',
    dni: '76543210',
    fecha_nacimiento: '2010-11-08',
    año_nacimiento: 2010,
    sexo: 'Masculino',
    telefono: '987654325',
    email: 'carlos.mendoza@example.com',
    direccion: 'Calle Los Rosales 789, La Molina',
    seguro_tipo: 'Privado',
    apoderado: 'Ana Silva de Mendoza',
    telefono_apoderado: '987654326',
    deportePreferido: 'ASODE'
  },
  {
    nombres: 'Sofía Valentina',
    apellido_paterno: 'Quispe',
    apellido_materno: 'Huamán',
    dni: '65432109',
    fecha_nacimiento: '2018-02-14',
    año_nacimiento: 2018,
    sexo: 'Femenino',
    telefono: '987654327',
    email: 'sofia.quispe@example.com',
    direccion: 'Av. La Marina 234, Pueblo Libre',
    seguro_tipo: 'EsSalud',
    apoderado: 'Pedro Quispe Torres',
    telefono_apoderado: '987654328',
    deportePreferido: 'Fútbol'
  },
  {
    nombres: 'Diego Alejandro',
    apellido_paterno: 'Sánchez',
    apellido_materno: 'Morales',
    dni: '54321098',
    fecha_nacimiento: '2012-09-30',
    año_nacimiento: 2012,
    sexo: 'Masculino',
    telefono: '987654329',
    email: 'diego.sanchez@example.com',
    direccion: 'Jr. Los Cedros 567, Miraflores',
    seguro_tipo: 'Ninguno',
    apoderado: 'Rosa Morales Vega',
    telefono_apoderado: '987654330',
    deportePreferido: 'Fútbol'
  }
];

// Función para esperar
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Simular delay de usuario pensando/escribiendo
const userDelay = () => sleep(Math.random() * 1000 + 500);

/**
 * PASO 1: Usuario visita la página y ve los horarios disponibles
 */
async function paso1_VerHorarios(usuario) {
  log(`\n👤 ${usuario.nombres} ${usuario.apellido_paterno} está visitando la página...`, colors.cyan);
  await userDelay();
  
  try {
    const response = await fetch(
      `${API_URL}/api/horarios?año_nacimiento=${usuario.año_nacimiento}`
    );
    const data = await response.json();
    
    if (data.success && data.horarios) {
      log(`   ✓ Ve ${data.horarios.length} horarios disponibles para su edad`, colors.green);
      
      // Filtrar por deporte preferido
      const horariosPreferidos = data.horarios.filter(h => 
        h.deporte.toLowerCase().includes(usuario.deportePreferido.toLowerCase())
      );
      
      log(`   ✓ ${horariosPreferidos.length} horarios de ${usuario.deportePreferido}`, colors.green);
      return horariosPreferidos;
    }
    
    log(`   ✗ No se pudieron cargar los horarios`, colors.red);
    return [];
  } catch (error) {
    log(`   ✗ Error: ${error.message}`, colors.red);
    return [];
  }
}

/**
 * PASO 2: Usuario selecciona horarios (máximo 2 por día)
 */
async function paso2_SeleccionarHorarios(usuario, horariosDisponibles) {
  log(`\n📅 ${usuario.nombres} está seleccionando horarios...`, colors.cyan);
  await userDelay();
  
  if (horariosDisponibles.length === 0) {
    log(`   ✗ No hay horarios para seleccionar`, colors.red);
    return [];
  }
  
  // Simular selección realista: 2-3 días diferentes
  const diasSeleccionados = new Set();
  const horariosSeleccionados = [];
  
  for (const horario of horariosDisponibles) {
    if (horariosSeleccionados.length >= 3) break;
    
    const diaCount = Array.from(diasSeleccionados).filter(d => d === horario.dia).length;
    if (diaCount < 2 && !diasSeleccionados.has(horario.dia)) {
      horariosSeleccionados.push({
        horario_id: horario.horario_id,
        deporte: horario.deporte,
        dia: horario.dia,
        hora_inicio: horario.hora_inicio,
        hora_fin: horario.hora_fin,
        plan: horario.plan || 'Económico'
      });
      diasSeleccionados.add(horario.dia);
      
      await sleep(500); // Simula tiempo pensando
    }
  }
  
  log(`   ✓ Seleccionó ${horariosSeleccionados.length} horarios:`, colors.green);
  horariosSeleccionados.forEach(h => {
    log(`      • ${h.deporte} - ${h.dia} ${h.hora_inicio}-${h.hora_fin}`, colors.reset);
  });
  
  return horariosSeleccionados;
}

/**
 * PASO 3: Usuario llena el formulario de inscripción
 */
async function paso3_LlenarFormulario(usuario) {
  log(`\n📝 ${usuario.nombres} está llenando el formulario...`, colors.cyan);
  
  // Simular tiempo llenando cada campo
  const campos = [
    'DNI', 'Nombres', 'Apellidos', 'Fecha de nacimiento',
    'Teléfono', 'Email', 'Dirección', 'Apoderado'
  ];
  
  for (const campo of campos) {
    await sleep(Math.random() * 300 + 200);
    log(`   ✓ ${campo} completado`, colors.reset);
  }
  
  log(`   ✓ Formulario completo`, colors.green);
  return true;
}

/**
 * PASO 4: Validar DNI (verificar si ya está registrado)
 */
async function paso4_ValidarDNI(dni) {
  log(`\n🔍 Validando DNI ${dni}...`, colors.cyan);
  await userDelay();
  
  try {
    const response = await fetch(`${API_URL}/api/validar-dni/${dni}`);
    const data = await response.json();
    
    if (data.disponible) {
      log(`   ✓ DNI disponible`, colors.green);
      return true;
    } else {
      log(`   ⚠ DNI ya registrado`, colors.yellow);
      return false;
    }
  } catch (error) {
    log(`   ✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * PASO 5: Enviar inscripción
 */
async function paso5_EnviarInscripcion(usuario, horarios) {
  log(`\n📤 Enviando inscripción...`, colors.cyan);
  await sleep(1000); // Simula clic en botón
  
  try {
    const response = await fetch(`${API_URL}/api/inscribir-multiple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        alumno: usuario,
        horarios: horarios
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      log(`   ✅ INSCRIPCIÓN EXITOSA`, colors.green);
      if (data.numero_inscripcion) {
        log(`   📋 Número de inscripción: ${data.numero_inscripcion}`, colors.green);
      }
      return { success: true, data };
    } else {
      log(`   ❌ Error: ${data.error || 'Error desconocido'}`, colors.red);
      return { success: false, error: data.error };
    }
  } catch (error) {
    log(`   ❌ Error de red: ${error.message}`, colors.red);
    return { success: false, error: error.message };
  }
}

/**
 * PASO 6: Consultar inscripción
 */
async function paso6_ConsultarInscripcion(dni) {
  log(`\n🔍 Consultando inscripción con DNI ${dni}...`, colors.cyan);
  await userDelay();
  
  try {
    const response = await fetch(`${API_URL}/api/consultar/${dni}`);
    const data = await response.json();
    
    if (response.ok && data.inscripciones) {
      log(`   ✓ Se encontraron ${data.inscripciones.length} inscripciones`, colors.green);
      data.inscripciones.forEach((insc, idx) => {
        log(`   ${idx + 1}. ${insc.deporte || 'N/A'} - Estado: ${insc.estado}`, colors.reset);
      });
      return true;
    } else {
      log(`   ⚠ No se encontraron inscripciones`, colors.yellow);
      return false;
    }
  } catch (error) {
    log(`   ✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Simular un usuario completo
 */
async function simularUsuario(usuario, numero) {
  log(`\n${'═'.repeat(70)}`, colors.magenta);
  log(`  SIMULACIÓN ${numero}: ${usuario.nombres} ${usuario.apellido_paterno}`, colors.magenta);
  log(`  Edad: ${2026 - usuario.año_nacimiento} años | Deporte: ${usuario.deportePreferido}`, colors.magenta);
  log(`${'═'.repeat(70)}`, colors.magenta);
  
  // PASO 1: Ver horarios
  const horarios = await paso1_VerHorarios(usuario);
  if (horarios.length === 0) {
    log(`\n⚠️  Sin horarios disponibles - simulación terminada`, colors.yellow);
    return { success: false, razon: 'sin_horarios' };
  }
  
  // PASO 2: Seleccionar horarios
  const horariosSeleccionados = await paso2_SeleccionarHorarios(usuario, horarios);
  if (horariosSeleccionados.length === 0) {
    log(`\n⚠️  No seleccionó horarios - simulación terminada`, colors.yellow);
    return { success: false, razon: 'sin_seleccion' };
  }
  
  // PASO 3: Llenar formulario
  await paso3_LlenarFormulario(usuario);
  
  // PASO 4: Validar DNI
  const dniValido = await paso4_ValidarDNI(usuario.dni);
  
  // PASO 5: Enviar inscripción
  const resultado = await paso5_EnviarInscripcion(usuario, horariosSeleccionados);
  
  if (resultado.success) {
    // PASO 6: Consultar inscripción
    await sleep(1000);
    await paso6_ConsultarInscripcion(usuario.dni);
    
    log(`\n✅ SIMULACIÓN COMPLETADA EXITOSAMENTE`, colors.green);
    return { success: true, dni: usuario.dni };
  } else {
    log(`\n❌ SIMULACIÓN FALLÓ: ${resultado.error}`, colors.red);
    return { success: false, razon: 'error_inscripcion', error: resultado.error };
  }
}

/**
 * Ejecutar todas las simulaciones
 */
async function ejecutarSimulaciones() {
  log(`\n${'█'.repeat(70)}`, colors.magenta);
  log(`  SIMULADOR DE USUARIOS REALES - SISTEMA JAGUARES`, colors.magenta);
  log(`  Total de usuarios a simular: ${usuariosPrueba.length}`, colors.magenta);
  log(`${'█'.repeat(70)}\n`, colors.magenta);
  
  const resultados = [];
  
  for (let i = 0; i < usuariosPrueba.length; i++) {
    const usuario = usuariosPrueba[i];
    const resultado = await simularUsuario(usuario, i + 1);
    resultados.push(resultado);
    
    // Pausa entre usuarios
    if (i < usuariosPrueba.length - 1) {
      await sleep(2000);
    }
  }
  
  // Resumen final
  log(`\n${'═'.repeat(70)}`, colors.magenta);
  log(`  RESUMEN FINAL`, colors.magenta);
  log(`${'═'.repeat(70)}`, colors.magenta);
  
  const exitosas = resultados.filter(r => r.success).length;
  const fallidas = resultados.filter(r => !r.success).length;
  
  log(`\n📊 Estadísticas:`, colors.cyan);
  log(`   Total simulados: ${resultados.length}`, colors.reset);
  log(`   ✅ Exitosas: ${exitosas}`, colors.green);
  log(`   ❌ Fallidas: ${fallidas}`, colors.red);
  log(`   📈 Tasa de éxito: ${((exitosas/resultados.length)*100).toFixed(2)}%\n`, colors.cyan);
  
  if (fallidas > 0) {
    log(`\n⚠️  Razones de fallo:`, colors.yellow);
    const fallos = resultados.filter(r => !r.success);
    fallos.forEach((f, idx) => {
      log(`   ${idx + 1}. ${f.razon || 'Desconocido'}: ${f.error || 'N/A'}`, colors.reset);
    });
  }
  
  log(`\n${'█'.repeat(70)}\n`, colors.magenta);
}

// Ejecutar
ejecutarSimulaciones().catch(err => {
  log(`\n❌ Error fatal: ${err.message}`, colors.red);
  console.error(err);
  process.exit(1);
});
