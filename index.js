import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno desde .env
config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3002;

// ==================== CONFIGURACIÓN ACADEMIA DEPORTIVA ====================

// URL y TOKEN del Apps Script (backend transaccional)
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN;

if (!APPS_SCRIPT_URL || !APPS_SCRIPT_TOKEN) {
  console.error('❌ ERROR: Variables de entorno requeridas no configuradas:');
  console.error('   - APPS_SCRIPT_URL');
  console.error('   - APPS_SCRIPT_TOKEN');
  process.exit(1);
}

console.log('✅ Apps Script URL configurado:', APPS_SCRIPT_URL);

// ==================== SISTEMA DE CACHÉ ====================

// Almacenamiento de caché en memoria
const cache = new Map();

// Configuración de tiempo de vida del caché (en milisegundos)
const CACHE_TTL = {
  horarios: 5 * 60 * 1000,      // 5 minutos para horarios
  inscritos: 2 * 60 * 1000,     // 2 minutos para lista de inscritos
  consulta: 3 * 60 * 1000,      // 3 minutos para consultas de inscripción
  default: 1 * 60 * 1000        // 1 minuto por defecto
};

/**
 * Obtiene datos del caché si están disponibles y no han expirado
 */
function getFromCache(key) {
  const cached = cache.get(key);
  
  if (!cached) {
    return null;
  }
  
  // Verificar si el caché expiró
  if (Date.now() > cached.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return cached.data;
}

/**
 * Guarda datos en el caché con tiempo de expiración
 */
function setCache(key, data, ttl = CACHE_TTL.default) {
  cache.set(key, {
    data: data,
    expiresAt: Date.now() + ttl
  });
}

/**
 * Limpia el caché completo o por patrón
 */
function clearCache(pattern = null) {
  if (!pattern) {
    cache.clear();
    console.log('🗑️  Caché completo limpiado');
    return;
  }
  
  // Limpiar entradas que coincidan con el patrón
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
  console.log(`🗑️  Caché limpiado para patrón: ${pattern}`);
}

// Limpiar caché automáticamente cada 10 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now > value.expiresAt) {
      cache.delete(key);
    }
  }
  console.log('🧹 Limpieza automática de caché ejecutada');
}, 10 * 60 * 1000);

// Middleware
app.use(cors());
app.use(express.json());

// ==================== ENDPOINTS ACADEMIA DEPORTIVA ====================

// Endpoint para obtener horarios disponibles (CON CACHÉ)
app.get('/api/horarios', async (req, res) => {
  try {
    const cacheKey = 'horarios';
    
    // Intentar obtener del caché
    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      console.log('✅ Horarios servidos desde caché');
      return res.json(cachedData);
    }
    
    // Si no está en caché, obtener de Apps Script
    const url = `${APPS_SCRIPT_URL}?action=horarios&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al obtener horarios');
    }
    
    // Guardar en caché
    setCache(cacheKey, data, CACHE_TTL.horarios);
    console.log('💾 Horarios guardados en caché');
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al obtener horarios:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al obtener horarios' 
    });
  }
});

// Endpoint para inscribir a múltiples horarios
app.post('/api/inscribir-multiple', async (req, res) => {
  try {
    const { alumno, horarios } = req.body;
    
    // Validaciones básicas
    if (!alumno || !horarios || !Array.isArray(horarios)) {
      return res.status(400).json({
        success: false,
        error: 'Datos inválidos. Se requiere alumno y horarios (array)'
      });
    }
    
    if (horarios.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Debe seleccionar al menos un horario'
      });
    }
    
    // Sin límite global - permitimos múltiples horarios (2 por día validado en frontend)
    
    // Reenviar al Apps Script
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: APPS_SCRIPT_TOKEN,
        action: 'inscribir_multiple',
        alumno,
        horarios
      })
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      return res.status(response.status || 500).json(data);
    }
    
    // INVALIDAR CACHÉ después de inscripción exitosa
    clearCache('horarios');
    clearCache('inscritos');
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al inscribir:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al procesar inscripción' 
    });
  }
});

// Endpoint para consultar inscripciones por DNI
app.get('/api/mis-inscripciones/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI inválido'
      });
    }
    
    const url = `${APPS_SCRIPT_URL}?action=mis_inscripciones&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al obtener inscripciones');
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al obtener inscripciones:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al obtener inscripciones' 
    });
  }
});

// Endpoint: Registrar pago pendiente
app.post('/api/registrar-pago', async (req, res) => {
  try {
    const { alumno, metodo_pago, horarios_seleccionados } = req.body;
    
    if (!alumno || !alumno.dni || !metodo_pago) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos'
      });
    }
    
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'registrar_pago',
        token: APPS_SCRIPT_TOKEN,
        alumno,
        metodo_pago,
        horarios_seleccionados: horarios_seleccionados || []
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al registrar pago');
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al registrar pago:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al registrar pago' 
    });
  }
});

// Endpoint: Verificar estado de pago
app.get('/api/verificar-pago/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI inválido'
      });
    }
    
    const url = `${APPS_SCRIPT_URL}?action=verificar_pago&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al verificar pago');
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al verificar pago:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al verificar pago' 
    });
  }
});

// Endpoint para validar DNI (verificar formato y si ya existe)
app.get('/api/validar-dni/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.toString().length !== 8) {
      return res.status(400).json({
        success: false,
        valido: false,
        error: 'DNI debe tener 8 dígitos'
      });
    }
    
    const url = `${APPS_SCRIPT_URL}?action=validar_dni&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al validar DNI');
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al validar DNI:', error);
    res.status(500).json({ 
      success: false,
      valido: false,
      error: error.message || 'Error al validar DNI' 
    });
  }
});

// Endpoint para eliminar usuario por DNI (elimina de TODAS las hojas)
app.delete('/api/eliminar-usuario/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.toString().length !== 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI debe tener 8 dígitos'
      });
    }
    
    const url = `${APPS_SCRIPT_URL}?action=eliminar_usuario&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al eliminar usuario');
    }
    
    // INVALIDAR CACHÉ después de eliminación exitosa
    clearCache('inscritos');
    clearCache('horarios');
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al eliminar usuario:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Error al eliminar usuario' 
    });
  }
});

// Endpoint: Consultar inscripción por DNI (para página de consulta)
app.get('/api/consultar/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI inválido'
      });
    }
    
    // Crear clave de caché para este DNI
    const cacheKey = `consulta_${dni}`;
    
    // Intentar obtener del caché
    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      console.log('✅ Consulta servida desde caché para DNI:', dni);
      return res.json(cachedData);
    }
    
    const url = `${APPS_SCRIPT_URL}?action=consultar_inscripcion&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al consultar inscripción');
    }
    
    // Solo cachear si la consulta fue exitosa
    if (data.success) {
      setCache(cacheKey, data, CACHE_TTL.consulta);
      console.log('💾 Consulta guardada en caché para DNI:', dni);
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al consultar inscripción:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al consultar inscripción' 
    });
  }
});

// ==================== ENDPOINTS ADMINISTRACIÓN ====================

// Login de administrador
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Credenciales admin (en producción usar base de datos y hash)
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@jaguares.com';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      res.json({
        success: true,
        admin: {
          email: ADMIN_EMAIL,
          nombre: 'Administrador',
          rol: 'admin'
        }
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'Credenciales inválidas'
      });
    }
  } catch (error) {
    console.error('❌ Error en login admin:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error en el servidor' 
    });
  }
});

// Obtener todos los inscritos
app.get('/api/admin/inscritos', async (req, res) => {
  try {
    const { dia, deporte } = req.query;
    
    // Crear clave de caché única basada en los filtros
    const cacheKey = `inscritos_${dia || 'all'}_${deporte || 'all'}`;
    
    // Intentar obtener del caché
    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      console.log('✅ Inscritos servidos desde caché:', cacheKey);
      return res.json(cachedData);
    }
    
    let url = `${APPS_SCRIPT_URL}?action=listar_inscritos&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}`;
    
    if (dia) {
      url += `&dia=${encodeURIComponent(dia)}`;
    }
    
    if (deporte) {
      url += `&deporte=${encodeURIComponent(deporte)}`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al listar inscritos');
    }

    // Guardar en caché
    setCache(cacheKey, data, CACHE_TTL.inscritos);
    console.log('💾 Inscritos guardados en caché:', cacheKey);

    res.json(data);
  } catch (error) {
    console.error('❌ Error al listar inscritos:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al listar inscritos' 
    });
  }
});

// ==================== FIN ENDPOINTS ADMINISTRACIÓN ====================

// Endpoint: Activar inscripciones manualmente (cuando el admin confirma pago)
app.post('/api/activar-inscripciones/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI inválido'
      });
    }
    
    const url = `${APPS_SCRIPT_URL}?action=activar_inscripciones&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al activar inscripciones');
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al activar inscripciones:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al activar inscripciones' 
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Academia Deportiva API',
    timestamp: new Date().toISOString(),
    appsScriptConfigured: !!APPS_SCRIPT_URL
  });
});

// ==================== ENDPOINTS LEGACY (CAMPAMENTO) ====================
// Los siguientes endpoints se mantienen para compatibilidad pero están obsoletos

// NOTA: Autenticación con Google Sheets deshabilitada - Se usa Apps Script como intermediario
// Configurar Google Sheets API con Service Account (LEGACY)
let auth;
let sheets;

console.log('ℹ️ Backend configurado para usar Apps Script - Google Sheets API no requerida');

// Obtener spreadsheetId del archivo .env o configuración
const SPREADSHEET_ID = process.env.VITE_SPREADSHEET_ID || '1hCbcC82oeY4auvQ6TC4FdmWcfr35Cnw-EJcPg8B8MCg';
const SPREADSHEET_ID_BACKUP = process.env.VITE_SPREADSHEET_ID_BACKUP || '1Xp8VI8CulkMZMiOc1RzopFLrwL6FnTQ5a3_gskMpbcY'; // Sheet de respaldo

// ==================== ENDPOINTS ====================

// 1. Agregar inscripción a la hoja única "Inscripciones"
app.post('/api/inscripciones', async (req, res) => {
  try {
    const data = req.body;
    
    const values = [[
      data.codigoInscripcion,
      data.nombres,
      data.apellidos,
      data.edad,
      data.sexo || 'N/A',
      data.dni,
      data.email,
      data.telefono,
      data.iglesia,
      data.necesidadesEspeciales || 'N/A',
      data.estadoPago, // "Pendiente" por defecto
      new Date(data.fechaInscripcion).toLocaleString('es-PE', { timeZone: 'America/Lima' }),
      data.fechaConfirmacion || '',
      '', // Columna N - Día 1 Taller 1
      '', // Columna O - Día 1 Taller 2
      '', // Columna P - Día 2 Taller 1
      '', // Columna Q - Día 2 Taller 2
      '', // Columna R - Día 3 Taller 1
      '', // Columna S - Día 3 Taller 2
      '', // Columna T - Día 4 Taller 1
      ''  // Columna U - Día 4 Taller 2
    ]];

    // Guardar en sheet principal
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });

    // Guardar también en sheet de respaldo si está configurado
    if (SPREADSHEET_ID_BACKUP) {
      try {
        // Obtener la última fila con datos en el sheet de backup para insertar correctamente
        const backupData = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: 'Inscripciones!A:A', // Solo columna A para encontrar la última fila
        });
        
        const backupRows = backupData.data.values || [];
        const nextRow = backupRows.length + 1; // La siguiente fila después de la última con datos
        
        // Insertar en la fila específica del backup
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: `Inscripciones!A${nextRow}:U${nextRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values }
        });
        console.log(`✅ Inscripción guardada también en sheet de respaldo (fila ${nextRow})`);
      } catch (backupError) {
        console.error('⚠️ Error al guardar en sheet de respaldo:', backupError.message);
      }
    }

    res.json({ success: true, message: 'Inscripción guardada' });
  } catch (error) {
    console.error('Error al guardar inscripción:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Verificar si DNI existe
app.get('/api/verificar-dni/:dni', async (req, res) => {
  try {
    const { dni } = req.params;

    // Buscar solo en la hoja Inscripciones
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U',
    });

    const rows = response.data.values || [];

    // Buscar DNI en columna F (índice 5)
    let existe = false;
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][5] === dni) {
        existe = true;
        break;
      }
    }

    res.json({ existe });
  } catch (error) {
    console.error('Error al verificar DNI:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Verificar pago confirmado (Estado Pago = "Confirmado")
app.get('/api/verificar-pago/:dni', async (req, res) => {
  try {
    const { dni } = req.params;

    // Buscar primero en sheet principal
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U',
    });

    const rows = result.data.values || [];

    // Buscar DNI en columna F (índice 5) Y Estado Pago = "Confirmado" en columna K (índice 10)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[5] === dni && row[10] === 'Confirmado') {
        return res.json({
          permitido: true,
          datos: {
            codigoInscripcion: row[0],
            nombres: row[1],
            apellidos: row[2],
            edad: row[3],
            sexo: row[4],
            dni: row[5],
            email: row[6],
            telefono: row[7],
            iglesia: row[8],
            necesidadesEspeciales: row[9],
            estadoPago: row[10],
            fechaInscripcion: row[11],
            fechaConfirmacion: row[12],
            tallerAsignado: null,
            fechaRegistroTaller: null
          }
        });
      }
    }

    // Si no encontró en el principal, buscar en el sheet de respaldo
    if (SPREADSHEET_ID_BACKUP) {
      try {
        const resultBackup = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: 'Inscripciones!A:U',
        });

        const rowsBackup = resultBackup.data.values || [];

        for (let i = 1; i < rowsBackup.length; i++) {
          const row = rowsBackup[i];
          if (row[5] === dni && row[10] === 'Confirmado') {
            console.log('✅ Pago confirmado encontrado en sheet de respaldo');
            return res.json({
              permitido: true,
              datos: {
                codigoInscripcion: row[0],
                nombres: row[1],
                apellidos: row[2],
                edad: row[3],
                sexo: row[4],
                dni: row[5],
                email: row[6],
                telefono: row[7],
                iglesia: row[8],
                necesidadesEspeciales: row[9],
                estadoPago: row[10],
                fechaInscripcion: row[11],
                fechaConfirmacion: row[12],
                tallerAsignado: null,
                fechaRegistroTaller: null
              }
            });
          }
        }
      } catch (backupError) {
        console.error('⚠️ Error al verificar en sheet de respaldo:', backupError.message);
      }
    }

    res.json({ permitido: false, datos: null });
  } catch (error) {
    console.error('Error al verificar pago:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Verificar si tiene taller asignado
app.get('/api/verificar-taller/:dni', async (req, res) => {
  try {
    const { dni } = req.params;

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U', // Incluir nuevas columnas
    });

    const rows = result.data.values || [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[5] === dni) {
        // Verificar columnas N-U (sistema de talleres por día)
        const talleresNuevos = row.slice(13, 21); // columnas N-U
        const tieneTalleresNuevos = talleresNuevos && talleresNuevos.some(t => t && t.trim() !== '');
        
        const tieneTaller = tieneTalleresNuevos;
        return res.json({ 
          tieneTaller,
          talleresRegistrados: tieneTalleresNuevos ? talleresNuevos : null
        });
      }
    }

    // Si no encontró en el principal, buscar en el sheet de respaldo
    if (SPREADSHEET_ID_BACKUP) {
      try {
        const resultBackup = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: 'Inscripciones!A:U',
        });

        const rowsBackup = resultBackup.data.values || [];

        for (let i = 1; i < rowsBackup.length; i++) {
          const row = rowsBackup[i];
          if (row[5] === dni) {
            const talleresNuevos = row.slice(13, 21);
            const tieneTalleresNuevos = talleresNuevos && talleresNuevos.some(t => t && t.trim() !== '');
            
            return res.json({ 
              tieneTaller: tieneTalleresNuevos,
              talleresRegistrados: tieneTalleresNuevos ? talleresNuevos : null
            });
          }
        }
      } catch (backupError) {
        console.error('⚠️ Error al verificar talleres en sheet de respaldo:', backupError.message);
      }
    }

    res.json({ tieneTaller: false });
  } catch (error) {
    console.error('Error al verificar taller:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Registrar en taller
app.post('/api/registrar-taller', async (req, res) => {
  try {
    const { dni, tallerId } = req.body;

    // Buscar la fila del usuario
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U', // Hoja única
    });

    const rows = result.data.values || [];
    let rowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][5] === dni) {
        rowIndex = i + 1; // +1 porque Sheets empieza en 1
        break;
      }
    }

    if (rowIndex === -1) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    // Actualizar columnas N y O
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Inscripciones!N${rowIndex}:O${rowIndex}`, // Hoja única
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          tallerId,
          new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })
        ]]
      }
    });

    // Actualizar también en sheet de respaldo si está configurado
    if (SPREADSHEET_ID_BACKUP) {
      try {
        // Buscar la fila del usuario en el sheet de respaldo de forma INDEPENDIENTE
        const backupResult = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: 'Inscripciones!A:U',
        });

        const backupRows = backupResult.data.values || [];
        let backupRowIndex = -1;

        for (let i = 1; i < backupRows.length; i++) {
          if (backupRows[i][5] === dni) {
            backupRowIndex = i + 1;
            break;
          }
        }

        if (backupRowIndex !== -1) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID_BACKUP,
            range: `Inscripciones!N${backupRowIndex}:O${backupRowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[
                tallerId,
                new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })
              ]]
            }
          });
          console.log(`✅ Taller guardado también en sheet de respaldo (fila ${backupRowIndex})`);
        }
      } catch (backupError) {
        console.error('⚠️ Error al guardar taller en sheet de respaldo:', backupError.message);
      }
    }

    res.json({ success: true, message: 'Registrado en taller' });
  } catch (error) {
    console.error('Error al registrar en taller:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5B. Registrar múltiples talleres por día (NUEVO SISTEMA)
app.post('/api/registrar-talleres-por-dia', async (req, res) => {
  try {
    const { dni, talleres } = req.body;
    // talleres es un array de { dia: number, talleres: string[] }
    
    if (!dni || !talleres || !Array.isArray(talleres)) {
      return res.status(400).json({ success: false, error: 'Datos inválidos' });
    }

    // Buscar la fila del usuario
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U',
    });

    const rows = result.data.values || [];
    let rowIndex = -1;
    let filaUsuario = null;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][5] === dni) {
        rowIndex = i + 1;
        filaUsuario = rows[i];
        break;
      }
    }

    if (rowIndex === -1) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    // VERIFICAR SI YA TIENE TALLERES REGISTRADOS (columnas N-U, índices 13-20)
    const talleresExistentes = filaUsuario.slice(13, 21); // columnas N-U
    const tieneAlgunTaller = talleresExistentes.some(t => t && t.trim() !== '');
    
    if (tieneAlgunTaller) {
      console.log(`⚠️ Usuario ${dni} ya tiene talleres registrados`);
      return res.status(400).json({ 
        success: false, 
        error: 'Ya tienes talleres registrados. No puedes inscribirte nuevamente.' 
      });
    }

    // Preparar los datos para actualizar
    // Columnas: O(14), P(15), Q(16), R(17), S(18), T(19), U(20), V(21)
    const talleresPorColumna = ['', '', '', '', '', '', '', '']; // 8 columnas para talleres

    talleres.forEach(diaData => {
      const dia = diaData.dia;
      const talleresDelDia = diaData.talleres;

      if (dia >= 1 && dia <= 4 && Array.isArray(talleresDelDia)) {
        const baseIndex = (dia - 1) * 2; // Cada día tiene 2 columnas
        
        // Convertir IDs a NOMBRES completos
        if (talleresDelDia[0]) {
          const nombreTaller = TALLERES_NOMBRES[talleresDelDia[0]] || talleresDelDia[0];
          talleresPorColumna[baseIndex] = nombreTaller;
        }
        if (talleresDelDia[1]) {
          const nombreTaller = TALLERES_NOMBRES[talleresDelDia[1]] || talleresDelDia[1];
          talleresPorColumna[baseIndex + 1] = nombreTaller;
        }
      }
    });

    // Actualizar columnas N a U en sheet principal
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Inscripciones!N${rowIndex}:U${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [talleresPorColumna]
      }
    });

    // ==================== NUEVA FUNCIONALIDAD: AGREGAR A HOJAS DE TALLERES ====================
    // Obtener datos completos del usuario
    // Columnas: A=Código, B=Nombres, C=Apellidos, D=Edad, E=Sexo, F=DNI, G=Email, H=Teléfono, I=Iglesia
    const datosUsuario = {
      codigo: filaUsuario[0],
      nombres: filaUsuario[1],
      apellidos: filaUsuario[2],
      edad: filaUsuario[3],
      sexo: filaUsuario[4] || '',   // Columna E
      dni: filaUsuario[5],  // Columna F
      email: filaUsuario[6],  // Columna G
      telefono: filaUsuario[7], // Columna H
      iglesia: filaUsuario[8],  // Columna I
      fechaRegistro: new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })
    };

    // Función auxiliar para agregar usuario a hoja de taller
    const agregarAHojaTaller = async (spreadsheetId, nombreTaller, datosUsuario) => {
      try {
        // Verificar si la hoja existe, si no, crearla
        const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
        const hojasExistentes = sheetInfo.data.sheets.map(s => s.properties.title);
        
        if (!hojasExistentes.includes(nombreTaller)) {
          // Crear la hoja del taller
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{
                addSheet: {
                  properties: { title: nombreTaller }
                }
              }]
            }
          });
          
          // Agregar encabezados
          const encabezados = [['Código', 'Nombres', 'Apellidos', 'Edad', 'Sexo', 'DNI', 'Email', 'Teléfono', 'Iglesia', 'Fecha Registro']];
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${nombreTaller}!A1:J1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: encabezados }
          });
          
          console.log(`📄 Hoja creada: ${nombreTaller}`);
        }
        
        // Agregar los datos del usuario a la hoja del taller
        const fila = [[
          datosUsuario.codigo,
          datosUsuario.nombres,
          datosUsuario.apellidos,
          datosUsuario.edad,
          datosUsuario.sexo,
          datosUsuario.dni,
          datosUsuario.email,
          datosUsuario.telefono,
          datosUsuario.iglesia,
          datosUsuario.fechaRegistro
        ]];
        
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${nombreTaller}!A:J`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: fila }
        });
        
        console.log(`✅ Usuario agregado a hoja: ${nombreTaller}`);
      } catch (error) {
        console.error(`⚠️ Error al agregar usuario a hoja ${nombreTaller}:`, error.message);
      }
    };

    // Agregar a hojas de talleres en sheet principal
    for (let i = 0; i < talleresPorColumna.length; i++) {
      const nombreTaller = talleresPorColumna[i];
      if (nombreTaller && nombreTaller.trim() !== '') {
        await agregarAHojaTaller(SPREADSHEET_ID, nombreTaller, datosUsuario);
      }
    }

    // Actualizar también en sheet de respaldo si está configurado
    if (SPREADSHEET_ID_BACKUP) {
      try {
        // Buscar la fila del usuario en el sheet de respaldo de forma INDEPENDIENTE
        const backupResult = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: 'Inscripciones!A:U',
        });

        const backupRows = backupResult.data.values || [];
        let backupRowIndex = -1;

        for (let i = 1; i < backupRows.length; i++) {
          if (backupRows[i][5] === dni) { // Columna F (índice 5) es el DNI
            backupRowIndex = i + 1;
            break;
          }
        }

        if (backupRowIndex !== -1) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID_BACKUP,
            range: `Inscripciones!N${backupRowIndex}:U${backupRowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [talleresPorColumna]
            }
          });
          console.log(`✅ Talleres guardados también en sheet de respaldo (fila ${backupRowIndex})`);
          
          // Agregar a hojas de talleres en sheet de respaldo
          for (let i = 0; i < talleresPorColumna.length; i++) {
            const nombreTaller = talleresPorColumna[i];
            if (nombreTaller && nombreTaller.trim() !== '') {
              await agregarAHojaTaller(SPREADSHEET_ID_BACKUP, nombreTaller, datosUsuario);
            }
          }
        } else {
          console.warn(`⚠️ Usuario ${dni} no encontrado en sheet de respaldo`);
        }
      } catch (backupError) {
        console.error('⚠️ Error al guardar talleres en sheet de respaldo:', backupError.message);
      }
    }

    console.log(`✅ Talleres registrados para DNI ${dni}:`, talleresPorColumna);
    res.json({ success: true, message: 'Talleres registrados exitosamente' });
  } catch (error) {
    console.error('Error al registrar talleres por día:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5C. Obtener cupos disponibles por taller (NUEVO)
app.get('/api/cupos-talleres', async (req, res) => {
  try {
    console.log('📊 Obteniendo cupos de talleres...');
    
    // Obtener todas las inscripciones
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U',
    });

    const rows = result.data.values || [];
    
    // Contar inscritos por taller
    const inscritosPorTaller = {};
    
    // Inicializar contadores para todos los talleres
    for (let dia = 1; dia <= 4; dia++) {
      for (let taller = 1; taller <= 3; taller++) {
        const tallerId = `dia${dia}-taller${taller}`;
        inscritosPorTaller[tallerId] = 0;
      }
    }
    
    // Contar inscritos (saltar la fila de encabezados)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Leer columnas N-U (índices 13-20)
      // N=Día1-T1, O=Día1-T2, P=Día2-T1, Q=Día2-T2, R=Día3-T1, S=Día3-T2, T=Día4-T1, U=Día4-T2
      const talleres = row.slice(13, 21);
      
      talleres.forEach(nombreTaller => {
        if (nombreTaller && nombreTaller.trim() !== '') {
          // Buscar el ID del taller por su nombre
          for (const [tallerId, nombre] of Object.entries(TALLERES_NOMBRES)) {
            if (nombre === nombreTaller.trim()) {
              inscritosPorTaller[tallerId] = (inscritosPorTaller[tallerId] || 0) + 1;
              break;
            }
          }
        }
      });
    }
    
    console.log('✅ Cupos calculados:', inscritosPorTaller);
    res.json({ success: true, inscritos: inscritosPorTaller });
  } catch (error) {
    console.error('Error al obtener cupos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Obtener datos completos del usuario por DNI (para perfil)
app.get('/api/perfil/:dni', async (req, res) => {
  try {
    const { dni } = req.params;

    // Consultar sheet principal
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U', // Incluir columnas de talleres
    });

    const rows = result.data.values || [];
    let datosUsuario = null;

    // Buscar DNI en columna F (índice 5) del sheet principal
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[5] === dni) {
        // Extraer talleres de columnas N-U (índices 13-20)
        const talleresPorDia = {
          dia1: [row[13] || null, row[14] || null].filter(t => t),
          dia2: [row[15] || null, row[16] || null].filter(t => t),
          dia3: [row[17] || null, row[18] || null].filter(t => t),
          dia4: [row[19] || null, row[20] || null].filter(t => t)
        };
        
        datosUsuario = {
          codigo: row[0],
          nombres: row[1],
          apellidos: row[2],
          edad: row[3],
          sexo: row[4],
          dni: row[5],
          email: row[6],
          telefono: row[7],
          iglesia: row[8],
          estadoPago: row[10] || 'Pendiente',
          fechaInscripcion: row[11],
          fechaConfirmacion: row[12] || '',
          tallerAsignado: null,
          talleresPorDia
        };
        
        console.log('📋 Usuario encontrado en sheet principal, estado:', datosUsuario.estadoPago);
        break;
      }
    }

    // Si no se encontró en el principal, retornar no encontrado
    if (!datosUsuario) {
      return res.json({ encontrado: false, datos: null });
    }

    // Consultar el sheet de respaldo para verificar estado de pago
    if (SPREADSHEET_ID_BACKUP) {
      try {
        const resultBackup = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: 'Inscripciones!A:U',
        });

        const rowsBackup = resultBackup.data.values || [];

        for (let i = 1; i < rowsBackup.length; i++) {
          const row = rowsBackup[i];
          if (row[5] === dni) {
            const estadoPagoBackup = row[10];
            const fechaConfirmacionBackup = row[12];
            
            console.log('🔍 Estado de pago en backup:', estadoPagoBackup);
            
            // Si el backup tiene el pago confirmado, usar ese estado
            if (estadoPagoBackup === 'Confirmado') {
              console.log('✅ Actualizando estado de pago desde backup: Confirmado');
              datosUsuario.estadoPago = 'Confirmado';
              datosUsuario.fechaConfirmacion = fechaConfirmacionBackup || datosUsuario.fechaConfirmacion;
            }
            
            break;
          }
        }
      } catch (backupError) {
        console.error('⚠️ Error al consultar sheet de respaldo:', backupError.message);
      }
    }

    // Retornar datos con el estado de pago correcto (del backup si está confirmado ahí)
    return res.json({
      encontrado: true,
      datos: datosUsuario
    });
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. Sincronizar talleres - Crear/actualizar hojas por taller
app.post('/api/sincronizar-talleres', async (req, res) => {
  try {
    console.log('📊 Sincronizando talleres...');

    // Obtener todas las inscripciones con talleres asignados
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:N',
    });

    const datos = response.data.values || [];
    
    // Agrupar por taller
    const talleresMapa = {};
    
    for (let i = 1; i < datos.length; i++) {
      const row = datos[i];
      const tallerId = row[12]; // Columna M
      
      if (tallerId && tallerId !== '') {
        if (!talleresMapa[tallerId]) {
          talleresMapa[tallerId] = [];
        }
        
        talleresMapa[tallerId].push({
          codigo: row[0],
          nombres: row[1],
          apellidos: row[2],
          edad: row[3],
          dni: row[4],
          email: row[5],
          telefono: row[6],
          iglesia: row[7],
          fechaRegistro: row[13] || ''
        });
      }
    }

    // Obtener info de las hojas existentes
    const sheetInfo = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const hojasExistentes = sheetInfo.data.sheets.map(s => s.properties.title);

    // Nombres de talleres
    const nombresTalleres = {
      'taller-1': 'Taller - Adoración y Alabanza',
      'taller-2': 'Taller - Evangelismo Creativo',
      'taller-3': 'Taller - Liderazgo Juvenil',
      'taller-4': 'Taller - Multimedia y Diseño',
      'taller-5': 'Taller - Teatro y Drama',
      'taller-6': 'Taller - Servicio y Misiones'
    };

    // Crear/actualizar cada hoja de taller
    for (const [tallerId, participantes] of Object.entries(talleresMapa)) {
      const nombreHoja = nombresTalleres[tallerId] || tallerId;
      
      // Si la hoja no existe, crearla
      if (!hojasExistentes.includes(nombreHoja)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: nombreHoja
                }
              }
            }]
          }
        });
        console.log(`✅ Hoja creada: ${nombreHoja}`);
      }

      // Preparar datos para la hoja
      const encabezados = ['Código', 'Nombres', 'Apellidos', 'Edad', 'DNI', 'Email', 'Teléfono', 'Iglesia', 'Fecha Registro'];
      const filas = participantes.map(p => [
        p.codigo,
        p.nombres,
        p.apellidos,
        p.edad,
        p.dni,
        p.email,
        p.telefono,
        p.iglesia,
        p.fechaRegistro
      ]);

      // Limpiar y escribir datos
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${nombreHoja}!A:I`,
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${nombreHoja}!A1:I${filas.length + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [encabezados, ...filas]
        }
      });

      console.log(`✅ ${nombreHoja}: ${participantes.length} participantes`);
    }

    res.json({ 
      success: true, 
      message: 'Talleres sincronizados',
      talleres: Object.keys(talleresMapa).length,
      participantes: Object.values(talleresMapa).reduce((sum, arr) => sum + arr.length, 0)
    });
  } catch (error) {
    console.error('Error al sincronizar talleres:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint de health check
app.get('/', (req, res) => {
  res.json({ 
    message: 'Backend de Campamento Cristiano funcionando',
    status: 'OK',
    spreadsheetId: SPREADSHEET_ID
  });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo en http://localhost:${PORT}`);
  console.log('');
  console.log('🏃 Endpoints Academia Deportiva:');
  console.log(`  GET    http://localhost:${PORT}/api/health`);
  console.log(`  GET    http://localhost:${PORT}/api/horarios`);
  console.log(`  POST   http://localhost:${PORT}/api/inscribir-multiple`);
  console.log(`  GET    http://localhost:${PORT}/api/mis-inscripciones/:dni`);
  console.log(`  GET    http://localhost:${PORT}/api/validar-dni/:dni`);
  console.log(`  DELETE http://localhost:${PORT}/api/eliminar-usuario/:dni`);
  console.log('');
  console.log('🔐 Endpoints Administración:');
  console.log(`  POST   http://localhost:${PORT}/api/admin/login`);
  console.log(`  GET    http://localhost:${PORT}/api/admin/inscritos`);
  console.log('');
  console.log('📋 Endpoints Legacy (Campamento):');
  console.log(`  POST   http://localhost:${PORT}/api/inscripciones`);
  console.log(`  GET    http://localhost:${PORT}/api/verificar-dni/:dni`);
  console.log(`  GET    http://localhost:${PORT}/api/verificar-pago/:dni`);
  console.log(`  GET    http://localhost:${PORT}/api/verificar-taller/:dni`);
  console.log(`  POST   http://localhost:${PORT}/api/registrar-taller`);
  console.log(`  POST   http://localhost:${PORT}/api/registrar-talleres-por-dia`);
  console.log(`  GET    http://localhost:${PORT}/api/cupos-talleres`);
  console.log(`  GET    http://localhost:${PORT}/api/perfil/:dni`);
  console.log(`  POST   http://localhost:${PORT}/api/sincronizar-talleres`);
  console.log('  GET    http://localhost:' + PORT + '/api/estadisticas-talleres');
  console.log('');
  console.log('⏳ Esperando peticiones...');
});

// ==========================================
// PANEL DE ADMINISTRACIÓN
// ==========================================

app.post('/api/admin/actualizar-capacidad', async (req, res) => {
  try {
    const { nuevaCapacidad } = req.body;
    
    if (!nuevaCapacidad || nuevaCapacidad < 20 || nuevaCapacidad > 200) {
      return res.status(400).json({ 
        success: false, 
        error: 'Capacidad inválida. Debe estar entre 20 y 200.' 
      });
    }

    const capacidadNum = parseInt(nuevaCapacidad);
    
    // 1. Actualizar server/index.js
    const serverPath = path.join(__dirname, 'index.js');
    let serverContent = fs.readFileSync(serverPath, 'utf8');
    serverContent = serverContent.replace(
      /const CAPACIDAD_TOTAL_CAMPAMENTO = \d+;/,
      `const CAPACIDAD_TOTAL_CAMPAMENTO = ${capacidadNum};`
    );
    fs.writeFileSync(serverPath, serverContent, 'utf8');

    // 2. Actualizar src/config/campamento.ts
    const configPath = path.join(__dirname, '..', 'src', 'config', 'campamento.ts');
    let configContent = fs.readFileSync(configPath, 'utf8');
    configContent = configContent.replace(
      /const CAPACIDAD_TOTAL_CAMPAMENTO = \d+;/,
      `const CAPACIDAD_TOTAL_CAMPAMENTO = ${capacidadNum};`
    );
    fs.writeFileSync(configPath, configContent, 'utf8');

    const nuevoCupo = Math.ceil((capacidadNum * 2) / 3);

    console.log(`✅ Capacidad actualizada: ${capacidadNum} personas (${nuevoCupo} cupos por taller)`);

    res.json({ 
      success: true, 
      mensaje: 'Capacidad actualizada correctamente',
      nuevaCapacidad: capacidadNum,
      nuevoCupoPorTaller: nuevoCupo
    });
  } catch (error) {
    console.error('❌ Error al actualizar capacidad:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// KEEP ALIVE - Health Check para UptimeRobot
// ==========================================

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    message: 'Backend funcionando correctamente'
  });
});

// ==========================================
// SISTEMA DE CACHÉ PARA ESTADÍSTICAS
// ==========================================

let cacheEstadisticas = null;
let ultimaActualizacion = null;
const CACHE_DURACION = 2 * 60 * 1000; // 2 minutos

// 8. Obtener estadísticas completas de talleres (CON CACHÉ)
app.get('/api/estadisticas-talleres', async (req, res) => {
  try {
    const ahora = Date.now();
    
    // Si el caché es válido, devolverlo inmediatamente
    if (cacheEstadisticas && ultimaActualizacion && (ahora - ultimaActualizacion < CACHE_DURACION)) {
      console.log('📊 Devolviendo estadísticas desde caché');
      return res.json({ 
        success: true, 
        estadisticas: cacheEstadisticas,
        fromCache: true,
        cacheAge: Math.floor((ahora - ultimaActualizacion) / 1000) + 's'
      });
    }

    console.log('📊 Generando estadísticas frescas...');
    
    // Obtener todas las inscripciones
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U',
    });

    const rows = result.data.values || [];
    
    if (rows.length <= 1) {
      return res.json({
        success: true,
        estadisticas: {
          resumen: {
            totalInscritos: 0,
            personasConTalleres: 0,
            personasSinTalleres: 0,
            porcentajeConTalleres: '0.0',
            cupoMaximoPorTaller: CUPO_POR_TALLER
          },
          talleresDetallado: {},
          talleresAgrupadosPorDia: {},
          talleresMasLlenos: [],
          talleresConMenosInscritos: []
        }
      });
    }
    
    // Total de inscritos (excluyendo encabezado)
    const totalInscritos = rows.length - 1;
    
    // Contar inscritos POR TALLER
    const inscritosPorTaller = {};
    let personasConTalleres = 0;
    let personasSinTalleres = 0;
    
    // Inicializar contadores para todos los talleres (debe coincidir con TALLERES_NOMBRES)
    const nombresTalleres = {
      'dia1-taller1': 'Resiliencia y esperanza',
      'dia1-taller2': 'Amistad, enamoramiento y noviazgo',
      'dia1-taller3': 'Identidad en la era digital',
      'dia2-taller1': 'Finanzas inteligentes',
      'dia2-taller2': 'Música y contenido',
      'dia2-taller3': 'Verdad vs relativismo',
      'dia3-taller1': 'Propósito y vocación',
      'dia3-taller2': 'Misiones',
      'dia3-taller3': 'Orientación vocacional y elección de carrera',
      'dia4-taller1': 'Impacto comunitario',
      'dia4-taller2': 'Comunicación y redes sociales',
      'dia4-taller3': 'Proyecto de vida recargado'
    };
    
    for (const [tallerId, nombreTaller] of Object.entries(nombresTalleres)) {
      inscritosPorTaller[nombreTaller] = {
        id: tallerId,
        inscritos: 0,
        cupoMaximo: CUPO_POR_TALLER,
        disponibles: CUPO_POR_TALLER,
        porcentajeOcupacion: '0.0'
      };
    }
    
    // Analizar datos demográficos y talleres
    const distribucionGenero = { M: 0, F: 0 };
    const distribucionEdad = { '13-15': 0, '16-18': 0, '19-21': 0, '22-25': 0, '26+': 0 };
    const distribucionIglesia = {};
    const distribucionPago = { Pagado: 0, Pendiente: 0 };
    let totalTalleresAsignados = 0;
    
    // Contar inscritos (saltar encabezados)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Columnas N-U (índices 13-20): talleres seleccionados
      const talleres = row.slice(13, 21);
      const tieneTalleres = talleres.some(t => t && t.trim() !== '');
      
      if (tieneTalleres) {
        personasConTalleres++;
      } else {
        personasSinTalleres++;
      }
      
      // Contar cada taller
      talleres.forEach(nombreTaller => {
        if (nombreTaller && nombreTaller.trim() !== '') {
          const tallerNombre = nombreTaller.trim();
          if (inscritosPorTaller[tallerNombre]) {
            inscritosPorTaller[tallerNombre].inscritos++;
          }
        }
      });
      
      // DEMOGRAFÍA - Género (columna E, índice 4)
      const sexo = (row[4] || '').toUpperCase().trim();
      if (sexo === 'M') distribucionGenero.M++;
      else if (sexo === 'F') distribucionGenero.F++;
      
      // Edad (columna D, índice 3)
      const edad = parseInt(row[3]) || 0;
      if (edad >= 13 && edad <= 15) distribucionEdad['13-15']++;
      else if (edad >= 16 && edad <= 18) distribucionEdad['16-18']++;
      else if (edad >= 19 && edad <= 21) distribucionEdad['19-21']++;
      else if (edad >= 22 && edad <= 25) distribucionEdad['22-25']++;
      else if (edad >= 26) distribucionEdad['26+']++;
      
      // Iglesia (columna I, índice 8)
      const iglesia = row[8] || 'No especificada';
      distribucionIglesia[iglesia] = (distribucionIglesia[iglesia] || 0) + 1;
      
      // Estado de pago (columna K, índice 10)
      const estadoPago = (row[10] || 'Pendiente').trim();
      if (estadoPago === 'Confirmado' || estadoPago === 'Pagado') distribucionPago.Pagado++;
      else distribucionPago.Pendiente++;
      
      // Contar talleres asignados
      totalTalleresAsignados += talleres.filter(t => t && t.trim() !== '').length;
    }
    
    // Calcular disponibles y porcentajes
    for (const taller in inscritosPorTaller) {
      const inscritos = inscritosPorTaller[taller].inscritos;
      const cupoMaximo = inscritosPorTaller[taller].cupoMaximo;
      
      inscritosPorTaller[taller].disponibles = Math.max(0, cupoMaximo - inscritos);
      inscritosPorTaller[taller].porcentajeOcupacion = ((inscritos / cupoMaximo) * 100).toFixed(1);
      inscritosPorTaller[taller].excedeCapacidad = inscritos > cupoMaximo;
      
      if (inscritos > cupoMaximo) {
        inscritosPorTaller[taller].exceso = inscritos - cupoMaximo;
      }
    }
    
    // Agrupar por día - TODOS los talleres, incluso con 0 inscritos
    const talleresAgrupadosPorDia = {
      dia1: {},
      dia2: {},
      dia3: {},
      dia4: {}
    };
    
    // Agregar TODOS los talleres a su día correspondiente
    for (const [nombre, data] of Object.entries(inscritosPorTaller)) {
      const match = data.id.match(/dia(\d)/);
      if (match) {
        const dia = match[1];
        talleresAgrupadosPorDia[`dia${dia}`][nombre] = data;
      }
    }
    
    const promedioTalleresPorPersona = personasConTalleres > 0 
      ? (totalTalleresAsignados / personasConTalleres).toFixed(1) 
      : 0;
    
    const estadisticas = {
      resumen: {
        totalInscritos,
        personasConTalleres,
        personasSinTalleres,
        porcentajeConTalleres: ((personasConTalleres / totalInscritos) * 100).toFixed(1),
        cupoMaximoPorTaller: CUPO_POR_TALLER,
        promedioTalleresPorPersona,
        totalTalleresAsignados
      },
      demografia: {
        genero: distribucionGenero,
        edad: distribucionEdad,
        iglesias: Object.entries(distribucionIglesia)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([nombre, cantidad]) => ({ nombre, cantidad })),
        pago: distribucionPago
      },
      talleresDetallado: inscritosPorTaller,
      talleresAgrupadosPorDia,
      talleresMasLlenos: Object.entries(inscritosPorTaller)
        .sort((a, b) => b[1].inscritos - a[1].inscritos)
        .slice(0, 5)
        .map(([nombre, data]) => ({ nombre, ...data })),
      talleresConMenosInscritos: Object.entries(inscritosPorTaller)
        .sort((a, b) => a[1].inscritos - b[1].inscritos)
        .slice(0, 5)
        .map(([nombre, data]) => ({ nombre, ...data })),
      talleresExcedidos: Object.entries(inscritosPorTaller)
        .filter(([, data]) => data.excedeCapacidad)
        .map(([nombre, data]) => ({ nombre, ...data }))
    };
    
    // Guardar en caché
    cacheEstadisticas = estadisticas;
    ultimaActualizacion = Date.now();
    
    console.log('✅ Estadísticas generadas y guardadas en caché:');
    console.log(`   Total inscritos: ${totalInscritos}`);
    console.log(`   Con talleres: ${personasConTalleres} (${estadisticas.resumen.porcentajeConTalleres}%)`);
    console.log(`   Sin talleres: ${personasSinTalleres}`);
    console.log(`   Talleres excedidos: ${estadisticas.talleresExcedidos.length}`);
    
    res.json({ success: true, estadisticas, fromCache: false });
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manejo de errores del servidor
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Error: El puerto ${PORT} ya está en uso`);
    console.error('   Cierra el otro proceso o usa un puerto diferente');
  } else {
    console.error('❌ Error del servidor:', error);
  }
  process.exit(1);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});
