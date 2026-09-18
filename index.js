import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import NodeCache from 'node-cache';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import {
  DEFAULT_LANDING_STRUCTURE,
  normalizeLandingContent,
  validateLandingContent
} from './utils/landing-content.js';

// Importar middlewares de seguridad
import { verificarAutenticacion, verificarAdmin, generarToken } from './middleware/auth.js';
import { 
    rateLimiterGeneral, 
    rateLimiterInscripciones, 
    rateLimiterLogin, 
    rateLimiterAdmin,
    corsOptions,
    helmetConfig,
    sanitizeInput,
    errorHandler,
    notFoundHandler
} from './middleware/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno desd .env
config({ path: path.join(__dirname, '.env') });

// ==================== CONFIGURACIÃ“N MYSQL ====================

// Pool de conexiones MySQL
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3307,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'rootpassword123',
  database: process.env.DB_NAME || 'jaguares_db',
  waitForConnections: true,
  connectionLimit: 25,
  queueLimit: 0,
  charset: 'utf8mb4'
};

let db;

async function initDatabase() {
  try {
    db = await mysql.createPool(dbConfig);
    // Garantizar utf8mb4 en CADA conexiÃ³n del pool
    db.pool.on('connection', (conn) => {
      conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
    });
    // Test de conexiÃ³n
    const connection = await db.getConnection();
    await connection.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
    console.log('âœ… ConexiÃ³n a MySQL establecida correctamente (utf8mb4)');
    
    // Establecer nombre de columna "aÃ±o" con valor seguro por defecto ANTES de intentar detectarlo.
    // Usamos unicode escape ('a\u00f1o' = 'aÃ±o') para evitar problemas de encoding en el archivo fuente.
    global.COL_ANIO = 'a\u00f1o';

    // Intentar detectar el nombre real de la columna desde la BD (puede ser 'aÃ±o' o 'anio')
    try {
      const [cols] = await connection.query('SHOW COLUMNS FROM pagos_mensuales');

      // Buscar EXPLÃCITAMENTE por nombre: primero 'aÃ±o', luego 'anio' (mÃ¡s seguro que buscar por tipo)
      const yearCol = cols.find(c =>
        c.Field === 'a\u00f1o' || // columna con Ã± (lo mÃ¡s comÃºn)
        c.Field === 'anio'         // columna sin Ã± (fallback alternativo)
      );

      if (yearCol) {
        global.COL_ANIO = yearCol.Field;
        console.log('\u2705 Columna a\u00f1o detectada como:', global.COL_ANIO);
      } else {
        // No se encontrÃ³ ni 'aÃ±o' ni 'anio' â€” mantener el default 'aÃ±o' ya establecido
        console.warn('\u26a0\ufe0f  Columna a\u00f1o no encontrada por nombre exacto, usando default:', global.COL_ANIO);
        console.warn('   Columnas disponibles:', cols.map(c => c.Field).join(', '));
      }

            // 1. Normalizar registros existentes de pagos_mensuales: 'setiembre' -> 'septiembre'
      try {
        const [resSet] = await connection.query("UPDATE pagos_mensuales SET mes = 'septiembre' WHERE LOWER(mes) = 'setiembre'");
        if (resSet.changedRows > 0) {
          console.log(`âœ… ${resSet.changedRows} pagos_mensuales normalizados de 'setiembre' a 'septiembre'`);
        }
      } catch (errSet) {
        console.warn('âš ï¸ No se pudo normalizar setiembre en pagos_mensuales:', errSet.message);
      }

      // 2. Sincronizar alumnos inscritos en septiembre con pago confirmado que no tengan fila en pagos_mensuales
      try {
        const colYear = global.COL_ANIO || 'a\u00f1o';
        const [resSync] = await connection.query(
          'INSERT IGNORE INTO pagos_mensuales (alumno_id, mes, `' + colYear + '`, monto, estado, fecha_pago, created_at) ' +
          'SELECT ' +
          '  a.alumno_id, ' +
          '  "septiembre", ' +
          '  2026, ' +
          '  COALESCE(SUM(i.precio_mensual), a.monto_pago, 0), ' +
          '  "confirmado", ' +
          '  COALESCE(a.fecha_pago, a.created_at, NOW()), ' +
          '  COALESCE(a.fecha_pago, a.created_at, NOW()) ' +
          'FROM alumnos a ' +
          'JOIN inscripciones i ON i.alumno_id = a.alumno_id AND i.estado = "activa" ' +
          'WHERE a.estado_pago = "confirmado" ' +
          '  AND a.created_at >= "2026-09-01 00:00:00" ' +
          '  AND NOT EXISTS ( ' +
          '    SELECT 1 FROM pagos_mensuales pm ' +
          '    WHERE pm.alumno_id = a.alumno_id ' +
          '      AND LOWER(pm.mes) IN ("septiembre", "setiembre") ' +
          '      AND pm.`' + colYear + '` = 2026 ' +
          '  ) ' +
          'GROUP BY a.alumno_id'
        );
        if (resSync.affectedRows > 0) {
          console.log(`âœ… ${resSync.affectedRows} alumnos inscritos en septiembre sincronizados automÃ¡ticamente a pagos_mensuales como confirmados`);
        }
      } catch (errSync) {
        console.warn('âš ï¸ No se pudo sincronizar inscritos de septiembre a pagos_mensuales:', errSync.message);
      }

      // Agregar columna observaciones si no existe
      const tieneObs = cols.find(c => c.Field === 'observaciones');
      if (!tieneObs) {
        await connection.query('ALTER TABLE pagos_mensuales ADD COLUMN observaciones TEXT NULL');
        console.log('\u2705 Columna observaciones agregada a pagos_mensuales');
      }
      const tieneNumOp = cols.find(c => c.Field === 'numero_operacion');
      if (!tieneNumOp) {
        await connection.query('ALTER TABLE pagos_mensuales ADD COLUMN numero_operacion VARCHAR(100) NULL');
        console.log('\u2705 Columna numero_operacion agregada a pagos_mensuales');
      }

      // Sincronizar comprobantes de alumnos a pagos_mensuales si estÃ¡n vacÃ­os
      try {
        await connection.query(
          'UPDATE pagos_mensuales pm ' +
          'JOIN alumnos a ON pm.alumno_id = a.alumno_id ' +
          'SET ' +
          '  pm.comprobante_url = COALESCE(NULLIF(pm.comprobante_url, ""), a.comprobante_pago_url), ' +
          '  pm.numero_operacion = COALESCE(NULLIF(pm.numero_operacion, ""), a.numero_operacion) ' +
          'WHERE (pm.comprobante_url IS NULL OR pm.comprobante_url = "") ' +
          '  AND a.comprobante_pago_url IS NOT NULL'
        );
      } catch (errSyncComp) {}
      // Migrar unique key para permitir pagos parciales (split por deporte)
      try {
        const [indexes] = await connection.query('SHOW INDEX FROM pagos_mensuales WHERE Key_name = "unique_alumno_mes"');
        if (indexes.length > 0) {
          const colAnio = global.COL_ANIO; // ya tiene el valor correcto garantizado
          // Primero crear Ã­ndice alternativo para la FK (MySQL lo necesita)
          await connection.query('ALTER TABLE pagos_mensuales ADD INDEX idx_alumno_id (alumno_id)');
          // Ahora sÃ­ podemos eliminar el unique
          await connection.query('ALTER TABLE pagos_mensuales DROP INDEX unique_alumno_mes');
          await connection.query('ALTER TABLE pagos_mensuales ADD INDEX idx_alumno_mes (alumno_id, mes, `' + colAnio + '`)');
          console.log('\u2705 Migrado unique_alumno_mes \u2192 idx_alumno_mes (permite pagos parciales)');
        }
      } catch (migErr) { console.warn('\u26a0\ufe0f Migraci\u00f3n unique key:', migErr.message); }
    } catch (e) {
      // La tabla puede no existir aÃºn en el primer arranque â€” es esperado
      console.warn('\u26a0\ufe0f  No se pudo consultar pagos_mensuales al arrancar:', e.message);
      console.warn('   Se usar\u00e1 el nombre de columna por defecto:', global.COL_ANIO);
    }
    

    // Agregar columnas para asistencia de puerta si no existen
    try {
      const [asistCols] = await connection.query('SHOW COLUMNS FROM asistencias');
      if (!asistCols.find(c => c.Field === 'asistencia_puerta')) {
        await connection.query('ALTER TABLE asistencias ADD COLUMN asistencia_puerta TINYINT(1) DEFAULT 0');
        console.log('âœ… Columna asistencia_puerta agregada a asistencias');
      }
      if (!asistCols.find(c => c.Field === 'hora_puerta')) {
        await connection.query('ALTER TABLE asistencias ADD COLUMN hora_puerta TIME NULL');
        console.log('âœ… Columna hora_puerta agregada a asistencias');
      }
    } catch (errAsist) {
      console.warn('âš ï¸ Error al verificar columnas en asistencias:', errAsist.message);
    }

    // Crear tabla de logs accesos_puerta si no existe
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS accesos_puerta (
          acceso_id INT AUTO_INCREMENT PRIMARY KEY,
          alumno_id INT NOT NULL,
          horario_id INT NULL,
          fecha DATE NOT NULL,
          hora TIME NOT NULL,
          estado_membresia VARCHAR(50) DEFAULT 'activa',
          autorizado_manual TINYINT(1) DEFAULT 0,
          registrado_por INT NULL,
          observaciones TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_alumno_fecha (alumno_id, fecha)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } catch (errAcc) {
      console.warn('âš ï¸ Error al verificar tabla accesos_puerta:', errAcc.message);
    }

    connection.release();
  } catch (error) {
    console.error('âŒ Error al conectar con MySQL:', error);
    console.error('âš ï¸  El servidor continuarÃ¡ sin base de datos (usarÃ¡ Google Sheets)');
  }
}

// Inicializar base de datos
initDatabase();

const app = express();
app.set('trust proxy', 1); // DetrÃ¡s de Cloudflare/nginx proxy
const PORT = process.env.PORT || 3002;

// ==================== CONFIGURACIÃ“N ACADEMIA DEPORTIVA ====================

// URL y TOKEN del Apps Script (backend transaccional)
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN;

if (!APPS_SCRIPT_URL || !APPS_SCRIPT_TOKEN) {
  console.error('âŒ ERROR: Variables de entorno requeridas no configuradas:');
  console.error('   - APPS_SCRIPT_URL');
  console.error('   - APPS_SCRIPT_TOKEN');
  process.exit(1);
}

console.log('âœ… Apps Script URL configurado:', APPS_SCRIPT_URL);

// ==================== SISTEMA DE CACHÃ‰ MEJORADO ====================

// Crear instancia de cachÃ© con node-cache (mÃ¡s robusto que Map)
const cache = new NodeCache({
    stdTTL: 300,      // TTL por defecto: 5 minutos
    checkperiod: 60,  // Revisar expiraciÃ³n cada 60 segundos
    useClones: false  // No clonar objetos (mejor performance)
});

// TTLs especÃ­ficos por tipo de dato (en segundos)
const CACHE_TTL = {
    horarios: 300,        // 5 minutos
    inscripciones: 120,   // 2 minutos
    consultas: 60,        // 1 minuto
    inscritos: 120,       // 2 minutos para lista de inscritos
    default: 300          // 5 minutos por defecto
};

/**
 * Genera clave de cachÃ© Ãºnica
 */
function getCacheKey(tipo, id = '') {
    return id ? `${tipo}_${id}` : tipo;
}

/**
 * Invalida cachÃ© de un DNI especÃ­fico (inscripciones + consultas)
 */
function invalidateDNICache(dni) {
    cache.del(getCacheKey('inscripciones', dni));
    cache.del(getCacheKey('consultas', dni));
    console.log(`ðŸ—‘ï¸ CACHÃ‰ INVALIDADO para DNI ${dni}`);
}

/**
 * Obtiene estadÃ­sticas del cachÃ©
 */
function getCacheStats() {
    const stats = cache.getStats();
    return {
        hits: stats.hits,
        misses: stats.misses,
        keys: stats.keys,
        hitRate: stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%' : '0%',
        activeKeys: cache.keys()
    };
}

// ==================== MIDDLEWARES DE SEGURIDAD ====================

// Helmet para headers de seguridad
app.use(helmetConfig);

// CORS restringido a dominios permitidos
app.use(cors(corsOptions));

// Body parser con lÃ­mite
app.use(express.json({ limit: '10mb' }));

// Sanitizar inputs para prevenir XSS
app.use(sanitizeInput);

// Rate limiting general (100 req/15min)
app.use(rateLimiterGeneral);

// ==================== ENDPOINTS UTILIDAD ====================

/**
 * Limpiar cachÃ© manualmente
 */
app.post('/api/cache/clear', (req, res) => {
  try {
    cache.flushAll();
    console.log('ðŸ—‘ï¸ CACHÃ‰ LIMPIADO MANUALMENTE');
    res.json({
      success: true,
      mensaje: 'CachÃ© limpiado correctamente'
    });
  } catch (error) {
    console.error('âŒ Error al limpiar cachÃ©:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DEBUG: Ver datos exactos de horarios sin cachÃ©
 */
app.get('/api/debug/horarios', async (req, res) => {
  try {
    const anio = req.query.anio || 2019;
    const query = `
      SELECT 
        h.horario_id,
        d.nombre as deporte,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
        h.categoria,
        h.ano_min,
        h.ano_max,
        h.cupo_maximo,
        h.cupos_ocupados
      FROM horarios h
      INNER JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE h.estado = 'activo'
      AND ? BETWEEN h.ano_min AND h.ano_max
      ORDER BY d.nombre, h.dia, h.hora_inicio, h.categoria
    `;
    
    const [results] = await pool.execute(query, [parseInt(anio)]);
    
    res.json({
      anio_consultado: parseInt(anio),
      total: results.length,
      horarios: results
    });
  } catch (error) {
    console.error('âŒ Error en debug:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ENDPOINTS ACADEMIA DEPORTIVA ====================

// Endpoint para obtener horarios disponibles (CON CACHÃ‰ y filtrado por edad)
app.get('/api/horarios', async (req, res) => {
  try {
    const anioNacimiento = req.query.anio_nacimiento || req.query.ano_nacimiento;
    const forceRefresh = req.query.refresh === 'true';
    
    // Clave de cachÃ© diferente si hay filtro de edad
    const cacheKey = getCacheKey('horarios', anioNacimiento || 'all');
    
    // Intentar obtener del cachÃ© (si no se fuerza refresh)
    if (!forceRefresh) {
      const cachedData = cache.get(cacheKey);
      if (cachedData) {
        console.log(`âš¡ CACHÃ‰ HIT: ${cacheKey}`);
        return res.json(cachedData);
      }
    } else {
      console.log(`ðŸ”„ FORCE REFRESH - Ignorando cachÃ©`);
    }
    
    console.log(`ðŸŒ CACHÃ‰ MISS: ${cacheKey} - Consultando MySQL`);
    
    // ==================== CONSULTA DESDE MYSQL ====================
    if (db) {
      try {
        console.log('ðŸ” Intentando consultar MySQL...');
        if (anioNacimiento) {
          console.log(`ðŸŽ¯ Filtrando por anio de nacimiento: ${anioNacimiento}`);
        }
        
        // Construir query con filtro opcional por edad
        let query = `
          SELECT 
            h.horario_id,
            d.nombre as deporte,
            d.icono,
            h.dia,
            TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
            TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
            h.cupo_maximo,
            h.cupos_ocupados,
            h.estado,
            h.categoria,
            h.nivel,
            h.genero,
            h.precio,
            h.plan,
            h.ano_min,
            h.ano_max
          FROM horarios h
          INNER JOIN deportes d ON h.deporte_id = d.deporte_id
          WHERE h.estado = 'activo'
        `;
        
        const params = [];
        
        // Agregar filtro por edad si se proporciona anio de nacimiento
        // IMPORTANTE: Si ano_min o ano_max son NULL/0, el horario se muestra para TODOS (sin restricciÃ³n de edad)
        if (anioNacimiento) {
          query += ` AND (h.ano_min IS NULL OR h.ano_max IS NULL OR h.ano_min = 0 OR h.ano_max = 0 OR ? BETWEEN h.ano_min AND h.ano_max)`;
          params.push(parseInt(anioNacimiento));
        }
        
        query += ` ORDER BY d.nombre, h.dia, h.hora_inicio`;
        
        console.log('ðŸ“ Query preparada:', query);
        console.log('ðŸ“Š ParÃ¡metros:', params);
        
        const [rows] = params.length > 0 
          ? await db.execute(query, params)
          : await db.execute(query);
        
        console.log(`âœ… Horarios obtenidos de MySQL: ${rows.length}`);
        if (anioNacimiento) {
          console.log(`   (filtrados para anio ${anioNacimiento})`);
          // Log de primeros 5 horarios para debug
          console.log('ðŸ“‹ Primeros horarios devueltos:');
          rows.slice(0, 5).forEach(h => {
            console.log(`   ID ${h.horario_id}: ${h.deporte} - ${h.dia} ${h.hora_inicio} - CategorÃ­a: "${h.categoria}" (${h.ano_min}-${h.ano_max})`);
          });
        }
        
        const data = {
          success: true,
          horarios: rows,
          total: rows.length,
          filtradoPorEdad: !!anioNacimiento,
          anioNacimiento: anioNacimiento || null,
          source: 'mysql'
        };
        
        // Guardar en cachÃ©
        cache.set(cacheKey, data, CACHE_TTL.horarios);
        console.log(`ðŸ’¾ CACHÃ‰ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.horarios}s)`);
        
        return res.json(data);
        
      } catch (mysqlError) {
        console.error('âŒ Error en consulta MySQL:', mysqlError);
        console.log('âš ï¸  Intentando con Google Sheets como respaldo...');
        // Si falla MySQL, continuar con Google Sheets abajo
      }
    }
    
    // ==================== GOOGLE SHEETS (COMENTADO - RESPALDO) ====================
    /*
    // Si no estÃ¡ en cachÃ©, obtener de Apps Script
    let url = `${APPS_SCRIPT_URL}?action=horarios&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}`;
    
    // Agregar parÃ¡metro de anio si existe
    if (anioNacimiento) {
      url += `&anio_nacimiento=${encodeURIComponent(anioNacimiento)}`;
      console.log(`ðŸŽ¯ Solicitando horarios filtrados para anio ${anioNacimiento}`);
    }
    
    console.log('ðŸ“¡ URL COMPLETA que se enviarÃ¡ a Apps Script:');
    console.log(url);
    console.log('ðŸ”‘ Token usado:', APPS_SCRIPT_TOKEN);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('ðŸ“¥ RESPUESTA de Apps Script:', JSON.stringify(data, null, 2));
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al obtener horarios');
    }
    
    // Guardar en cachÃ© (node-cache usa segundos)
    cache.set(cacheKey, data, CACHE_TTL.horarios);
    console.log(`ðŸ’¾ CACHÃ‰ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.horarios}s, total: ${data.horarios?.length || 0} horarios)`);
    
    res.json(data);
    */
    
    // Si llegamos aquÃ­ sin MySQL, retornar error
    return res.status(503).json({
      success: false,
      error: 'Base de datos no disponible',
      message: 'No se pudo conectar a MySQL y Google Sheets estÃ¡ deshabilitado'
    });
    
  } catch (error) {
    console.error('âŒ Error al obtener horarios:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al obtener horarios' 
    });
  }
});

// Endpoint para inscribir a mÃºltiples horarios
app.post('/api/inscribir-multiple', rateLimiterInscripciones, async (req, res) => {
  try {
    const { alumno, horarios, comprobante } = req.body;
    
    console.log('ðŸ“ ==================== INSCRIPCIÃ“N MÃšLTIPLE ====================');
    console.log('ðŸ‘¤ ALUMNO:', JSON.stringify(alumno, null, 2));
    console.log('ðŸ“… HORARIOS (cantidad):', horarios.length);
    console.log('ðŸ“‹ HORARIOS DETALLE:', horarios.map(h => ({ 
      horario_id: h.horario_id, 
      deporte: h.deporte, 
      dia: h.dia, 
      hora: h.hora_inicio 
    })));
    
    // Validaciones bÃ¡sicas
    if (!alumno || !horarios || !Array.isArray(horarios)) {
      return res.status(400).json({
        success: false,
        error: 'Datos invÃ¡lidos. Se requiere alumno y horarios (array)'
      });
    }
    
    if (horarios.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Debe seleccionar al menos un horario'
      });
    }
    
    // âš ï¸ NUEVO: Limitar a mÃ¡ximo 10 horarios para prevenir abuso
    if (horarios.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'MÃ¡ximo 10 horarios por inscripciÃ³n',
        message: 'Por favor, seleccione mÃ¡ximo 10 horarios. Si necesita mÃ¡s, contacte al administrador.'
      });
    }
    
    // âš ï¸ Validar que el comprobante de pago sea obligatorio
    if (!comprobante) {
      return res.status(400).json({
        success: false,
        error: 'Comprobante de pago requerido',
        message: 'Debes subir el comprobante de pago con el nÃºmero de operaciÃ³n para completar la inscripciÃ³n.'
      });
    }

    // âš ï¸ Validar que si viene comprobante tenga nÃºmero de operaciÃ³n (obligatorio)
    if (comprobante && !comprobante.numero_operacion?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'NÃºmero de operaciÃ³n requerido',
        message: 'Debes ingresar el nÃºmero de operaciÃ³n de tu comprobante de pago.'
      });
    }

    // âš ï¸ Validar nÃºmero de operaciÃ³n duplicado (anti-fraude: evitar pasar el mismo pago)
    if (comprobante && comprobante.numero_operacion && db) {
      const numOp = comprobante.numero_operacion.trim();
      // No validar duplicados para valores genÃ©ricos como "-"
      if (numOp && numOp !== '-') {
        const [existentes] = await db.query(
          `SELECT a.dni, a.nombres, a.apellido_paterno 
           FROM alumnos a 
           WHERE a.numero_operacion = ? AND a.dni != ?`,
          [numOp, alumno.dni]
        );
        if (existentes.length > 0) {
          const otro = existentes[0];
          console.warn(`âš ï¸ DUPLICADO DE PAGO: Nro operaciÃ³n "${numOp}" ya usado por ${otro.nombres} ${otro.apellido_paterno} (DNI: ${otro.dni})`);
          return res.status(409).json({
            success: false,
            error: 'NÃºmero de operaciÃ³n duplicado',
            message: `Este nÃºmero de operaciÃ³n ya fue registrado por otro alumno (DNI: ${otro.dni.substring(0, 4)}****). Si crees que es un error, contacta al administrador.`
          });
        }
      }
    }
    
    // ==================== GUARDAR EN MYSQL PRIMERO (MySQL-First Approach) ====================
    let inscripcionData = null;
    let codigoOperacion = null;
    
    if (db) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        console.log('ðŸ’¾ Guardando inscripciÃ³n en MySQL (transacciÃ³n)...');
        
        // 1. Verificar o crear alumno
        const [alumnoRows] = await conn.query(
          'SELECT alumno_id FROM alumnos WHERE dni = ?',
          [alumno.dni]
        );
        
        let alumnoId;
        let alumnoCreado = false;
        let alumnoDBData = null;
        
        if (alumnoRows.length > 0) {
          alumnoId = alumnoRows[0].alumno_id;
          console.log(`âœ… Alumno encontrado en MySQL: ID ${alumnoId}`);
          // Traer datos reales de la BD para retornarlos en la respuesta
          const [alumnoReal] = await conn.query(
            'SELECT nombres, apellido_paterno, apellido_materno FROM alumnos WHERE alumno_id = ?',
            [alumnoId]
          );
          if (alumnoReal.length > 0) alumnoDBData = alumnoReal[0];
        } else {
          // Crear nuevo alumno (dentro de la transacciÃ³n â€” se revierte si algo falla)
          alumnoCreado = true;
          const fechaNacimiento = alumno.fecha_nacimiento || '2010-01-01';
          
          const [insertResult] = await conn.query(
            `INSERT INTO alumnos (
              dni, nombres, apellido_paterno, apellido_materno, 
              fecha_nacimiento, sexo, telefono, email, direccion,
              seguro_tipo, condicion_medica, apoderado, telefono_apoderado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              alumno.dni,
              alumno.nombres,
              alumno.apellido_paterno || alumno.apellidos?.split(' ')[0] || '',
              alumno.apellido_materno || alumno.apellidos?.split(' ')[1] || '',
              fechaNacimiento,
              alumno.sexo || 'Masculino',
              alumno.telefono || null,
              alumno.email || null,
              alumno.direccion || null,
              alumno.seguro_tipo || null,
              alumno.condicion_medica || null,
              alumno.apoderado || null,
              alumno.telefono_apoderado || null
            ]
          );
          alumnoId = insertResult.insertId;
          console.log(`âœ… Alumno creado en MySQL: ID ${alumnoId}`);
        }
        
        // 2. Validar que todos los horarios tengan horario_id
        const horariosInvalidos = horarios.filter(h => !h.horario_id);
        if (horariosInvalidos.length > 0) {
          console.error('âŒ HORARIOS SIN ID:', horariosInvalidos);
          await conn.rollback();
          conn.release();
          return res.status(400).json({
            success: false,
            error: 'Horarios invÃ¡lidos',
            message: 'Todos los horarios deben tener un ID vÃ¡lido. Por favor, seleccione horarios de la lista.',
            horarios_invalidos: horariosInvalidos.length
          });
        }
        
        // 3. Agrupar horarios por deporte
        const deportesMap = {};
        horarios.forEach(h => {
          const deporte = h.deporte || 'FÃºtbol';
          if (!deportesMap[deporte]) {
            deportesMap[deporte] = {
              horarios: [],
              plan: h.plan || 'EconÃ³mico'
            };
          }
          deportesMap[deporte].horarios.push(h);
        });
        
        // FunciÃ³n para calcular precio
        const calcularPrecio = (cantidadDias, plan, deporte) => {
          // MAMAS FIT: precio fijo S/.60
          if (deporte === 'MAMAS FIT' || plan === 'MAMAS FIT') return 60;
          
          // Baby FÃºtbol: 1d=50, 2d=100, 3d=150
          if (plan === 'Baby FÃºtbol' || deporte === 'Baby FÃºtbol') {
            if (cantidadDias === 1) return 50;
            if (cantidadDias === 2) return 100;
            if (cantidadDias >= 3) return 150;
            return 50;
          }
          
          if (plan === 'EconÃ³mico') {
            if (cantidadDias === 2) return 60;
            if (cantidadDias >= 3) return 80;
            return 60;
          }
          
          if (plan === 'EstÃ¡ndar') {
            if (cantidadDias === 1) return 40;
            if (cantidadDias === 2) return 80;
            if (cantidadDias >= 3) return 120;
            return 40;
          }
          
          if (plan === 'Premium') {
            if (cantidadDias === 2) return 100;
            if (cantidadDias >= 3) return 150;
            return 100;
          }
          
          return 60;
        };
        
        // 3. Generar cÃ³digo de operaciÃ³n Ãºnico (mismo formato que Apps Script)
        const fecha = new Date();
        const yyyymmdd = fecha.getFullYear().toString() + 
                         (fecha.getMonth() + 1).toString().padStart(2, '0') + 
                         fecha.getDate().toString().padStart(2, '0');
        const random = Math.random().toString(36).substring(2, 7).toUpperCase();
        codigoOperacion = `ACAD-${yyyymmdd}-${random}`;
        
        console.log(`ðŸ“‹ CÃ³digo de OperaciÃ³n Generado: ${codigoOperacion}`);
        
        // Leer config de matrÃ­cula: si matricula_activa=false no se cobra matrÃ­cula
        let matriculaActivaVal = 1; // por defecto se cobra
        try {
          const [configRows] = await conn.query(
            "SELECT valor FROM configuracion WHERE clave = 'matricula_activa' LIMIT 1"
          );
          if (configRows.length > 0) {
            const v = configRows[0].valor;
            matriculaActivaVal = (v === 'true' || v === true || v === 1 || v === '1') ? 1 : 0;
          }
        } catch (e) {
          console.warn('âš ï¸ No se pudo leer config matricula_activa, asumiendo activa:', e.message);
        }
        console.log(`ðŸ’³ matricula_activa = ${matriculaActivaVal === 1 ? 'SÃ se cobra' : 'NO se cobra'}`);
        
        // 4. Guardar inscripciones
        
        // â™»ï¸ LIMPIAR PENDIENTES PREVIAS: Si el alumno ya tenÃ­a inscripciones pendientes
        // (ej: el usuario volviÃ³ atrÃ¡s desde la confirmaciÃ³n para editar), las eliminamos
        // para que pueda re-confirmar sin error. Solo bloqueamos las 'activas'.
        const [pendientesExistentes] = await conn.query(
          `SELECT inscripcion_id FROM inscripciones WHERE alumno_id = ? AND estado = 'pendiente'`,
          [alumnoId]
        );
        if (pendientesExistentes.length > 0) {
          const idsPendientes = pendientesExistentes.map(r => r.inscripcion_id);
          console.log(`â™»ï¸ Eliminando ${idsPendientes.length} inscripciÃ³n(es) pendiente(s) previas del alumno ${alumnoId}: [${idsPendientes.join(', ')}]`);
          // Eliminar horarios asociados primero (FK)
          await conn.query(
            `DELETE FROM inscripcion_horarios WHERE inscripcion_id IN (${idsPendientes.map(() => '?').join(',')})`,
            idsPendientes
          );
          // Eliminar las inscripciones pendientes
          await conn.query(
            `DELETE FROM inscripciones WHERE inscripcion_id IN (${idsPendientes.map(() => '?').join(',')})`,
            idsPendientes
          );
        }
        
        // âš ï¸ VALIDAR CRUCES DE HORARIO con inscripciones activas existentes
        // Traer todos los horarios activos del alumno
        const [horariosActivos] = await conn.query(`
          SELECT h.horario_id, h.dia, h.hora_inicio, h.hora_fin, d.nombre as deporte
          FROM inscripcion_horarios ih
          JOIN inscripciones i ON ih.inscripcion_id = i.inscripcion_id
          JOIN horarios h ON ih.horario_id = h.horario_id
          JOIN deportes d ON i.deporte_id = d.deporte_id
          WHERE i.alumno_id = ? AND i.estado = 'activa'
        `, [alumnoId]);

        console.log(`ðŸ” VALIDACIÃ“N DE CRUCES: alumnoId=${alumnoId}, horarios activos encontrados: ${horariosActivos.length}`);
        if (horariosActivos.length > 0) {
          console.log('ðŸ“‹ Horarios activos:', horariosActivos.map(h => `${h.deporte} ${h.dia} ${h.hora_inicio}-${h.hora_fin}`));
        }

        // Traer detalle de los horarios nuevos solicitados
        const idsNuevos = horarios.map(h => h.horario_id).filter(Boolean);
        console.log(`ðŸ“‹ IDs nuevos a inscribir: [${idsNuevos.join(', ')}]`);
        
        if (idsNuevos.length > 0 && horariosActivos.length > 0) {
          const [horariosNuevosDetalle] = await conn.query(`
            SELECT h.horario_id, h.dia, h.hora_inicio, h.hora_fin, d.nombre as deporte
            FROM horarios h
            JOIN deportes d ON h.deporte_id = d.deporte_id
            WHERE h.horario_id IN (${idsNuevos.map(() => '?').join(',')})
          `, idsNuevos);

          console.log('ðŸ“‹ Horarios nuevos detalle:', horariosNuevosDetalle.map(h => `${h.deporte} ${h.dia} ${h.hora_inicio}-${h.hora_fin}`));

          for (const nuevo of horariosNuevosDetalle) {
            for (const existente of horariosActivos) {
              if (nuevo.dia.toUpperCase().trim() === existente.dia.toUpperCase().trim()) {
                // Normalizar horas a string "HH:MM:SS" para comparaciÃ³n segura
                const nInicio = String(nuevo.hora_inicio).padStart(8, '0');
                const nFin = String(nuevo.hora_fin).padStart(8, '0');
                const eInicio = String(existente.hora_inicio).padStart(8, '0');
                const eFin = String(existente.hora_fin).padStart(8, '0');
                console.log(`ðŸ” Comparando: ${nuevo.deporte} ${nuevo.dia} ${nInicio}-${nFin} vs ${existente.deporte} ${existente.dia} ${eInicio}-${eFin} â†’ cruza=${nInicio < eFin && nFin > eInicio}`);
                if (nInicio < eFin && nFin > eInicio) {
                  console.warn(`âŒ CRUCE DE HORARIO DETECTADO: ${nuevo.deporte} ${nuevo.dia} ${nInicio}-${nFin} se cruza con ${existente.deporte} ${existente.dia} ${eInicio}-${eFin}`);
                  await conn.rollback();
                  conn.release();
                  return res.status(409).json({
                    success: false,
                    error: 'Conflicto de horario',
                    message: `Ya tienes ${existente.deporte} el ${existente.dia} de ${String(existente.hora_inicio).substring(0,5)} a ${String(existente.hora_fin).substring(0,5)}. No puedes inscribirte en ${nuevo.deporte} (${String(nuevo.hora_inicio).substring(0,5)}-${String(nuevo.hora_fin).substring(0,5)}) porque se cruzan los horarios.`
                  });
                }
              }
            }
          }
        }

        const inscripcionesIds = [];
        for (const [nombreDeporte, info] of Object.entries(deportesMap)) {
          // âš ï¸ IMPORTANTE: Usar coincidencia EXACTA (=) en vez de LIKE.
          // LIKE '%FÃºtbol%' con Ã­ndice sobre 'nombre' y colaciÃ³n utf8mb4_unicode_ci
          // (insensible a acentos) devuelve "Baby Futbol" antes que "FÃºtbol" alfabÃ©ticamente,
          // asignando el deporte_id incorrecto a todas las inscripciones.
          const [deporteRows] = await conn.query(
            'SELECT deporte_id FROM deportes WHERE nombre = ?',
            [nombreDeporte]
          );
          
          if (deporteRows.length === 0) {
            console.warn(`âš ï¸ Deporte no encontrado (exacto): ${nombreDeporte}`);
            continue;
          }
          
          const deporteId = deporteRows[0].deporte_id;
          const plan = info.plan;
          const cantidadDias = info.horarios.length;
          const precioMensual = calcularPrecio(cantidadDias, plan, nombreDeporte);
          
          // âš ï¸ VALIDACIÃ“N: Solo bloquear si ya existe inscripciÃ³n ACTIVA (no pendiente, esas ya se limpiaron)
          const [inscripcionActiva] = await conn.query(
            `SELECT inscripcion_id, estado, plan, precio_mensual 
             FROM inscripciones 
             WHERE alumno_id = ? AND deporte_id = ? AND estado = 'activa'
             LIMIT 1`,
            [alumnoId, deporteId]
          );
          
          if (inscripcionActiva.length > 0) {
            const inscExist = inscripcionActiva[0];
            console.warn(`âš ï¸ DUPLICADO ACTIVO: Alumno ${alumnoId} ya tiene inscripciÃ³n ACTIVA en ${nombreDeporte} (ID: ${inscExist.inscripcion_id})`);
            await conn.rollback();
            conn.release();
            return res.status(409).json({
              success: false,
              error: 'InscripciÃ³n duplicada',
              message: `Ya tienes una inscripciÃ³n activa en ${nombreDeporte}. No puedes inscribirte dos veces en el mismo deporte.`,
              deporte: nombreDeporte,
              inscripcion_existente: {
                id: inscExist.inscripcion_id,
                estado: inscExist.estado,
                plan: inscExist.plan,
                precio: inscExist.precio_mensual
              }
            });
          }
          
          const [result] = await conn.query(
            `INSERT INTO inscripciones (codigo_operacion, alumno_id, deporte_id, plan, precio_mensual, matricula_pagada, estado)
             VALUES (?, ?, ?, ?, ?, ?, 'pendiente')`,
            [codigoOperacion, alumnoId, deporteId, plan, precioMensual, matriculaActivaVal]
          );
          
          inscripcionesIds.push({ 
            inscripcionId: result.insertId, 
            deporteId, 
            horarios: info.horarios 
          });
          
          console.log(`âœ… InscripciÃ³n: ${nombreDeporte} - ${plan} - S/.${precioMensual}`);
        }
        
        // 4. Guardar horarios en tabla intermedia
        let horariosGuardados = 0;
        for (const { inscripcionId, horarios: horariosInscripcion } of inscripcionesIds) {
          for (const horario of horariosInscripcion) {
            if (horario.horario_id) {
              try {
                await conn.query(
                  `INSERT INTO inscripcion_horarios (inscripcion_id, horario_id)
                   VALUES (?, ?)`,
                  [inscripcionId, horario.horario_id]
                );
                horariosGuardados++;
                console.log(`âœ… Horario guardado: InscripciÃ³n ${inscripcionId} -> Horario ${horario.horario_id}`);
              } catch (horarioError) {
                // Si falla un horario individual, toda la transacciÃ³n debe revertirse
                throw horarioError;
              }
            } else {
              console.error(`âŒ Horario sin ID para inscripciÃ³n ${inscripcionId}:`, horario);
            }
          }
        }
        
        console.log(`âœ… Total horarios guardados: ${horariosGuardados} de ${horarios.length}`);
        
        if (horariosGuardados === 0) {
          console.error('âš ï¸ ADVERTENCIA: No se guardÃ³ ningÃºn horario');
        }
        
        // Todo saliÃ³ bien â†’ confirmar la transacciÃ³n (alumno + inscripciones + horarios)
        await conn.commit();
        conn.release();

        // Guardar nÃºmero de operaciÃ³n en tabla alumnos si viene con comprobante
        if (comprobante && comprobante.numero_operacion) {
          const numOp = comprobante.numero_operacion.trim();
          if (numOp) {
            try {
              await db.query(
                `UPDATE alumnos SET numero_operacion = ?, updated_at = NOW() WHERE alumno_id = ?`,
                [numOp, alumnoId]
              );
              console.log(`âœ… NÃºmero de operaciÃ³n guardado: ${numOp}`);
            } catch (numOpErr) {
              console.error('âŒ Error guardando nÃºmero de operaciÃ³n:', numOpErr.message);
            }
          }
        }

        inscripcionData = {
          alumnoId,
          alumnoCreado,
          alumnoDBData,
          inscripcionIds: inscripcionesIds,
          success: true
        };
        
        console.log('âœ… INSCRIPCIÃ“N GUARDADA EN MYSQL');
      } catch (mysqlError) {
        // Revertir TODOS los cambios: alumno, inscripciones y horarios quedan como si nada
        try { await conn.rollback(); } catch (_) {}
        conn.release();

        console.error('âŒ Error MySQL:', mysqlError);
        // Construir mensaje orientativo segÃºn el cÃ³digo MySQL
        let mensajeUsuario = 'No se pudo completar la inscripciÃ³n. Por favor intente nuevamente.';
        let codigoError = mysqlError.code || 'UNKNOWN';
        if (codigoError === 'ER_DUP_ENTRY') {
          mensajeUsuario = 'El alumno ya tiene una inscripciÃ³n registrada para este deporte.';
        } else if (codigoError === 'ER_NO_REFERENCED_ROW_2') {
          mensajeUsuario = 'Uno de los horarios seleccionados ya no estÃ¡ disponible. Vuelve y selecciona otro.';
        } else if (['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED'].includes(codigoError)) {
          mensajeUsuario = 'ConexiÃ³n con la base de datos interrumpida. Intente nuevamente en unos segundos.';
        }
        return res.status(500).json({
          success: false,
          error: 'Error al guardar inscripciÃ³n',
          message: mensajeUsuario,
          codigo: codigoError,
          detalles: mysqlError.sqlMessage || mysqlError.message || codigoError
        });
      }
    }
    
    // INVALIDAR CACHÃ‰
    const horariosKeys = cache.keys().filter(k => k.startsWith('horarios_'));
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(horariosKeys);
    cache.del(inscritosKeys);
    if (alumno.dni) {
      invalidateDNICache(alumno.dni);
    }
    console.log('ðŸ—‘ï¸ CACHÃ‰ INVALIDADO');

    // ==================== SINCRONIZAR CON APPS SCRIPT EN BACKGROUND CON REINTENTOS ====================
    // Disparar la sincronizaciÃ³n en background sin bloquear la respuesta al usuario
    setImmediate(() => {
      const payload = {
        token: APPS_SCRIPT_TOKEN,
        action: 'inscribir_multiple',
        codigo_operacion: codigoOperacion,
        alumno,
        horarios
      };
      const payloadStr = JSON.stringify(payload);
      console.log(`ðŸ“¤ [BG] Enviando a Apps Script - CÃ³digo: ${codigoOperacion}`);
      
      // FunciÃ³n con reintentos automÃ¡ticos
      const sincronizarConReintentos = async (intento = 1, maxIntentos = 3) => {
        try {
          const response = await Promise.race([
            fetch(APPS_SCRIPT_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payloadStr
            }).then(r => {
              if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
              return r.json();
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 5min')), 300000))
          ]);
          return response;
        } catch (err) {
          if (intento < maxIntentos) {
            const delayMs = Math.pow(2, intento) * 1000;
            console.warn(`âš ï¸ [BG] Intento ${intento}/${maxIntentos} fallÃ³ - CÃ³digo: ${codigoOperacion}`);
            console.warn(`   Error: ${err.message} - Reintentando en ${delayMs/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            return sincronizarConReintentos(intento + 1, maxIntentos);
          } else {
            throw err;
          }
        }
      };
      
      sincronizarConReintentos()
      .then(async (appsScriptResponse) => {
        if (appsScriptResponse.success) {
          console.log(`âœ… [BG] Apps Script exitoso - CÃ³digo: ${codigoOperacion}`);
          // Actualizar URLs de documentos si estÃ¡n disponibles
          if (appsScriptResponse.urls_documentos && inscripcionData && db) {
            try {
              await db.query(
                `UPDATE alumnos SET 
                 dni_frontal_url = ?, 
                 dni_reverso_url = ?, 
                 foto_carnet_url = ?,
                 comprobante_pago_url = ?
                 WHERE alumno_id = ?`,
                [
                  appsScriptResponse.urls_documentos.dni_frontal,
                  appsScriptResponse.urls_documentos.dni_reverso,
                  appsScriptResponse.urls_documentos.foto_carnet,
                  appsScriptResponse.url_comprobante,
                  inscripcionData.alumnoId
                ]
              );
              console.log(`âœ… [BG] URLs guardadas en MySQL - CÃ³digo: ${codigoOperacion}`);
            } catch (e) {
              console.error(`âŒ [BG] Error guardando URLs - CÃ³digo: ${codigoOperacion}:`, e.message);
            }
          } else {
            console.warn(`âš ï¸ [BG] Apps Script exitoso pero sin URLs - CÃ³digo: ${codigoOperacion}`);
          }
          
          // ====== SUBIR COMPROBANTE DESPUÃ‰S DE QUE LA INSCRIPCIÃ“N SE SINCRONIZÃ“ ======
          // Esto evita race condition: carpeta ya existe + PAGOS ya tiene el cÃ³digo
          if (comprobante && comprobante.imagen && comprobante.nombre_archivo) {
            console.log(`ðŸ“¸ [BG] Subiendo comprobante - CÃ³digo: ${codigoOperacion}`);
            
            // FunciÃ³n con reintentos para comprobante
            const subirComprobanteConReintentos = async (intento = 1, maxIntentos = 3) => {
              try {
                return await Promise.race([
                  fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      token: APPS_SCRIPT_TOKEN,
                      action: 'subir_comprobante',
                      codigo_operacion: codigoOperacion,
                      dni: alumno.dni,
                      alumno: `${alumno.nombres} ${alumno.apellidos || alumno.apellidoPaterno || ''}`,
                      imagen: comprobante.imagen,
                      nombre_archivo: comprobante.nombre_archivo,
                      metodo_pago: comprobante.metodo_pago || 'Plin/QR'
                    })
                  }).then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                    return r.json();
                  }),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout comprobante 3min')), 180000))
                ]);
              } catch (err) {
                if (intento < maxIntentos) {
                  const delayMs = Math.pow(2, intento) * 1000;
                  console.warn(`âš ï¸ [BG] Comprobante intento ${intento}/${maxIntentos} fallÃ³ - CÃ³digo: ${codigoOperacion}`);
                  console.warn(`   Error: ${err.message} - Reintentando en ${delayMs/1000}s...`);
                  await new Promise(resolve => setTimeout(resolve, delayMs));
                  return subirComprobanteConReintentos(intento + 1, maxIntentos);
                } else {
                  throw err;
                }
              }
            };
            
            try {
              const compResp = await subirComprobanteConReintentos();
              if (compResp.success && compResp.url_comprobante && db) {
                await db.query(
                  `UPDATE alumnos SET comprobante_pago_url = ? WHERE alumno_id = ?`,
                  [compResp.url_comprobante, inscripcionData.alumnoId]
                );
                console.log(`âœ… [BG] Comprobante subido - CÃ³digo: ${codigoOperacion}`);
              } else {
                console.error(`âŒ [BG] Comprobante fallÃ³ - CÃ³digo: ${codigoOperacion}:`, compResp.error);
              }
            } catch (compErr) {
              console.error(`âŒ [BG] Error subida comprobante - CÃ³digo: ${codigoOperacion}:`, compErr.message);
            }
          }
        } else {
          console.error(`âŒ [BG] Apps Script error - CÃ³digo: ${codigoOperacion}:`, appsScriptResponse.error);
        }
      })
      .catch(err => {
        console.error(`âŒ [BG] Apps Script fallÃ³ (mÃ¡x 3 reintentos) - CÃ³digo: ${codigoOperacion}:`, err.message);
      });
    });
    
    // Responder inmediatamente con Ã©xito de MySQL (formato compatible con tests)
    res.json({
      success: true,
      message: 'InscripciÃ³n registrada exitosamente',
      codigo_operacion: codigoOperacion,
      alumno: {
        alumno_id: inscripcionData.alumnoId,
        dni: alumno.dni,
        nombres: inscripcionData.alumnoDBData ? inscripcionData.alumnoDBData.nombres : alumno.nombres,
        apellido_paterno: inscripcionData.alumnoDBData ? inscripcionData.alumnoDBData.apellido_paterno : (alumno.apellidoPaterno || ''),
        apellido_materno: inscripcionData.alumnoDBData ? inscripcionData.alumnoDBData.apellido_materno : (alumno.apellidoMaterno || '')
      },
      inscripciones: inscripcionData.inscripcionIds ? 
        inscripcionData.inscripcionIds.map(ins => ({ 
          inscripcion_id: ins.inscripcionId,
          deporte_id: ins.deporteId
        })) : [],
      data: inscripcionData,
      dni: alumno.dni
    });
    
  } catch (error) {
    console.error('âŒ Error al inscribir:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al procesar inscripciÃ³n' 
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
        error: 'DNI invÃ¡lido'
      });
    }
    
    // ==================== CONSULTAR DESDE MYSQL (PRINCIPAL) ====================
    if (db) {
      try {
        console.log(`ðŸ” Consultando inscripciones de DNI ${dni} en MySQL...`);
        
        const [rows] = await db.query(`
          SELECT 
            i.inscripcion_id,
            a.dni,
            a.nombres,
            CONCAT(a.apellido_paterno, ' ', a.apellido_materno) as apellidos,
            d.nombre as deporte,
            i.plan,
            i.precio_mensual,
            i.matricula_pagada,
            i.estado,
            DATE_FORMAT(i.fecha_inscripcion, '%d/%m/%Y') as fecha_inscripcion,
            YEAR(i.fecha_inscripcion) as anio_inscripcion
          FROM inscripciones i
          INNER JOIN alumnos a ON i.alumno_id = a.alumno_id
          INNER JOIN deportes d ON i.deporte_id = d.deporte_id
          WHERE a.dni = ? AND i.estado IN ('activa', 'pendiente')
          ORDER BY i.fecha_inscripcion DESC
        `, [dni]);
        
        console.log(`âœ… Inscripciones activas encontradas en MySQL: ${rows.length}`);
        console.log(`ðŸ“Š Datos:`, JSON.stringify(rows, null, 2));
        
        return res.json({
          success: true,
          inscripciones: rows,
          total: rows.length,
          source: 'mysql'
        });
        
      } catch (mysqlError) {
        console.error('âŒ Error en MySQL, intentando con Google Sheets:', mysqlError);
        // Continuar con Google Sheets como fallback
      }
    }
    
    // ==================== GOOGLE SHEETS (FALLBACK) ====================
    console.log('âš ï¸ Consultando Google Sheets como fallback...');
    const url = `${APPS_SCRIPT_URL}?action=mis_inscripciones&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al obtener inscripciones');
    }
    
    res.json({
      ...data,
      source: 'google_sheets'
    });
  } catch (error) {
    console.error('âŒ Error al obtener inscripciones:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al obtener inscripciones' 
    });
  }
});

// Endpoint: Eliminar un dÃ­a/horario de una inscripciÃ³n existente
app.post('/api/eliminar-horario', async (req, res) => {
  try {
    const { dni, inscripcion_id, horario_id } = req.body;

    if (!dni || !inscripcion_id || !horario_id) {
      return res.status(400).json({ success: false, error: 'Datos incompletos' });
    }
    if (!db) return res.status(503).json({ success: false, error: 'Base de datos no disponible' });

    // 1. Validar que la inscripciÃ³n pertenece al DNI y estÃ¡ activa
    const [inscRows] = await db.query(`
      SELECT i.inscripcion_id, i.plan, d.nombre as deporte
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.alumno_id
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE a.dni = ? AND i.inscripcion_id = ? AND i.estado = 'activa'
    `, [dni, inscripcion_id]);

    if (inscRows.length === 0) {
      return res.status(404).json({ success: false, error: 'InscripciÃ³n no encontrada o no estÃ¡ activa' });
    }

    // 2. Verificar que quedan mÃ¡s de 1 dÃ­a (no dejar inscripciÃ³n vacÃ­a)
    const [countRows] = await db.query(
      'SELECT COUNT(*) as total FROM inscripcion_horarios WHERE inscripcion_id = ?',
      [inscripcion_id]
    );
    if (countRows[0].total <= 1) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar el Ãºnico dÃ­a registrado. Si deseas cancelar la inscripciÃ³n, contacta al administrador.'
      });
    }

    // 3. Eliminar el horario
    const [del] = await db.query(
      'DELETE FROM inscripcion_horarios WHERE inscripcion_id = ? AND horario_id = ?',
      [inscripcion_id, horario_id]
    );
    if (del.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado en esta inscripciÃ³n' });
    }

    // 4. Recalcular precio_mensual con el nuevo total de dÃ­as
    const [totalRows] = await db.query(
      'SELECT COUNT(*) as total FROM inscripcion_horarios WHERE inscripcion_id = ?',
      [inscripcion_id]
    );
    const totalDias = totalRows[0].total;
    const { plan, deporte } = inscRows[0];

    const calcularPrecio = (dias, plan, deporte) => {
      if (deporte === 'MAMAS FIT' || plan === 'MAMAS FIT') return 60;
      if (plan === 'Baby FÃºtbol' || deporte === 'Baby FÃºtbol') {
        if (dias === 1) return 50; if (dias === 2) return 100; return 150;
      }
      if (plan === 'EconÃ³mico') { if (dias === 2) return 60; if (dias >= 3) return 80; return 60; }
      if (plan === 'EstÃ¡ndar') { if (dias === 1) return 40; if (dias === 2) return 80; return 120; }
      if (plan === 'Premium') { if (dias === 2) return 100; return 150; }
      return 60;
    };
    const nuevoPrecio = calcularPrecio(totalDias, plan, deporte);
    await db.query('UPDATE inscripciones SET precio_mensual = ? WHERE inscripcion_id = ?', [nuevoPrecio, inscripcion_id]);

    // 4b. Actualizar monto en pagos_mensuales pendientes del mes actual
    try {
      const ahora = new Date();
      const NOMBRES_MESES_NORM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const mesActual = NOMBRES_MESES_NORM[ahora.getMonth()]; // siempre en minusculas y ortografia estandar
      const [alumnoRows] = await db.query('SELECT alumno_id FROM alumnos WHERE dni = ?', [dni]);
      if (alumnoRows.length > 0) {
        const [updated] = await db.query(
          "UPDATE pagos_mensuales SET monto = ? WHERE alumno_id = ? AND mes = ? AND estado = 'pendiente'",
          [nuevoPrecio, alumnoRows[0].alumno_id, mesActual]
        );
        if (updated.affectedRows > 0) {
          console.log(`ðŸ’° pagos_mensuales actualizado a S/.${nuevoPrecio} para DNI ${dni} mes ${mesActual}`);
        }
      }
    } catch (e) { console.error('âš ï¸ Error al actualizar pagos_mensuales:', e.message); }

    // 5. Limpiar cachÃ©
    cache.del(getCacheKey('consultas', dni));
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    if (inscritosKeys.length > 0) cache.del(inscritosKeys);
    console.log(`ðŸ—‘ï¸ Horario ${horario_id} eliminado de inscripciÃ³n ${inscripcion_id}. DÃ­as restantes: ${totalDias}. Precio: S/.${nuevoPrecio}`);

    res.json({
      success: true,
      message: 'DÃ­a eliminado correctamente',
      nuevo_precio: nuevoPrecio,
      total_dias: totalDias
    });
  } catch (error) {
    console.error('âŒ Error al eliminar horario:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar el horario. Intente nuevamente.' });
  }
});

// Endpoint: Agregar un dÃ­a/horario a una inscripciÃ³n existente
app.post('/api/agregar-horario', async (req, res) => {
  try {
    const { dni, inscripcion_id, horario_id } = req.body;

    if (!dni || !inscripcion_id || !horario_id) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos: se requiere dni, inscripcion_id y horario_id'
      });
    }

    if (!db) {
      return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
    }

    // 1. Validar que la inscripciÃ³n pertenece al DNI y estÃ¡ activa
    const [inscRows] = await db.query(`
      SELECT i.inscripcion_id, i.deporte_id, d.nombre as deporte
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.alumno_id
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE a.dni = ? AND i.inscripcion_id = ? AND i.estado = 'activa'
    `, [dni, inscripcion_id]);

    if (inscRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'InscripciÃ³n no encontrada o no estÃ¡ activa'
      });
    }

    const inscripcion = inscRows[0];

    // 2. Validar que el horario existe y pertenece al mismo deporte
    const [horRows] = await db.query(`
      SELECT horario_id, dia, TIME_FORMAT(hora_inicio, '%H:%i') as hora_inicio, categoria, plan
      FROM horarios
      WHERE horario_id = ? AND deporte_id = ? AND estado = 'activo'
    `, [horario_id, inscripcion.deporte_id]);

    if (horRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El horario no corresponde al deporte inscrito o no estÃ¡ disponible'
      });
    }

    // 2b. Validar que la categorÃ­a y plan del nuevo horario coincidan con los horarios existentes
    const [horExistentes] = await db.query(`
      SELECT h.categoria, h.plan
      FROM inscripcion_horarios ih
      JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE ih.inscripcion_id = ?
      LIMIT 1
    `, [inscripcion_id]);

    if (horExistentes.length > 0) {
      const { categoria: catExistente, plan: planExistente } = horExistentes[0];
      const { categoria: catNueva, plan: planNuevo } = horRows[0];
      if (catExistente && catNueva && catExistente !== catNueva) {
        return res.status(400).json({
          success: false,
          error: `El horario seleccionado es de categorÃ­a ${catNueva}, pero tu inscripciÃ³n es de categorÃ­a ${catExistente}.`
        });
      }
      if (planExistente && planNuevo && planExistente !== planNuevo) {
        return res.status(400).json({
          success: false,
          error: `El horario seleccionado corresponde al plan ${planNuevo}, pero tu inscripciÃ³n es del plan ${planExistente}.`
        });
      }
    }

    // 3. Verificar que no estÃ© ya inscrito en ese horario
    const [existRows] = await db.query(`
      SELECT 1 FROM inscripcion_horarios
      WHERE inscripcion_id = ? AND horario_id = ?
    `, [inscripcion_id, horario_id]);

    if (existRows.length > 0) {
      return res.status(409).json({ success: false, error: 'Ya estÃ¡s inscrito en ese horario' });
    }

    // 4. Insertar el nuevo horario
    await db.query(`
      INSERT INTO inscripcion_horarios (inscripcion_id, horario_id) VALUES (?, ?)
    `, [inscripcion_id, horario_id]);

    // 5. Recalcular precio_mensual segÃºn el nuevo total de dÃ­as
    const [totalDiasRows] = await db.query(`
      SELECT COUNT(*) as total FROM inscripcion_horarios WHERE inscripcion_id = ?
    `, [inscripcion_id]);
    const totalDias = totalDiasRows[0].total;

    const [planRows] = await db.query(`
      SELECT plan FROM inscripciones WHERE inscripcion_id = ?
    `, [inscripcion_id]);
    const plan = planRows[0]?.plan || 'EconÃ³mico';
    const deporteNombre = inscripcion.deporte;

    // Misma lÃ³gica que el endpoint de inscripciÃ³n
    const calcularPrecio = (cantidadDias, plan, deporte) => {
      if (deporte === 'MAMAS FIT' || plan === 'MAMAS FIT') return 60;
      if (plan === 'Baby FÃºtbol' || deporte === 'Baby FÃºtbol') {
        if (cantidadDias === 1) return 50;
        if (cantidadDias === 2) return 100;
        if (cantidadDias >= 3) return 150;
        return 50;
      }
      if (plan === 'EconÃ³mico') {
        if (cantidadDias === 2) return 60;
        if (cantidadDias >= 3) return 80;
        return 60;
      }
      if (plan === 'EstÃ¡ndar') {
        if (cantidadDias === 1) return 40;
        if (cantidadDias === 2) return 80;
        if (cantidadDias >= 3) return 120;
        return 40;
      }
      if (plan === 'Premium') {
        if (cantidadDias === 2) return 100;
        if (cantidadDias >= 3) return 150;
        return 100;
      }
      return 60;
    };

    const nuevoPrecio = calcularPrecio(totalDias, plan, deporteNombre);
    await db.query(`
      UPDATE inscripciones SET precio_mensual = ? WHERE inscripcion_id = ?
    `, [nuevoPrecio, inscripcion_id]);

    console.log(`ðŸ’° precio_mensual actualizado: S/.${nuevoPrecio} (${totalDias} dÃ­as, plan ${plan})`);

    // 5b. Actualizar monto en pagos_mensuales pendientes del mes actual
    try {
      const ahora = new Date();
      const NOMBRES_MESES_NORM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const mesActual = NOMBRES_MESES_NORM[ahora.getMonth()]; // siempre en minusculas y ortografia estandar
      const [alumnoRows] = await db.query('SELECT alumno_id FROM alumnos WHERE dni = ?', [dni]);
      if (alumnoRows.length > 0) {
        const [updated] = await db.query(
          "UPDATE pagos_mensuales SET monto = ? WHERE alumno_id = ? AND mes = ? AND estado = 'pendiente'",
          [nuevoPrecio, alumnoRows[0].alumno_id, mesActual]
        );
        if (updated.affectedRows > 0) {
          console.log(`ðŸ’° pagos_mensuales actualizado a S/.${nuevoPrecio} para DNI ${dni} mes ${mesActual}`);
        }
      }
    } catch (e) { console.error('âš ï¸ Error al actualizar pagos_mensuales:', e.message); }

    // 6. Limpiar cachÃ© del DNI
    const cacheKeyConsulta = getCacheKey('consultas', dni);
    cache.del(cacheKeyConsulta);

    console.log(`âœ… Horario ${horario_id} (${horRows[0].dia} ${horRows[0].hora_inicio}) agregado a inscripciÃ³n ${inscripcion_id} (DNI ${dni})`);

    res.json({
      success: true,
      message: `DÃ­a ${horRows[0].dia} agregado correctamente a ${inscripcion.deporte}`,
      nuevo_precio: nuevoPrecio,
      total_dias: totalDias
    });

  } catch (error) {
    console.error('âŒ Error al agregar horario:', error);
    res.status(500).json({ success: false, error: 'Error al agregar el horario. Intente nuevamente.' });
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
    
    // INVALIDAR CACHÃ‰ despuÃ©s de registrar pago
    if (alumno.dni) {
      invalidateDNICache(alumno.dni);
    }
    console.log('ðŸ—‘ï¸ CACHÃ‰ INVALIDADO tras registrar pago');
    
    res.json(data);
  } catch (error) {
    console.error('âŒ Error al registrar pago:', error);
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
        error: 'DNI invÃ¡lido'
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
    console.error('âŒ Error al verificar pago:', error);
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
        error: 'DNI debe tener 8 dÃ­gitos'
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
    console.error('âŒ Error al validar DNI:', error);
    res.status(500).json({ 
      success: false,
      valido: false,
      error: error.message || 'Error al validar DNI' 
    });
  }
});

// Endpoint pÃºblico para consultar datos de un alumno por DNI (autocompletado e inscripciones)
app.get('/api/consultar/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    if (!dni || dni.toString().trim().length < 6) {
      return res.status(400).json({ success: false, error: 'DNI invÃ¡lido' });
    }

    if (!db) {
      return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
    }

    const [alumnos] = await db.query(
      `SELECT 
        alumno_id,
        dni,
        nombres,
        CONCAT(TRIM(apellido_paterno), IF(apellido_materno IS NOT NULL AND apellido_materno != '', CONCAT(' ', TRIM(apellido_materno)), '')) as apellidos,
        apellido_paterno,
        apellido_materno,
        DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') as fecha_nacimiento,
        TIMESTAMPDIFF(YEAR, fecha_nacimiento, CURDATE()) as edad,
        sexo,
        telefono,
        email,
        direccion,
        seguro_tipo,
        condicion_medica,
        apoderado,
        telefono_apoderado,
        dni_frontal_url,
        dni_reverso_url,
        foto_carnet_url,
        comprobante_pago_url,
        estado,
        estado_pago,
        fecha_pago,
        monto_pago,
        numero_operacion,
        notas_pago,
        created_at,
        updated_at
      FROM alumnos WHERE dni = ? ORDER BY alumno_id DESC LIMIT 1`,
      [dni.toString().trim()]
    );

    if (alumnos.length === 0) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }

    const usuario = alumnos[0];

    // Consultar inscripciones
    const [inscripcionesRaw] = await db.query(`
      SELECT 
        i.inscripcion_id,
        i.estado as estado_inscripcion,
        i.fecha_inscripcion,
        i.plan,
        i.precio_mensual as precio,
        d.deporte_id,
        d.nombre as deporte,
        d.icono,
        h.horario_id,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
        h.categoria,
        h.nivel
      FROM inscripciones i
      JOIN deportes d ON i.deporte_id = d.deporte_id
      LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE i.alumno_id = ? AND i.estado IN ('activa', 'pendiente')
      ORDER BY d.nombre, h.dia, h.hora_inicio
    `, [usuario.alumno_id]);

    const inscripcionesMap = new Map();
    inscripcionesRaw.forEach(row => {
      const key = row.inscripcion_id;
      if (!inscripcionesMap.has(key)) {
        inscripcionesMap.set(key, {
          inscripcion_id: row.inscripcion_id,
          estado_inscripcion: row.estado_inscripcion,
          fecha_inscripcion: row.fecha_inscripcion,
          plan: row.plan,
          precio: row.precio,
          deporte_id: row.deporte_id,
          deporte: row.deporte,
          icono: row.icono,
          categoria: row.categoria,
          nivel: row.nivel,
          horarios: []
        });
      }
      if (row.dia && row.hora_inicio) {
        inscripcionesMap.get(key).horarios.push({
          horario_id: row.horario_id,
          dia: row.dia,
          hora_inicio: row.hora_inicio,
          hora_fin: row.hora_fin
        });
      }
    });

    const inscripciones = [];
    inscripcionesMap.forEach(inscripcion => {
      if (inscripcion.horarios.length > 0) {
        inscripcion.horarios.forEach(horario => {
          inscripciones.push({
            ...inscripcion,
            horario_id: horario.horario_id,
            dia: horario.dia,
            hora_inicio: horario.hora_inicio,
            hora_fin: horario.hora_fin
          });
        });
      } else {
        inscripciones.push(inscripcion);
      }
    });

    // Si monto_pago estÃ¡ guardado usarlo; si es NULL (admin confirmÃ³ sin ingresar monto)
    // calcular dinÃ¡micamente sumando precio_mensual de las inscripciones activas Ãºnicas
    const montoNumerico = parseFloat(usuario.monto_pago) ||
      Array.from(inscripcionesMap.values()).reduce((sum, i) => sum + parseFloat(i.precio || 0), 0);

    return res.json({
      success: true,
      alumno: usuario,
      pago: {
        estado: usuario.estado_pago || 'pendiente',
        fecha_pago: usuario.fecha_pago,
        fecha_registro: usuario.fecha_pago || usuario.created_at,
        monto: montoNumerico,
        metodo_pago: usuario.numero_operacion ? `OperaciÃ³n: ${usuario.numero_operacion}` : 'Transferencia / DepÃ³sito',
        numero_operacion: usuario.numero_operacion,
        comprobante_url: usuario.comprobante_pago_url
      },
      inscripciones,
      horarios: inscripciones,
      resumen: {
        total_inscripciones: inscripcionesMap.size
      }
    });
  } catch (error) {
    console.error('âŒ Error al consultar alumno por DNI:', error);
    res.status(500).json({ success: false, error: 'Error interno al consultar alumno' });
  }
});

// Endpoint para eliminar usuario por DNI (elimina de TODAS las hojas)
app.delete('/api/eliminar-usuario/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.toString().length !== 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI debe tener 8 dÃ­gitos'
      });
    }
    
    const url = `${APPS_SCRIPT_URL}?action=eliminar_usuario&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al eliminar usuario');
    }
    
    // INVALIDAR CACHÃ‰ despuÃ©s de eliminaciÃ³n exitosa
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    const horariosKeys = cache.keys().filter(k => k.startsWith('horarios_'));
    cache.del(inscritosKeys);
    cache.del(horariosKeys);
    console.log('ðŸ—‘ï¸ CACHÃ‰ INVALIDADO tras eliminar usuario');
    
    res.json(data);
  } catch (error) {
    console.error('âŒ Error al eliminar usuario:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Error al eliminar usuario' 
    });
  }
});

// Endpoint: Consultar inscripciÃ³n por DNI (para pÃ¡gina de consulta)
app.get('/api/consultar/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI invÃ¡lido'
      });
    }
    
    // Crear clave de cachÃ© para este DNI
    const cacheKey = getCacheKey('consultas', dni);
    
    // Consultas admin con incluir_inactivos saltan el cachÃ©
    const incluirInactivos = req.query.incluir_inactivos === '1';
    
    // Intentar obtener del cachÃ© (solo para consultas pÃºblicas)
    if (!incluirInactivos) {
      const cachedData = cache.get(cacheKey);
      if (cachedData) {
        console.log(`âš¡ CACHÃ‰ HIT: ${cacheKey}`);
        return res.json(cachedData);
      }
    }
    
    console.log(`ðŸŒ CACHÃ‰ MISS: ${cacheKey}`);
    
    // ==================== CONSULTAR MYSQL PRIMERO ====================
    if (db) {
      try {
        console.log(`ðŸ” Consultando estado para DNI ${dni} en MySQL...`);
        
        // Obtener datos del alumno
        const [alumnoRows] = await db.query(`
          SELECT 
            alumno_id, dni, nombres,
            CONCAT(apellido_paterno, ' ', apellido_materno) as apellidos,
            fecha_nacimiento,
            TIMESTAMPDIFF(YEAR, fecha_nacimiento, CURDATE()) as edad,
            sexo, telefono, email,
            direccion,
            seguro_tipo,
            condicion_medica,
            apoderado,
            telefono_apoderado,
            estado,
            estado_pago,
            monto_pago,
            numero_operacion,
            fecha_pago,
            comprobante_pago_url,
            dni_frontal_url,
            dni_reverso_url,
            foto_carnet_url
          FROM alumnos 
          WHERE dni = ?
        `, [dni]);
        
        if (alumnoRows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'No se encontrÃ³ ninguna inscripciÃ³n con ese DNI'
          });
        }
        
        const alumno = alumnoRows[0];
        
        // Validar que el usuario estÃ© activo (a menos que sea consulta admin)
        if (alumno.estado === 'inactivo' && !incluirInactivos) {
          return res.status(403).json({
            success: false,
            inactivo: true,
            error: 'Tu cuenta ha sido desactivada. Por favor contacta al administrador.'
          });
        }
        
        // Obtener inscripciones (si es admin, incluir canceladas tambiÃ©n)
        const estadosInscripcion = incluirInactivos 
          ? `('activa', 'suspendida', 'pendiente', 'cancelada')` 
          : `('activa', 'suspendida', 'pendiente')`;
        const [inscripciones] = await db.query(`
          SELECT 
            i.inscripcion_id,
            d.nombre as deporte,
            i.plan,
            i.precio_mensual,
            i.estado,
            DATE_FORMAT(i.fecha_inscripcion, '%d/%m/%Y') as fecha_inscripcion,
            i.fecha_inscripcion as fecha_registro
          FROM inscripciones i
          JOIN deportes d ON i.deporte_id = d.deporte_id
          WHERE i.alumno_id = ? AND i.estado IN ${estadosInscripcion}
        `, [alumno.alumno_id]);
        
        // Obtener horarios de cada inscripciÃ³n
        const horariosCompletos = [];
        for (const inscripcion of inscripciones) {
          const [horarios] = await db.query(`
            SELECT 
              h.horario_id,
              h.dia,
              TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
              TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
              h.categoria
            FROM inscripcion_horarios ih
            JOIN horarios h ON ih.horario_id = h.horario_id
            WHERE ih.inscripcion_id = ?
            ORDER BY FIELD(h.dia, 'LUNES', 'MARTES', 'MIÃ‰RCOLES', 'JUEVES', 'VIERNES', 'SÃBADO', 'DOMINGO')
          `, [inscripcion.inscripcion_id]);
          
          if (horarios.length > 0) {
            horarios.forEach(h => {
              horariosCompletos.push({
                inscripcion_id: inscripcion.inscripcion_id,
                horario_id: h.horario_id,
                deporte: inscripcion.deporte,
                sede: 'Sede Principal',
                plan: inscripcion.plan || 'EconÃ³mico',
                dia: h.dia,
                hora_inicio: h.hora_inicio,
                hora_fin: h.hora_fin,
                categoria: h.categoria,
                precio: inscripcion.precio_mensual,
                estado_inscripcion: inscripcion.estado,
                fecha_inscripcion: inscripcion.fecha_inscripcion
              });
            });
          } else {
            horariosCompletos.push({
              inscripcion_id: inscripcion.inscripcion_id,
              deporte: inscripcion.deporte,
              sede: 'Sede Principal',
              plan: inscripcion.plan || 'EconÃ³mico',
              dia: 'Por definir',
              hora_inicio: null,
              hora_fin: null,
              categoria: '',
              precio: inscripcion.precio_mensual,
              estado_inscripcion: inscripcion.estado,
              fecha_inscripcion: inscripcion.fecha_inscripcion
            });
          }
        }
        
        // Calcular monto total (solo inscripciones activas)
        const montoTotal = inscripciones
          .filter(i => i.estado === 'activa')
          .reduce((sum, i) => sum + parseFloat(i.precio_mensual || 0), 0);
        
        const resultado = {
          success: true,
          alumno: {
            dni: alumno.dni,
            nombres: alumno.nombres,
            apellidos: alumno.apellidos,
            estado: alumno.estado,
            fecha_nacimiento: alumno.fecha_nacimiento,
            edad: alumno.edad,
            sexo: alumno.sexo,
            telefono: alumno.telefono,
            email: alumno.email,
            direccion: alumno.direccion,
            seguro_tipo: alumno.seguro_tipo,
            condicion_medica: alumno.condicion_medica,
            apoderado: alumno.apoderado,
            telefono_apoderado: alumno.telefono_apoderado,
            dni_frontal_url: alumno.dni_frontal_url,
            dni_reverso_url: alumno.dni_reverso_url,
            foto_carnet_url: alumno.foto_carnet_url
          },
          pago: {
            estado: alumno.estado_pago || 'pendiente',
            monto: montoTotal,
            metodo_pago: 'Transferencia bancaria', // Por defecto
            numero_operacion: alumno.numero_operacion || '',
            fecha: alumno.fecha_pago || null,
            fecha_registro: inscripciones.length > 0 ? inscripciones[0].fecha_registro : null,
            comprobante_url: alumno.comprobante_pago_url || null
          },
          inscripciones: inscripciones,
          horarios: horariosCompletos,
          source: 'mysql'
        };

        // âœ… AUTO-REPARAR: Si faltan URLs de documentos, consultarlas en Apps Script y guardarlas
        const faltanURLs = !alumno.dni_frontal_url || !alumno.dni_reverso_url || !alumno.foto_carnet_url;
        if (faltanURLs) {
          try {
            const appsUrl = `${APPS_SCRIPT_URL}?action=consultar_inscripcion&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
            const appsResp = await Promise.race([
              fetch(appsUrl).then(r => r.json()),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
            ]);
            if (appsResp && appsResp.alumno) {
              const u = appsResp.alumno;
              const frontal = u.dni_frontal_url || u.dniFrontalUrl || null;
              const reverso = u.dni_reverso_url || u.dniReversoUrl || null;
              const carnet = u.foto_carnet_url || u.fotoCarnetUrl || null;
              if (frontal || reverso || carnet) {
                // Guardar en MySQL para la prÃ³xima vez
                await db.query(
                  `UPDATE alumnos SET
                    dni_frontal_url = COALESCE(dni_frontal_url, ?),
                    dni_reverso_url = COALESCE(dni_reverso_url, ?),
                    foto_carnet_url = COALESCE(foto_carnet_url, ?)
                   WHERE alumno_id = ?`,
                  [frontal, reverso, carnet, alumno.alumno_id]
                );
                // Incluir en la respuesta actual
                resultado.alumno.dni_frontal_url = resultado.alumno.dni_frontal_url || frontal;
                resultado.alumno.dni_reverso_url = resultado.alumno.dni_reverso_url || reverso;
                resultado.alumno.foto_carnet_url = resultado.alumno.foto_carnet_url || carnet;
                console.log(`âœ… URLs de documentos recuperadas de Apps Script para DNI ${dni}`);
              }
            }
          } catch (e) {
            console.warn(`âš ï¸ No se pudieron recuperar URLs de Apps Script para DNI ${dni}:`, e.message);
          }
        }

        // Cachear resultado (solo consultas pÃºblicas, no admin con canceladas)
        if (!incluirInactivos) {
          cache.set(cacheKey, resultado, CACHE_TTL.consultas);
          console.log(`ðŸ’¾ CACHÃ‰ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.consultas}s)`);
        }
        console.log(`âœ… Consulta desde MySQL - Estado pago: ${alumno.estado_pago}`);
        
        return res.json(resultado);
        
      } catch (mysqlError) {
        console.error('âŒ Error en MySQL, usando Google Sheets:', mysqlError.message);
        // Continuar con Google Sheets como fallback
      }
    }
    
    // ==================== GOOGLE SHEETS FALLBACK ====================
    console.log('âš ï¸ Consultando Google Sheets como fallback...');
    const url = `${APPS_SCRIPT_URL}?action=consultar_inscripcion&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al consultar inscripciÃ³n');
    }
    
    // Solo cachear si la consulta fue exitosa
    if (data.success) {
      cache.set(cacheKey, data, CACHE_TTL.consultas);
      console.log(`ðŸ’¾ CACHÃ‰ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.consultas}s)`);
    }
    
    res.json(data);
  } catch (error) {
    console.error('âŒ Error al consultar inscripciÃ³n:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al consultar inscripciÃ³n' 
    });
  }
});

// Endpoint: Obtener datos de inscripciÃ³n por cÃ³digo de operaciÃ³n
app.get('/api/inscripcion/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    if (!codigo) {
      return res.status(400).json({
        success: false,
        error: 'CÃ³digo de operaciÃ³n requerido'
      });
    }
    
    console.log(`ðŸ” Buscando inscripciÃ³n con cÃ³digo: ${codigo}`);
    
    const query = `
      SELECT 
        i.id,
        i.codigo_operacion,
        i.fecha_inscripcion,
        i.estado,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', COALESCE(a.apellido_materno, '')) AS alumno,
        d.nombre AS deporte,
        d.precio,
        d.matricula
      FROM inscripciones i
      INNER JOIN alumnos a ON i.alumno_id = a.id
      INNER JOIN deportes d ON i.deporte_id = d.id
      WHERE i.codigo_operacion = ?
      ORDER BY i.fecha_inscripcion DESC
    `;
    
    const [inscripciones] = await pool.query(query, [codigo]);
    
    if (!inscripciones || inscripciones.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No se encontrÃ³ ninguna inscripciÃ³n con ese cÃ³digo'
      });
    }
    
    // Agrupar horarios por inscripciÃ³n
    const primerInscripcion = inscripciones[0];
    const horarios = inscripciones.map(ins => ({
      deporte: ins.deporte,
      precio: parseFloat(ins.precio || 0),
      matricula: parseFloat(ins.matricula || 0)
    }));
    
    // Calcular deportes nuevos para matrÃ­cula
    const deportesUnicos = [...new Set(horarios.map(h => h.deporte))];
    const matriculaTotal = deportesUnicos.length * 20;
    
    const datos = {
      success: true,
      codigo: codigo,
      dni: primerInscripcion.dni,
      alumno: primerInscripcion.alumno,
      fecha: primerInscripcion.fecha_inscripcion,
      estado: primerInscripcion.estado,
      horarios: horarios,
      matricula: {
        deportesNuevos: deportesUnicos,
        cantidad: deportesUnicos.length,
        monto: matriculaTotal
      }
    };
    
    console.log(`âœ… InscripciÃ³n encontrada: ${datos.alumno} (${datos.dni})`);
    
    res.json(datos);
  } catch (error) {
    console.error('âŒ Error al obtener inscripciÃ³n:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener inscripciÃ³n'
    });
  }
});

// Endpoint: Subir comprobante de pago
app.post('/api/subir-comprobante', async (req, res) => {
  try {
    const { codigo_operacion, dni, alumno, imagen, nombre_archivo } = req.body;
    
    // Validaciones bÃ¡sicas
    if (!codigo_operacion || !dni || !imagen || !nombre_archivo) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos. Se requiere: codigo_operacion, dni, imagen y nombre_archivo'
      });
    }
    
    // Validar formato Base64
    if (!imagen.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Formato de imagen invÃ¡lido. Debe ser Base64 con prefijo data:image/'
      });
    }
    
    console.log(`ðŸ“¸ Subiendo comprobante para DNI ${dni}, cÃ³digo: ${codigo_operacion}`);

    // Validar que el cÃ³digo existe en MySQL (no depender del Sheet)
    if (db) {
      const [rows] = await db.query(
        `SELECT i.inscripcion_id FROM inscripciones i
         JOIN alumnos a ON i.alumno_id = a.alumno_id
         WHERE i.codigo_operacion = ? AND a.dni = ? LIMIT 1`,
        [codigo_operacion, dni]
      );
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'CÃ³digo de operaciÃ³n no encontrado. Verifica tu inscripciÃ³n.'
        });
      }
      // Marcar en MySQL que el comprobante fue recibido (pendiente de subir a Drive)
      await db.query(
        `UPDATE inscripciones SET estado = 'pendiente' 
         WHERE codigo_operacion = ? AND estado = 'pendiente'`,
        [codigo_operacion]
      );
    }

    // Invalidar cachÃ© inmediatamente
    invalidateDNICache(dni);

    // Responder Ã©xito al usuario de inmediato
    res.json({
      success: true,
      message: 'Comprobante recibido correctamente. SerÃ¡ procesado en breve.',
      url_comprobante: null
    });

    // Subir a Apps Script / Google Drive en background
    setImmediate(() => {
      console.log(`ðŸ“¤ [BG] Subiendo comprobante a Drive para cÃ³digo: ${codigo_operacion}`);
      Promise.race([
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: APPS_SCRIPT_TOKEN,
            action: 'subir_comprobante',
            codigo_operacion,
            dni,
            alumno,
            imagen,
            nombre_archivo
          })
        }).then(r => r.json()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 5min')), 300000))
      ])
      .then(async (data) => {
        if (data.success && data.url_comprobante && db) {
          await db.query(
            `UPDATE alumnos SET comprobante_pago_url = ? WHERE dni = ?`,
            [data.url_comprobante, dni]
          );
          console.log(`âœ… [BG] Comprobante subido a Drive: ${data.url_comprobante}`);
        } else {
          console.error('âŒ [BG] Apps Script error al subir comprobante:', data.error);
        }
      })
      .catch(err => {
        console.error('âŒ [BG] FallÃ³ subida de comprobante a Drive:', err.message);
      });
    });

  } catch (error) {
    console.error('âŒ Error al subir comprobante:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al subir comprobante' 
    });
  }
});

/**
 * POST /api/subir-comprobante-tardio/:dni
 * Subir comprobante despuÃ©s de la inscripciÃ³n (para usuarios que eligieron efectivo)
 */
app.post('/api/subir-comprobante-tardio/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    const { imagen, nombre_archivo, metodo_pago = 'Transferencia bancaria', numero_operacion } = req.body;
    
    // Validaciones
    if (!imagen || !nombre_archivo) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos. Se requiere: imagen y nombre_archivo'
      });
    }

    if (!numero_operacion || !numero_operacion.trim()) {
      return res.status(400).json({
        success: false,
        error: 'NÃºmero de operaciÃ³n requerido',
        message: 'Debes ingresar el nÃºmero de operaciÃ³n de tu comprobante de pago.'
      });
    }
    
    if (!imagen.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Formato de imagen invÃ¡lido. Debe ser Base64 con prefijo data:image/'
      });
    }
    
    console.log(`ðŸ“¸ Subida tardÃ­a de comprobante para DNI ${dni}`);
    
    // Verificar que el alumno existe y no tiene comprobante
    const [alumnos] = await db.query(
      'SELECT alumno_id, dni, nombres, CONCAT(apellido_paterno, " ", apellido_materno) as apellidos FROM alumnos WHERE dni = ?',
      [dni]
    );
    
    if (alumnos.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alumno no encontrado'
      });
    }
    
    const alumno = alumnos[0];
    
    // Subir a Google Drive via Apps Script
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: APPS_SCRIPT_TOKEN,
        action: 'subir_comprobante_tardio',
        dni,
        alumno: {
          nombres: alumno.nombres,
          apellidos: alumno.apellidos
        },
        imagen,
        nombre_archivo,
        metodo_pago
      })
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      console.error('âŒ Error del Apps Script al subir comprobante tardÃ­o:', data.error);
      return res.status(response.status || 500).json({
        success: false,
        error: data.error || 'Error al subir comprobante a Google Drive'
      });
    }
    
    const urlComprobante = data.url_comprobante;
    console.log('âœ… Comprobante subido a Drive:', urlComprobante);
    
    // Actualizar MySQL con la URL del comprobante y el nÃºmero de operaciÃ³n
    await db.query(
      'UPDATE alumnos SET comprobante_pago_url = ?, numero_operacion = ?, updated_at = NOW() WHERE dni = ?',
      [urlComprobante, numero_operacion.trim(), dni]
    );
    console.log('âœ… MySQL actualizado con URL del comprobante y nÃºmero de operaciÃ³n');
    
    // Invalidar cachÃ©
    invalidateDNICache(dni);
    
    res.json({
      success: true,
      message: 'Comprobante subido exitosamente',
      url_comprobante: urlComprobante
    });
    
  } catch (error) {
    console.error('âŒ Error al subir comprobante tardÃ­o:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al subir comprobante' 
    });
  }
});

/**
 * POST /api/pago-mensual
 * Subir comprobante de pago mensual directamente a Google Drive
 */
app.post(['/api/pago-mensual', '/api/pago-Mensual'], async (req, res) => {
  try {
    const { dni, alumno, imagen, nombre_archivo, mes, monto, numero_operacion } = req.body;
    
    // Validaciones
    if (!dni || !imagen || !nombre_archivo) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos. Se requiere: dni, imagen y nombre_archivo'
      });
    }
    
    if (!imagen.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Formato de imagen invÃ¡lido. Debe ser Base64 con prefijo data:image/'
      });
    }
    
    console.log(`ðŸ’³ Pago mensual recibido - DNI: ${dni}, Mes: ${mes}`);
    
    // Verificar que el alumno existe
    const [alumnos] = await db.query(
      'SELECT alumno_id, dni, nombres, apellido_paterno, apellido_materno FROM alumnos WHERE dni = ?',
      [dni]
    );
    
    if (alumnos.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alumno no encontrado'
      });
    }
    
    const alumnoDb = alumnos[0];
    const nombreCompleto = alumno || `${alumnoDb.nombres} ${alumnoDb.apellido_paterno} ${alumnoDb.apellido_materno}`;
    
    // Extraer mes y aÃ±o para verificar duplicado
    const fechaCheck = new Date();
    const mesCheck = mes ? mes.split(/[-\s]/)[0] : '';
    const anioCheck = fechaCheck.getFullYear();
    
    // Verificar si ya existe un comprobante para este alumno/mes/aÃ±o (evitar duplicados en Drive)
    const [todosLosPagos] = await db.query(
      'SELECT * FROM pagos_mensuales WHERE alumno_id = ? AND mes = ? AND comprobante_url IS NOT NULL',
      [alumnoDb.alumno_id, mesCheck]
    );
    // Filtrar por aÃ±o en JS (evita problema de encoding con columna Ã±)
    const pagoExistente = todosLosPagos.filter(p => {
      const yearVal = Object.values(p).find(v => typeof v === 'number' && v > 2000 && v < 2100);
      return yearVal === anioCheck;
    });
    
    if (pagoExistente.length > 0) {
      console.log(`âš ï¸ Pago mensual duplicado detectado - DNI: ${dni}, Mes: ${mes}. Ya existe comprobante.`);
      return res.json({
        success: true,
        message: 'Ya tienes un comprobante registrado para este mes. No es necesario enviarlo de nuevo.',
        driveUrl: pagoExistente[0].comprobante_url,
        duplicado: true
      });
    }
    
    // Subir a Google Drive via Apps Script
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: APPS_SCRIPT_TOKEN,
        action: 'subir_pago_mensual',
        dni,
        alumno: nombreCompleto,
        imagen,
        nombre_archivo,
        mes,
        monto
      })
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      console.error('âŒ Error del Apps Script al subir pago mensual:', data.error);
      return res.status(response.status || 500).json({
        success: false,
        error: data.error || 'Error al subir comprobante a Google Drive'
      });
    }
    
    const urlComprobante = data.url_comprobante;
    console.log('âœ… Pago mensual subido a Drive:', urlComprobante);
    
    // Extraer mes y aÃ±o del string (formato: "enero-2026" o "enero de 2026")
    const fechaActual = new Date();
    // Normalizar mes: Linux puede devolver 'setiembre' sin 'p' via toLocaleString
    const MAPA_MESES = { 'enero':1,'febrero':2,'marzo':3,'abril':4,'mayo':5,'junio':6,'julio':7,'agosto':8,'setiembre':9,'septiembre':9,'octubre':10,'noviembre':11,'diciembre':12 };
    const NOMBRES_MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const mesRaw = mes.split(/[-\s]/)[0].toLowerCase();
    const mesIdx = MAPA_MESES[mesRaw];
    const mesNombre = mesIdx ? NOMBRES_MESES[mesIdx - 1] : mesRaw; // siempre 'septiembre'
    const anioActual = fechaActual.getFullYear();
    
    // Registrar en MySQL el pago mensual
    const colYear = global.COL_ANIO || 'a\u00f1o'; // 'aÃ±o' â€” fallback unicode-safe
    // Buscar si ya existe un pago pendiente para este alumno/mes/aÃ±o
    const [existePago] = await db.query(
      'SELECT pago_id FROM pagos_mensuales WHERE alumno_id = ? AND mes = ? AND `' + colYear + '` = ? AND estado = "pendiente" LIMIT 1',
      [alumnoDb.alumno_id, mesNombre, anioActual]
    );
    if (existePago.length > 0) {
      // Actualizar el pago pendiente existente
      await db.query(
        'UPDATE pagos_mensuales SET comprobante_url = ?, monto = ?, numero_operacion = COALESCE(?, numero_operacion), fecha_pago = NOW() WHERE pago_id = ?',
        [urlComprobante, monto || 0, (numero_operacion || '').trim() || null, existePago[0].pago_id]
      );
    } else {
      // Crear nuevo pago pendiente
      await db.query(
        'INSERT INTO pagos_mensuales (alumno_id, mes, `' + colYear + '`, monto, comprobante_url, estado, metodo_pago, numero_operacion, fecha_pago, created_at)' +
        " VALUES (?, ?, ?, ?, ?, 'pendiente', 'Transferencia/Plin', ?, NOW(), NOW())",
        [alumnoDb.alumno_id, mesNombre, anioActual, monto || 0, urlComprobante, (numero_operacion || '').trim() || null]
      );
    }
    console.log('âœ… Pago mensual registrado en MySQL');
    
    // Invalidar cachÃ©
    invalidateDNICache(dni);
    
    res.json({
      success: true,
      message: 'Pago mensual registrado exitosamente',
      driveUrl: urlComprobante
    });
    
  } catch (error) {
    console.error('âŒ Error al registrar pago mensual:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al registrar pago mensual' 
    });
  }
});

/**
 * GET /api/admin/pagos-mensuales
 * Listar pagos mensuales con filtros (para panel admin)
 */
app.get('/api/admin/pagos-mensuales', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { estado = 'todos', mes = '', anio = '', buscar = '', deporte = '', grupo = '' } = req.query;
    console.log(`ðŸ“‹ pagos-mensuales â†’ estado=${estado} mes=${mes} deporte=${deporte} grupo=${grupo} buscar=${buscar}`);
    const colYear = global.COL_ANIO || 'a\u00f1o'; // 'aÃ±o' â€” fallback unicode-safe
    const ahora = new Date();
    const NOMBRES_MESES_NORM_PM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const mesActual = NOMBRES_MESES_NORM_PM[ahora.getMonth()];
    const anioActual = ahora.getFullYear();
    const filtroMes = mes || mesActual;
    const filtroAnio = anio ? parseInt(anio, 10) : anioActual;

    // Necesitamos JOIN a inscripciones/deportes si hay filtro de deporte o categorÃ­a
    const necesitaJoinDeporte = !!(deporte || grupo);
    // Necesitamos JOIN a horarios si hay filtro de categorÃ­a
    const necesitaJoinHorario = !!grupo;

    let query =
      'SELECT ' +
      'pm.*, ' +
      'COALESCE(NULLIF(pm.comprobante_url, ""), a.comprobante_pago_url) as comprobante_url, ' +
      'COALESCE(NULLIF(pm.numero_operacion, ""), a.numero_operacion) as numero_operacion, ' +
      'a.dni, ' +
      'a.nombres, ' +
      'a.telefono, ' +
      'a.telefono_apoderado, ' +
      "CONCAT(a.apellido_paterno, ' ', a.apellido_materno) as apellidos " +
      'FROM pagos_mensuales pm ' +
      'JOIN alumnos a ON pm.alumno_id = a.alumno_id ';

    if (necesitaJoinDeporte) {
      query += 'JOIN inscripciones i ON i.alumno_id = a.alumno_id AND i.estado IN (\'activa\',\'pendiente\') ' +
               'JOIN deportes d ON i.deporte_id = d.deporte_id ';
    }
    if (necesitaJoinHorario) {
      // JOIN para filtrar por categorÃ­a del horario
      query += 'JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id ' +
               'JOIN horarios h ON h.horario_id = ih.horario_id ';
    }

    query += 'WHERE 1=1';
    const params = [];

    if (estado !== 'todos') {
      query += ' AND pm.estado = ?';
      params.push(estado);
    }
    if (mes) {
      // Normalizar filtro: aceptar tanto 'setiembre' como 'septiembre'
      const MAPA_MESES_FILTRO = { 'setiembre': 'septiembre' };
      const mesFiltro = (MAPA_MESES_FILTRO[mes.toLowerCase()] || mes.toLowerCase());
      if (mesFiltro === 'septiembre') {
        query += " AND LOWER(pm.mes) IN ('septiembre', 'setiembre')";
      } else {
        query += ' AND LOWER(pm.mes) = ?';
        params.push(mesFiltro);
      }
    }
    if (anio) {
      // Se filtra por aÃ±o en JS despuÃ©s de la consulta
    }
    if (deporte) {
      query += ' AND UPPER(d.nombre) = UPPER(?)';
      params.push(deporte);
    }
    if (grupo) {
      query += ' AND h.categoria = ?';
      params.push(grupo);
    }
    if (buscar) {
      query += ' AND (a.dni LIKE ? OR a.nombres LIKE ? OR a.apellido_paterno LIKE ? OR a.apellido_materno LIKE ?)';
      const like = `%${buscar}%`;
      params.push(like, like, like, like);
    }

    // GROUP BY para evitar duplicados cuando un alumno tiene mÃºltiples inscripciones
    if (necesitaJoinDeporte || necesitaJoinHorario) {
      query += ' GROUP BY pm.pago_id';
    }

    query += ' ORDER BY pm.created_at DESC LIMIT 500';

    let [pagos] = await db.query(query, params);

    if (estado === 'pendiente' || estado === 'todos') {
      // ðŸ“… MESES A REVISAR:
      // Si el admin seleccionÃ³ un mes especÃ­fico â†’ solo ese mes (comportamiento original).
      // Si no seleccionÃ³ mes (campo vacÃ­o = "Todos los meses") â†’ busca en TODOS los meses
      // desde el inicio de operaciones (abril 2026) hasta el mes actual, para que el admin
      // pueda ver los alumnos que deben de meses anteriores sin tener que filtrar uno a uno.
      const MESES_ORDEN = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const MES_INICIO_OPERACIONES = 'abril'; // Primer mes de pagos del sistema

      let mesesABuscar;
      if (mes) {
        // Mes especÃ­fico seleccionado â†’ comportamiento original
        mesesABuscar = [mes];
      } else {
        // Sin mes seleccionado â†’ buscar desde abril hasta el mes actual
        const idxInicio = MESES_ORDEN.indexOf(MES_INICIO_OPERACIONES);
        const mesActualNorm = mesActual.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const idxActual = MESES_ORDEN.findIndex(m => m.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === mesActualNorm);
        const idxFin = idxActual >= 0 ? idxActual : MESES_ORDEN.length - 1;
        mesesABuscar = MESES_ORDEN.slice(idxInicio, idxFin + 1);
      }

      // Ejecutar la query de "sin pago" para cada mes a revisar
      const todasFaltantes = []; // { ...alumno, _mes, _mIdx }

      for (let mIdx = 0; mIdx < mesesABuscar.length; mIdx++) {
        const mesRevision = mesesABuscar[mIdx];
        const esSeptiembre = (mesRevision === 'septiembre' || mesRevision === 'setiembre');
        const pendienteParamsMes = esSeptiembre ? [filtroAnio] : [mesRevision, filtroAnio];
        
        // Calcular el Ãºltimo dÃ­a del mes en revisiÃ³n para filtrar por fecha de inscripciÃ³n
        const mesNumero = MESES_ORDEN.indexOf(mesRevision) + 1;
        const ultimoDiaMes = new Date(filtroAnio, mesNumero, 0); // dÃ­a 0 del mes siguiente = Ãºltimo dÃ­a del mes actual
        const fechaLimite = `${filtroAnio}-${String(mesNumero).padStart(2, '0')}-${String(ultimoDiaMes.getDate()).padStart(2, '0')} 23:59:59`;

        let pendientesQuery = `
          SELECT a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno,
                 a.telefono, a.telefono_apoderado
          FROM alumnos a
          JOIN inscripciones i ON i.alumno_id = a.alumno_id AND i.estado IN ('activa','pendiente')`;

        // âš ï¸ Los JOINs de filtro van ANTES del LEFT JOIN para que MySQL no los ignore
        if (deporte || grupo) {
          pendientesQuery += ' JOIN deportes d ON i.deporte_id = d.deporte_id';
        }
        if (grupo) {
          pendientesQuery += ' JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id' +
                             ' JOIN horarios h ON h.horario_id = ih.horario_id';
        }

        // LEFT JOIN al final â€” asÃ­ pm.pago_id IS NULL funciona correctamente
        if (esSeptiembre) {
          pendientesQuery += ` LEFT JOIN pagos_mensuales pm ON pm.alumno_id = a.alumno_id AND LOWER(pm.mes) IN ('septiembre', 'setiembre') AND pm.\`${colYear}\` = ?`;
        } else {
          pendientesQuery += ` LEFT JOIN pagos_mensuales pm ON pm.alumno_id = a.alumno_id AND pm.mes = ? AND pm.\`${colYear}\` = ?`;
        }

        pendientesQuery += ' WHERE pm.pago_id IS NULL AND i.created_at <= ?';
        pendienteParamsMes.push(fechaLimite);

        if (deporte) {
          pendientesQuery += ' AND UPPER(d.nombre) = UPPER(?)';
          pendienteParamsMes.push(deporte);
        }
        if (grupo) {
          pendientesQuery += ' AND h.categoria = ?';
          pendienteParamsMes.push(grupo);
        }
        if (buscar) {
          pendientesQuery += ' AND (a.dni LIKE ? OR a.nombres LIKE ? OR a.apellido_paterno LIKE ? OR a.apellido_materno LIKE ?)';
          const like = `%${buscar}%`;
          pendienteParamsMes.push(like, like, like, like);
        }
        pendientesQuery += ' GROUP BY a.alumno_id';

        const [sinPagoMes] = await db.query(pendientesQuery, pendienteParamsMes);

        sinPagoMes.forEach(row => {
          todasFaltantes.push({ ...row, _mes: mesRevision, _mIdx: mIdx });
        });
      }

      if (todasFaltantes.length > 0) {
        // Obtener montos solo una vez para todos los alumnos Ãºnicos
        const alumnoIdsUnicos = [...new Set(todasFaltantes.map(r => r.alumno_id))];
        const placeholders = alumnoIdsUnicos.map(() => '?').join(',');
        const montoParams = [...alumnoIdsUnicos];
        let montoQuery = `
          SELECT i.alumno_id, SUM(i.precio_mensual) AS monto
          FROM inscripciones i
          JOIN deportes d ON i.deporte_id = d.deporte_id
          WHERE i.alumno_id IN (${placeholders}) AND i.estado IN ('activa','pendiente')`;
        if (deporte) {
          montoQuery += ' AND UPPER(d.nombre) = UPPER(?)';
          montoParams.push(deporte);
        }
        montoQuery += ' GROUP BY i.alumno_id';

        const [montos] = await db.query(montoQuery, montoParams);
        const montoMap = {};
        montos.forEach(row => { montoMap[row.alumno_id] = parseFloat(row.monto || 0); });

        // Crear una fila virtual por cada alumnoÃ—mes faltante.
        // El pago_id virtual usa -(alumnoId * 100 + mIdx) para ser Ãºnico entre meses.
        const faltantes = todasFaltantes.map(row => ({
          pago_id: -(row.alumno_id * 100 + row._mIdx),
          alumno_id: row.alumno_id,
          dni: row.dni,
          nombres: row.nombres,
          apellidos: `${row.apellido_paterno} ${row.apellido_materno}`,
          telefono: row.telefono,
          telefono_apoderado: row.telefono_apoderado,
          mes: row._mes,
          [colYear]: filtroAnio,
          aÃ±o: filtroAnio,
          monto: montoMap[row.alumno_id] || 0,
          estado: 'pendiente',
          comprobante_url: null,
          fecha_pago: null,
          created_at: null,
          es_sin_pago: true
        }));

        pagos = pagos.concat(faltantes);
      }
    }

    // Filtrar por aÃ±o en JS (evita problemas de encoding con la columna Ã±)
    if (anio) {
      pagos = pagos.filter(p => {
        const val = Object.values(p).find((v, i) => Object.keys(p)[i].length <= 4 && typeof v === 'number' && v > 2000 && v < 2100);
        return val == anio;
      });
    }

    // Agregar deportes inscritos con precios a cada pago
    const alumnoIds = [...new Set(pagos.map(p => p.alumno_id))];
    const phAlumnos = alumnoIds.map(() => '?').join(',');
    let deportesPorAlumno = {};
    if (alumnoIds.length > 0) {
      const [inscDeportes] = await db.query(`
        SELECT i.inscripcion_id, i.alumno_id, d.nombre as deporte, i.precio_mensual, i.estado as estado_inscripcion
        FROM inscripciones i
        JOIN deportes d ON i.deporte_id = d.deporte_id
        WHERE i.alumno_id IN (${phAlumnos})
        ORDER BY d.nombre
      `, alumnoIds);
      inscDeportes.forEach(row => {
        if (!deportesPorAlumno[row.alumno_id]) deportesPorAlumno[row.alumno_id] = [];
        deportesPorAlumno[row.alumno_id].push({
          inscripcion_id: row.inscripcion_id,
          deporte: row.deporte,
          precio: parseFloat(row.precio_mensual || 0),
          estado: row.estado_inscripcion
        });
      });
    }

    const asistenciasPorAlumno = {};
    if (alumnoIds.length > 0) {
      const [asistenciaRows] = await db.query(`
        SELECT ast.alumno_id,
               sub.max_fecha AS ultima_fecha,
               MAX(CASE WHEN ast.fecha = sub.max_fecha THEN ast.presente ELSE NULL END) AS ultimo_presente,
               SUM(ast.presente = 1) AS total_presentes,
               SUM(ast.presente = 0) AS total_ausentes,
               COUNT(*) AS total_registros
        FROM asistencias ast
        JOIN (
          SELECT alumno_id, MAX(fecha) AS max_fecha
          FROM asistencias
          WHERE alumno_id IN (${phAlumnos})
          GROUP BY alumno_id
        ) sub ON ast.alumno_id = sub.alumno_id
        GROUP BY ast.alumno_id, sub.max_fecha
      `, alumnoIds);

      asistenciaRows.forEach(row => {
        asistenciasPorAlumno[row.alumno_id] = {
          total_registros: row.total_registros || 0,
          total_presentes: row.total_presentes || 0,
          total_ausentes: row.total_ausentes || 0,
          ultima_fecha: row.ultima_fecha ? new Date(row.ultima_fecha).toISOString().split('T')[0] : null,
          ultimo_presente: row.ultimo_presente === 1
        };
      });
    }

    pagos.forEach(p => {
      p.deportes_inscritos = deportesPorAlumno[p.alumno_id] || [];
      p.asistencia_resumen = asistenciasPorAlumno[p.alumno_id] || {
        total_registros: 0,
        total_presentes: 0,
        total_ausentes: 0,
        ultima_fecha: null,
        ultimo_presente: null
      };
    });

    res.json({ success: true, pagos });
  } catch (error) {
    console.error('âŒ Error al listar pagos mensuales:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/pagos-mensuales/:id/confirmar
 * Confirmar un pago mensual
 */
app.put('/api/admin/pagos-mensuales/:id/confirmar', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { observaciones, monto, deportes_pendientes } = req.body;

    const [pago] = await db.query('SELECT pago_id, alumno_id, mes, estado FROM pagos_mensuales WHERE pago_id = ?', [id]);
    if (pago.length === 0) {
      return res.status(404).json({ success: false, error: 'Pago no encontrado' });
    }

    let updateQuery = `UPDATE pagos_mensuales SET estado = 'confirmado', fecha_pago = COALESCE(fecha_pago, NOW()), observaciones = COALESCE(?, observaciones)`;
    const updateParams = [observaciones || null];
    
    // Si se envÃ­a un monto ajustado, actualizar tambiÃ©n
    if (monto !== undefined && monto !== null) {
      updateQuery += `, monto = ?`;
      updateParams.push(parseFloat(monto));
    }
    
    updateQuery += ` WHERE pago_id = ?`;
    updateParams.push(id);

    await db.query(updateQuery, updateParams);

    // Si hay deportes pendientes, crear pago pendiente separado para ellos
    if (deportes_pendientes && deportes_pendientes.length > 0) {
      const montoPendiente = deportes_pendientes.reduce((sum, d) => sum + parseFloat(d.precio || 0), 0);
      const nombresPendientes = deportes_pendientes.map(d => d.deporte).join(', ');
      const colYear = global.COL_ANIO || 'a\u00f1o'; // 'aÃ±o' â€” fallback unicode-safe
      // Obtener el aÃ±o del pago original
      const [pagoOriginal] = await db.query('SELECT `' + colYear + '` as anio_val FROM pagos_mensuales WHERE pago_id = ?', [id]);
      const anioVal = pagoOriginal[0]?.anio_val || new Date().getFullYear();
      
      await db.query(
        'INSERT INTO pagos_mensuales (alumno_id, mes, `' + colYear + '`, monto, estado, observaciones, metodo_pago, created_at)' +
        " VALUES (?, ?, ?, ?, 'pendiente', ?, 'Pendiente de pago', NOW())",
        [pago[0].alumno_id, pago[0].mes, anioVal, montoPendiente, `Pendiente: ${nombresPendientes}`]
      );
      console.log(`ðŸŸ¡ Pago pendiente creado para ${nombresPendientes} (S/ ${montoPendiente.toFixed(2)})`);
    }

    res.json({ success: true, mensaje: 'Pago mensual confirmado' });
  } catch (error) {
    console.error('âŒ Error al confirmar pago mensual:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/pagos-mensuales/:id/rechazar
 * Rechazar un pago mensual
 */
app.put('/api/admin/pagos-mensuales/:id/rechazar', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { observaciones } = req.body;

    const [pago] = await db.query('SELECT pago_id, estado FROM pagos_mensuales WHERE pago_id = ?', [id]);
    if (pago.length === 0) {
      return res.status(404).json({ success: false, error: 'Pago no encontrado' });
    }

    await db.query(
      `UPDATE pagos_mensuales SET estado = 'rechazado', observaciones = COALESCE(?, observaciones) WHERE pago_id = ?`,
      [observaciones || 'Rechazado por administrador', id]
    );

    res.json({ success: true, mensaje: 'Pago mensual rechazado' });
  } catch (error) {
    console.error('âŒ Error al rechazar pago mensual:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/pagos-mensuales/:id/observaciones
 * Agregar o editar observaciones de un pago mensual
 */
app.put('/api/admin/pagos-mensuales/:id/observaciones', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { observaciones } = req.body;

    const [pago] = await db.query('SELECT pago_id FROM pagos_mensuales WHERE pago_id = ?', [id]);
    if (pago.length === 0) {
      return res.status(404).json({ success: false, error: 'Pago no encontrado' });
    }

    await db.query('UPDATE pagos_mensuales SET observaciones = ? WHERE pago_id = ?', [observaciones || null, id]);

    res.json({ success: true, mensaje: 'ObservaciÃ³n guardada' });
  } catch (error) {
    console.error('âŒ Error al guardar observaciÃ³n:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/pagos-mensuales/:id/monto
 * Editar manualmente el monto de un pago mensual
 */
/**
 * PUT /api/admin/pagos-mensuales/:id/comprobante
 * Actualizar comprobante o nÃºmero de operaciÃ³n de un pago mensual
 */
app.put('/api/admin/pagos-mensuales/:id/comprobante', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { comprobante_url, numero_operacion } = req.body;

    await db.query(
      'UPDATE pagos_mensuales SET comprobante_url = COALESCE(?, comprobante_url), numero_operacion = COALESCE(?, numero_operacion) WHERE pago_id = ?',
      [comprobante_url || null, numero_operacion || null, id]
    );

    res.json({ success: true, mensaje: 'Comprobante actualizado correctamente' });
  } catch (error) {
    console.error('âŒ Error al actualizar comprobante mensual:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/pagos-mensuales/:id/monto', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { monto } = req.body;

    if (monto === undefined || monto === null || isNaN(parseFloat(monto)) || parseFloat(monto) < 0) {
      return res.status(400).json({ success: false, error: 'Monto invÃ¡lido' });
    }

    const [pago] = await db.query('SELECT pago_id FROM pagos_mensuales WHERE pago_id = ?', [id]);
    if (pago.length === 0) {
      return res.status(404).json({ success: false, error: 'Pago no encontrado' });
    }

    await db.query('UPDATE pagos_mensuales SET monto = ? WHERE pago_id = ?', [parseFloat(monto), id]);

    res.json({ success: true, mensaje: 'Monto actualizado' });
  } catch (error) {
    console.error('âŒ Error al actualizar monto:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/alumno/toggle-deporte
 * Pausar o reactivar un deporte inscrito
 */
app.post('/api/alumno/toggle-deporte', async (req, res) => {
  try {
    const { dni, inscripcion_id, accion } = req.body;
    
    if (!dni || !inscripcion_id || !accion) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos. Se requiere: dni, inscripcion_id y accion'
      });
    }
    
    if (!['pausar', 'reactivar'].includes(accion)) {
      return res.status(400).json({
        success: false,
        error: 'AcciÃ³n invÃ¡lida. Use: pausar o reactivar'
      });
    }
    
    // Verificar que el alumno existe
    const [alumnos] = await db.query(
      'SELECT alumno_id FROM alumnos WHERE dni = ?',
      [dni]
    );
    
    if (alumnos.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alumno no encontrado'
      });
    }
    
    const alumnoId = alumnos[0].alumno_id;
    
    // Verificar que la inscripciÃ³n pertenece al alumno
    const [inscripciones] = await db.query(
      'SELECT inscripcion_id, estado FROM inscripciones WHERE inscripcion_id = ? AND alumno_id = ?',
      [inscripcion_id, alumnoId]
    );
    
    if (inscripciones.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'InscripciÃ³n no encontrada o no pertenece al alumno'
      });
    }
    
    const estadoActual = inscripciones[0].estado;
    const nuevoEstado = accion === 'pausar' ? 'suspendida' : 'activa';
    
    // Validar transiciÃ³n de estado
    if (accion === 'pausar' && estadoActual !== 'activa') {
      return res.status(400).json({
        success: false,
        error: 'Solo se pueden pausar inscripciones activas'
      });
    }
    
    if (accion === 'reactivar' && estadoActual !== 'suspendida') {
      return res.status(400).json({
        success: false,
        error: 'Solo se pueden reactivar inscripciones suspendidas'
      });
    }
    
    // Actualizar estado de la inscripciÃ³n
    await db.query(
      'UPDATE inscripciones SET estado = ? WHERE inscripcion_id = ?',
      [nuevoEstado, inscripcion_id]
    );
    
    console.log(`âœ… InscripciÃ³n ${inscripcion_id} ${accion === 'pausar' ? 'pausada' : 'reactivada'} para DNI ${dni}`);
    
    // Invalidar cachÃ©
    invalidateDNICache(dni);
    
    res.json({
      success: true,
      message: `Deporte ${accion === 'pausar' ? 'pausado' : 'reactivado'} exitosamente`,
      nuevo_estado: nuevoEstado
    });
    
  } catch (error) {
    console.error('âŒ Error al toggle deporte:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al cambiar estado del deporte'
    });
  }
});

/**
 * POST /api/alumno/cancelar-deporte
 * Cancelar (dejar) un deporte inscrito â€” elimina la inscripciÃ³n y libera los horarios
 */
app.post('/api/alumno/cancelar-deporte', async (req, res) => {
  try {
    const { dni, inscripcion_id } = req.body;

    if (!dni || !inscripcion_id) {
      return res.status(400).json({ success: false, error: 'Datos incompletos. Se requiere: dni e inscripcion_id' });
    }
    if (!db) return res.status(503).json({ success: false, error: 'Base de datos no disponible' });

    // Verificar alumno
    const [alumnos] = await db.query('SELECT alumno_id FROM alumnos WHERE dni = ?', [dni]);
    if (alumnos.length === 0) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }
    const alumnoId = alumnos[0].alumno_id;

    // Verificar inscripciÃ³n pertenece al alumno y estÃ¡ activa o suspendida
    const [inscRows] = await db.query(`
      SELECT i.inscripcion_id, i.estado, d.nombre as deporte
      FROM inscripciones i
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.inscripcion_id = ? AND i.alumno_id = ? AND i.estado IN ('activa', 'suspendida')
    `, [inscripcion_id, alumnoId]);

    if (inscRows.length === 0) {
      return res.status(404).json({ success: false, error: 'InscripciÃ³n no encontrada o no se puede cancelar' });
    }

    const deporte = inscRows[0].deporte;

    // Contar cuÃ¡ntos horarios se liberan
    const [horarios] = await db.query('SELECT COUNT(*) as total FROM inscripcion_horarios WHERE inscripcion_id = ?', [inscripcion_id]);
    const diasLiberados = horarios[0].total;

    // Eliminar horarios asignados
    await db.query('DELETE FROM inscripcion_horarios WHERE inscripcion_id = ?', [inscripcion_id]);

    // Cambiar estado a cancelada
    await db.query("UPDATE inscripciones SET estado = 'cancelada' WHERE inscripcion_id = ?", [inscripcion_id]);

    // Invalidar cachÃ©
    invalidateDNICache(dni);

    console.log(`ðŸ—‘ï¸ InscripciÃ³n ${inscripcion_id} (${deporte}) cancelada para DNI ${dni}. ${diasLiberados} horarios liberados.`);

    res.json({
      success: true,
      message: `Has dejado ${deporte} correctamente`,
      deporte,
      dias_liberados: diasLiberados
    });

  } catch (error) {
    console.error('âŒ Error al cancelar deporte:', error);
    res.status(500).json({ success: false, error: error.message || 'Error al cancelar el deporte' });
  }
});

// ==================== ENDPOINTS ADMINISTRACIÃ“N ====================

// ==================== ENDPOINTS ADMINISTRACIÃ“N ====================

// Login de administrador con JWT y bcrypt
app.post('/api/admin/login', rateLimiterLogin, async (req, res) => {
  try {
    const { usuario, email, password, contrasena } = req.body;
    
    // Aceptar tanto 'password' como 'contrasena' y 'usuario' o 'email'
    const passwordInput = password || contrasena;
    const userInput = usuario || email;
    
    if (!userInput || !passwordInput) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos',
        message: 'Usuario/Email y contraseÃ±a son requeridos'
      });
    }
    
    // Buscar administrador en base de datos por usuario O email
    const [admins] = await db.query(
      'SELECT * FROM administradores WHERE (usuario = ? OR email = ?) AND estado = ?',
      [userInput, userInput, 'activo']
    );
    
    if (admins.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales invÃ¡lidas',
        message: 'Usuario/Email o contraseÃ±a incorrectos'
      });
    }
    
    const admin = admins[0];
    
    // Verificar si estÃ¡ bloqueado
    if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
      return res.status(423).json({
        success: false,
        error: 'Cuenta bloqueada',
        message: 'Demasiados intentos fallidos. Intente mÃ¡s tarde.'
      });
    }
    
    // Verificar contraseÃ±a
    const passwordMatch = await bcrypt.compare(passwordInput, admin.password_hash);
    
    if (!passwordMatch) {
      // Incrementar intentos fallidos
      await db.query(
        'UPDATE administradores SET failed_login_attempts = failed_login_attempts + 1 WHERE admin_id = ?',
        [admin.admin_id]
      );
      
      // Bloquear si supera 5 intentos
      if (admin.failed_login_attempts >= 4) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
        await db.query(
          'UPDATE administradores SET locked_until = ? WHERE admin_id = ?',
          [lockUntil, admin.admin_id]
        );
      }
      
      return res.status(401).json({
        success: false,
        error: 'Credenciales invÃ¡lidas',
        message: 'Usuario/Email o contraseÃ±a incorrectos'
      });
    }
    
    // Login exitoso - resetear intentos y actualizar Ãºltimo acceso
    await db.query(
      'UPDATE administradores SET failed_login_attempts = 0, locked_until = NULL, ultimo_acceso = NOW() WHERE admin_id = ?',
      [admin.admin_id]
    );
    
    // Generar token JWT
    const token = generarToken({
      administrador_id: admin.admin_id,
      username: admin.usuario,
      nombre_completo: admin.nombre_completo,
      rol: admin.rol
    });
    
    res.json({
      success: true,
      token,
      admin: {
        id: admin.admin_id,
        usuario: admin.usuario,
        email: admin.email,
        nombre: admin.nombre_completo,
        rol: admin.rol
      },
      message: 'Login exitoso'
    });
  } catch (error) {
    console.error('âŒ Error en login admin:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error en el servidor',
      message: 'Error al procesar login'
    });
  }
});

/**
 * GET /api/configuracion/matricula_activa
 * Endpoint pÃºblico para que el frontend verifique si se cobra matrÃ­cula
 */
app.get('/api/configuracion/matricula_activa', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT valor FROM configuracion WHERE clave = 'matricula_activa' LIMIT 1"
    );
    let activa = true;
    if (rows.length > 0) {
      const v = rows[0].valor;
      activa = (v === 'true' || v === true || v === 1 || v === '1');
    }
    res.json({ success: true, valor: activa });
  } catch (error) {
    console.error('Error al obtener matricula_activa:', error);
    res.json({ success: true, valor: true }); // Por defecto activa si hay error
  }
});

/**
 * GET /api/admin/configuracion
 * Obtener todas las configuraciones del sistema
 */
app.get('/api/admin/configuracion', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const [configuraciones] = await db.query('SELECT * FROM configuracion');
    
    // Convertir valores booleanos
    const configParsed = configuraciones.map(c => ({
      ...c,
      valor: c.valor === 'true' ? true : c.valor === 'false' ? false : c.valor
    }));
    
    res.json({
      success: true,
      configuraciones: configParsed
    });
  } catch (error) {
    console.error('âŒ Error al obtener configuraciÃ³n:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener configuraciÃ³n'
    });
  }
});

/**
 * PUT /api/admin/configuracion/:clave
 * Actualizar una configuraciÃ³n especÃ­fica
 */
app.put('/api/admin/configuracion/:clave', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { clave } = req.params;
    const { valor } = req.body;
    
    if (valor === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere el campo valor'
      });
    }
    
    // Convertir booleano a string
    const valorStr = typeof valor === 'boolean' ? valor.toString() : valor;
    
    const [result] = await db.query(
      'UPDATE configuracion SET valor = ? WHERE clave = ?',
      [valorStr, clave]
    );
    
    if (result.affectedRows === 0) {
      // Si no existe, crear
      await db.query(
        'INSERT INTO configuracion (clave, valor) VALUES (?, ?)',
        [clave, valorStr]
      );
    }
    
    console.log(`âœ… ConfiguraciÃ³n actualizada: ${clave} = ${valorStr}`);
    
    res.json({
      success: true,
      message: 'ConfiguraciÃ³n actualizada',
      clave,
      valor: valor
    });
  } catch (error) {
    console.error('âŒ Error al actualizar configuraciÃ³n:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar configuraciÃ³n'
    });
  }
});

// Obtener todos los inscritos (PROTEGIDO)
app.get('/api/admin/inscritos', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    const { dia, deporte, refresh } = req.query;
    
    // Crear clave de cachÃ© Ãºnica basada en los filtros
    const cacheKey = `inscritos_${dia || 'all'}_${deporte || 'all'}`;
    
    // Intentar obtener del cachÃ©
    const cachedData = cache.get(cacheKey);
    if (cachedData && refresh !== 'true') {
      console.log(`âš¡ CACHÃ‰ HIT: ${cacheKey}`);
      return res.json(cachedData);
    }
    
    console.log(`ðŸŒ CACHÃ‰ MISS: ${cacheKey} - Consultando MySQL`);
    
    // ==================== CONSULTAR DESDE MYSQL ====================
    if (db) {
      try {
        let query = `
          SELECT DISTINCT
            a.alumno_id,
            a.dni,
            a.nombres,
            a.apellido_paterno,
            a.apellido_materno,
            a.fecha_nacimiento,
            a.sexo,
            a.telefono,
            a.email,
            a.direccion,
            a.apoderado,
            a.telefono_apoderado,
            a.seguro_tipo,
            a.condicion_medica,
            a.estado as estado_usuario,
            a.estado_pago,
            a.monto_pago,
            a.numero_operacion,
            a.fecha_pago,
            a.dni_frontal_url,
            a.dni_reverso_url,
            a.foto_carnet_url,
            a.comprobante_pago_url,
            a.created_at as fecha_registro,
            i.inscripcion_id,
            d.nombre as deporte,
            GROUP_CONCAT(DISTINCT h.categoria SEPARATOR ', ') as categoria,
            GROUP_CONCAT(DISTINCT CONCAT(h.dia, ' ', TIME_FORMAT(h.hora_inicio, '%H:%i'), '-', TIME_FORMAT(h.hora_fin, '%H:%i')) ORDER BY FIELD(h.dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO') SEPARATOR ', ') as horario_completo,
            i.estado as estado_inscripcion
          FROM alumnos a
          INNER JOIN inscripciones i ON a.alumno_id = i.alumno_id
          INNER JOIN deportes d ON i.deporte_id = d.deporte_id
          LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
          LEFT JOIN horarios h ON ih.horario_id = h.horario_id
          WHERE 1=1
        `;
        
        const params = [];
        
        if (dia) {
          query += ` AND h.dia = ?`;
          params.push(dia.toUpperCase());
        }
        
        if (deporte) {
          query += ` AND UPPER(d.nombre) = UPPER(?)`;
          params.push(deporte);
        }
        
        query += ` GROUP BY i.inscripcion_id, a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno, a.fecha_nacimiento, a.sexo, a.telefono, a.email, a.direccion, a.apoderado, a.telefono_apoderado, a.seguro_tipo, a.condicion_medica, a.estado, a.estado_pago, a.monto_pago, a.numero_operacion, a.fecha_pago, a.dni_frontal_url, a.dni_reverso_url, a.foto_carnet_url, a.comprobante_pago_url, a.created_at, d.nombre, i.estado`;
        query += ` ORDER BY a.created_at DESC`;
        
        const [alumnos] = params.length > 0 
          ? await db.execute(query, params)
          : await db.execute(query);
        
        // Mapear resultados
        const alumnosConDatos = alumnos.map(row => ({
          alumno_id: row.alumno_id,
          inscripcion_id: row.inscripcion_id,
          dni: row.dni,
          nombres: row.nombres,
          apellidos: `${row.apellido_paterno || ''} ${row.apellido_materno || ''}`.trim(),
          fecha_nacimiento: row.fecha_nacimiento,
          categoria: row.categoria || null,
          telefono: row.telefono,
          email: row.email,
          deporte: row.deporte,
          horario: row.horario_completo || '-',
          estado_usuario: row.estado_usuario,
          estado: row.estado_inscripcion,
          estado_pago: row.estado_pago,
          fecha_registro: row.fecha_registro,
          foto_carnet_url: row.foto_carnet_url || null,
          dni_frontal_url: row.dni_frontal_url || null,
          numero_operacion: row.numero_operacion || '',
          comprobante_pago_url: row.comprobante_pago_url || null,
          fecha_pago: row.fecha_pago || null,
          monto_pago: row.monto_pago || null
        }));
        
        const data = {
          success: true,
          inscritos: alumnosConDatos,
          total: alumnosConDatos.length,
          filtros: { dia, deporte },
          source: 'mysql'
        };
        
        // Guardar en cachÃ©
        cache.set(cacheKey, data, CACHE_TTL.inscritos);
        console.log(`ðŸ’¾ CACHÃ‰ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.inscritos}s, total: ${alumnosConDatos.length})`);
        
        return res.json(data);
      } catch (mysqlError) {
        console.error('âŒ Error en MySQL:', mysqlError);
        // Continuar con Google Sheets como fallback
      }
    }
    
    // ==================== FALLBACK: GOOGLE SHEETS ====================
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

    // Guardar en cachÃ©
    cache.set(cacheKey, data, CACHE_TTL.inscritos);
    console.log(`ðŸ’¾ CACHÃ‰ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.inscritos}s)`);

    res.json(data);
  } catch (error) {
    console.error('âŒ Error al listar inscritos:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al listar inscritos' 
    });
  }
});

// Cambiar contraseÃ±a del administrador actual (PROTEGIDO)
app.post('/api/admin/cambiar-password', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    const { password_actual, password_nueva } = req.body;
    const adminId = req.user.id; // Cambiado de req.usuario.admin_id a req.user.id

    if (!password_actual || !password_nueva) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere la contraseÃ±a actual y la nueva contraseÃ±a'
      });
    }

    if (password_nueva.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La nueva contraseÃ±a debe tener al menos 6 caracteres'
      });
    }

    // Obtener el admin actual
    const [admins] = await db.query(
      'SELECT password_hash FROM administradores WHERE admin_id = ?',
      [adminId]
    );

    if (admins.length === 0) {
      return res.status(404).json({ success: false, error: 'Administrador no encontrado' });
    }

    // Verificar contraseÃ±a actual
    const passwordMatch = await bcrypt.compare(password_actual, admins[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: 'ContraseÃ±a actual incorrecta' });
    }

    // Generar hash de la nueva contraseÃ±a
    const newPasswordHash = await bcrypt.hash(password_nueva, 10);

    // Actualizar contraseÃ±a
    await db.query(
      'UPDATE administradores SET password_hash = ?, updated_at = NOW() WHERE admin_id = ?',
      [newPasswordHash, adminId]
    );

    res.json({
      success: true,
      message: 'ContraseÃ±a actualizada correctamente'
    });
  } catch (error) {
    console.error('âŒ Error al cambiar contraseÃ±a:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Crear nuevo usuario administrador (PROTEGIDO - Solo super_admin)
app.post('/api/admin/crear-usuario', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    const { usuario, email, password, nombre_completo, rol } = req.body;
    const creadorRol = req.user.role; // Cambiado de req.usuario.rol a req.user.role

    // Solo super_admin puede crear usuarios
    if (creadorRol !== 'super_admin' && creadorRol !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'No tienes permisos para crear usuarios'
      });
    }

    if (!usuario || !email || !password || !nombre_completo) {
      return res.status(400).json({
        success: false,
        error: 'Todos los campos son obligatorios'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La contraseÃ±a debe tener al menos 6 caracteres'
      });
    }

    // Verificar si el usuario o email ya existen
    const [existing] = await db.query(
      'SELECT admin_id FROM administradores WHERE usuario = ? OR email = ?',
      [usuario, email]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'El usuario o email ya estÃ¡n registrados'
      });
    }

    // Hash de la contraseÃ±a
    const passwordHash = await bcrypt.hash(password, 10);

    // Crear usuario
    const [result] = await db.query(
      `INSERT INTO administradores (usuario, password_hash, nombre_completo, email, rol, estado) 
       VALUES (?, ?, ?, ?, ?, 'activo')`,
      [usuario, passwordHash, nombre_completo, email, rol || 'admin']
    );

    res.json({
      success: true,
      message: 'Usuario creado correctamente',
      admin_id: result.insertId
    });
  } catch (error) {
    console.error('âŒ Error al crear usuario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Listar usuarios administradores (PROTEGIDO)
app.get('/api/admin/usuarios', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    const [usuarios] = await db.query(
      `SELECT admin_id, usuario, email, nombre_completo, rol, estado, 
              created_at, ultimo_acceso, failed_login_attempts
       FROM administradores
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      usuarios
    });
  } catch (error) {
    console.error('âŒ Error al listar usuarios:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Eliminar usuario administrador (PROTEGIDO - Solo super_admin)
app.delete('/api/admin/usuarios/:id', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const creadorRol = req.user.role; // Cambiado
    const adminIdActual = req.user.id; // Cambiado

    // Solo super_admin puede eliminar usuarios
    if (creadorRol !== 'super_admin' && creadorRol !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'No tienes permisos para eliminar usuarios'
      });
    }

    // No puede eliminarse a sÃ­ mismo
    if (parseInt(id) === adminIdActual) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar tu propia cuenta'
      });
    }

    await db.query('DELETE FROM administradores WHERE admin_id = ?', [id]);

    res.json({
      success: true,
      message: 'Usuario eliminado correctamente'
    });
  } catch (error) {
    console.error('âŒ Error al eliminar usuario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener estadÃ­sticas financieras detalladas (PROTEGIDO)
app.get('/api/admin/estadisticas-financieras', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    // CALCULAR DIRECTAMENTE DESDE MYSQL PARA PRECISIÃ“N EXACTA
    if (!db) {
      throw new Error('Base de datos no disponible');
    }

    // 1. RESUMEN GENERAL - Solo inscripciones activas
    // MATRÃCULA: S/ 20.00 por cada inscripciÃ³n activa (sin importar matricula_pagada)
    const [resumenGeneral] = await db.query(`
      SELECT 
        COUNT(DISTINCT i.alumno_id) as total_alumnos_activos,
        COUNT(i.inscripcion_id) as total_inscripciones_activas,
        SUM(CASE WHEN i.matricula_pagada = 1 THEN d.matricula ELSE 0 END) as total_matriculas,
        SUM(i.precio_mensual) as total_mensualidades,
        SUM(CASE WHEN i.matricula_pagada = 1 THEN d.matricula ELSE 0 END) + SUM(i.precio_mensual) as total_ingresos
      FROM inscripciones i
      INNER JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.estado = 'activa'
    `);

    // 2. INGRESOS DEL MES ACTUAL - Combina mensualidades confirmadas en pagos_mensuales y nuevas inscripciones
    const colYear = global.COL_ANIO || 'aÃ±o';
    const [mesPagosMensuales] = await db.query(`
      SELECT COALESCE(SUM(pm.monto), 0) as total_pm_mes
      FROM pagos_mensuales pm
      WHERE pm.estado = 'confirmado'
        AND (
          (MONTH(pm.fecha_pago) = MONTH(CURRENT_DATE()) AND YEAR(pm.fecha_pago) = YEAR(CURRENT_DATE()))
          OR (pm.mes IN ('septiembre', 'setiembre') AND pm.\`${colYear}\` = YEAR(CURRENT_DATE()))
        )
    `);

    const [mesInscripcionesNuevas] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN i.matricula_pagada = 1 THEN d.matricula ELSE 0 END), 0) as matriculas_mes,
        COALESCE(SUM(i.precio_mensual), 0) as mensualidades_insc_mes
      FROM inscripciones i
      INNER JOIN deportes d ON i.deporte_id = d.deporte_id
      INNER JOIN alumnos a ON i.alumno_id = a.alumno_id
      WHERE i.estado = 'activa'
        AND (
          (MONTH(COALESCE(a.fecha_pago, i.fecha_inscripcion)) = MONTH(CURRENT_DATE()) AND YEAR(COALESCE(a.fecha_pago, i.fecha_inscripcion)) = YEAR(CURRENT_DATE()))
        )
        AND NOT EXISTS (
          SELECT 1 FROM pagos_mensuales pm 
          WHERE pm.alumno_id = a.alumno_id 
            AND pm.estado = 'confirmado' 
            AND (MONTH(pm.fecha_pago) = MONTH(CURRENT_DATE()) AND YEAR(pm.fecha_pago) = YEAR(CURRENT_DATE()))
        )
    `);

    const totalMensualidadesMes = parseFloat(mesPagosMensuales[0]?.total_pm_mes || 0) + parseFloat(mesInscripcionesNuevas[0]?.mensualidades_insc_mes || 0);
    const totalMatriculasMes = parseFloat(mesInscripcionesNuevas[0]?.matriculas_mes || 0);

    // 3. INGRESOS DE HOY - Mensualidades confirmadas hoy + inscripciones activadas hoy
    const [hoyPagosMensuales] = await db.query(`
      SELECT COALESCE(SUM(pm.monto), 0) as total_pm_hoy
      FROM pagos_mensuales pm
      WHERE pm.estado = 'confirmado'
        AND DATE(pm.fecha_pago) = CURRENT_DATE()
    `);

    const [hoyInscripciones] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN i.matricula_pagada = 1 THEN d.matricula ELSE 0 END), 0) as matriculas_hoy,
        COALESCE(SUM(i.precio_mensual), 0) as mensualidades_insc_hoy
      FROM inscripciones i
      INNER JOIN deportes d ON i.deporte_id = d.deporte_id
      INNER JOIN alumnos a ON i.alumno_id = a.alumno_id
      WHERE i.estado = 'activa'
        AND a.estado_pago = 'confirmado'
        AND (DATE(a.fecha_pago) = CURRENT_DATE() OR DATE(i.fecha_inscripcion) = CURRENT_DATE())
        AND NOT EXISTS (
          SELECT 1 FROM pagos_mensuales pm 
          WHERE pm.alumno_id = a.alumno_id 
            AND pm.estado = 'confirmado' 
            AND DATE(pm.fecha_pago) = CURRENT_DATE()
        )
    `);

    const totalMensualidadesHoy = parseFloat(hoyPagosMensuales[0]?.total_pm_hoy || 0) + parseFloat(hoyInscripciones[0]?.mensualidades_insc_hoy || 0);
    const totalMatriculasHoy = parseFloat(hoyInscripciones[0]?.matriculas_hoy || 0);

    // Desglose mensual por mes/deporte
    let desgloseMensual = [];
    try {
      const [desglose] = await db.query(`
        SELECT 
          pm.mes,
          pm.\`${colYear}\` as anio,
          COALESCE(d.nombre, 'General') as deporte,
          COUNT(DISTINCT pm.pago_id) as cantidad_pagos,
          SUM(pm.monto) as total_recaudado
        FROM pagos_mensuales pm
        LEFT JOIN alumnos a ON pm.alumno_id = a.alumno_id
        LEFT JOIN inscripciones i ON i.alumno_id = a.alumno_id AND i.estado = 'activa'
        LEFT JOIN deportes d ON i.deporte_id = d.deporte_id
        WHERE pm.estado = 'confirmado'
        GROUP BY pm.mes, pm.\`${colYear}\`, d.nombre
        ORDER BY anio DESC
      `);
      desgloseMensual = desglose;
    } catch (errDesglose) {
      console.warn('âš ï¸ No se pudo generar desglose mensual:', errDesglose.message);
    }

    // 4. ESTADÃSTICAS POR DEPORTE - Solo inscripciones activas
    const [porDeporte] = await db.query(`
      SELECT 
        d.nombre as deporte,
        COUNT(i.inscripcion_id) as total_inscritos,
        SUM(CASE WHEN i.matricula_pagada = 1 THEN d.matricula ELSE 0 END) as matriculas,
        SUM(i.precio_mensual) as mensualidades,
        SUM(CASE WHEN i.matricula_pagada = 1 THEN d.matricula ELSE 0 END) + SUM(i.precio_mensual) as total
      FROM deportes d
      LEFT JOIN inscripciones i ON d.deporte_id = i.deporte_id AND i.estado = 'activa'
      WHERE d.estado = 'activo'
      GROUP BY d.deporte_id, d.nombre
      ORDER BY total DESC
    `);

    // 5. ESTADÃSTICAS POR ALUMNO (TOP 20) - Solo con inscripciones activas
    const [porAlumno] = await db.query(`
      SELECT 
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) as nombres,
        a.telefono,
        COUNT(i.inscripcion_id) as cantidad_deportes,
        GROUP_CONCAT(DISTINCT d.nombre ORDER BY d.nombre SEPARATOR ', ') as deportes,
        SUM(CASE WHEN i.matricula_pagada = 1 THEN dep.matricula ELSE 0 END) as matriculas,
        SUM(i.precio_mensual) as mensualidades,
        SUM(CASE WHEN i.matricula_pagada = 1 THEN dep.matricula ELSE 0 END) + SUM(i.precio_mensual) as total
      FROM alumnos a
      INNER JOIN inscripciones i ON a.alumno_id = i.alumno_id
      INNER JOIN deportes dep ON i.deporte_id = dep.deporte_id
      LEFT JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE a.estado = 'activo' AND i.estado = 'activa'
      GROUP BY a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno, a.telefono
      ORDER BY total DESC
      LIMIT 20
    `);

    // Construir respuesta con valores seguros (evitar null)
    const resumen = resumenGeneral[0];

    const estadisticas = {
      resumen: {
        totalAlumnosActivos: parseInt(resumen.total_alumnos_activos) || 0,
        totalInscripcionesActivas: parseInt(resumen.total_inscripciones_activas) || 0,
        totalMatriculas: parseFloat(resumen.total_matriculas) || 0,
        totalMensualidades: parseFloat(resumen.total_mensualidades) || 0,
        totalIngresosActivos: parseFloat(resumen.total_ingresos) || 0,
        ingresosMes: totalMatriculasMes + totalMensualidadesMes,
        ingresosHoy: totalMatriculasHoy + totalMensualidadesHoy
      },
      porDeporte: porDeporte.map(d => ({
        deporte: d.deporte,
        totalInscritos: parseInt(d.total_inscritos) || 0,
        matriculas: parseFloat(d.matriculas) || 0,
        mensualidades: parseFloat(d.mensualidades) || 0,
        total: parseFloat(d.total) || 0
      })),
      desgloseMensual: desgloseMensual || [],
      porAlumno: porAlumno.map(a => ({
        dni: a.dni,
        nombres: a.nombres,
        telefono: a.telefono || '',
        cantidadDeportes: parseInt(a.cantidad_deportes) || 0,
        deportes: a.deportes ? a.deportes.split(', ') : [],
        matriculas: parseFloat(a.matriculas) || 0,
        mensualidades: parseFloat(a.mensualidades) || 0,
        total: parseFloat(a.total) || 0
      })),
      timestamp: new Date().toISOString()
    };

    console.log('ðŸ“Š EstadÃ­sticas financieras calculadas:', {
      alumnos: estadisticas.resumen.totalAlumnosActivos,
      inscripciones: estadisticas.resumen.totalInscripcionesActivas,
      ingresos: `S/ ${estadisticas.resumen.totalIngresosActivos.toFixed(2)}`
    });

    res.json({
      success: true,
      estadisticas
    });

  } catch (error) {
    console.error('âŒ Error al obtener estadÃ­sticas financieras:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al obtener estadÃ­sticas' 
    });
  }
});

// ==================== FIN ENDPOINTS ADMINISTRACIÃ“N ====================

// Endpoint: Obtener inscripciones activas de un alumno por DNI (para modal de desactivaciÃ³n selectiva)
app.get('/api/admin/inscripciones-alumno/:dni', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { dni } = req.params;
    if (!dni || dni.length < 8) {
      return res.status(400).json({ success: false, error: 'DNI invÃ¡lido' });
    }

    const [alumnoRows] = await db.query('SELECT alumno_id, nombres, apellido_paterno, apellido_materno, estado FROM alumnos WHERE dni = ?', [dni]);
    if (alumnoRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }

    const alumno = alumnoRows[0];
    const nombreCompleto = `${alumno.nombres} ${alumno.apellido_paterno || ''} ${alumno.apellido_materno || ''}`.trim();

    const [inscripciones] = await db.query(`
      SELECT i.inscripcion_id, d.nombre as deporte, i.plan, i.precio_mensual, i.estado,
             GROUP_CONCAT(DISTINCT CONCAT(h.dia, ' ', TIME_FORMAT(h.hora_inicio, '%H:%i'), '-', TIME_FORMAT(h.hora_fin, '%H:%i')) ORDER BY FIELD(h.dia, 'LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO') SEPARATOR ', ') as horarios
      FROM inscripciones i
      JOIN deportes d ON i.deporte_id = d.deporte_id
      LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE i.alumno_id = ? AND i.estado IN ('activa', 'pendiente')
      GROUP BY i.inscripcion_id
    `, [alumno.alumno_id]);

    res.json({ success: true, nombre: nombreCompleto, estado_alumno: alumno.estado, inscripciones });
  } catch (error) {
    console.error('Error al obtener inscripciones del alumno:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint: Desactivar inscripciones selectivas (por inscripcion_id)
app.post('/api/admin/desactivar-inscripciones', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { dni, inscripcion_ids } = req.body;

    if (!dni || !inscripcion_ids || !Array.isArray(inscripcion_ids) || inscripcion_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'DNI e inscripciones requeridos' });
    }

    const idsValidos = inscripcion_ids.filter(id => Number.isInteger(Number(id))).map(Number);
    if (idsValidos.length === 0) {
      return res.status(400).json({ success: false, error: 'IDs de inscripciÃ³n invÃ¡lidos' });
    }

    const [alumnoRows] = await db.query('SELECT alumno_id FROM alumnos WHERE dni = ?', [dni]);
    if (alumnoRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }
    const alumnoId = alumnoRows[0].alumno_id;

    const placeholders = idsValidos.map(() => '?').join(',');
    await db.query(
      `UPDATE inscripciones SET estado = 'cancelada' WHERE inscripcion_id IN (${placeholders}) AND alumno_id = ?`,
      [...idsValidos, alumnoId]
    );

    const [restantes] = await db.query(
      `SELECT COUNT(*) as total FROM inscripciones WHERE alumno_id = ? AND estado IN ('activa', 'pendiente')`,
      [alumnoId]
    );

    if (restantes[0].total === 0) {
      await db.query(`UPDATE alumnos SET estado = 'inactivo' WHERE alumno_id = ?`, [alumnoId]);
      console.log(`ðŸ”´ Alumno ${dni} marcado como inactivo (sin inscripciones activas)`);
    }

    invalidateDNICache(dni);
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(inscritosKeys);

    console.log(`âœ… Desactivadas ${idsValidos.length} inscripciones de ${dni}`);
    res.json({ success: true, message: `Se desactivaron ${idsValidos.length} inscripciÃ³n(es)`, alumno_inactivo: restantes[0].total === 0 });
  } catch (error) {
    console.error('Error al desactivar inscripciones:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint: Reactivar inscripciones selectivas (por inscripcion_id)
app.post('/api/admin/reactivar-inscripciones', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { dni, inscripcion_ids } = req.body;

    if (!dni || !inscripcion_ids || !Array.isArray(inscripcion_ids) || inscripcion_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'DNI e inscripciones requeridos' });
    }

    const idsValidos = inscripcion_ids.filter(id => Number.isInteger(Number(id))).map(Number);
    if (idsValidos.length === 0) {
      return res.status(400).json({ success: false, error: 'IDs de inscripciÃ³n invÃ¡lidos' });
    }

    const [alumnoRows] = await db.query('SELECT alumno_id, estado FROM alumnos WHERE dni = ?', [dni]);
    if (alumnoRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }
    const alumnoId = alumnoRows[0].alumno_id;

    const placeholders = idsValidos.map(() => '?').join(',');
    await db.query(
      `UPDATE inscripciones SET estado = 'activa' WHERE inscripcion_id IN (${placeholders}) AND alumno_id = ? AND estado = 'cancelada'`,
      [...idsValidos, alumnoId]
    );

    // Si el alumno estaba inactivo, reactivarlo
    if (alumnoRows[0].estado === 'inactivo') {
      await db.query(`UPDATE alumnos SET estado = 'activo' WHERE alumno_id = ?`, [alumnoId]);
      console.log(`ðŸŸ¢ Alumno ${dni} reactivado automÃ¡ticamente`);
    }

    invalidateDNICache(dni);
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(inscritosKeys);

    console.log(`âœ… Reactivadas ${idsValidos.length} inscripciones de ${dni}`);
    res.json({ success: true, message: `Se reactivaron ${idsValidos.length} inscripciÃ³n(es)` });
  } catch (error) {
    console.error('Error al reactivar inscripciones:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint: Desactivar usuario (soft delete - marca como inactivo)
app.post('/api/desactivar-usuario', async (req, res) => {
  try {
    const { dni } = req.body;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI invÃ¡lido'
      });
    }
    
    // ==================== DESACTIVAR EN MYSQL ====================
    if (db) {
      try {
        console.log(`ðŸ”´ Desactivando usuario DNI ${dni} en MySQL...`);
        
        // Actualizar estado del alumno a 'inactivo'
        await db.query(
          `UPDATE alumnos SET estado = 'inactivo' WHERE dni = ?`,
          [dni]
        );
        
        // Obtener ID del alumno
        const [alumnoRows] = await db.query(
          'SELECT alumno_id FROM alumnos WHERE dni = ?',
          [dni]
        );
        
        if (alumnoRows.length > 0) {
          const alumnoId = alumnoRows[0].alumno_id;
          
          // Desactivar todas las inscripciones del alumno (usar 'cancelada' segÃºn ENUM)
          await db.query(
            `UPDATE inscripciones SET estado = 'cancelada' WHERE alumno_id = ?`,
            [alumnoId]
          );
          
          console.log(`âœ… Usuario ${dni} desactivado en MySQL (estado: cancelada)`);
        }
        
        // INVALIDAR CACHÃ‰
        invalidateDNICache(dni);
        const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
        cache.del(inscritosKeys);
        console.log('ðŸ—‘ï¸ CACHÃ‰ INVALIDADO tras desactivar usuario');
        
        // TambiÃ©n sincronizar con Google Sheets como backup
        try {
          await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'desactivar_usuario',
              token: APPS_SCRIPT_TOKEN,
              dni: dni
            })
          });
          console.log('ðŸ“Š Sincronizado con Google Sheets');
        } catch (sheetError) {
          console.warn('âš ï¸ No se pudo sincronizar con Sheets:', sheetError.message);
        }
        
        return res.json({
          success: true,
          message: 'Usuario desactivado correctamente'
        });
        
      } catch (mysqlError) {
        console.error('âŒ Error en MySQL:', mysqlError);
        throw mysqlError;
      }
    }
    
    // Fallback a Google Sheets si no hay MySQL
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'desactivar_usuario',
        token: APPS_SCRIPT_TOKEN,
        dni: dni
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al desactivar usuario');
    }
    
    // INVALIDAR CACHÃ‰ despuÃ©s de desactivar usuario
    invalidateDNICache(dni);
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(inscritosKeys);
    console.log('ðŸ—‘ï¸ CACHÃ‰ INVALIDADO tras desactivar usuario');
    
    res.json(data);
  } catch (error) {
    console.error('âŒ Error al desactivar usuario:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al desactivar usuario' 
    });
  }
});

// Endpoint: Reactivar usuario (marca como activo)
app.post('/api/reactivar-usuario', async (req, res) => {
  try {
    const { dni } = req.body;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI invÃ¡lido'
      });
    }
    
    // ==================== REACTIVAR EN MYSQL ====================
    if (db) {
      try {
        console.log(`ðŸŸ¢ Reactivando usuario DNI ${dni} en MySQL...`);
        
        // Actualizar estado del alumno a 'activo'
        await db.query(
          `UPDATE alumnos SET estado = 'activo' WHERE dni = ?`,
          [dni]
        );
        
        // Obtener ID del alumno
        const [alumnoRows] = await db.query(
          'SELECT alumno_id FROM alumnos WHERE dni = ?',
          [dni]
        );
        
        if (alumnoRows.length > 0) {
          const alumnoId = alumnoRows[0].alumno_id;
          
          // Reactivar inscripciones que fueron canceladas (no las suspendidas manualmente)
          await db.query(
            `UPDATE inscripciones SET estado = 'activa' WHERE alumno_id = ? AND estado = 'cancelada'`,
            [alumnoId]
          );
          
          console.log(`âœ… Usuario ${dni} reactivado en MySQL (inscripciones: cancelada â†’ activa)`);
        }
        
        // INVALIDAR CACHÃ‰
        invalidateDNICache(dni);
        const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
        cache.del(inscritosKeys);
        console.log('ðŸ—‘ï¸ CACHÃ‰ INVALIDADO tras reactivar usuario');
        
        // TambiÃ©n sincronizar con Google Sheets como backup
        try {
          await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'reactivar_usuario',
              token: APPS_SCRIPT_TOKEN,
              dni: dni
            })
          });
          console.log('ðŸ“Š Sincronizado con Google Sheets');
        } catch (sheetError) {
          console.warn('âš ï¸ No se pudo sincronizar con Sheets:', sheetError.message);
        }
        
        return res.json({
          success: true,
          message: 'Usuario reactivado correctamente'
        });
        
      } catch (mysqlError) {
        console.error('âŒ Error en MySQL:', mysqlError);
        throw mysqlError;
      }
    }
    
    // Fallback a Google Sheets si no hay MySQL
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'reactivar_usuario',
        token: APPS_SCRIPT_TOKEN,
        dni: dni
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al reactivar usuario');
    }
    
    // INVALIDAR CACHÃ‰ despuÃ©s de reactivar usuario
    invalidateDNICache(dni);
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(inscritosKeys);
    console.log('ðŸ—‘ï¸ CACHÃ‰ INVALIDADO tras reactivar usuario');
    
    res.json(data);
  } catch (error) {
    console.error('âŒ Error al reactivar usuario:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al reactivar usuario' 
    });
  }
});

// Endpoint: Activar inscripciones manualmente (cuando el admin confirma pago)
app.post('/api/activar-inscripciones/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI invÃ¡lido'
      });
    }
    
    const url = `${APPS_SCRIPT_URL}?action=activar_inscripciones&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al activar inscripciones');
    }
    
    // INVALIDAR CACHÃ‰ despuÃ©s de activar inscripciones
    invalidateDNICache(dni);
    const horariosKeys = cache.keys().filter(k => k.startsWith('horarios_'));
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(horariosKeys);
    cache.del(inscritosKeys);
    console.log('ðŸ—‘ï¸ CACHÃ‰ INVALIDADO tras activar inscripciones');
    
    res.json(data);
  } catch (error) {
    console.error('âŒ Error al activar inscripciones:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al activar inscripciones' 
    });
  }
});

// ==================== ENDPOINT PÃšBLICO DE RANKING ====================
// Ranking pÃºblico para mostrar en la pÃ¡gina principal
app.get('/api/public/ranking', async (req, res) => {
    try {
        const mesActual = new Date().getMonth() + 1;
        const anioActual = new Date().getFullYear();
        
        // FunciÃ³n auxiliar para convertir URLs de Google Drive a formato de imagen directa
        function convertirUrlDrive(url) {
            if (!url) return null;
            
            // Si ya es una URL de imagen directa, retornarla
            if (url.includes('uc?export=view') || url.includes('lh3.googleusercontent.com')) {
                return url;
            }
            
            // Extraer el ID del archivo de Google Drive
            // Formato: https://drive.google.com/file/d/ID/view?...
            const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
                // Usar el formato de thumbnail de Google que es mÃ¡s confiable
                return `https://lh3.googleusercontent.com/d/${match[1]}`;
            }
            
            return url;
        }
        
        // Obtener el ranking del mes actual con datos de alumnos
        const [ranking] = await db.query(`
            SELECT 
                rp.alumno_id,
                CONCAT(a.nombres, ' ', a.apellido_paterno) as nombre_completo,
                CONCAT(SUBSTRING_INDEX(a.nombres, ' ', 1), ' ', LEFT(a.apellido_paterno, 1), '.') as nombre_corto,
                a.foto_carnet_url as foto_url,
                d.nombre as deporte,
                rp.puntos_total,
                rp.puntos_asistencia,
                rp.puntos_bonus,
                rp.categoria
            FROM ranking_puntos rp
            JOIN alumnos a ON rp.alumno_id = a.alumno_id
            JOIN deportes d ON rp.deporte_id = d.deporte_id
            WHERE rp.mes = ? AND rp.anio = ?
            ORDER BY rp.puntos_total DESC
            LIMIT 10
        `, [mesActual, anioActual]);
        
        // Si no hay datos del mes actual, devolver array vacÃ­o
        if (!ranking || ranking.length === 0) {
            return res.json({
                success: true,
                ranking: [],
                mensaje: 'No hay datos de ranking para este mes'
            });
        }
        
        res.json({
            success: true,
            ranking: ranking.map(r => ({
                alumno_id: r.alumno_id,
                nombre_completo: r.nombre_completo,
                nombre_corto: r.nombre_corto,
                foto_url: convertirUrlDrive(r.foto_url),
                deporte: r.deporte,
                puntaje_global: r.puntos_total,
                puntos: r.puntos_total,
                puntos_asistencia: r.puntos_asistencia,
                puntos_bonus: r.puntos_bonus,
                categoria: r.categoria
            })),
            mes: mesActual,
            anio: anioActual
        });
        
    } catch (error) {
        console.error('Error obteniendo ranking pÃºblico:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener ranking',
            ranking: []
        });
    }
});

// ==================== ENDPOINTS DE DOCENTES ====================

// GET /api/admin/docentes
app.get('/api/admin/docentes', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                a.admin_id,
                a.nombre_completo,
                a.usuario,
                a.email,
                a.estado,
                a.ultimo_acceso,
                GROUP_CONCAT(DISTINCT d.nombre ORDER BY d.nombre SEPARATOR ', ') AS deportes_asignados
            FROM administradores a
            LEFT JOIN profesor_deportes pd ON pd.admin_id = a.admin_id
            LEFT JOIN deportes d ON d.deporte_id = pd.deporte_id
            WHERE a.rol = 'profesor'
            GROUP BY a.admin_id
            ORDER BY a.nombre_completo
        `);
        res.json({ success: true, docentes: rows });
    } catch (error) {
        console.error('Error en GET /api/admin/docentes:', error);
        res.status(500).json({ success: false, error: 'Error al obtener docentes' });
    }
});

// POST /api/admin/docentes
app.post('/api/admin/docentes', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { nombre_completo, usuario, email, password } = req.body;
        if (!nombre_completo || !usuario || !email || !password) {
            return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
        }
        // Verificar usuario/email Ãºnicos
        const [existe] = await db.query('SELECT admin_id FROM administradores WHERE usuario = ? OR email = ?', [usuario, email]);
        if (existe.length > 0) {
            return res.status(400).json({ success: false, error: 'El usuario o email ya existe' });
        }
        const hash = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            'INSERT INTO administradores (nombre_completo, usuario, email, password_hash, rol, estado) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre_completo, usuario, email, hash, 'profesor', 'activo']
        );
        res.json({ success: true, admin_id: result.insertId });
    } catch (error) {
        console.error('Error en POST /api/admin/docentes:', error);
        res.status(500).json({ success: false, error: 'Error al crear docente' });
    }
});

// PUT /api/admin/docentes/:adminId
app.put('/api/admin/docentes/:adminId', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { adminId } = req.params;
        const { nombre_completo, usuario, email } = req.body;
        await db.query(
            'UPDATE administradores SET nombre_completo = ?, usuario = ?, email = ? WHERE admin_id = ? AND rol = ?',
            [nombre_completo, usuario, email, adminId, 'profesor']
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error en PUT /api/admin/docentes:', error);
        res.status(500).json({ success: false, error: 'Error al actualizar docente' });
    }
});

// PUT /api/admin/docentes/:adminId/estado
app.put('/api/admin/docentes/:adminId/estado', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { adminId } = req.params;
        const { estado } = req.body;
        await db.query('UPDATE administradores SET estado = ? WHERE admin_id = ? AND rol = ?', [estado, adminId, 'profesor']);
        res.json({ success: true });
    } catch (error) {
        console.error('Error en PUT /api/admin/docentes/estado:', error);
        res.status(500).json({ success: false, error: 'Error al cambiar estado' });
    }
});

// PUT /api/admin/docentes/:adminId/password
app.put('/api/admin/docentes/:adminId/password', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { adminId } = req.params;
        const { password } = req.body;
        if (!password || password.length < 8) {
            return res.status(400).json({ success: false, error: 'La contraseÃ±a debe tener al menos 8 caracteres' });
        }
        const hash = await bcrypt.hash(password, 10);
        await db.query('UPDATE administradores SET password_hash = ? WHERE admin_id = ? AND rol = ?', [hash, adminId, 'profesor']);
        res.json({ success: true });
    } catch (error) {
        console.error('Error en PUT /api/admin/docentes/password:', error);
        res.status(500).json({ success: false, error: 'Error al actualizar contraseÃ±a' });
    }
});

// DELETE /api/admin/docentes/:adminId
app.delete('/api/admin/docentes/:adminId', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { adminId } = req.params;
        const [[docente]] = await db.query(
            'SELECT admin_id, nombre_completo FROM administradores WHERE admin_id = ? AND rol = ?',
            [adminId, 'profesor']
        );
        if (!docente) {
            return res.status(404).json({ success: false, error: 'Docente no encontrado' });
        }
        // Eliminar asignaciones primero
        await db.query('DELETE FROM profesor_deportes WHERE admin_id = ?', [adminId]);
        // Eliminar sesiones activas si hubiera
        await db.query('DELETE FROM sesiones WHERE admin_id = ? ', [adminId]).catch(() => {});
        // Eliminar el docente
        await db.query('DELETE FROM administradores WHERE admin_id = ? AND rol = ?', [adminId, 'profesor']);
        console.log(`ðŸ—‘ï¸ Docente eliminado: ${docente.nombre_completo} (ID: ${adminId})`);
        res.json({ success: true, message: 'Docente eliminado correctamente' });
    } catch (error) {
        console.error('Error en DELETE /api/admin/docentes:', error);
        res.status(500).json({ success: false, error: 'Error al eliminar docente' });
    }
});

// GET /api/admin/asignaciones-docentes
app.get('/api/admin/asignaciones-docentes', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                pd.id,
                pd.admin_id,
                a.nombre_completo AS docente_nombre,
                d.nombre AS deporte,
                pd.categoria,
                h.dia,
                h.hora_inicio,
                h.hora_fin,
                pd.horario_id
            FROM profesor_deportes pd
            JOIN administradores a ON a.admin_id = pd.admin_id
            JOIN deportes d ON d.deporte_id = pd.deporte_id
            LEFT JOIN horarios h ON h.horario_id = pd.horario_id
            ORDER BY a.nombre_completo, d.nombre
        `);
        res.json({ success: true, asignaciones: rows });
    } catch (error) {
        console.error('Error en GET /api/admin/asignaciones-docentes:', error);
        res.status(500).json({ success: false, error: 'Error al obtener asignaciones' });
    }
});

// POST /api/admin/asignaciones-docentes
app.post('/api/admin/asignaciones-docentes', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { admin_id, horario_id } = req.body;
        if (!admin_id || !horario_id) {
            return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
        }
        // Obtener deporte y categoria del horario
        const [[horario]] = await db.query('SELECT deporte_id, categoria, dia FROM horarios WHERE horario_id = ?', [horario_id]);
        if (!horario) return res.status(404).json({ success: false, error: 'Horario no encontrado' });

        const [existe] = await db.query('SELECT id FROM profesor_deportes WHERE admin_id = ? AND horario_id = ?', [admin_id, horario_id]);
        if (existe.length > 0) return res.status(400).json({ success: false, error: 'Esta asignaciÃ³n ya existe' });

        await db.query(
            'INSERT INTO profesor_deportes (admin_id, deporte_id, categoria, dia, horario_id) VALUES (?, ?, ?, ?, ?)',
            [admin_id, horario.deporte_id, horario.categoria, horario.dia, horario_id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error en POST /api/admin/asignaciones-docentes:', error);
        res.status(500).json({ success: false, error: 'Error al crear asignaciÃ³n' });
    }
});

// DELETE /api/admin/asignaciones-docentes/:id
app.delete('/api/admin/asignaciones-docentes/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM profesor_deportes WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error en DELETE /api/admin/asignaciones-docentes:', error);
        res.status(500).json({ success: false, error: 'Error al eliminar asignaciÃ³n' });
    }
});

// GET /api/admin/docente-clases/:adminId â€” Clases asignadas a un docente con conteo de alumnos
app.get('/api/admin/docente-clases/:adminId', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { adminId } = req.params;
        const adminIdNum = parseInt(adminId, 10);
        if (isNaN(adminIdNum) || adminIdNum <= 0) {
            return res.status(400).json({ success: false, error: 'adminId invÃ¡lido' });
        }

        const [rows] = await db.query(`
            SELECT
                GROUP_CONCAT(DISTINCT pd.horario_id ORDER BY pd.horario_id) AS horario_ids,
                MIN(pd.horario_id) AS horario_id,
                d.nombre AS deporte,
                pd.categoria,
                h.dia,
                h.hora_inicio,
                h.hora_fin,
                COALESCE(COUNT(DISTINCT CASE WHEN i.estado = 'activa' THEN ih.inscripcion_id END), 0) AS total_alumnos
            FROM profesor_deportes pd
            JOIN horarios h ON h.horario_id = pd.horario_id
            JOIN deportes d ON d.deporte_id = pd.deporte_id
            LEFT JOIN inscripcion_horarios ih ON ih.horario_id = pd.horario_id
            LEFT JOIN inscripciones i ON i.inscripcion_id = ih.inscripcion_id
            WHERE pd.admin_id = ?
            GROUP BY d.nombre, pd.categoria, h.dia, h.hora_inicio, h.hora_fin
            ORDER BY FIELD(h.dia, 'LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'), h.hora_inicio
        `, [adminIdNum]);

        res.json({ success: true, clases: rows.map(r => ({
            horario_id: r.horario_id,
            horario_ids: r.horario_ids,
            deporte: r.deporte,
            categoria: r.categoria || 'General',
            dia: r.dia,
            hora_inicio: r.hora_inicio,
            hora_fin: r.hora_fin,
            total_alumnos: Number(r.total_alumnos)
        })) });
    } catch (error) {
        console.error('Error en GET /api/admin/docente-clases:', error);
        res.status(500).json({ success: false, error: 'Error al obtener clases del docente' });
    }
});

// GET /api/admin/docente-clase-alumnos?horario_ids=1,2&fecha_inicio=X&fecha_fin=Y â€” Lista de alumnos con asistencia
app.get('/api/admin/docente-clase-alumnos', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { horario_ids, fecha_inicio, fecha_fin } = req.query;
        if (!horario_ids) {
            return res.status(400).json({ success: false, error: 'Faltan horario_ids' });
        }
        const ids = horario_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
        if (ids.length === 0) {
            return res.status(400).json({ success: false, error: 'horario_ids invÃ¡lidos' });
        }
        const placeholders = ids.map(() => '?').join(',');

        // Info del horario
        const [[horario]] = await db.query(`
            SELECT h.horario_id, d.nombre AS deporte, h.categoria, h.dia, h.hora_inicio, h.hora_fin
            FROM horarios h JOIN deportes d ON d.deporte_id = h.deporte_id
            WHERE h.horario_id = ?
        `, [ids[0]]);

        // Alumnos inscritos activos
        const [alumnos] = await db.query(`
            SELECT DISTINCT
                a.alumno_id,
                CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) AS nombre_completo,
                a.dni
            FROM inscripciones i
            JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id
            JOIN alumnos a ON a.alumno_id = i.alumno_id
            WHERE ih.horario_id IN (${placeholders})
              AND i.estado = 'activa'
            ORDER BY nombre_completo
        `, ids);

        // Asistencias en el rango de fechas (si se proporcionan)
        let asistencias = [];
        if (fecha_inicio && fecha_fin) {
            const [rows] = await db.query(`
                SELECT ast.alumno_id, ast.fecha, ast.presente
                FROM asistencias ast
                WHERE ast.horario_id IN (${placeholders})
                  AND ast.fecha BETWEEN ? AND ?
                ORDER BY ast.fecha
            `, [...ids, fecha_inicio, fecha_fin]);
            asistencias = rows;
        }

        res.json({
            success: true,
            horario: horario || {},
            alumnos,
            asistencias
        });
    } catch (error) {
        console.error('Error en GET /api/admin/docente-clase-alumnos:', error);
        res.status(500).json({ success: false, error: 'Error al obtener alumnos de la clase' });
    }
});

// GET /api/admin/horarios-disponibles?deporte_id=X&dia=Y
app.get('/api/admin/horarios-disponibles', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { deporte_id, dia } = req.query;
        const [rows] = await db.query(`
            SELECT horario_id, categoria, hora_inicio, hora_fin, dia
            FROM horarios
            WHERE deporte_id = ? AND dia = ? AND estado = 'activo'
            ORDER BY hora_inicio
        `, [deporte_id, dia]);
        res.json({ success: true, horarios: rows });
    } catch (error) {
        console.error('Error en GET /api/admin/horarios-disponibles:', error);
        res.status(500).json({ success: false, error: 'Error al obtener horarios' });
    }
});

// GET /api/admin/dias?deporte_id=X&categoria=Y  â€” dÃ­as distintos para deporte+categorÃ­a
app.get('/api/admin/dias', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { deporte_id, categoria } = req.query;
        const params = [];
        const conds = [];
        if (deporte_id) { conds.push('deporte_id = ?'); params.push(deporte_id); }
        if (categoria)  { conds.push('categoria = ?');  params.push(categoria); }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const orden = "FIELD(dia,'LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO')";
        const [rows] = await db.query(`SELECT DISTINCT dia FROM horarios ${where} ORDER BY ${orden}`, params);
        res.json({ success: true, dias: rows.map(r => r.dia) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error al obtener dÃ­as' });
    }
});

// GET /api/admin/reporte-asistencias?fecha_inicio&fecha_fin&deporte_id&categoria
app.get('/api/admin/reporte-asistencias', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, deporte_id, categoria, dia } = req.query;
        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ success: false, error: 'Faltan fechas' });
        }
        const params = [fecha_inicio, fecha_fin];
        let whereCond = '';
        if (deporte_id) { whereCond += ' AND h.deporte_id = ?'; params.push(deporte_id); }
        if (categoria)  { whereCond += ' AND h.categoria = ?';  params.push(categoria); }
        if (dia)        { whereCond += ' AND h.dia = ?';        params.push(dia.toUpperCase()); }

        const [totales] = await db.query(`
            SELECT
                SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS total_presentes,
                SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS total_ausentes
            FROM asistencias ast
            JOIN horarios h ON h.horario_id = ast.horario_id
            WHERE ast.fecha BETWEEN ? AND ? ${whereCond}
        `, params);

        const [detalle] = await db.query(`
            SELECT
                ast.fecha,
                d.nombre AS deporte,
                h.categoria,
                h.dia,
                TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
                TIME_FORMAT(h.hora_fin, '%H:%i') AS hora_fin,
                SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS total_presentes,
                SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS total_ausentes,
                COUNT(*) AS total_registros
            FROM asistencias ast
            JOIN horarios h ON h.horario_id = ast.horario_id
            JOIN deportes d ON d.deporte_id = h.deporte_id
            WHERE ast.fecha BETWEEN ? AND ? ${whereCond}
            GROUP BY ast.fecha, h.horario_id, d.nombre, h.categoria, h.dia, h.hora_inicio, h.hora_fin
            ORDER BY ast.fecha DESC, d.nombre, h.categoria, h.dia
        `, params);

        res.json({
            success: true,
            estadisticas: {
                total_presentes: Number(totales[0]?.total_presentes || 0),
                total_ausentes: Number(totales[0]?.total_ausentes || 0)
            },
            detalle
        });
    } catch (error) {
        console.error('Error en GET /api/admin/reporte-asistencias:', error);
        res.status(500).json({ success: false, error: 'Error al generar reporte' });
    }
});

// GET /api/admin/exportar-asistencias-json â€” datos para generar Excel en el cliente
app.get('/api/admin/exportar-asistencias-json', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, deporte_id, categoria, dia } = req.query;
        const params = [fecha_inicio, fecha_fin];
        let whereCond = '';
        if (deporte_id) { whereCond += ' AND h.deporte_id = ?'; params.push(deporte_id); }
        if (categoria)  { whereCond += ' AND h.categoria = ?';  params.push(categoria); }
        if (dia)        { whereCond += ' AND h.dia = ?';        params.push(dia.toUpperCase()); }

        const [rows] = await db.query(`
            SELECT
                ast.fecha,
                d.nombre AS deporte,
                h.categoria,
                h.dia,
                TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
                TIME_FORMAT(h.hora_fin, '%H:%i') AS hora_fin,
                CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', IFNULL(a.apellido_materno,'')) AS alumno,
                a.dni,
                ast.presente
            FROM asistencias ast
            JOIN horarios h ON h.horario_id = ast.horario_id
            JOIN deportes d ON d.deporte_id = h.deporte_id
            JOIN alumnos a ON a.alumno_id = ast.alumno_id
            WHERE ast.fecha BETWEEN ? AND ? ${whereCond}
            ORDER BY ast.fecha, d.nombre, h.categoria, h.dia, a.apellido_paterno
        `, params);

        res.json({ success: true, rows, filtros: { fecha_inicio, fecha_fin, deporte_id: deporte_id || null, categoria: categoria || null, dia: dia || null } });
    } catch (error) {
        console.error('Error en exportar-asistencias-json:', error);
        res.status(500).json({ success: false, error: 'Error al exportar' });
    }
});

// GET /api/admin/exportar-asistencias-excel (devuelve CSV con BOM UTF-8 para Excel)
app.get('/api/admin/exportar-asistencias-excel', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, deporte_id, categoria, dia } = req.query;
        const params = [fecha_inicio, fecha_fin];
        let whereCond = '';
        if (deporte_id) { whereCond += ' AND h.deporte_id = ?'; params.push(deporte_id); }
        if (categoria)  { whereCond += ' AND h.categoria = ?';  params.push(categoria); }
        if (dia)        { whereCond += ' AND h.dia = ?';        params.push(dia.toUpperCase()); }

        const [rows] = await db.query(`
            SELECT
                DATE_FORMAT(ast.fecha, '%d/%m/%Y') AS fecha,
                d.nombre AS deporte,
                h.categoria,
                h.dia,
                TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
                TIME_FORMAT(h.hora_fin, '%H:%i') AS hora_fin,
                CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', IFNULL(a.apellido_materno,'')) AS alumno,
                a.dni,
                CASE WHEN ast.presente = 1 THEN 'Presente' ELSE 'Ausente' END AS asistencia
            FROM asistencias ast
            JOIN horarios h ON h.horario_id = ast.horario_id
            JOIN deportes d ON d.deporte_id = h.deporte_id
            JOIN alumnos a ON a.alumno_id = ast.alumno_id
            WHERE ast.fecha BETWEEN ? AND ? ${whereCond}
            ORDER BY ast.fecha, d.nombre, h.categoria, h.dia, a.apellido_paterno
        `, params);

        // FunciÃ³n para escapar valores CSV (comillas dobles si contiene coma/comilla/salto)
        const esc = (v) => {
            const s = v == null ? '' : String(v).trim();
            return s.includes(';') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const SEP = ';';
        const headers = ['Fecha', 'Deporte', 'CategorÃ­a', 'DÃ­a', 'Hora Inicio', 'Hora Fin', 'Alumno', 'DNI', 'Asistencia'];
        const lines = [headers.join(SEP)];

        for (const r of rows) {
            lines.push([
                esc(r.fecha),
                esc(r.deporte),
                esc(r.categoria),
                esc(r.dia),
                esc(r.hora_inicio),
                esc(r.hora_fin),
                esc(r.alumno),
                esc(r.dni),
                esc(r.asistencia)
            ].join(SEP));
        }

        // BOM UTF-8 para que Excel detecte la codificaciÃ³n correctamente
        const csv = '\uFEFF' + lines.join('\r\n');

        const filename = `Asistencias_${fecha_inicio}_${fecha_fin}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('Error en exportar-asistencias-excel:', error);
        res.status(500).json({ success: false, error: 'Error al exportar' });
    }
});

// ==================== ENDPOINTS DE PROFESOR ====================

// GET /api/profesor/mis-clases?dia=Lunes
// Devuelve las clases del profesor para el dÃ­a indicado (o todas si no se especifica)
app.get('/api/profesor/mis-clases', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const diaParam = req.query.dia ? req.query.dia.toUpperCase() : null;
        const fechaHoy = req.query.fecha || new Date().toISOString().split('T')[0];

        // Mapa de nombres en espaÃ±ol mixto a uppercase (por si viene 'Lunes' en lugar de 'LUNES')
        const diaMap = {
            'LUNES': 'LUNES', 'MARTES': 'MARTES', 'MIERCOLES': 'MIERCOLES',
            'MIÃ‰RCOLES': 'MIERCOLES', 'JUEVES': 'JUEVES', 'VIERNES': 'VIERNES',
            'SABADO': 'SABADO', 'SÃBADO': 'SABADO', 'DOMINGO': 'DOMINGO'
        };
        const dia = diaParam ? (diaMap[diaParam] || diaParam) : null;

        let query = `
            SELECT
                GROUP_CONCAT(DISTINCT pd.horario_id ORDER BY pd.horario_id) AS horario_ids,
                MIN(pd.horario_id) AS horario_id,
                d.nombre AS deporte,
                pd.categoria,
                h.dia,
                h.hora_inicio,
                h.hora_fin,
                MAX(h.cupo_maximo) AS cupo_maximo,
                COALESCE(COUNT(DISTINCT CASE WHEN i.estado = 'activa' THEN ih.inscripcion_id END), 0) AS total_alumnos,
                MAX(CASE WHEN ast_hoy.cnt > 0 THEN 1 ELSE 0 END) AS asistencia_hoy
            FROM profesor_deportes pd
            JOIN horarios h ON h.horario_id = pd.horario_id
            JOIN deportes d ON d.deporte_id = pd.deporte_id
            LEFT JOIN inscripcion_horarios ih ON ih.horario_id = pd.horario_id
            LEFT JOIN inscripciones i ON i.inscripcion_id = ih.inscripcion_id
            LEFT JOIN (
                SELECT horario_id, COUNT(*) AS cnt FROM asistencias WHERE fecha = ?
                GROUP BY horario_id
            ) ast_hoy ON ast_hoy.horario_id = pd.horario_id
            WHERE pd.admin_id = ?
        `;
        const params = [fechaHoy, adminId];

        if (dia) {
            query += ' AND h.dia = ?';
            params.push(dia);
        }

        query += ' GROUP BY d.nombre, pd.categoria, h.dia, h.hora_inicio, h.hora_fin ORDER BY h.hora_inicio';

        const [rows] = await db.query(query, params);

        const clases = rows.map(r => ({
            horario_id: r.horario_id,
            horario_ids: r.horario_ids,
            deporte: r.deporte,
            categoria: r.categoria || 'General',
            dia: r.dia,
            hora_inicio: r.hora_inicio,
            hora_fin: r.hora_fin,
            cupo_maximo: r.cupo_maximo,
            total_alumnos: Number(r.total_alumnos),
            asistencia_hoy: r.asistencia_hoy === 1
        }));

        res.json({ success: true, clases });
    } catch (error) {
        console.error('Error en /api/profesor/mis-clases:', error);
        res.status(500).json({ success: false, error: 'Error al obtener clases', clases: [] });
    }
});

// GET /api/profesor/mis-deportes
// Devuelve los deportes Ãºnicos (sin repetir) asignados al profesor
app.get('/api/profesor/mis-deportes', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;

        const [rows] = await db.query(`
            SELECT DISTINCT
                d.deporte_id,
                d.nombre,
                d.nombre AS deporte
            FROM profesor_deportes pd
            JOIN deportes d ON d.deporte_id = pd.deporte_id
            WHERE pd.admin_id = ?
            ORDER BY d.nombre
        `, [adminId]);

        res.json({ success: true, deportes: rows });
    } catch (error) {
        console.error('Error en /api/profesor/mis-deportes:', error);
        res.status(500).json({ success: false, error: 'Error al obtener deportes', deportes: [] });
    }
});

// GET /api/profesor/categorias-deporte/:deporteId
// Devuelve las categorÃ­as del profesor para un deporte especÃ­fico
app.get('/api/profesor/categorias-deporte/:deporteId', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { deporteId } = req.params;

        const [rows] = await db.query(`
            SELECT DISTINCT categoria
            FROM profesor_deportes
            WHERE admin_id = ? AND deporte_id = ? AND categoria IS NOT NULL
            ORDER BY categoria
        `, [adminId, deporteId]);

        res.json({ success: true, categorias: rows });
    } catch (error) {
        console.error('Error en /api/profesor/categorias-deporte:', error);
        res.status(500).json({ success: false, error: 'Error al obtener categorÃ­as', categorias: [] });
    }
});

// GET /api/profesor/dias-categoria?deporte_id=X&categoria=Y
// Devuelve los dÃ­as disponibles para una categorÃ­a
app.get('/api/profesor/dias-categoria', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { deporte_id, categoria } = req.query;

        const [rows] = await db.query(`
            SELECT DISTINCT h.dia
            FROM profesor_deportes pd
            JOIN horarios h ON h.horario_id = pd.horario_id
            WHERE pd.admin_id = ? AND pd.deporte_id = ? AND pd.categoria = ?
            ORDER BY FIELD(h.dia, 'LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO')
        `, [adminId, deporte_id, categoria]);

        res.json({ success: true, dias: rows.map(r => r.dia) });
    } catch (error) {
        console.error('Error en /api/profesor/dias-categoria:', error);
        res.status(500).json({ success: false, error: 'Error al obtener dÃ­as', dias: [] });
    }
});

// GET /api/profesor/horarios-categoria?deporte_id=X&categoria=Y&dia=Z
// Devuelve los horarios del profesor para deporte/categorÃ­a/dÃ­a
app.get('/api/profesor/horarios-categoria', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { deporte_id, categoria, dia } = req.query;

        const [rows] = await db.query(`
            SELECT h.horario_id, h.hora_inicio, h.hora_fin, h.dia, h.cupo_maximo
            FROM profesor_deportes pd
            JOIN horarios h ON h.horario_id = pd.horario_id
            WHERE pd.admin_id = ? AND pd.deporte_id = ? AND pd.categoria = ? AND h.dia = ?
            ORDER BY h.hora_inicio
        `, [adminId, deporte_id, categoria, dia]);

        res.json({ success: true, horarios: rows });
    } catch (error) {
        console.error('Error en /api/profesor/horarios-categoria:', error);
        res.status(500).json({ success: false, error: 'Error al obtener horarios', horarios: [] });
    }
});

// GET /api/profesor/alumnos-clase/:horarioId
// Devuelve los alumnos inscritos en un horario (o varios separados por coma) con su estado de asistencia de hoy
app.get('/api/profesor/alumnos-clase/:horarioId', verificarAutenticacion, async (req, res) => {
    try {
        const { horarioId } = req.params;
        // Soportar mÃºltiples horario_ids separados por coma (para clases con varios planes)
        const horarioIds = horarioId.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
        if (horarioIds.length === 0) {
            return res.status(400).json({ success: false, error: 'horarioId invÃ¡lido' });
        }
        // Usar fecha enviada por el cliente (hora local PerÃº) si viene, sino UTC
        const fechaHoy = req.query.fecha || new Date().toISOString().split('T')[0];

        // Datos del primer horario (para mostrar info de la clase)
        const [[horario]] = await db.query(`
            SELECT h.horario_id, d.nombre AS deporte, h.categoria, h.dia, h.hora_inicio, h.hora_fin
            FROM horarios h
            JOIN deportes d ON d.deporte_id = h.deporte_id
            WHERE h.horario_id = ?
        `, [horarioIds[0]]);

        if (!horario) {
            return res.status(404).json({ success: false, error: 'Horario no encontrado' });
        }

        // Alumnos inscritos en TODOS los horarios relacionados + asistencia de hoy
        const placeholders = horarioIds.map(() => '?').join(',');
        const [alumnos] = await db.query(`
            SELECT
                a.alumno_id,
                CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) AS nombre_completo,
                a.dni,
                ih.horario_id AS alumno_horario_id,
                CASE WHEN ast.asistencia_id IS NOT NULL THEN 1 ELSE 0 END AS asistencia_registrada,
                COALESCE(ast.presente, 1) AS presente,
                COALESCE(ast.asistencia_puerta, 0) AS asistencia_puerta,
                TIME_FORMAT(ast.hora_puerta, '%H:%i') AS hora_puerta
            FROM inscripciones i
            JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id
            JOIN alumnos a ON a.alumno_id = i.alumno_id
            LEFT JOIN asistencias ast ON ast.alumno_id = a.alumno_id
                AND ast.horario_id = ih.horario_id AND ast.fecha = ?
            WHERE ih.horario_id IN (${placeholders})
              AND i.estado = 'activa'
            ORDER BY a.apellido_paterno, a.nombres
        `, [fechaHoy, ...horarioIds]);

        // Agregar horario_ids al objeto horario para que el frontend pueda usarlos al guardar
        horario.horario_ids = horarioIds.join(',');

        res.json({ success: true, horario, alumnos });
    } catch (error) {
        console.error('Error en /api/profesor/alumnos-clase:', error);
        res.status(500).json({ success: false, error: 'Error al obtener alumnos', alumnos: [] });
    }
});

// POST /api/profesor/guardar-asistencia
// Guarda la asistencia de una clase y recalcula ranking automÃ¡ticamente
app.post('/api/profesor/guardar-asistencia', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { horario_id, fecha, asistencias } = req.body;

        if (!horario_id || !fecha || !Array.isArray(asistencias)) {
            return res.status(400).json({ success: false, error: 'Datos incompletos' });
        }

        // 1. Guardar asistencias (usar horario_id especÃ­fico del alumno si viene, sino el general)
        for (const a of asistencias) {
            const hId = a.horario_id || horario_id;
            await db.query(`
                INSERT INTO asistencias (alumno_id, horario_id, fecha, presente, registrado_por)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE presente = VALUES(presente), registrado_por = VALUES(registrado_por)
            `, [a.alumno_id, hId, fecha, a.presente ? 1 : 0, adminId]);
        }

        // 2. Recalcular puntos de asistencia del mes automÃ¡ticamente
        try {
            const fechaObj = new Date(fecha + 'T12:00:00');
            const mes = fechaObj.getMonth() + 1;
            const anio = fechaObj.getFullYear();

            const [[horario]] = await db.query(
                'SELECT deporte_id, categoria FROM horarios WHERE horario_id = ?', [horario_id]
            );

            if (horario) {
                // Calcular presentes del mes por alumno para este deporte/categoria
                const [rows] = await db.query(`
                    SELECT
                        a.alumno_id,
                        COUNT(CASE WHEN ast.presente = 1 THEN 1 END) AS total_presentes
                    FROM inscripciones i
                    JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id
                    JOIN horarios h ON h.horario_id = ih.horario_id
                    JOIN alumnos a ON a.alumno_id = i.alumno_id
                    LEFT JOIN asistencias ast ON ast.alumno_id = a.alumno_id
                        AND ast.horario_id = ih.horario_id
                        AND MONTH(ast.fecha) = ? AND YEAR(ast.fecha) = ?
                    WHERE h.deporte_id = ? AND (? IS NULL OR h.categoria = ?)
                    GROUP BY a.alumno_id
                `, [mes, anio, horario.deporte_id, horario.categoria || null, horario.categoria || null]);

                for (const row of rows) {
                    await db.query(`
                        INSERT INTO ranking_puntos (alumno_id, deporte_id, categoria, puntos_asistencia, mes, anio, profesor_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE puntos_asistencia = VALUES(puntos_asistencia), profesor_id = VALUES(profesor_id)
                    `, [row.alumno_id, horario.deporte_id, horario.categoria || null, row.total_presentes, mes, anio, adminId]);
                }
            }
        } catch (rankError) {
            // No fallar el request principal si el ranking falla
            console.error('Error al recalcular ranking automÃ¡tico:', rankError);
        }

        res.json({ success: true, message: `Asistencia guardada para ${asistencias.length} alumnos` });
    } catch (error) {
        console.error('Error en /api/profesor/guardar-asistencia:', error);
        res.status(500).json({ success: false, error: 'Error al guardar asistencia' });
    }
});

// GET /api/profesor/historial-asistencias/:horarioId
app.get('/api/profesor/historial-asistencias/:horarioId', verificarAutenticacion, async (req, res) => {
    try {
        const { horarioId } = req.params;
        // Soportar mÃºltiples horario_ids separados por coma
        const horarioIds = horarioId.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
        if (horarioIds.length === 0) {
            return res.status(400).json({ success: false, error: 'horarioId invÃ¡lido' });
        }
        const limite = Math.min(parseInt(req.query.limite) || 20, 60);

        const placeholders = horarioIds.map(() => '?').join(',');
        const [rows] = await db.query(`
            SELECT
                ast.fecha,
                SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes,
                SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS ausentes,
                COUNT(DISTINCT CONCAT(ast.alumno_id, '-', ast.fecha)) AS total
            FROM asistencias ast
            WHERE ast.horario_id IN (${placeholders})
            GROUP BY ast.fecha
            ORDER BY ast.fecha DESC
            LIMIT ?
        `, [...horarioIds, limite]);

        const historial = rows.map(r => ({
            fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : String(r.fecha).split('T')[0],
            presentes: Number(r.presentes),
            ausentes: Number(r.ausentes),
            total: Number(r.total)
        }));

        res.json({ success: true, historial });
    } catch (error) {
        console.error('Error en /api/profesor/historial-asistencias:', error);
        res.status(500).json({ success: false, error: 'Error al obtener historial' });
    }
});

// GET /api/profesor/datos-exportar?horario_id=X&mes=3&anio=2026
// Devuelve todos los alumnos con asistencia por fecha para exportar a Excel
// horario_id puede ser uno solo o varios separados por coma (e.g. "10,15")
app.get('/api/profesor/datos-exportar', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { horario_id, mes, anio } = req.query;

        if (!horario_id || !mes || !anio) {
            return res.status(400).json({ success: false, error: 'Faltan parÃ¡metros: horario_id, mes, anio' });
        }

        // Soportar mÃºltiples horario_ids separados por coma
        const horarioIds = horario_id.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
        if (horarioIds.length === 0) {
            return res.status(400).json({ success: false, error: 'horario_id invÃ¡lido' });
        }
        const placeholders = horarioIds.map(() => '?').join(',');

        // Verificar que al menos un horario pertenece al profesor
        const [[horario]] = await db.query(`
            SELECT h.horario_id, d.nombre AS deporte, h.categoria, h.dia, h.hora_inicio, h.hora_fin
            FROM horarios h
            JOIN deportes d ON d.deporte_id = h.deporte_id
            JOIN profesor_deportes pd ON pd.horario_id = h.horario_id AND pd.admin_id = ?
            WHERE h.horario_id IN (${placeholders})
            LIMIT 1
        `, [adminId, ...horarioIds]);

        if (!horario) {
            return res.status(403).json({ success: false, error: 'Horario no autorizado' });
        }

        // Obtener todas las fechas de clase de ese mes para esos horarios
        const [fechasRows] = await db.query(`
            SELECT DISTINCT ast.fecha
            FROM asistencias ast
            WHERE ast.horario_id IN (${placeholders})
              AND MONTH(ast.fecha) = ? AND YEAR(ast.fecha) = ?
            ORDER BY ast.fecha ASC
        `, [...horarioIds, mes, anio]);

        const fechas = fechasRows.map(r =>
            r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : String(r.fecha).split('T')[0]
        );

        // Obtener todos los alumnos inscritos en esos horarios
        const [alumnos] = await db.query(`
            SELECT DISTINCT
                a.alumno_id,
                a.nombres,
                a.apellido_paterno,
                a.apellido_materno,
                a.dni,
                CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) AS nombre_completo
            FROM inscripciones i
            JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id
            JOIN alumnos a ON a.alumno_id = i.alumno_id
            WHERE ih.horario_id IN (${placeholders})
            ORDER BY a.apellido_paterno, a.nombres
        `, [...horarioIds]);

        // Obtener todas las asistencias del mes para esos horarios
        const [asistencias] = await db.query(`
            SELECT alumno_id, fecha, presente
            FROM asistencias
            WHERE horario_id IN (${placeholders})
              AND MONTH(fecha) = ? AND YEAR(fecha) = ?
        `, [...horarioIds, mes, anio]);

        // Construir mapa: alumno_id -> { fecha -> presente }
        const mapaAsistencias = {};
        asistencias.forEach(ast => {
            const fechaStr = ast.fecha instanceof Date ? ast.fecha.toISOString().split('T')[0] : String(ast.fecha).split('T')[0];
            if (!mapaAsistencias[ast.alumno_id]) mapaAsistencias[ast.alumno_id] = {};
            mapaAsistencias[ast.alumno_id][fechaStr] = ast.presente;
        });

        // Armar estructura de respuesta
        const datos = alumnos.map(alumno => {
            const asistenciaPorFecha = {};
            let totalPresentes = 0;
            let totalAusentes = 0;
            let totalRegistrados = 0;

            fechas.forEach(fecha => {
                const val = mapaAsistencias[alumno.alumno_id]?.[fecha];
                if (val === undefined || val === null) {
                    asistenciaPorFecha[fecha] = null; // sin registro
                } else {
                    asistenciaPorFecha[fecha] = val === 1 || val === true ? 1 : 0;
                    if (asistenciaPorFecha[fecha] === 1) totalPresentes++;
                    else totalAusentes++;
                    totalRegistrados++;
                }
            });

            return {
                alumno_id: alumno.alumno_id,
                nombre_completo: alumno.nombre_completo,
                dni: alumno.dni,
                asistencia_por_fecha: asistenciaPorFecha,
                total_presentes: totalPresentes,
                total_ausentes: totalAusentes,
                total_clases: fechas.length,
                porcentaje: fechas.length > 0 ? Math.round((totalPresentes / fechas.length) * 100) : 0
            };
        });

        res.json({
            success: true,
            horario,
            mes: parseInt(mes),
            anio: parseInt(anio),
            fechas,
            datos
        });
    } catch (error) {
        console.error('Error en /api/profesor/datos-exportar:', error);
        res.status(500).json({ success: false, error: 'Error al obtener datos' });
    }
});

// POST /api/profesor/asignar-puntaje
// Asigna puntos de ranking a un alumno
app.post('/api/profesor/asignar-puntaje', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { alumno_id, horario_id, puntos, motivo } = req.body;

        if (!alumno_id || !horario_id || puntos === undefined) {
            return res.status(400).json({ success: false, error: 'Datos incompletos' });
        }

        // Obtener deporte_id desde el horario
        const [[horario]] = await db.query('SELECT deporte_id FROM horarios WHERE horario_id = ?', [horario_id]);
        if (!horario) {
            return res.status(404).json({ success: false, error: 'Horario no encontrado' });
        }

        const mes = new Date().getMonth() + 1;
        const anio = new Date().getFullYear();

        await db.query(`
            INSERT INTO ranking_puntos (alumno_id, deporte_id, puntos_bonus, motivo_bonus, mes, anio, profesor_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                puntos_bonus = puntos_bonus + VALUES(puntos_bonus),
                motivo_bonus = VALUES(motivo_bonus),
                profesor_id = VALUES(profesor_id)
        `, [alumno_id, horario.deporte_id, puntos, motivo || 'Asignado por profesor', mes, anio, adminId]);

        res.json({ success: true, message: `${puntos} puntos asignados correctamente` });
    } catch (error) {
        console.error('Error en /api/profesor/asignar-puntaje:', error);
        res.status(500).json({ success: false, error: 'Error al asignar puntaje' });
    }
});

// GET /api/profesor/ranking?deporte_id=X&categoria=Y
// Devuelve el ranking de alumnos para el deporte/categorÃ­a del profesor
app.get('/api/profesor/ranking', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { deporte_id, categoria } = req.query;

        // Verificar que el profesor tiene asignado ese deporte/categorÃ­a
        const [check] = await db.query(
            'SELECT id FROM profesor_deportes WHERE admin_id = ? AND deporte_id = ? AND (? IS NULL OR categoria = ?)',
            [adminId, deporte_id, categoria || null, categoria || null]
        );
        if (check.length === 0) {
            return res.status(403).json({ success: false, error: 'No autorizado para este deporte/categorÃ­a' });
        }

        const mes = req.query.mes ? parseInt(req.query.mes) : new Date().getMonth() + 1;
        const anio = req.query.anio ? parseInt(req.query.anio) : new Date().getFullYear();

        let rankingQuery = `
            SELECT
                a.alumno_id,
                a.nombres,
                CONCAT(a.apellido_paterno, ' ', a.apellido_materno) AS apellidos,
                CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) AS nombre_completo,
                a.foto_carnet_url AS foto_url,
                COALESCE(rp.puntos_asistencia, 0) AS puntos_asistencia,
                COALESCE(rp.puntos_bonus, 0) AS puntos_bonus,
                COALESCE(rp.puntos_total, 0) AS puntos_totales,
                COALESCE(rp.puntos_total, 0) AS puntos_total
            FROM alumnos a
            JOIN inscripciones i ON i.alumno_id = a.alumno_id
            JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id
            JOIN horarios h ON h.horario_id = ih.horario_id
            LEFT JOIN ranking_puntos rp ON rp.alumno_id = a.alumno_id
                AND rp.deporte_id = h.deporte_id AND rp.mes = ? AND rp.anio = ?
            WHERE h.deporte_id = ?
        `;
        const params = [mes, anio, deporte_id];

        if (categoria) {
            rankingQuery += ' AND h.categoria = ?';
            params.push(categoria);
        }

        rankingQuery += ' GROUP BY a.alumno_id, a.nombres, a.apellido_paterno, a.apellido_materno, a.foto_carnet_url, rp.puntos_asistencia, rp.puntos_bonus, rp.puntos_total ORDER BY puntos_total DESC LIMIT 50';

        const [rows] = await db.query(rankingQuery, params);

        res.json({ success: true, alumnos: rows });
    } catch (error) {
        console.error('Error en /api/profesor/ranking:', error);
        res.status(500).json({ success: false, error: 'Error al obtener ranking', ranking: [] });
    }
});

// GET /api/profesor/ranking/categorias/:deporteId
app.get('/api/profesor/ranking/categorias/:deporteId', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { deporteId } = req.params;

        const [rows] = await db.query(
            'SELECT DISTINCT categoria FROM profesor_deportes WHERE admin_id = ? AND deporte_id = ? AND categoria IS NOT NULL ORDER BY categoria',
            [adminId, deporteId]
        );

        res.json({ success: true, categorias: rows.map(r => r.categoria) });
    } catch (error) {
        console.error('Error en /api/profesor/ranking/categorias:', error);
        res.status(500).json({ success: false, error: 'Error al obtener categorÃ­as', categorias: [] });
    }
});

// POST /api/profesor/ranking/bonus  { alumno_id, deporte_id, categoria, puntos_bonus, motivo, mes, anio }
app.post('/api/profesor/ranking/bonus', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { alumno_id, deporte_id, categoria, puntos_bonus, motivo, mes, anio } = req.body;

        if (!alumno_id || !deporte_id || puntos_bonus === undefined) {
            return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
        }

        const mesUso = mes || new Date().getMonth() + 1;
        const anioUso = anio || new Date().getFullYear();

        await db.query(`
            INSERT INTO ranking_puntos (alumno_id, deporte_id, categoria, puntos_bonus, motivo_bonus, mes, anio, profesor_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                puntos_bonus = VALUES(puntos_bonus),
                motivo_bonus = VALUES(motivo_bonus),
                profesor_id = VALUES(profesor_id)
        `, [alumno_id, deporte_id, categoria || null, puntos_bonus, motivo || null, mesUso, anioUso, adminId]);

        res.json({ success: true, message: 'Puntos bonus actualizados' });
    } catch (error) {
        console.error('Error en /api/profesor/ranking/bonus:', error);
        res.status(500).json({ success: false, error: 'Error al agregar puntos' });
    }
});

// POST /api/profesor/ranking/calcular-asistencias  { deporte_id, categoria, mes, anio }
app.post('/api/profesor/ranking/calcular-asistencias', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { deporte_id, categoria, mes, anio } = req.body;

        if (!deporte_id) {
            return res.status(400).json({ success: false, error: 'Falta deporte_id' });
        }

        const mesUso = mes || new Date().getMonth() + 1;
        const anioUso = anio || new Date().getFullYear();

        // Calcular asistencias del mes para cada alumno del horario
        let query = `
            SELECT
                a.alumno_id,
                h.deporte_id,
                h.categoria,
                COUNT(CASE WHEN ast.presente = 1 THEN 1 END) AS total_presentes
            FROM inscripciones i
            JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id
            JOIN horarios h ON h.horario_id = ih.horario_id
            JOIN alumnos a ON a.alumno_id = i.alumno_id
            LEFT JOIN asistencias ast ON ast.alumno_id = a.alumno_id
                AND ast.horario_id = ih.horario_id
                AND MONTH(ast.fecha) = ? AND YEAR(ast.fecha) = ?
            WHERE h.deporte_id = ?
        `;
        const params = [mesUso, anioUso, deporte_id];

        if (categoria) {
            query += ' AND h.categoria = ?';
            params.push(categoria);
        }

        query += ' GROUP BY a.alumno_id, h.deporte_id, h.categoria';

        const [rows] = await db.query(query, params);

        // Upsert puntos_asistencia (1 punto por asistencia)
        for (const row of rows) {
            await db.query(`
                INSERT INTO ranking_puntos (alumno_id, deporte_id, categoria, puntos_asistencia, mes, anio, profesor_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE puntos_asistencia = VALUES(puntos_asistencia), profesor_id = VALUES(profesor_id)
            `, [row.alumno_id, row.deporte_id, row.categoria || null, row.total_presentes, mesUso, anioUso, adminId]);
        }

        res.json({ success: true, message: `Puntos calculados para ${rows.length} alumnos`, total: rows.length });
    } catch (error) {
        console.error('Error en /api/profesor/ranking/calcular-asistencias:', error);
        res.status(500).json({ success: false, error: 'Error al calcular asistencias' });
    }
});

// GET /api/profesor/reporte-asistencias?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD&deporte_id=X
app.get('/api/profesor/reporte-asistencias', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { fecha_inicio, fecha_fin, deporte_id } = req.query;

        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ success: false, error: 'Faltan fechas' });
        }

        // CondiciÃ³n de deporte
        const deporteCondicion = deporte_id ? 'AND h.deporte_id = ?' : '';
        const deporteParams = deporte_id ? [deporte_id] : [];

        // Totales generales
        const [totales] = await db.query(`
            SELECT
                SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS total_presentes,
                SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS total_ausentes
            FROM asistencias ast
            JOIN horarios h ON h.horario_id = ast.horario_id
            JOIN profesor_deportes pd ON pd.horario_id = h.horario_id AND pd.admin_id = ?
            WHERE ast.fecha BETWEEN ? AND ?
            ${deporteCondicion}
        `, [adminId, fecha_inicio, fecha_fin, ...deporteParams]);

        // Por fecha
        const [porFecha] = await db.query(`
            SELECT
                ast.fecha,
                SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes,
                SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS ausentes
            FROM asistencias ast
            JOIN horarios h ON h.horario_id = ast.horario_id
            JOIN profesor_deportes pd ON pd.horario_id = h.horario_id AND pd.admin_id = ?
            WHERE ast.fecha BETWEEN ? AND ?
            ${deporteCondicion}
            GROUP BY ast.fecha
            ORDER BY ast.fecha ASC
        `, [adminId, fecha_inicio, fecha_fin, ...deporteParams]);

        // Por alumno
        const [porAlumno] = await db.query(`
            SELECT
                CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) AS nombre_completo,
                SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS total_presentes,
                SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS total_ausentes
            FROM asistencias ast
            JOIN alumnos a ON a.alumno_id = ast.alumno_id
            JOIN horarios h ON h.horario_id = ast.horario_id
            JOIN profesor_deportes pd ON pd.horario_id = h.horario_id AND pd.admin_id = ?
            WHERE ast.fecha BETWEEN ? AND ?
            ${deporteCondicion}
            GROUP BY a.alumno_id, a.nombres, a.apellido_paterno, a.apellido_materno
            ORDER BY total_presentes DESC
        `, [adminId, fecha_inicio, fecha_fin, ...deporteParams]);

        const estadisticas = {
            total_presentes: Number(totales[0]?.total_presentes || 0),
            total_ausentes: Number(totales[0]?.total_ausentes || 0),
            por_fecha: porFecha.map(r => ({
                fecha: r.fecha,
                presentes: Number(r.presentes),
                ausentes: Number(r.ausentes)
            })),
            por_alumno: porAlumno.map(r => ({
                nombre_completo: r.nombre_completo,
                total_presentes: Number(r.total_presentes),
                total_ausentes: Number(r.total_ausentes)
            }))
        };

        const hayDatos = estadisticas.total_presentes > 0 || estadisticas.total_ausentes > 0;
        res.json({ success: hayDatos, estadisticas: hayDatos ? estadisticas : null });
    } catch (error) {
        console.error('Error en /api/profesor/reporte-asistencias:', error);
        res.status(500).json({ success: false, error: 'Error al generar reporte' });
    }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const healthInfo = {
      status: 'OK',
      service: 'Academia Deportiva API',
      timestamp: new Date().toISOString(),
      database: 'disconnected', // Campo requerido para tests
      appsScriptConfigured: !!APPS_SCRIPT_URL,
      mysql: null
    };

    // Verificar conexiÃ³n MySQL
    if (db) {
      try {
        const [rows] = await db.query('SELECT 1 as health');
        if (rows[0].health === 1) {
          healthInfo.database = 'connected'; // Actualizar estado
          
          // Obtener estadÃ­sticas bÃ¡sicas
          const [alumnos] = await db.query('SELECT COUNT(*) as total FROM alumnos');
          const [inscripciones] = await db.query('SELECT COUNT(*) as total FROM inscripciones');
          const [horarios] = await db.query('SELECT COUNT(*) as total FROM horarios WHERE estado = ?', ['activo']);

          healthInfo.mysql = {
            estado: 'conectado',
            alumnos: alumnos[0].total,
            inscripciones: inscripciones[0].total,
            horarios_activos: horarios[0].total
          };
        }
      } catch (mysqlError) {
        healthInfo.database = 'error';
        healthInfo.mysql = {
          estado: 'error',
          mensaje: mysqlError.message
        };
      }
    } else {
      healthInfo.database = 'not_configured';
      healthInfo.mysql = {
        estado: 'no_configurado'
      };
    }

    res.json(healthInfo);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'error',
      message: error.message
    });
  }
});

// ==================== ENDPOINTS LEGACY (CAMPAMENTO) - DESHABILITADOS ====================
// Estos endpoints estÃ¡n OBSOLETOS y han sido reemplazados por los endpoints principales
// que usan MySQL + Apps Script. NO HABILITAR - causarÃ¡n conflictos

/*
// NOTA: AutenticaciÃ³n con Google Sheets deshabilitada - Se usa Apps Script como intermediario
// Configurar Google Sheets API con Service Account (LEGACY)
let auth;
let sheets;

console.log('â„¹ï¸ Backend configurado para usar Apps Script - Google Sheets API no requerida');

// Obtener spreadsheetId del archivo .env o configuraciÃ³n
const SPREADSHEET_ID = process.env.VITE_SPREADSHEET_ID || '1hCbcC82oeY4auvQ6TC4FdmWcfr35Cnw-EJcPg8B8MCg';
const SPREADSHEET_ID_BACKUP = process.env.VITE_SPREADSHEET_ID_BACKUP || '1Xp8VI8CulkMZMiOc1RzopFLrwL6FnTQ5a3_gskMpbcY'; // Sheet de respaldo

// ==================== ENDPOINTS ====================

// 1. Agregar inscripciÃ³n a la hoja Ãºnica "Inscripciones"
app.post('/api/inscripciones-LEGACY-DISABLED', async (req, res) => {
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
      '', // Columna N - DÃ­a 1 Taller 1
      '', // Columna O - DÃ­a 1 Taller 2
      '', // Columna P - DÃ­a 2 Taller 1
      '', // Columna Q - DÃ­a 2 Taller 2
      '', // Columna R - DÃ­a 3 Taller 1
      '', // Columna S - DÃ­a 3 Taller 2
      '', // Columna T - DÃ­a 4 Taller 1
      ''  // Columna U - DÃ­a 4 Taller 2
    ]];

    // Guardar en sheet principal
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Inscripciones!A:U',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });

    // Guardar tambiÃ©n en sheet de respaldo si estÃ¡ configurado
    if (SPREADSHEET_ID_BACKUP) {
      try {
        // Obtener la Ãºltima fila con datos en el sheet de backup para insertar correctamente
        const backupData = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: 'Inscripciones!A:A', // Solo columna A para encontrar la Ãºltima fila
        });
        
        const backupRows = backupData.data.values || [];
        const nextRow = backupRows.length + 1; // La siguiente fila despuÃ©s de la Ãºltima con datos
        
        // Insertar en la fila especÃ­fica del backup
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID_BACKUP,
          range: `Inscripciones!A${nextRow}:U${nextRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values }
        });
        console.log(`âœ… InscripciÃ³n guardada tambiÃ©n en sheet de respaldo (fila ${nextRow})`);
      } catch (backupError) {
        console.error('âš ï¸ Error al guardar en sheet de respaldo:', backupError.message);
      }
    }

    res.json({ success: true, message: 'InscripciÃ³n guardada' });
  } catch (error) {
    console.error('Error al guardar inscripciÃ³n:', error);
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

    // Buscar DNI en columna F (Ã­ndice 5)
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

    // Buscar DNI en columna F (Ã­ndice 5) Y Estado Pago = "Confirmado" en columna K (Ã­ndice 10)
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

    // Si no encontrÃ³ en el principal, buscar en el sheet de respaldo
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
            console.log('âœ… Pago confirmado encontrado en sheet de respaldo');
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
        console.error('âš ï¸ Error al verificar en sheet de respaldo:', backupError.message);
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
        // Verificar columnas N-U (sistema de talleres por dÃ­a)
        const talleresNuevos = row.slice(13, 21); // columnas N-U
        const tieneTalleresNuevos = talleresNuevos && talleresNuevos.some(t => t && t.trim() !== '');
        
        const tieneTaller = tieneTalleresNuevos;
        return res.json({ 
          tieneTaller,
          talleresRegistrados: tieneTalleresNuevos ? talleresNuevos : null
        });
      }
    }

    // Si no encontrÃ³ en el principal, buscar en el sheet de respaldo
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
        console.error('âš ï¸ Error al verificar talleres en sheet de respaldo:', backupError.message);
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
      range: 'Inscripciones!A:U', // Hoja Ãºnica
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
      range: `Inscripciones!N${rowIndex}:O${rowIndex}`, // Hoja Ãºnica
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          tallerId,
          new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })
        ]]
      }
    });

    // Actualizar tambiÃ©n en sheet de respaldo si estÃ¡ configurado
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
          console.log(`âœ… Taller guardado tambiÃ©n en sheet de respaldo (fila ${backupRowIndex})`);
        }
      } catch (backupError) {
        console.error('âš ï¸ Error al guardar taller en sheet de respaldo:', backupError.message);
      }
    }

    res.json({ success: true, message: 'Registrado en taller' });
  } catch (error) {
    console.error('Error al registrar en taller:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5B. Registrar mÃºltiples talleres por dÃ­a (NUEVO SISTEMA)
app.post('/api/registrar-talleres-por-dia', async (req, res) => {
  try {
    const { dni, talleres } = req.body;
    // talleres es un array de { dia: number, talleres: string[] }
    
    if (!dni || !talleres || !Array.isArray(talleres)) {
      return res.status(400).json({ success: false, error: 'Datos invÃ¡lidos' });
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

    // VERIFICAR SI YA TIENE TALLERES REGISTRADOS (columnas N-U, Ã­ndices 13-20)
    const talleresExistentes = filaUsuario.slice(13, 21); // columnas N-U
    const tieneAlgunTaller = talleresExistentes.some(t => t && t.trim() !== '');
    
    if (tieneAlgunTaller) {
      console.log(`âš ï¸ Usuario ${dni} ya tiene talleres registrados`);
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
        const baseIndex = (dia - 1) * 2; // Cada dÃ­a tiene 2 columnas
        
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
    // Columnas: A=CÃ³digo, B=Nombres, C=Apellidos, D=Edad, E=Sexo, F=DNI, G=Email, H=TelÃ©fono, I=Iglesia
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

    // FunciÃ³n auxiliar para agregar usuario a hoja de taller
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
          const encabezados = [['CÃ³digo', 'Nombres', 'Apellidos', 'Edad', 'Sexo', 'DNI', 'Email', 'TelÃ©fono', 'Iglesia', 'Fecha Registro']];
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${nombreTaller}!A1:J1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: encabezados }
          });
          
          console.log(`ðŸ“„ Hoja creada: ${nombreTaller}`);
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
        
        console.log(`âœ… Usuario agregado a hoja: ${nombreTaller}`);
      } catch (error) {
        console.error(`âš ï¸ Error al agregar usuario a hoja ${nombreTaller}:`, error.message);
      }
    };

    // Agregar a hojas de talleres en sheet principal
    for (let i = 0; i < talleresPorColumna.length; i++) {
      const nombreTaller = talleresPorColumna[i];
      if (nombreTaller && nombreTaller.trim() !== '') {
        await agregarAHojaTaller(SPREADSHEET_ID, nombreTaller, datosUsuario);
      }
    }

    // Actualizar tambiÃ©n en sheet de respaldo si estÃ¡ configurado
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
          if (backupRows[i][5] === dni) { // Columna F (Ã­ndice 5) es el DNI
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
          console.log(`âœ… Talleres guardados tambiÃ©n en sheet de respaldo (fila ${backupRowIndex})`);
          
          // Agregar a hojas de talleres en sheet de respaldo
          for (let i = 0; i < talleresPorColumna.length; i++) {
            const nombreTaller = talleresPorColumna[i];
            if (nombreTaller && nombreTaller.trim() !== '') {
              await agregarAHojaTaller(SPREADSHEET_ID_BACKUP, nombreTaller, datosUsuario);
            }
          }
        } else {
          console.warn(`âš ï¸ Usuario ${dni} no encontrado en sheet de respaldo`);
        }
      } catch (backupError) {
        console.error('âš ï¸ Error al guardar talleres en sheet de respaldo:', backupError.message);
      }
    }

    console.log(`âœ… Talleres registrados para DNI ${dni}:`, talleresPorColumna);
    res.json({ success: true, message: 'Talleres registrados exitosamente' });
  } catch (error) {
    console.error('Error al registrar talleres por dÃ­a:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5C. Obtener cupos disponibles por taller (NUEVO)
app.get('/api/cupos-talleres', async (req, res) => {
  try {
    console.log('ðŸ“Š Obteniendo cupos de talleres...');
    
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
      
      // Leer columnas N-U (Ã­ndices 13-20)
      // N=DÃ­a1-T1, O=DÃ­a1-T2, P=DÃ­a2-T1, Q=DÃ­a2-T2, R=DÃ­a3-T1, S=DÃ­a3-T2, T=DÃ­a4-T1, U=DÃ­a4-T2
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
    
    console.log('âœ… Cupos calculados:', inscritosPorTaller);
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

    // Buscar DNI en columna F (Ã­ndice 5) del sheet principal
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[5] === dni) {
        // Extraer talleres de columnas N-U (Ã­ndices 13-20)
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
        
        console.log('ðŸ“‹ Usuario encontrado en sheet principal, estado:', datosUsuario.estadoPago);
        break;
      }
    }

    // Si no se encontrÃ³ en el principal, retornar no encontrado
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
            
            console.log('ðŸ” Estado de pago en backup:', estadoPagoBackup);
            
            // Si el backup tiene el pago confirmado, usar ese estado
            if (estadoPagoBackup === 'Confirmado') {
              console.log('âœ… Actualizando estado de pago desde backup: Confirmado');
              datosUsuario.estadoPago = 'Confirmado';
              datosUsuario.fechaConfirmacion = fechaConfirmacionBackup || datosUsuario.fechaConfirmacion;
            }
            
            break;
          }
        }
      } catch (backupError) {
        console.error('âš ï¸ Error al consultar sheet de respaldo:', backupError.message);
      }
    }

    // Retornar datos con el estado de pago correcto (del backup si estÃ¡ confirmado ahÃ­)
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
    console.log('ðŸ“Š Sincronizando talleres...');

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
      'taller-1': 'Taller - AdoraciÃ³n y Alabanza',
      'taller-2': 'Taller - Evangelismo Creativo',
      'taller-3': 'Taller - Liderazgo Juvenil',
      'taller-4': 'Taller - Multimedia y DiseÃ±o',
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
        console.log(`âœ… Hoja creada: ${nombreHoja}`);
      }

      // Preparar datos para la hoja
      const encabezados = ['CÃ³digo', 'Nombres', 'Apellidos', 'Edad', 'DNI', 'Email', 'TelÃ©fono', 'Iglesia', 'Fecha Registro'];
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

      console.log(`âœ… ${nombreHoja}: ${participantes.length} participantes`);
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

FIN BLOQUE LEGACY COMENTADO */

console.log('âš ï¸  Endpoints legacy deshabilitados - usando solo MySQL + Apps Script');

// ==================== ENDPOINTS ADMINISTRATIVOS CACHÃ‰ ====================

// Ver estadÃ­sticas del cachÃ©
app.get('/api/cache/stats', (req, res) => {
  const stats = getCacheStats();
  res.json({
    success: true,
    cache: stats
  });
});

// Limpiar todo el cachÃ©
app.post('/api/cache/clear', (req, res) => {
  cache.flushAll();
  console.log('ðŸ—‘ï¸ TODO EL CACHÃ‰ HA SIDO LIMPIADO');
  res.json({
    success: true,
    message: 'CachÃ© limpiado correctamente'
  });
});

// ==================== ENDPOINTS DE REUBICACIONES ====================

// Endpoint secreto para reparar cupos desfasados
app.get('/api/admin/reparar-cupos', async (req, res) => {
  try {
    await db.query(`
      UPDATE horarios h
      SET cupos_ocupados = (
          SELECT COUNT(*) 
          FROM inscripcion_horarios ih 
          INNER JOIN inscripciones i ON ih.inscripcion_id = i.inscripcion_id 
          WHERE ih.horario_id = h.horario_id 
          AND i.estado != 'cancelada'
      )
    `);
    res.json({ success: true, message: 'Todos los cupos han sido recalculados y sincronizados correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener deportes con sus categorÃ­as para reubicaciones
app.get('/api/admin/reubicaciones/deportes', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const [deportes] = await db.query(`
      SELECT DISTINCT 
        d.deporte_id,
        d.nombre,
        d.icono
      FROM deportes d
      INNER JOIN horarios h ON h.deporte_id = d.deporte_id
      WHERE h.estado = 'activo'
      ORDER BY d.nombre
    `);

    // Para cada deporte, obtener sus categorÃ­as Ãºnicas
    const deportesConCategorias = await Promise.all(deportes.map(async (deporte) => {
      const [categorias] = await db.query(`
        SELECT DISTINCT categoria 
        FROM horarios 
        WHERE deporte_id = ? AND estado = 'activo'
        ORDER BY categoria
      `, [deporte.deporte_id]);
      
      return {
        ...deporte,
        categorias: categorias.map(c => c.categoria)
      };
    }));

    res.json({
      success: true,
      deportes: deportesConCategorias
    });
  } catch (error) {
    console.error('Error al obtener deportes para reubicaciones:', error);
    res.status(500).json({ success: false, error: 'Error al cargar deportes' });
  }
});

// Obtener alumnos agrupados por categorÃ­a para un deporte
app.get('/api/admin/reubicaciones/alumnos/:deporteId', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { deporteId } = req.params;
    
    // Obtener nombre del deporte
    const [deporteInfo] = await db.query('SELECT nombre, icono FROM deportes WHERE deporte_id = ?', [deporteId]);
    if (deporteInfo.length === 0) {
      return res.status(404).json({ success: false, error: 'Deporte no encontrado' });
    }
    
    const nombreDeporte = deporteInfo[0].nombre;
    const icono = deporteInfo[0].icono;

    // 1. Obtener TODAS las categorÃ­as Ãºnicas de horarios de este deporte
    const [categoriasHorarios] = await db.query(`
      SELECT DISTINCT categoria, precio
      FROM horarios 
      WHERE deporte_id = ? AND estado = 'activo'
      ORDER BY categoria
    `, [deporteId]);

    // 2. Obtener todos los alumnos inscritos activos con sus horarios
    const [alumnos] = await db.query(`
      SELECT 
        i.inscripcion_id,
        i.precio_mensual as precio_inscripcion,
        a.alumno_id,
        a.nombres,
        a.apellido_paterno,
        a.apellido_materno,
        CONCAT(a.apellido_paterno, ' ', a.apellido_materno) as apellidos,
        a.dni,
        h.categoria,
        GROUP_CONCAT(DISTINCT CONCAT(h.dia, ' ', h.hora_inicio) ORDER BY 
          FIELD(h.dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO')
        SEPARATOR ', ') as horarios
      FROM inscripciones i
      INNER JOIN alumnos a ON i.alumno_id = a.alumno_id
      LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id AND h.deporte_id = ?
      WHERE i.deporte_id = ? 
        AND i.estado = 'activa'
      GROUP BY i.inscripcion_id, a.alumno_id, a.nombres, a.apellido_paterno, a.apellido_materno, a.dni, h.categoria
      ORDER BY h.categoria, a.apellido_paterno, a.apellido_materno, a.nombres
    `, [deporteId, deporteId]);

    // 3. Crear mapa de categorÃ­as con sus alumnos
    const categoriasMap = {};
    
    // Inicializar todas las categorÃ­as de horarios (incluso las vacÃ­as)
    categoriasHorarios.forEach(cat => {
      categoriasMap[cat.categoria] = {
        alumnos: [],
        precio: cat.precio
      };
    });

    // Agregar categorÃ­a para alumnos sin horario asignado
    categoriasMap['Sin asignar'] = { alumnos: [], precio: 0 };

    // Asignar alumnos a sus categorÃ­as
    alumnos.forEach(al => {
      const categoria = al.categoria || 'Sin asignar';
      if (!categoriasMap[categoria]) {
        categoriasMap[categoria] = { alumnos: [], precio: 0 };
      }
      categoriasMap[categoria].alumnos.push({
        inscripcion_id: al.inscripcion_id,
        alumno_id: al.alumno_id,
        nombres: al.nombres,
        apellidos: al.apellidos,
        nombre: `${al.nombres} ${al.apellidos}`,
        dni: al.dni,
        dias: al.horarios || 'Sin horario',
        categoria: categoria,
        precio_actual: al.precio_inscripcion
      });
    });

    // Convertir a array, filtrando la categorÃ­a "Sin asignar" si estÃ¡ vacÃ­a
    const categoriasConAlumnos = Object.entries(categoriasMap)
      .filter(([cat, data]) => cat !== 'Sin asignar' || data.alumnos.length > 0)
      .map(([cat, data]) => ({
        categoria: cat,
        alumnos: data.alumnos,
        precio: data.precio
      }));

    res.json({
      success: true,
      deporte: nombreDeporte,
      icono: icono,
      categorias: categoriasConAlumnos
    });
  } catch (error) {
    console.error('Error al obtener alumnos para reubicaciones:', error);
    res.status(500).json({ success: false, error: 'Error al cargar alumnos' });
  }
});

// Preview de reubicaciÃ³n - muestra quÃ© cambiarÃ­a
app.get('/api/admin/reubicaciones/preview', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { inscripcionId, categoriaDestino, deporteId } = req.query;

    // Obtener info actual de la inscripciÃ³n con o sin horario
    const [inscripcionActual] = await db.query(`
      SELECT 
        i.inscripcion_id,
        i.precio_mensual as precio_inscripcion,
        i.deporte_id,
        d.nombre as deporte,
        h.categoria as categoria_actual,
        h.dia,
        h.hora_inicio,
        h.hora_fin,
        ih.horario_id
      FROM inscripciones i
      INNER JOIN deportes d ON i.deporte_id = d.deporte_id
      LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE i.inscripcion_id = ? AND i.deporte_id = ?
      LIMIT 1
    `, [inscripcionId, deporteId]);

    if (inscripcionActual.length === 0) {
      return res.status(404).json({ success: false, error: 'InscripciÃ³n no encontrada' });
    }

    const actual = inscripcionActual[0];
    const categoriaActual = actual.categoria_actual || 'Sin asignar';
    const precioActual = parseFloat(actual.precio_inscripcion) || 0;

    // Obtener horarios disponibles en la categorÃ­a destino
    const [horariosDestino] = await db.query(`
      SELECT horario_id, dia, hora_inicio, hora_fin, precio
      FROM horarios
      WHERE deporte_id = ? 
        AND categoria = ?
        AND estado = 'activo'
      ORDER BY FIELD(dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO')
    `, [deporteId, categoriaDestino]);

    // Obtener precio de la categorÃ­a destino
    const precioNuevo = horariosDestino.length > 0 ? parseFloat(horariosDestino[0].precio) || 0 : 0;

    // Construir dÃ­as actuales
    let diasActuales = ['Sin horario asignado'];
    if (actual.dia && actual.hora_inicio) {
      // Si hay mÃ¡s horarios actuales, obtenerlos
      const [todosHorariosActuales] = await db.query(`
        SELECT h.dia, h.hora_inicio, h.hora_fin 
        FROM inscripcion_horarios ih
        INNER JOIN horarios h ON ih.horario_id = h.horario_id
        WHERE ih.inscripcion_id = ?
        ORDER BY FIELD(h.dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO')
      `, [inscripcionId]);
      
      diasActuales = todosHorariosActuales.map(h => `${h.dia} ${h.hora_inicio} - ${h.hora_fin}`);
    }

    // La nueva categorÃ­a asigna TODOS sus horarios activos al alumno
    const diasNuevos = horariosDestino.length > 0 
      ? horariosDestino.map(h => `${h.dia} ${h.hora_inicio} - ${h.hora_fin}`)
      : ['No hay horarios disponibles'];

    res.json({
      success: true,
      diasActuales: diasActuales,
      diasNuevos: diasNuevos,
      precioActual: precioActual,
      precioNuevo: precioNuevo,
      planActual: categoriaActual,
      planNuevo: categoriaDestino,
      precioCambia: precioActual !== precioNuevo,
      horarioDestinoId: horariosDestino[0]?.horario_id || null
    });
  } catch (error) {
    console.error('Error al obtener preview:', error);
    res.status(500).json({ success: false, error: 'Error al obtener preview' });
  }
});

// Ejecutar reubicaciÃ³n
app.put('/api/admin/reubicaciones/mover', verificarAutenticacion, verificarAdmin, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    const { inscripcionId, categoriaOrigen, categoriaDestino, deporteId } = req.body;

    await connection.beginTransaction();

    // Obtener info del deporte
    const [deporteInfo] = await connection.query('SELECT nombre FROM deportes WHERE deporte_id = ?', [deporteId]);
    if (deporteInfo.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Deporte no encontrado' });
    }

    // Verificar que la inscripciÃ³n existe
    const [inscripcionVerify] = await connection.query(
      'SELECT inscripcion_id, precio_mensual FROM inscripciones WHERE inscripcion_id = ? AND deporte_id = ?',
      [inscripcionId, deporteId]
    );
    if (inscripcionVerify.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'InscripciÃ³n no encontrada' });
    }

    // Obtener TODOS los dÃ­as actuales del alumno en esta inscripciÃ³n
    const [horariosActualesInfo] = await connection.query(`
      SELECT ih.horario_id, h.dia 
      FROM inscripcion_horarios ih
      INNER JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE ih.inscripcion_id = ? AND h.deporte_id = ?
      ORDER BY FIELD(h.dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO')
    `, [inscripcionId, deporteId]);

    const diasActualesMover = horariosActualesInfo.map(h => h.dia);

    // Obtener TODOS los horarios activos de la categorÃ­a destino
    const [todosHorariosDestino] = await connection.query(`
      SELECT horario_id, cupo_maximo, cupos_ocupados, (cupo_maximo - cupos_ocupados) as cupo_disponible, precio, dia, hora_inicio
      FROM horarios
      WHERE deporte_id = ? 
        AND categoria = ?
        AND estado = 'activo'
      ORDER BY FIELD(dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO')
    `, [deporteId, categoriaDestino]);

    if (!todosHorariosDestino || todosHorariosDestino.length === 0) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        error: `No hay horarios disponibles en la categorÃ­a ${categoriaDestino}` 
      });
    }

    // Asignar TODOS los horarios de la categorÃ­a destino (independientemente de los dÃ­as actuales)
    const horariosAsignados = todosHorariosDestino.filter(h => h.cupo_disponible > 0);

    if (horariosAsignados.length === 0) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        error: `No hay cupos disponibles en la categorÃ­a ${categoriaDestino}` 
      });
    }

    const nuevoPrecio = horariosAsignados[0].precio;

    // Obtener TODOS los horarios actuales de esta inscripciÃ³n para este deporte
    const [todosHorariosActuales] = await connection.query(`
      SELECT ih.horario_id 
      FROM inscripcion_horarios ih
      INNER JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE ih.inscripcion_id = ? AND h.deporte_id = ?
    `, [inscripcionId, deporteId]);

    // Liberar cupos de TODOS los horarios anteriores
    // (El TRIGGER after_inscripcion_horario_delete liberarÃ¡ los cupos automÃ¡ticamente)

    // Eliminar TODOS los horarios anteriores de esta inscripciÃ³n para este deporte
    if (todosHorariosActuales.length > 0) {
      const horarioIds = todosHorariosActuales.map(h => h.horario_id);
      await connection.query(
        'DELETE FROM inscripcion_horarios WHERE inscripcion_id = ? AND horario_id IN (?)',
        [inscripcionId, horarioIds]
      );
    }

    // Insertar TODOS los nuevos horarios asignados
    // (El TRIGGER after_inscripcion_horario_insert ocuparÃ¡ los cupos automÃ¡ticamente)
    for (const horario of horariosAsignados) {
      await connection.query(
        'INSERT INTO inscripcion_horarios (inscripcion_id, horario_id) VALUES (?, ?)',
        [inscripcionId, horario.horario_id]
      );
    }

    // Actualizar el precio de la inscripciÃ³n
    if (nuevoPrecio) {
      await connection.query(
        'UPDATE inscripciones SET precio_mensual = ? WHERE inscripcion_id = ?',
        [nuevoPrecio, inscripcionId]
      );
    }

    await connection.commit();

    // Limpiar cachÃ© relacionado
    cache.del('horarios_disponibles');

    res.json({
      success: true,
      message: `Alumno reubicado de ${categoriaOrigen} a ${categoriaDestino} correctamente`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error al reubicar alumno:', error);
    res.status(500).json({ success: false, error: 'Error al reubicar alumno' });
  } finally {
    connection.release();
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MÃ“DULO: Editor de Landing Page
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LANDING_CONTENT_PATH = path.join(__dirname, 'landing-content.json');

// Biblioteca de medios persistente del CMS. En Docker se monta un volumen en esta ruta.
const UPLOADS_DIR = path.resolve(process.env.CMS_UPLOADS_DIR || path.join(__dirname, 'uploads', 'landing'));
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use('/uploads/landing', (_req, res, next) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next(); }, express.static(UPLOADS_DIR, {
  fallthrough: false,
  immutable: true,
  maxAge: '30d',
  index: false
}));

const IMAGE_MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/ogg': '.ogv'
};

const getMediaUrl = (req, filename) => {
  const configuredBase = process.env.CMS_MEDIA_BASE_URL?.replace(/\/$/, '');
  const mediaPath = `/uploads/landing/${filename}`;
  return configuredBase ? `${configuredBase}${mediaPath}` : mediaPath;
};

const registrarMedio = async (req) => {
  const url = getMediaUrl(req, req.file.filename);
  const autor = req.user?.username || req.admin?.usuario || 'admin';
  const [result] = await db.query(
    `INSERT INTO landing_media (filename, original_name, mime_type, size_bytes, url, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url, autor]
  );
  return { id: result.insertId, url, autor };
};

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = IMAGE_MIME_EXTENSIONS[file.mimetype] || '';
    const name = `landing-${Date.now()}-${Math.random().toString(36).slice(2,7)}${ext}`;
    cb(null, name);
  }
});
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB (permite videos)
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIME_EXTENSIONS[file.mimetype]) {
      return cb(new Error('Formato no permitido. Usa JPG, PNG, WebP, GIF, MP4, WebM o MOV.'));
    }
    cb(null, true);
  }
});

// POST /api/admin/upload-image
app.post('/api/admin/upload-image', verificarAutenticacion, verificarAdmin, imageUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibiÃ³ ninguna imagen' });
    const media = await registrarMedio(req);
    console.log(`[LandingEditor] Imagen #${media.id} subida: ${media.url}`);
    res.status(201).json({ success: true, mediaId: media.id, url: media.url });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// FOTOS DE CARNET DE ALUMNOS (ALMACENAMIENTO LIGERO EN DISCO)
// ==========================================
const CARNETS_UPLOADS_DIR = path.resolve(process.env.CARNETS_UPLOADS_DIR || path.join(__dirname, 'uploads', 'carnets'));
if (!fs.existsSync(CARNETS_UPLOADS_DIR)) fs.mkdirSync(CARNETS_UPLOADS_DIR, { recursive: true });

app.use('/uploads/carnets', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(CARNETS_UPLOADS_DIR, {
  fallthrough: false,
  maxAge: '1d',
  index: false
}));

const getFotoCarnetUrl = (req, filename) => {
  const configuredBase = process.env.CMS_MEDIA_BASE_URL?.replace(/\/$/, '') ||
    (process.env.NODE_ENV === 'production' ? 'https://api.jaguarescar.com' : '');
  const mediaPath = `/uploads/carnets/${filename}`;
  return configuredBase ? `${configuredBase}${mediaPath}` : mediaPath;
};

const carnetStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CARNETS_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = IMAGE_MIME_EXTENSIONS[file.mimetype] || '.jpg';
    const dni = (req.params.dni || 'alumno').replace(/[^a-zA-Z0-9]/g, '');
    const name = `carnet-${dni}-${Date.now()}${ext}`;
    cb(null, name);
  }
});

const carnetUpload = multer({
  storage: carnetStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB mÃ¡x
  fileFilter: (_req, file, cb) => {
    const valid = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (!valid) {
      return cb(new Error('Formato no permitido. Solo se aceptan imÃ¡genes JPG, PNG o WebP.'));
    }
    cb(null, true);
  }
});

// POST /api/admin/alumnos/:dni/foto-carnet
app.post('/api/admin/alumnos/:dni/foto-carnet', verificarAutenticacion, verificarAdmin, carnetUpload.single('foto'), async (req, res) => {
  try {
    const { dni } = req.params;
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se recibiÃ³ ninguna imagen' });
    }

    const [alumnos] = await db.query(
      'SELECT alumno_id, nombres, apellido_paterno, apellido_materno, foto_carnet_url FROM alumnos WHERE dni = ? LIMIT 1',
      [dni]
    );

    if (alumnos.length === 0) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json({ success: false, error: 'Alumno no encontrado con el DNI proporcionado' });
    }

    const alumno = alumnos[0];
    const fotoAnterior = alumno.foto_carnet_url;

    // Si la foto anterior era un archivo local en /uploads/carnets/, borrar el archivo fÃ­sico antiguo para no acumular espacio
    if (fotoAnterior && fotoAnterior.includes('/uploads/carnets/')) {
      try {
        const nombreArchivoAntiguo = path.basename(fotoAnterior.split('?')[0]);
        const rutaAntigua = path.join(CARNETS_UPLOADS_DIR, nombreArchivoAntiguo);
        if (fs.existsSync(rutaAntigua) && rutaAntigua !== req.file.path) {
          fs.unlinkSync(rutaAntigua);
          console.log('ðŸ—‘ï¸ Foto carnet anterior eliminada del disco:', nombreArchivoAntiguo);
        }
      } catch (errDel) {
        console.warn('âš ï¸ No se pudo eliminar la foto carnet anterior del disco:', errDel.message);
      }
    }

    const nuevaFotoUrl = getFotoCarnetUrl(req, req.file.filename);

    await db.query(
      'UPDATE alumnos SET foto_carnet_url = ? WHERE alumno_id = ?',
      [nuevaFotoUrl, alumno.alumno_id]
    );

    // Invalidar cachÃ©s en memoria
    try {
      cache.flushAll();
    } catch (_) {}

    // Registrar log administrativo
    try {
      const adminId = req.admin?.admin_id || null;
      await db.query(
        `INSERT INTO logs_actividad (tipo, descripcion, usuario_id, datos)
         VALUES ('actualizar_foto_carnet', ?, ?, ?)`,
        [
          `ActualizaciÃ³n de foto tamaÃ±o carnet para DNI ${dni} (${alumno.nombres})`,
          adminId,
          JSON.stringify({ dni, alumno_id: alumno.alumno_id, foto_url: nuevaFotoUrl })
        ]
      );
    } catch (_) {}

    console.log(`âœ… Foto tamaÃ±o carnet actualizada para alumno DNI ${dni}: ${nuevaFotoUrl}`);

    return res.json({
      success: true,
      mensaje: 'Foto tamaÃ±o carnet actualizada correctamente',
      foto_carnet_url: nuevaFotoUrl,
      alumno_id: alumno.alumno_id
    });
  } catch (error) {
    console.error('Error al actualizar foto tamaÃ±o carnet:', error);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    return res.status(500).json({ success: false, error: error.message || 'Error interno al procesar la foto' });
  }
});


function leerLandingContent() {
  try {
    const raw = fs.readFileSync(LANDING_CONTENT_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// GET /api/admin/landing-content  â€” lectura pÃºblica (usada por Home si quiere)
app.get('/api/admin/landing-content', async (req, res) => {
  try {
    const content = leerLandingContent();
    console.log('[GET /api/admin/landing-content] Contenido leÃ­do:', {
      success: !!content,
      tienePageos: !!content?.pagos,
      paginosKeys: content?.pagos ? Object.keys(content.pagos) : [],
      plinExiste: !!content?.pagos?.plin,
      plin: content?.pagos?.plin
    });
    
    if (!content) {
      console.error('[GET /api/admin/landing-content] Contenido NULL');
      return res.status(404).json({ success: false, error: 'Contenido no encontrado' });
    }
    
    res.json({ success: true, data: content });
  } catch (error) {
    console.error('Error leyendo landing-content:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// PUT /api/admin/landing-content  â€” escritura protegida (solo admins)
app.put('/api/admin/landing-content', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const validation = validateLandingContent(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: 'Contenido invÃ¡lido', details: validation.errors });
    }
    const nuevoContenido = normalizeLandingContent(req.body);

    // Preservar meta y actualizar timestamp
    const actual = leerLandingContent() || {};
    nuevoContenido._meta = {
      ultimaActualizacion: new Date().toISOString(),
      actualizadoPor: req.usuario?.email || 'admin'
    };

    fs.writeFileSync(LANDING_CONTENT_PATH, JSON.stringify(nuevoContenido, null, 2), 'utf-8');
    console.log(`[LandingEditor] Contenido actualizado por ${nuevoContenido._meta.actualizadoPor}`);

    res.json({ success: true, message: 'Contenido guardado correctamente', meta: nuevoContenido._meta });
  } catch (error) {
    console.error('Error guardando landing-content:', error);
    res.status(500).json({ success: false, error: 'Error al guardar' });
  }
});

// POST /api/admin/landing-content/reset â€” restaurar valores por defecto
app.post('/api/admin/landing-content/reset', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const DEFAULT_PATH = path.join(__dirname, 'landing-content.json');
    // Leemos el archivo actual y lo restauramos borrando la meta
    const content = leerLandingContent();
    if (content) {
      content._meta = { ultimaActualizacion: null, actualizadoPor: null };
      fs.writeFileSync(DEFAULT_PATH, JSON.stringify(content, null, 2), 'utf-8');
    }
    res.json({ success: true, message: 'Contenido restaurado' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al restaurar' });
  }
});

// ==============================================================
// MÃ“DULO 3 â€” Landing content con persistencia en MySQL
// ==============================================================

// --- Helpers ---

/**
 * Recibe el objeto de contenido de la landing y devuelve
 * arrays de filas para landing_texts y landing_images.
 */
function contentToRows(content) {
  const texts  = [];
  const images = [];

  const pushText  = (slug, idx, clave, valor) => texts.push({ section_slug: slug, item_index: idx, clave, valor: valor != null ? String(valor) : '' });
  const pushImage = (slug, idx, clave, url)   => images.push({ section_slug: slug, item_index: idx, clave, url: url || '' });

  // hero â€” fields: title, subtitle, description, image, sport, accent
  const slides = content?.hero?.slides || [];
  slides.forEach((s, i) => {
    pushText('hero', i, 'title',       s.title);
    pushText('hero', i, 'subtitle',    s.subtitle);
    pushText('hero', i, 'description', s.description);
    pushText('hero', i, 'sport',       s.sport);
    pushText('hero', i, 'accent',      s.accent);
    if (s.image) pushImage('hero', i, 'image', s.image);
  });

  // deportes â€” fields: titulo, descripcion, imagen, categoria, fecha, destacado
  const deportes = content?.deportes || [];
  deportes.forEach((d, i) => {
    pushText('deportes', i, 'titulo',      d.titulo);
    pushText('deportes', i, 'descripcion', d.descripcion);
    pushText('deportes', i, 'categoria',   d.categoria);
    pushText('deportes', i, 'fecha',       d.fecha);
    pushText('deportes', i, 'destacado',   d.destacado ? '1' : '0');
    if (d.imagen) pushImage('deportes', i, 'imagen', d.imagen);
  });

  // estadisticas â€” flat object: gente, partidos, anos, trofeos
  const est = content?.estadisticas || {};
  pushText('estadisticas', 0, 'gente',    est.gente);
  pushText('estadisticas', 0, 'partidos', est.partidos);
  pushText('estadisticas', 0, 'anos',     est.anos);
  pushText('estadisticas', 0, 'trofeos',  est.trofeos);

  // docentes â€” fields: nombre, especialidad, foto
  const docentes = content?.docentes || [];
  docentes.forEach((d, i) => {
    pushText('docentes', i, 'nombre',       d.nombre);
    pushText('docentes', i, 'especialidad', d.especialidad);
    if (d.foto) pushImage('docentes', i, 'foto', d.foto);
  });

  // cta â€” fields: titulo, subtitulo, botonTexto, botonEnlace + imagen
  const cta = content?.cta || {};
  pushText('cta', 0, 'titulo',      cta.titulo);
  pushText('cta', 0, 'subtitulo',   cta.subtitulo);
  pushText('cta', 0, 'botonTexto',  cta.botonTexto);
  pushText('cta', 0, 'botonEnlace', cta.botonEnlace);
  if (cta.imagen) pushImage('cta', 0, 'imagen', cta.imagen);

  // general â€” fields: nombreClub, copyright, facebook, whatsapp
  const gen = content?.general || {};
  pushText('general', 0, 'nombreClub', gen.nombreClub);
  pushText('general', 0, 'copyright',  gen.copyright);
  pushText('general', 0, 'facebook',   gen.facebook);
  pushText('general', 0, 'whatsapp',   gen.whatsapp);

  // tipografia â€” fields: fuenteTitulos, pesoTitulos, fuenteCuerpo
  const tip = content?.tipografia || {};
  pushText('tipografia', 0, 'fuenteTitulos', tip.fuenteTitulos);
  pushText('tipografia', 0, 'pesoTitulos',   tip.pesoTitulos);
  pushText('tipografia', 0, 'fuenteCuerpo',  tip.fuenteCuerpo);

  // partidos â€” array de 4 partidos, cada uno con equipoLocal, equipoVisita, fecha, resultado, liga, season, sede
  const partidos = content?.partidos || [];
  partidos.forEach((p, i) => {
    pushText('partidos', i, 'local_nombre',  p.equipoLocal?.nombre);
    pushText('partidos', i, 'visita_nombre', p.equipoVisita?.nombre);
    pushText('partidos', i, 'fecha',         p.fecha);
    pushText('partidos', i, 'resultado',     p.resultado);
    pushText('partidos', i, 'liga',          p.liga);
    pushText('partidos', i, 'season',        p.season);
    pushText('partidos', i, 'sede',          p.sede);
    if (p.equipoLocal?.logo)  pushImage('partidos', i, 'local_logo',  p.equipoLocal.logo);
    if (p.equipoVisita?.logo) pushImage('partidos', i, 'visita_logo', p.equipoVisita.logo);
  });

  // novedades â€” header (subtitulo, titulo) + array de items
  const nov = content?.novedades || {};
  pushText('novedades', 0, 'subtitulo', nov.subtitulo);
  pushText('novedades', 0, 'titulo',    nov.titulo);
  (nov.items || []).forEach((item, i) => {
    pushText('novedades_art', i, 'categoria',      item.categoria);
    pushText('novedades_art', i, 'titulo',          item.titulo);
    pushText('novedades_art', i, 'fecha',           item.fecha);
    pushText('novedades_art', i, 'comentarios',     item.comentarios);
    pushText('novedades_art', i, 'enlace',          item.enlace);
    pushText('novedades_art', i, 'alt',             item.alt);
    pushText('novedades_art', i, 'categoria_href',  item.categoria_href);
    pushText('novedades_art', i, 'titulo_href',     item.titulo_href);
    if (item.imagen) pushImage('novedades_art', i, 'imagen', item.imagen);
  });

  // patrocinadores â€” array de sponsors con nombre, enlace e imagen opcional
  const sponsors = content?.patrocinadores || [];
  sponsors.forEach((sp, i) => {
    pushText('patrocinadores', i, 'nombre', sp.nombre);
    pushText('patrocinadores', i, 'enlace', sp.enlace);
    if (sp.imagen) pushImage('patrocinadores', i, 'logo', sp.imagen);
  });

  // galeria â€” botonTexto + 6 items con alt e imagen
  const galeria = content?.galeria || {};
  pushText('galeria', 0, 'botonTexto', galeria.botonTexto);
  const galeriaItems = galeria.items || [];
  galeriaItems.forEach((item, i) => {
    pushText('galeria', i + 1, 'alt', item.alt);
    if (item.imagen) pushImage('galeria', i + 1, 'imagen', item.imagen);
  });

  return { texts, images };
}

/**
 * A partir de arrays de filas de la BD, reconstruye
 * el mismo objeto JSON que espera el frontend.
 */
function rowsToContent(textRows, imageRows) {
  // Index por clave compuesta slug|idx|clave
  const tIdx = {};
  textRows.forEach(r => { tIdx[`${r.section_slug}|${r.item_index}|${r.clave}`] = r.valor; });

  const iIdx = {};
  imageRows.forEach(r => { iIdx[`${r.section_slug}|${r.item_index}|${r.clave}`] = r.url; });

  const maxIdx = (slug, rows) => {
    let max = -1;
    rows.forEach(r => { if (r.section_slug === slug && r.item_index > max) max = r.item_index; });
    return max;
  };

  // hero
  const heroMax = maxIdx('hero', textRows);
  const slides = heroMax < 0 ? [] : Array.from({ length: heroMax + 1 }, (_, i) => ({
    id:           i + 1,
    sport:        tIdx[`hero|${i}|sport`]       || '',
    title:        tIdx[`hero|${i}|title`]        || '',
    subtitle:     tIdx[`hero|${i}|subtitle`]     || '',
    description:  tIdx[`hero|${i}|description`]  || '',
    accent:       tIdx[`hero|${i}|accent`]       || '',
    image:        iIdx[`hero|${i}|image`]        || ''
  }));

  // deportes
  const depMax = maxIdx('deportes', textRows);
  const deportes = depMax < 0 ? [] : Array.from({ length: depMax + 1 }, (_, i) => ({
    id:          i + 1,
    titulo:      tIdx[`deportes|${i}|titulo`]      || '',
    descripcion: tIdx[`deportes|${i}|descripcion`] || '',
    categoria:   tIdx[`deportes|${i}|categoria`]   || '',
    fecha:       tIdx[`deportes|${i}|fecha`]       || '',
    destacado:   tIdx[`deportes|${i}|destacado`]   === '1',
    imagen:      iIdx[`deportes|${i}|imagen`]      || ''
  }));

  // estadisticas â€” flat object (no es array)
  const estadisticas = {
    gente:    tIdx['estadisticas|0|gente']    || '',
    partidos: tIdx['estadisticas|0|partidos'] || '',
    anos:     tIdx['estadisticas|0|anos']     || '',
    trofeos:  tIdx['estadisticas|0|trofeos']  || ''
  };

  // docentes
  const docMax = maxIdx('docentes', textRows);
  const docentes = docMax < 0 ? [] : Array.from({ length: docMax + 1 }, (_, i) => ({
    id:           i + 1,
    nombre:       tIdx[`docentes|${i}|nombre`]       || '',
    especialidad: tIdx[`docentes|${i}|especialidad`] || '',
    foto:         iIdx[`docentes|${i}|foto`]         || ''
  }));

  return {
    hero:         { slides },
    deportes,
    estadisticas,
    docentes,
    partidos: (() => {
      const max = maxIdx('partidos', textRows);
      if (max < 0) return [];
      return Array.from({ length: max + 1 }, (_, i) => ({
        id:           i + 1,
        equipoLocal:  { nombre: tIdx[`partidos|${i}|local_nombre`]  || '', logo: iIdx[`partidos|${i}|local_logo`]  || '' },
        equipoVisita: { nombre: tIdx[`partidos|${i}|visita_nombre`] || '', logo: iIdx[`partidos|${i}|visita_logo`] || '' },
        fecha:         tIdx[`partidos|${i}|fecha`]     || '',
        resultado:     tIdx[`partidos|${i}|resultado`] || '',
        liga:          tIdx[`partidos|${i}|liga`]      || '',
        season:        tIdx[`partidos|${i}|season`]    || '',
        sede:          tIdx[`partidos|${i}|sede`]      || '',
      }));
    })(),
    cta: {
      titulo:      tIdx['cta|0|titulo']      || '',
      subtitulo:   tIdx['cta|0|subtitulo']   || '',
      botonTexto:  tIdx['cta|0|botonTexto']  || '',
      botonEnlace: tIdx['cta|0|botonEnlace'] || '/inscripcion',
      imagen:      iIdx['cta|0|imagen']      || ''
    },
    general: {
      nombreClub: tIdx['general|0|nombreClub'] || '',
      copyright:  tIdx['general|0|copyright']  || '',
      facebook:   tIdx['general|0|facebook']   || '',
      whatsapp:   tIdx['general|0|whatsapp']   || ''
    },
    tipografia: {
      fuenteTitulos: tIdx['tipografia|0|fuenteTitulos'] || 'Inter Tight',
      pesoTitulos:   tIdx['tipografia|0|pesoTitulos']   || '700',
      fuenteCuerpo:  tIdx['tipografia|0|fuenteCuerpo']  || 'DM Sans',
    },
    novedades: {
      subtitulo: tIdx['novedades|0|subtitulo'] || 'Academia Jaguares',
      titulo:    tIdx['novedades|0|titulo']    || 'Ãšltimas Novedades',
      items: (() => {
        const max = maxIdx('novedades_art', textRows);
        if (max < 0) return [];
        return Array.from({ length: max + 1 }, (_, i) => ({
          id:            i + 1,
          categoria:     tIdx[`novedades_art|${i}|categoria`]     || '',
          titulo:        tIdx[`novedades_art|${i}|titulo`]         || '',
          fecha:         tIdx[`novedades_art|${i}|fecha`]          || '',
          comentarios:   tIdx[`novedades_art|${i}|comentarios`]    || '',
          enlace:        tIdx[`novedades_art|${i}|enlace`]         || '#',
          alt:           tIdx[`novedades_art|${i}|alt`]            || '',
          categoria_href:tIdx[`novedades_art|${i}|categoria_href`] || '#',
          titulo_href:   tIdx[`novedades_art|${i}|titulo_href`]    || '#',
          imagen:        iIdx[`novedades_art|${i}|imagen`]         || '',
        }));
      })()
    },
    patrocinadores: (() => {
      const max = maxIdx('patrocinadores', textRows);
      if (max < 0) return [];
      return Array.from({ length: max + 1 }, (_, i) => ({
        id:     i + 1,
        nombre: tIdx[`patrocinadores|${i}|nombre`] || '',
        enlace: tIdx[`patrocinadores|${i}|enlace`] || '#',
        imagen: iIdx[`patrocinadores|${i}|logo`]   || '',
      }));
    })(),
    galeria: {
      botonTexto: tIdx['galeria|0|botonTexto'] || 'SÃ­guenos en Facebook',
      items: Array.from({ length: 6 }, (_, i) => ({
        imagen: iIdx[`galeria|${i + 1}|imagen`] || '',
        alt:    tIdx[`galeria|${i + 1}|alt`]    || '',
      }))
    }
  };
}

// GET /api/landing
// Devuelve el contenido activo de la landing para el pÃºblico.
// Prioridad: landing_versions (status=published) â†’ landing_texts/images â†’ JSON fallback
app.get('/api/landing', async (req, res) => {
  try {
    // Cache: 30 s browser + stale-while-revalidate 60 s para CDN/proxy
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');

    // MÃ³dulo 5: buscar versiÃ³n publicada en landing_versions
    const [vRows] = await db.query(
      `SELECT content FROM landing_versions WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`
    );
    if (vRows.length > 0) {
      const content = typeof vRows[0].content === 'string'
        ? JSON.parse(vRows[0].content)
        : vRows[0].content;
      return res.json({ success: true, source: 'versions', data: normalizeLandingContent(content) });
    }

    // MÃ³dulo 3 fallback: landing_texts / landing_images
    const [textRows]  = await db.query('SELECT section_slug, item_index, clave, valor FROM landing_texts');
    const [imageRows] = await db.query('SELECT section_slug, item_index, clave, url FROM landing_images');

    if (textRows.length === 0 && imageRows.length === 0) {
      const json = leerLandingContent();
      return res.json({ success: true, source: 'json', data: normalizeLandingContent(json) });
    }

    const data = rowsToContent(textRows, imageRows);
    res.json({ success: true, source: 'db', data: normalizeLandingContent(data) });
  } catch (error) {
    console.error('[Landing] Error GET /api/landing:', error);
    const json = leerLandingContent();
    if (json) {
      res.set('X-Landing-Source', 'json-fallback');
      return res.json({ success: true, source: 'json-fallback', data: normalizeLandingContent(json) });
    }
    res.status(500).json({ success: false, error: 'Error al leer contenido' });
  }
});

// POST /api/landing/update
// Guarda el contenido completo en la BD Y en landing-content.json.
// Requiere autenticaciÃ³n de admin.
app.post('/api/landing/update', verificarAutenticacion, verificarAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const validation = validateLandingContent(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: 'Contenido invÃ¡lido', details: validation.errors });
    }
    const content = normalizeLandingContent(req.body);

    const { texts, images } = contentToRows(content);

    await conn.beginTransaction();

    // UPSERT texts
    for (const t of texts) {
      await conn.query(
        `INSERT INTO landing_texts (section_slug, item_index, clave, valor)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor), updated_at = CURRENT_TIMESTAMP`,
        [t.section_slug, t.item_index, t.clave, t.valor]
      );
    }

    // UPSERT images
    for (const img of images) {
      await conn.query(
        `INSERT INTO landing_images (section_slug, item_index, clave, url)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE url = VALUES(url), updated_at = CURRENT_TIMESTAMP`,
        [img.section_slug, img.item_index, img.clave, img.url]
      );
    }

    await conn.commit();

    // TambiÃ©n persistir en JSON para backward-compat con endpoints viejos
    const meta = {
      ultimaActualizacion: new Date().toISOString(),
      actualizadoPor: req.usuario?.email || 'admin'
    };
    const contentConMeta = { ...content, _meta: meta };
    fs.writeFileSync(LANDING_CONTENT_PATH, JSON.stringify(contentConMeta, null, 2), 'utf-8');

    console.log(`[Landing] Contenido actualizado en BD+JSON por ${meta.actualizadoPor}. Textos: ${texts.length}, ImÃ¡genes: ${images.length}`);
    res.json({ success: true, message: 'Contenido guardado en BD y JSON', meta, stats: { texts: texts.length, images: images.length } });
  } catch (error) {
    await conn.rollback();
    console.error('[Landing] Error POST /api/landing/update:', error);
    res.status(500).json({ success: false, error: 'Error al guardar contenido' });
  } finally {
    conn.release();
  }
});

// POST /api/landing/seed
// Admin only. Lee landing-content.json y lo migra a la BD.
// Ãštil para la primera carga o para resetear desde el archivo.
app.post('/api/landing/seed', verificarAutenticacion, verificarAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const content = leerLandingContent();
    if (!content) return res.status(404).json({ success: false, error: 'landing-content.json no encontrado' });

    const { texts, images } = contentToRows(content);

    await conn.beginTransaction();

    // Limpiar antes de insertar (para seed limpio)
    await conn.query('DELETE FROM landing_texts');
    await conn.query('DELETE FROM landing_images');

    for (const t of texts) {
      await conn.query(
        'INSERT INTO landing_texts (section_slug, item_index, clave, valor) VALUES (?, ?, ?, ?)',
        [t.section_slug, t.item_index, t.clave, t.valor]
      );
    }
    for (const img of images) {
      await conn.query(
        'INSERT INTO landing_images (section_slug, item_index, clave, url) VALUES (?, ?, ?, ?)',
        [img.section_slug, img.item_index, img.clave, img.url]
      );
    }

    await conn.commit();
    console.log(`[Landing] Seed completado. Textos: ${texts.length}, ImÃ¡genes: ${images.length}`);
    res.json({ success: true, message: 'Seed completado', stats: { texts: texts.length, images: images.length } });
  } catch (error) {
    await conn.rollback();
    console.error('[Landing] Error en seed:', error);
    res.status(500).json({ success: false, error: 'Error en seed' });
  } finally {
    conn.release();
  }
});

// POST /api/landing/upload-image
// Alias del endpoint de subida de imÃ¡genes que ya existe.
// Usa el mismo middleware multer (imageUpload).
app.post('/api/landing/upload-image', verificarAutenticacion, verificarAdmin, imageUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibiÃ³ ninguna imagen' });
    const media = await registrarMedio(req);
    console.log(`[Landing] Imagen #${media.id} subida: ${media.url}`);
    res.status(201).json({ success: true, mediaId: media.id, url: media.url, originalName: req.file.originalname });
  } catch (error) {
    next(error);
  }
});

// GET /api/landing/media - biblioteca de imÃ¡genes del CMS
app.get('/api/landing/media', verificarAutenticacion, verificarAdmin, async (_req, res) => {
  try {
    const [media] = await db.query(
      `SELECT id, filename, original_name, mime_type, size_bytes, width, height, url, alt_text, created_by, created_at
       FROM landing_media ORDER BY created_at DESC, id DESC LIMIT 300`
    );
    res.json({ success: true, media });
  } catch (error) {
    console.error('[Landing] Error listando medios:', error);
    res.status(500).json({ success: false, error: 'No se pudo cargar la biblioteca de imÃ¡genes.' });
  }
});

// DELETE /api/landing/media/:id - solo elimina archivos administrados por el CMS
app.delete('/api/landing/media/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Identificador de imagen invÃ¡lido.' });
    }
    const [rows] = await db.query('SELECT filename FROM landing_media WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Imagen no encontrada.' });

    const target = path.resolve(UPLOADS_DIR, rows[0].filename);
    const safePrefix = `${UPLOADS_DIR}${path.sep}`;
    if (!target.startsWith(safePrefix)) {
      return res.status(400).json({ success: false, error: 'Ruta de imagen invÃ¡lida.' });
    }

    await db.query('DELETE FROM landing_media WHERE id = ?', [id]);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    res.json({ success: true, message: 'Imagen eliminada de la biblioteca.' });
  } catch (error) {
    console.error('[Landing] Error eliminando medio:', error);
    res.status(500).json({ success: false, error: 'No se pudo eliminar la imagen.' });
  }
});

// ==============================================================
// MÃ“DULO 5 â€” SISTEMA DE PUBLICACIÃ“N DE VERSIONES
// ==============================================================

// GET /api/landing/versions
// Lista todas las versiones (sin el campo content para no saturar).
// Requiere autenticaciÃ³n de admin.
app.get('/api/landing/versions', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, label, notes, status, created_at, created_by, published_at, published_by
       FROM landing_versions
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ success: true, versions: rows });
  } catch (error) {
    console.error('[Versions] Error GET /api/landing/versions:', error);
    res.status(500).json({ success: false, error: 'Error al leer versiones' });
  }
});

// GET /api/landing/versions/:id
// Devuelve el contenido completo de una versiÃ³n especÃ­fica.
// Requiere autenticaciÃ³n de admin.
app.get('/api/landing/versions/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT id, label, notes, status, content, created_at, created_by, published_at, published_by
       FROM landing_versions WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'VersiÃ³n no encontrada' });

    const version = rows[0];
    if (typeof version.content === 'string') version.content = JSON.parse(version.content);
    res.json({ success: true, version });
  } catch (error) {
    console.error('[Versions] Error GET /api/landing/versions/:id:', error);
    res.status(500).json({ success: false, error: 'Error al leer versiÃ³n' });
  }
});

// POST /api/landing/draft
// Guarda el contenido actual como un nuevo borrador.
// NO modifica la versiÃ³n publicada ni afecta al pÃºblico.
// Requiere autenticaciÃ³n de admin.
app.post('/api/landing/draft', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const validation = validateLandingContent(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: 'Contenido invÃ¡lido', details: validation.errors });
    }

    // CRÃTICO: preservar pagos del JSON actual si el editor no los envÃ­a
    const draftBody = { ...req.body };
    // SIEMPRE inyectar pagos del JSON en el borrador
    {
      const currentJson = leerLandingContent();
      if (currentJson?.pagos) {
        draftBody.pagos = currentJson.pagos;
        console.log('[Draft] Pagos preservados desde JSON actual al guardar borrador');
      }
    }
    const content = normalizeLandingContent(draftBody);

    const autor = req.user?.username || req.admin?.usuario || 'admin';
    const now   = new Date();
    const label  = content._draftLabel
      || `Borrador Â· ${now.toLocaleDateString('es-PE')} ${now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;
    const notes  = content._draftNotes || null;

    // Limpiar metadatos del editor del contenido antes de guardar
    const cleanContent = { ...content };
    delete cleanContent._draftLabel;
    delete cleanContent._draftNotes;

    const [result] = await db.query(
      `INSERT INTO landing_versions (label, notes, status, content, created_by) VALUES (?, ?, 'draft', ?, ?)`,
      [label, notes, JSON.stringify(cleanContent), autor]
    );

    const draftId = result.insertId;
    console.log(`[Versions] Borrador #${draftId} creado por ${autor}: "${label}"`);
    res.json({ success: true, draftId, label, message: 'Borrador guardado. La landing pÃºblica no ha cambiado.' });
  } catch (error) {
    console.error('[Versions] Error POST /api/landing/draft:', error);
    res.status(500).json({ success: false, error: 'Error al guardar borrador' });
  }
});

// POST /api/landing/publish/:id
// Publica una versiÃ³n especÃ­fica:
//   1. Archiva la versiÃ³n publicada actual (si existe)
//   2. Marca la versiÃ³n target como 'published'
//   3. Actualiza landing_texts/images para backward compat
//   4. Actualiza landing-content.json
// Requiere autenticaciÃ³n de admin.
app.post('/api/landing/publish/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { id } = req.params;
    const autor   = req.user?.username || req.admin?.usuario || 'admin';

    // 1. Verificar que la versiÃ³n existe y estÃ¡ en estado vÃ¡lido
    const [rows] = await conn.query(
      `SELECT id, label, status, content FROM landing_versions WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'VersiÃ³n no encontrada' });
    }
    const version = rows[0];
    if (version.status === 'archived') {
      // Permitir rollback desde archivado â€” continuar igual
    }

    const rawContent = typeof version.content === 'string'
      ? JSON.parse(version.content)
      : version.content;

    // CRÃTICO: preservar pagos del JSON actual si la versiÃ³n no los incluye
    // El editor de landing no gestiona pagos, por eso no los envÃ­a en el borrador
    // SIEMPRE inyectar pagos desde el JSON â€” el CMS nunca gestiona pagos
    // Esto garantiza que publish nunca sobreescriba el numero de plin/yape
    {
      const currentJson = leerLandingContent();
      if (currentJson?.pagos) {
        rawContent.pagos = currentJson.pagos;
        console.log('[Versions] Pagos preservados desde JSON actual al publicar versiÃ³n');
      }
    }

    const validation = validateLandingContent(rawContent);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: 'La versiÃ³n contiene datos invÃ¡lidos.', details: validation.errors });
    }
    const content = normalizeLandingContent(rawContent);

    await conn.beginTransaction();

    // 2. Archivar la versiÃ³n publicada actual
    await conn.query(
      `UPDATE landing_versions SET status = 'archived' WHERE status = 'published' AND id != ?`,
      [id]
    );

    // 3. Publicar la versiÃ³n target
    await conn.query(
      `UPDATE landing_versions SET status = 'published', published_at = NOW(), published_by = ? WHERE id = ?`,
      [autor, id]
    );

    // 4. Actualizar landing_texts / landing_images para backward compat
    const { texts, images } = contentToRows(content);

    await conn.query('DELETE FROM landing_texts');
    await conn.query('DELETE FROM landing_images');

    for (const t of texts) {
      await conn.query(
        `INSERT INTO landing_texts (section_slug, item_index, clave, valor) VALUES (?, ?, ?, ?)`,
        [t.section_slug, t.item_index, t.clave, t.valor]
      );
    }
    for (const img of images) {
      await conn.query(
        `INSERT INTO landing_images (section_slug, item_index, clave, url) VALUES (?, ?, ?, ?)`,
        [img.section_slug, img.item_index, img.clave, img.url]
      );
    }

    await conn.commit();

    // 5. Actualizar landing-content.json
    const meta = {
      ultimaActualizacion: new Date().toISOString(),
      actualizadoPor: autor,
      versionId: Number(id),
      versionLabel: version.label,
    };
    fs.writeFileSync(LANDING_CONTENT_PATH, JSON.stringify({ ...content, _meta: meta }, null, 2), 'utf-8');

    console.log(`[Versions] VersiÃ³n #${id} ("${version.label}") publicada por ${autor}`);
    res.json({
      success: true,
      message: `VersiÃ³n "${version.label}" publicada exitosamente. La landing pÃºblica ya muestra el nuevo contenido.`,
      publishedId: Number(id),
      label: version.label,
      publishedAt: new Date().toISOString(),
      publishedBy: autor,
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[Versions] Error POST /api/landing/publish/:id:', error);
    res.status(500).json({ success: false, error: 'Error al publicar versiÃ³n' });
  } finally {
    conn.release();
  }
});

// DELETE /api/landing/versions/:id
// Elimina un borrador. No se pueden eliminar versiones publicadas ni archivadas.
// Requiere autenticaciÃ³n de admin.
app.delete('/api/landing/versions/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT id, label, status FROM landing_versions WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'VersiÃ³n no encontrada' });

    if (rows[0].status === 'published') {
      return res.status(409).json({ success: false, error: 'No se puede eliminar la versiÃ³n publicada actualmente.' });
    }

    await db.query(`DELETE FROM landing_versions WHERE id = ?`, [id]);
    console.log(`[Versions] VersiÃ³n #${id} ("${rows[0].label}") eliminada`);
    res.json({ success: true, message: `VersiÃ³n "${rows[0].label}" eliminada.` });
  } catch (error) {
    console.error('[Versions] Error DELETE /api/landing/versions/:id:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar versiÃ³n' });
  }
});

// ==============================================================
// FIN MÃ“DULO 5
// ==============================================================

// ==============================================================
// MÃ“DULO 6 â€” ORDEN DE SECCIONES (landing_structure)
// ==============================================================

// GET /api/landing/structure
// PÃºblico â€” la landing pÃºblica lo consume para ordenar secciones.
// Si la tabla estÃ¡ vacÃ­a devuelve los valores por defecto.
app.get('/api/landing/structure', async (req, res) => {
  try {
    // Cache: 60 s browser + stale-while-revalidate 120 s (el orden de secciones cambia poco)
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

    const [dbRows] = await db.query(
      `SELECT section_slug, orden, visible FROM landing_structure ORDER BY orden ASC`
    );
    const allowedSlugs = new Set(DEFAULT_LANDING_STRUCTURE.map(s => s.section_slug));
    const rows = dbRows.filter(row => allowedSlugs.has(row.section_slug));

    // Si la tabla no tiene datos, devolver defaults y no romperse
    if (rows.length === 0) {
      return res.json({ success: true, source: 'defaults', sections: DEFAULT_LANDING_STRUCTURE });
    }

    // Mezclar: lo que hay en DB + defaults para secciones no registradas
    const dbSlugs = new Set(rows.map(r => r.section_slug));
    const missing = DEFAULT_LANDING_STRUCTURE.filter(d => !dbSlugs.has(d.section_slug));
    const all = [...rows, ...missing].sort((a, b) => a.orden - b.orden);

    res.json({ success: true, source: 'db', sections: all });
  } catch (error) {
    // Si la tabla no existe, devolver defaults sin llenar logs de errores
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.json({ success: true, source: 'defaults', sections: DEFAULT_LANDING_STRUCTURE });
    }
    console.error('[Structure] Error GET /api/landing/structure:', error);
    // Fallback seguro: nunca romper la landing por fallo de estructura
    res.json({ success: true, source: 'fallback', sections: DEFAULT_LANDING_STRUCTURE });
  }
});

// POST /api/landing/structure
// Admin only â€” guarda el nuevo orden de secciones.
// Body: { sections: [{section_slug, orden, visible}] }
app.post('/api/landing/structure', verificarAutenticacion, verificarAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { sections } = req.body;
    if (!Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ success: false, error: 'Se esperaba sections: [{section_slug, orden, visible}]' });
    }

    const allowedSlugs = new Set(DEFAULT_LANDING_STRUCTURE.map(s => s.section_slug));
    const seen = new Set();
    for (const section of sections) {
      const order = Number(section.orden);
      if (!allowedSlugs.has(section.section_slug) || seen.has(section.section_slug)) {
        return res.status(400).json({ success: false, error: `SecciÃ³n invÃ¡lida o duplicada: ${section.section_slug || '(vacÃ­a)'}` });
      }
      if (!Number.isFinite(order) || order < 0 || order > 1000) {
        return res.status(400).json({ success: false, error: `Orden invÃ¡lido para ${section.section_slug}.` });
      }
      seen.add(section.section_slug);
    }

    await conn.beginTransaction();
    for (const s of sections) {
      await conn.query(
        `INSERT INTO landing_structure (section_slug, orden, visible)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE orden = VALUES(orden), visible = VALUES(visible)`,
        [s.section_slug, Number(s.orden), s.visible !== undefined ? (s.visible ? 1 : 0) : 1]
      );
    }
    await conn.commit();

    const autor = req.usuario?.email || 'admin';
    console.log(`[Structure] Orden de ${sections.length} secciones actualizado por ${autor}`);
    res.json({ success: true, message: `Orden de ${sections.length} secciones guardado.`, sections: sections.length });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[Structure] Error POST /api/landing/structure:', error);
    res.status(500).json({ success: false, error: 'Error al guardar estructura' });
  } finally {
    conn.release();
  }
});

// ==============================================================
// FIN MÃ“DULO 6
// ==============================================================

// ==============================================================
// FIN MÃ“DULO 3
// ==============================================================

// Iniciar servidor
/**
 * POST /api/admin/inscripciones/:inscripcionId/override-horario
 * OVERRIDE ADMIN: Agregar un horario a una inscripcion saltando las validaciones de plan/categoria.
 * Permite al admin asignar horarios de diferente plan o categoria al mismo alumno
 * (ej: alumno Premium que tambien entrena con grupo Estandar).
 * El precio NO se recalcula: el admin lo gestiona manualmente en pagos mensuales.
 * Protegido: solo administradores autenticados.
 */
app.post('/api/admin/inscripciones/:inscripcionId/override-horario', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { inscripcionId } = req.params;
    const { horario_id } = req.body;

    if (!horario_id) {
      return res.status(400).json({ success: false, error: 'Se requiere horario_id en el body' });
    }

    if (!db) {
      return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
    }

    // 1. Verificar que la inscripcion existe y obtener datos para el log
    const [inscRows] = await db.query(`
      SELECT i.inscripcion_id, i.deporte_id, i.plan, i.estado,
             d.nombre as deporte, a.dni, a.nombres
      FROM inscripciones i
      JOIN deportes d ON i.deporte_id = d.deporte_id
      JOIN alumnos a ON i.alumno_id = a.alumno_id
      WHERE i.inscripcion_id = ?
    `, [inscripcionId]);

    if (inscRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Inscripcion no encontrada' });
    }

    const inscripcion = inscRows[0];

    // 2. Verificar que el horario existe y pertenece al MISMO deporte (unica restriccion que se mantiene)
    const [horRows] = await db.query(`
      SELECT horario_id, dia, plan, categoria,
             TIME_FORMAT(hora_inicio, '%H:%i') as hora_inicio,
             TIME_FORMAT(hora_fin, '%H:%i') as hora_fin
      FROM horarios
      WHERE horario_id = ? AND deporte_id = ? AND estado = 'activo'
    `, [horario_id, inscripcion.deporte_id]);

    if (horRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El horario no existe, no pertenece al mismo deporte, o no esta activo'
      });
    }

    const horario = horRows[0];

    // 3. Verificar que el alumno NO este ya asignado a ese horario en esta inscripcion
    const [existRows] = await db.query(`
      SELECT 1 FROM inscripcion_horarios
      WHERE inscripcion_id = ? AND horario_id = ?
    `, [inscripcionId, horario_id]);

    if (existRows.length > 0) {
      return res.status(409).json({ success: false, error: 'El alumno ya esta asignado a ese horario en esta inscripcion' });
    }

    // 4. Insertar el horario (SIN validar plan ni categoria - ese es el override)
    await db.query(`
      INSERT INTO inscripcion_horarios (inscripcion_id, horario_id) VALUES (?, ?)
    `, [inscripcionId, horario_id]);

    // 5. Invalidar cache del alumno
    if (typeof invalidateDNICache === 'function') {
      invalidateDNICache(inscripcion.dni);
    }

    console.log(`âš¡ OVERRIDE ADMIN: horario ${horario_id} (${horario.dia} ${horario.hora_inicio} - Plan ${horario.plan}, Cat ${horario.categoria}) agregado a inscripcion ${inscripcionId} (${inscripcion.deporte}) del alumno DNI ${inscripcion.dni} - ${inscripcion.nombres}`);

    res.json({
      success: true,
      mensaje: `Horario del ${horario.dia} ${horario.hora_inicio} agregado correctamente como acceso especial`,
      horario: {
        horario_id: horario.horario_id,
        dia: horario.dia,
        hora_inicio: horario.hora_inicio,
        hora_fin: horario.hora_fin,
        plan: horario.plan,
        categoria: horario.categoria
      },
      aviso: 'El precio mensual NO se actualizo automaticamente. Ajustalo manualmente en Pagos Mensuales si es necesario.'
    });

  } catch (error) {
    console.error('âŒ Error en override-horario admin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/inscripciones/:inscripcionId/override-horario/:horarioId
 * Quitar un horario de acceso especial de una inscripcion (admin override).
 */
app.delete('/api/admin/inscripciones/:inscripcionId/override-horario/:horarioId', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { inscripcionId, horarioId } = req.params;

    if (!db) {
      return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
    }

    // Obtener datos para el log y validacion
    const [rows] = await db.query(`
      SELECT i.inscripcion_id, a.dni, a.nombres, d.nombre as deporte
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.alumno_id
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.inscripcion_id = ?
    `, [inscripcionId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Inscripcion no encontrada' });
    }

    // Verificar que el horario esta asignado
    const [existRows] = await db.query(`
      SELECT 1 FROM inscripcion_horarios WHERE inscripcion_id = ? AND horario_id = ?
    `, [inscripcionId, horarioId]);

    if (existRows.length === 0) {
      return res.status(404).json({ success: false, error: 'El horario no esta asignado a esta inscripcion' });
    }

    // Verificar cuantos horarios quedan
    const [totalRows] = await db.query(`
      SELECT COUNT(*) as total FROM inscripcion_horarios WHERE inscripcion_id = ?
    `, [inscripcionId]);

    const alumno = rows[0];
    const esUltimo = totalRows[0].total <= 1;

    if (esUltimo) {
      // --- Cancelar inscripcion completa (es el ultimo horario) ---
      // 1. Cancelar la inscripcion
      await db.query(
        `UPDATE inscripciones SET estado = 'cancelada' WHERE inscripcion_id = ? AND alumno_id IN (SELECT alumno_id FROM alumnos WHERE dni = ?)`,
        [inscripcionId, alumno.dni]
      );

      // 2. Si no quedan otras inscripciones activas/pendientes, marcar alumno inactivo
      const [alumnoRow] = await db.query('SELECT alumno_id FROM alumnos WHERE dni = ?', [alumno.dni]);
      if (alumnoRow.length > 0) {
        const alumnoId = alumnoRow[0].alumno_id;
        const [restantes] = await db.query(
          `SELECT COUNT(*) as total FROM inscripciones WHERE alumno_id = ? AND estado IN ('activa', 'pendiente')`,
          [alumnoId]
        );
        if (restantes[0].total === 0) {
          await db.query(`UPDATE alumnos SET estado = 'inactivo' WHERE alumno_id = ?`, [alumnoId]);
          console.log(`ðŸ”´ Alumno ${alumno.dni} marcado inactivo (sin inscripciones activas tras cancelar inscripcion ${inscripcionId})`);
        }

        // 3. Recalcular monto total en pagos_mensuales pendientes del mes actual
        //    sumando precio_mensual de las inscripciones que siguen activas
        try {
          const NOMBRES_MESES_NORM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
          const mesActual = NOMBRES_MESES_NORM[new Date().getMonth()];
          const [activasRows] = await db.query(
            `SELECT COALESCE(SUM(precio_mensual), 0) as total_mensual
             FROM inscripciones
             WHERE alumno_id = ? AND estado IN ('activa', 'pendiente') AND inscripcion_id != ?`,
            [alumnoId, inscripcionId]
          );
          const nuevoMontoTotal = parseFloat(activasRows[0].total_mensual) || 0;
          if (nuevoMontoTotal > 0) {
            const [updPm] = await db.query(
              `UPDATE pagos_mensuales SET monto = ? WHERE alumno_id = ? AND mes = ? AND estado = 'pendiente'`,
              [nuevoMontoTotal, alumnoId, mesActual]
            );
            if (updPm.affectedRows > 0) {
              console.log(`ðŸ’° pagos_mensuales actualizado a S/.${nuevoMontoTotal} para DNI ${alumno.dni} mes ${mesActual} (inscripcion ${inscripcionId} cancelada)`);
            }
          } else {
            // Sin inscripciones activas â†’ monto 0, marcar pendiente como cancelado si aplica
            await db.query(
              `UPDATE pagos_mensuales SET monto = 0 WHERE alumno_id = ? AND mes = ? AND estado = 'pendiente'`,
              [alumnoId, mesActual]
            );
            console.log(`ðŸ’° pagos_mensuales puesto a 0 para DNI ${alumno.dni} mes ${mesActual} (sin inscripciones activas)`);
          }
        } catch (ePm) {
          console.error('âš ï¸ Error al recalcular pagos_mensuales tras cancelar inscripcion:', ePm.message);
        }
      }

      if (typeof invalidateDNICache === 'function') invalidateDNICache(alumno.dni);
      const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
      cache.del(inscritosKeys);

      console.log(`ðŸ—‘ï¸ OVERRIDE ADMIN (cancelacion): inscripcion ${inscripcionId} (${alumno.deporte}) cancelada para DNI ${alumno.dni} (ultimo horario eliminado)`);

      return res.json({
        success: true,
        inscripcion_cancelada: true,
        mensaje: `La inscripciÃ³n de ${alumno.deporte} fue cancelada correctamente (era el Ãºnico horario)`
      });
    }

    // --- Caso normal: quedan mÃ¡s horarios, solo quitar este ---
    await db.query(`
      DELETE FROM inscripcion_horarios WHERE inscripcion_id = ? AND horario_id = ?
    `, [inscripcionId, horarioId]);

    if (typeof invalidateDNICache === 'function') {
      invalidateDNICache(alumno.dni);
    }
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    if (inscritosKeys.length > 0) cache.del(inscritosKeys);

    console.log(`ðŸ—‘ï¸ OVERRIDE ADMIN (baja): horario ${horarioId} quitado de inscripcion ${inscripcionId} (${alumno.deporte}) del alumno DNI ${alumno.dni}`);

    res.json({
      success: true,
      inscripcion_cancelada: false,
      mensaje: 'Horario de acceso especial eliminado correctamente'
    });

  } catch (error) {
    console.error('âŒ Error al quitar override-horario admin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


const server = app.listen(PORT, () => {  console.log('');
  console.log('='.repeat(70));
  console.log('ðŸš€ SERVIDOR BACKEND JAGUARES - MODO PRODUCCIÃ“N');
  console.log('='.repeat(70));
  console.log('');
  console.log(`ðŸ“ URL Base:        http://localhost:${PORT}`);
  console.log(`ðŸ—„ï¸  Base de Datos:  MySQL 8.0 (Puerto 3307)`);
  console.log(`âš¡ CachÃ©:           NodeCache activado`);
  console.log('');
  console.log('ðŸ”’ SEGURIDAD ACTIVADA:');
  console.log('  âœ… JWT Authentication (8h expiry)');
  console.log('  âœ… Rate Limiting (100 req/15min general, 10 req/hour inscripciones)');
  console.log('  âœ… CORS RestricciÃ³n (localhost + whitelist)');
  console.log('  âœ… Helmet Security Headers');
  console.log('  âœ… XSS Sanitization');
  console.log('  âœ… Bcrypt Password Hashing');
  console.log('');
  console.log('ðŸƒ ENDPOINTS PÃšBLICOS:');
  console.log(`  GET    /api/health                         - Health check`);
  console.log(`  GET    /api/horarios                       - Listado de horarios disponibles`);
  console.log(`  POST   /api/inscribir-multiple             - InscripciÃ³n mÃºltiple (rate limited)`);
  console.log(`  GET    /api/mis-inscripciones/:dni         - Consultar inscripciones por DNI`);
  console.log(`  GET    /api/validar-dni/:dni               - Validar existencia de DNI`);
  console.log('');
  console.log('ðŸ” ENDPOINTS PROTEGIDOS (Requieren JWT):');
  console.log(`  POST   /api/admin/login                    - AutenticaciÃ³n admin`);
  console.log(`  GET    /api/admin/inscritos                - Listado completo de inscritos`);
  console.log(`  GET    /api/admin/estadisticas-financieras - EstadÃ­sticas financieras`);
  console.log('');
  console.log('â³ Esperando peticiones...');
  console.log('='.repeat(70));
  console.log('');
});

// ==========================================
// PANEL DE ADMINISTRACIÃ“N
// ==========================================

app.post('/api/admin/actualizar-capacidad', async (req, res) => {
  try {
    const { nuevaCapacidad } = req.body;
    
    if (!nuevaCapacidad || nuevaCapacidad < 20 || nuevaCapacidad > 200) {
      return res.status(400).json({ 
        success: false, 
        error: 'Capacidad invÃ¡lida. Debe estar entre 20 y 200.' 
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

    console.log(`âœ… Capacidad actualizada: ${capacidadNum} personas (${nuevoCupo} cupos por taller)`);

    res.json({ 
      success: true, 
      mensaje: 'Capacidad actualizada correctamente',
      nuevaCapacidad: capacidadNum,
      nuevoCupoPorTaller: nuevoCupo
    });
  } catch (error) {
    console.error('âŒ Error al actualizar capacidad:', error);
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
// SISTEMA DE CACHÃ‰ PARA ESTADÃSTICAS
// ==========================================

let cacheEstadisticas = null;
let ultimaActualizacion = null;
const CACHE_DURACION = 2 * 60 * 1000; // 2 minutos

// 8. Obtener estadÃ­sticas completas de talleres (CON CACHÃ‰)
app.get('/api/estadisticas-talleres', async (req, res) => {
  try {
    const ahora = Date.now();
    
    // Si el cachÃ© es vÃ¡lido, devolverlo inmediatamente
    if (cacheEstadisticas && ultimaActualizacion && (ahora - ultimaActualizacion < CACHE_DURACION)) {
      console.log('ðŸ“Š Devolviendo estadÃ­sticas desde cachÃ©');
      return res.json({ 
        success: true, 
        estadisticas: cacheEstadisticas,
        fromCache: true,
        cacheAge: Math.floor((ahora - ultimaActualizacion) / 1000) + 's'
      });
    }

    console.log('ðŸ“Š Generando estadÃ­sticas frescas...');
    
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
      'dia2-taller2': 'MÃºsica y contenido',
      'dia2-taller3': 'Verdad vs relativismo',
      'dia3-taller1': 'PropÃ³sito y vocaciÃ³n',
      'dia3-taller2': 'Misiones',
      'dia3-taller3': 'OrientaciÃ³n vocacional y elecciÃ³n de carrera',
      'dia4-taller1': 'Impacto comunitario',
      'dia4-taller2': 'ComunicaciÃ³n y redes sociales',
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
    
    // Analizar datos demogrÃ¡ficos y talleres
    const distribucionGenero = { M: 0, F: 0 };
    const distribucionEdad = { '13-15': 0, '16-18': 0, '19-21': 0, '22-25': 0, '26+': 0 };
    const distribucionIglesia = {};
    const distribucionPago = { Pagado: 0, Pendiente: 0 };
    let totalTalleresAsignados = 0;
    
    // Contar inscritos (saltar encabezados)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Columnas N-U (Ã­ndices 13-20): talleres seleccionados
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
      
      // DEMOGRAFÃA - GÃ©nero (columna E, Ã­ndice 4)
      const sexo = (row[4] || '').toUpperCase().trim();
      if (sexo === 'M') distribucionGenero.M++;
      else if (sexo === 'F') distribucionGenero.F++;
      
      // Edad (columna D, Ã­ndice 3)
      const edad = parseInt(row[3]) || 0;
      if (edad >= 13 && edad <= 15) distribucionEdad['13-15']++;
      else if (edad >= 16 && edad <= 18) distribucionEdad['16-18']++;
      else if (edad >= 19 && edad <= 21) distribucionEdad['19-21']++;
      else if (edad >= 22 && edad <= 25) distribucionEdad['22-25']++;
      else if (edad >= 26) distribucionEdad['26+']++;
      
      // Iglesia (columna I, Ã­ndice 8)
      const iglesia = row[8] || 'No especificada';
      distribucionIglesia[iglesia] = (distribucionIglesia[iglesia] || 0) + 1;
      
      // Estado de pago (columna K, Ã­ndice 10)
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
    
    // Agrupar por dÃ­a - TODOS los talleres, incluso con 0 inscritos
    const talleresAgrupadosPorDia = {
      dia1: {},
      dia2: {},
      dia3: {},
      dia4: {}
    };
    
    // Agregar TODOS los talleres a su dÃ­a correspondiente
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
    
    // Guardar en cachÃ©
    cacheEstadisticas = estadisticas;
    ultimaActualizacion = Date.now();
    
    console.log('âœ… EstadÃ­sticas generadas y guardadas en cachÃ©:');
    console.log(`   Total inscritos: ${totalInscritos}`);
    console.log(`   Con talleres: ${personasConTalleres} (${estadisticas.resumen.porcentajeConTalleres}%)`);
    console.log(`   Sin talleres: ${personasSinTalleres}`);
    console.log(`   Talleres excedidos: ${estadisticas.talleresExcedidos.length}`);
    
    res.json({ success: true, estadisticas, fromCache: false });
  } catch (error) {
    console.error('Error al obtener estadÃ­sticas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS CRUD DEPORTES ====================

// Obtener todos los deportes
app.get('/api/admin/deportes', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const [deportes] = await db.execute(`
      SELECT deporte_id, nombre, descripcion, icono, estado, matricula, 
             created_at, updated_at
      FROM deportes
      ORDER BY nombre ASC
    `);
    
    console.log(`âœ… Deportes obtenidos: ${deportes.length}`);
    res.json({ success: true, deportes });
  } catch (error) {
    console.error('âŒ Error al obtener deportes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Crear nuevo deporte
app.post('/api/admin/deportes', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const { nombre, descripcion, icono, matricula } = req.body;
    
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    }
    
    const [result] = await db.execute(
      `INSERT INTO deportes (nombre, descripcion, icono, matricula, estado)
       VALUES (?, ?, ?, ?, 'activo')`,
      [nombre, descripcion || null, icono || null, matricula || 20.00]
    );
    
    // Limpiar cachÃ© de horarios
    cache.flushAll();
    
    console.log(`âœ… Deporte creado: ${nombre} (ID: ${result.insertId})`);
    res.json({ success: true, deporte_id: result.insertId, mensaje: 'Deporte creado correctamente' });
  } catch (error) {
    console.error('âŒ Error al crear deporte:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, error: 'Ya existe un deporte con ese nombre' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Actualizar deporte
app.put('/api/admin/deportes/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const deporteId = req.params.id;
    const { nombre, descripcion, icono, matricula, estado } = req.body;
    
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    }
    
    const [result] = await db.execute(
      `UPDATE deportes 
       SET nombre = ?, descripcion = ?, icono = ?, matricula = ?, estado = ?
       WHERE deporte_id = ?`,
      [nombre, descripcion || null, icono || null, matricula || 20.00, estado || 'activo', deporteId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Deporte no encontrado' });
    }
    
    // Limpiar cachÃ©
    cache.flushAll();
    
    console.log(`âœ… Deporte actualizado: ID ${deporteId}`);
    res.json({ success: true, mensaje: 'Deporte actualizado correctamente' });
  } catch (error) {
    console.error('âŒ Error al actualizar deporte:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, error: 'Ya existe un deporte con ese nombre' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Eliminar deporte (soft delete - cambia estado a inactivo)
app.delete('/api/admin/deportes/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const deporteId = req.params.id;
    
    // Verificar si tiene horarios activos
    const [horarios] = await db.execute(
      'SELECT COUNT(*) as total FROM horarios WHERE deporte_id = ? AND estado = "activo"',
      [deporteId]
    );
    
    if (horarios[0].total > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `No se puede eliminar. Tiene ${horarios[0].total} horario(s) activo(s)` 
      });
    }
    
    // Cambiar estado a inactivo en lugar de eliminar
    const [result] = await db.execute(
      'UPDATE deportes SET estado = "inactivo" WHERE deporte_id = ?',
      [deporteId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Deporte no encontrado' });
    }
    
    // Limpiar cachÃ©
    cache.flushAll();
    
    console.log(`âœ… Deporte desactivado: ID ${deporteId}`);
    res.json({ success: true, mensaje: 'Deporte desactivado correctamente' });
  } catch (error) {
    console.error('âŒ Error al eliminar deporte:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Eliminar deporte PERMANENTEMENTE (hard delete)
app.delete('/api/admin/deportes/:id/eliminar-permanente', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const deporteId = req.params.id;
    
    // Iniciar transacciÃ³n (usar query en lugar de execute para transacciones)
    await db.query('START TRANSACTION');
    
    try {
      // 1. Eliminar inscripciones asociadas a horarios de este deporte
      // Primero eliminar de la tabla intermedia inscripcion_horarios
      await db.execute(
        `DELETE ih FROM inscripcion_horarios ih
         INNER JOIN horarios h ON ih.horario_id = h.horario_id 
         WHERE h.deporte_id = ?`,
        [deporteId]
      );
      
      // 2. Eliminar inscripciones del deporte
      await db.execute(
        'DELETE FROM inscripciones WHERE deporte_id = ?',
        [deporteId]
      );
      
      // 3. Eliminar horarios del deporte
      const [horariosResult] = await db.execute(
        'DELETE FROM horarios WHERE deporte_id = ?',
        [deporteId]
      );
      
      // 4. Eliminar categorÃ­as del deporte
      const [categoriasResult] = await db.execute(
        'DELETE FROM categorias WHERE deporte_id = ?',
        [deporteId]
      );
      
      // 5. Eliminar el deporte
      const [deporteResult] = await db.execute(
        'DELETE FROM deportes WHERE deporte_id = ?',
        [deporteId]
      );
      
      if (deporteResult.affectedRows === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Deporte no encontrado' });
      }
      
      // Confirmar transacciÃ³n (usar query en lugar de execute)
      await db.query('COMMIT');
      
      // Limpiar cachÃ©
      cache.flushAll();
      
      console.log(`ðŸ—‘ï¸ Deporte ELIMINADO PERMANENTEMENTE: ID ${deporteId}`);
      console.log(`   - Horarios eliminados: ${horariosResult.affectedRows}`);
      console.log(`   - CategorÃ­as eliminadas: ${categoriasResult.affectedRows}`);
      
      res.json({ 
        success: true, 
        mensaje: 'Deporte y todos sus datos asociados eliminados permanentemente',
        detalles: {
          horarios_eliminados: horariosResult.affectedRows,
          categorias_eliminadas: categoriasResult.affectedRows
        }
      });
    } catch (error) {
      // Revertir transacciÃ³n en caso de error (usar query en lugar de execute)
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('âŒ Error al eliminar deporte permanentemente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS PLANES ====================

// GET pÃºblico (usado por selecciÃ³n de horarios)
app.get('/api/planes', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const [planes] = await db.execute(
      'SELECT * FROM planes WHERE activo = TRUE ORDER BY orden ASC, plan_id ASC'
    );
    res.json({ success: true, planes });
  } catch (error) {
    console.error('âŒ Error GET /api/planes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET admin
app.get('/api/admin/planes', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const [planes] = await db.execute(
      'SELECT * FROM planes ORDER BY orden ASC, plan_id ASC'
    );
    res.json({ success: true, planes });
  } catch (error) {
    console.error('âŒ Error GET /api/admin/planes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST crear plan
app.post('/api/admin/planes', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const { nombre, tipo, precio_1dia, precio_2dias, precio_3dias, precio_fijo, precio_completo, minimo_dias, maximo_dias, descripcion_extra, activo, orden } = req.body;
    if (!nombre || !tipo) return res.status(400).json({ success: false, error: 'nombre y tipo son requeridos' });
    const [result] = await db.execute(
      `INSERT INTO planes (nombre, tipo, precio_1dia, precio_2dias, precio_3dias, precio_fijo, precio_completo, minimo_dias, maximo_dias, descripcion_extra, activo, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre, tipo, precio_1dia||null, precio_2dias||null, precio_3dias||null, precio_fijo||null, precio_completo||null, minimo_dias||2, maximo_dias||3, descripcion_extra||null, activo!==false, orden||0]
    );
    cache.flushAll();
    res.json({ success: true, plan_id: result.insertId, mensaje: 'Plan creado correctamente' });
  } catch (error) {
    console.error('âŒ Error POST /api/admin/planes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT actualizar plan
app.put('/api/admin/planes/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const { nombre, tipo, precio_1dia, precio_2dias, precio_3dias, precio_fijo, precio_completo, minimo_dias, maximo_dias, descripcion_extra, activo, orden } = req.body;
    const [result] = await db.execute(
      `UPDATE planes SET nombre=?, tipo=?, precio_1dia=?, precio_2dias=?, precio_3dias=?, precio_fijo=?, precio_completo=?, minimo_dias=?, maximo_dias=?, descripcion_extra=?, activo=?, orden=? WHERE plan_id=?`,
      [nombre, tipo, precio_1dia||null, precio_2dias||null, precio_3dias||null, precio_fijo||null, precio_completo||null, minimo_dias||2, maximo_dias||3, descripcion_extra||null, activo!==false, orden||0, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Plan no encontrado' });
    cache.flushAll();
    res.json({ success: true, mensaje: 'Plan actualizado correctamente' });
  } catch (error) {
    console.error('âŒ Error PUT /api/admin/planes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE plan
app.delete('/api/admin/planes/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const [result] = await db.execute('DELETE FROM planes WHERE plan_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Plan no encontrado' });
    cache.flushAll();
    res.json({ success: true, mensaje: 'Plan eliminado correctamente' });
  } catch (error) {
    console.error('âŒ Error DELETE /api/admin/planes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS NIVELES ====================

// GET pÃºblico
app.get('/api/niveles', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const [niveles] = await db.execute(
      'SELECT * FROM niveles WHERE activo = TRUE ORDER BY orden ASC, nivel_id ASC'
    );
    res.json({ success: true, niveles });
  } catch (error) {
    console.error('âŒ Error GET /api/niveles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET admin
app.get('/api/admin/niveles', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const [niveles] = await db.execute(
      'SELECT * FROM niveles ORDER BY orden ASC, nivel_id ASC'
    );
    res.json({ success: true, niveles });
  } catch (error) {
    console.error('âŒ Error GET /api/admin/niveles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST crear nivel
app.post('/api/admin/niveles', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const { nombre, color_barra, color_texto, activo, orden } = req.body;
    if (!nombre) return res.status(400).json({ success: false, error: 'nombre es requerido' });
    const [result] = await db.execute(
      `INSERT INTO niveles (nombre, color_barra, color_texto, activo, orden) VALUES (?, ?, ?, ?, ?)`,
      [nombre, color_barra||'bg-gray-500', color_texto||'text-gray-600', activo!==false, orden||0]
    );
    cache.flushAll();
    res.json({ success: true, nivel_id: result.insertId, mensaje: 'Nivel creado correctamente' });
  } catch (error) {
    console.error('âŒ Error POST /api/admin/niveles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT actualizar nivel
app.put('/api/admin/niveles/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const { nombre, color_barra, color_texto, activo, orden } = req.body;
    const [result] = await db.execute(
      `UPDATE niveles SET nombre=?, color_barra=?, color_texto=?, activo=?, orden=? WHERE nivel_id=?`,
      [nombre, color_barra||'bg-gray-500', color_texto||'text-gray-600', activo!==false, orden||0, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Nivel no encontrado' });
    cache.flushAll();
    res.json({ success: true, mensaje: 'Nivel actualizado correctamente' });
  } catch (error) {
    console.error('âŒ Error PUT /api/admin/niveles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE nivel
app.delete('/api/admin/niveles/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const [result] = await db.execute('DELETE FROM niveles WHERE nivel_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Nivel no encontrado' });
    cache.flushAll();
    res.json({ success: true, mensaje: 'Nivel eliminado correctamente' });
  } catch (error) {
    console.error('âŒ Error DELETE /api/admin/niveles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS CRUD HORARIOS ====================

// Obtener todos los horarios (con filtros opcionales)
app.get('/api/admin/horarios', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const deporteId = req.query.deporte_id;
    const estado = req.query.estado;
    
    let query = `
      SELECT 
        h.horario_id, h.deporte_id, d.nombre as deporte,
        h.dia, 
        TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
        h.cupo_maximo, h.cupos_ocupados, h.estado,
        h.categoria, h.nivel, h.ano_min, h.ano_max,
        h.genero, h.precio, h.plan,
        h.created_at, h.updated_at
      FROM horarios h
      INNER JOIN deportes d ON h.deporte_id = d.deporte_id
    `;
    
    const conditions = [];
    const params = [];
    
    if (deporteId) {
      conditions.push('h.deporte_id = ?');
      params.push(deporteId);
    }
    
    if (estado) {
      conditions.push('h.estado = ?');
      params.push(estado);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY d.nombre, h.dia, h.hora_inicio';
    
    const [horarios] = params.length > 0 
      ? await db.execute(query, params)
      : await db.execute(query);
    
    console.log(`âœ… Horarios obtenidos: ${horarios.length}`);
    res.json({ success: true, horarios });
  } catch (error) {
    console.error('âŒ Error al obtener horarios:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Crear nuevo horario
app.post('/api/admin/horarios', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const {
      deporte_id, dia, hora_inicio, hora_fin, cupo_maximo,
      categoria, nivel, ano_min, ano_max, genero, precio, plan
    } = req.body;
    
    // Validaciones
    if (!deporte_id || !dia || !hora_inicio || !hora_fin || !precio) {
      return res.status(400).json({ 
        success: false, 
        error: 'Campos requeridos: deporte_id, dia, hora_inicio, hora_fin, precio' 
      });
    }
    
    const [result] = await db.execute(
      `INSERT INTO horarios (
        deporte_id, dia, hora_inicio, hora_fin, cupo_maximo,
        categoria, nivel, ano_min, ano_max, genero, precio, plan, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo')`,
      [
        deporte_id, dia, hora_inicio, hora_fin, cupo_maximo || 20,
        categoria || null, nivel || null, ano_min || null, ano_max || null,
        genero || 'Mixto', precio, plan || null
      ]
    );
    
    // Limpiar cachÃ©
    cache.flushAll();
    
    console.log(`âœ… Horario creado: ID ${result.insertId}`);
    res.json({ success: true, horario_id: result.insertId, mensaje: 'Horario creado correctamente' });
  } catch (error) {
    console.error('âŒ Error al crear horario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Actualizar horario
app.put('/api/admin/horarios/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const horarioId = req.params.id;
    const {
      deporte_id, dia, hora_inicio, hora_fin, cupo_maximo,
      categoria, nivel, ano_min, ano_max, genero, precio, plan, estado
    } = req.body;
    
    const [result] = await db.execute(
      `UPDATE horarios SET
        deporte_id = ?, dia = ?, hora_inicio = ?, hora_fin = ?,
        cupo_maximo = ?, categoria = ?, nivel = ?, ano_min = ?, ano_max = ?,
        genero = ?, precio = ?, plan = ?, estado = ?
       WHERE horario_id = ?`,
      [
        deporte_id, dia, hora_inicio, hora_fin, cupo_maximo || 20,
        categoria || null, nivel || null, ano_min || null, ano_max || null,
        genero || 'Mixto', precio, plan || null, estado || 'activo',
        horarioId
      ]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado' });
    }
    
    // Limpiar cachÃ©
    cache.flushAll();
    
    console.log(`âœ… Horario actualizado: ID ${horarioId}`);
    res.json({ success: true, mensaje: 'Horario actualizado correctamente' });
  } catch (error) {
    console.error('âŒ Error al actualizar horario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// EdiciÃ³n rÃ¡pida de horario (solo campos esenciales)
app.put('/api/admin/horarios/:id/edicion-rapida', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const horarioId = req.params.id;
    const { categoria, nivel, plan, ano_min, ano_max, hora_inicio, hora_fin, cupo_maximo, precio, deporte_id, dia, genero, estado } = req.body;
    
    // Validar que el cupo mÃ¡ximo no sea menor a los cupos ocupados
    if (cupo_maximo) {
      const [horarioActual] = await db.execute(
        'SELECT cupos_ocupados FROM horarios WHERE horario_id = ?',
        [horarioId]
      );
      
      if (horarioActual.length > 0 && cupo_maximo < horarioActual[0].cupos_ocupados) {
        return res.status(400).json({ 
          success: false, 
          error: `El cupo mÃ¡ximo no puede ser menor a los cupos ocupados (${horarioActual[0].cupos_ocupados})` 
        });
      }
    }
    
    // Construir query dinÃ¡mico solo con los campos enviados
    const updates = [];
    const values = [];
    
    if (categoria !== undefined) {
      updates.push('categoria = ?');
      values.push(categoria || null);
    }
    if (nivel !== undefined) {
      updates.push('nivel = ?');
      values.push(nivel || null);
    }
    if (plan !== undefined) {
      updates.push('plan = ?');
      values.push(plan || null);
    }
    if (ano_min !== undefined) {
      updates.push('ano_min = ?');
      values.push(ano_min || null);
    }
    if (ano_max !== undefined) {
      updates.push('ano_max = ?');
      values.push(ano_max || null);
    }
    if (hora_inicio) {
      updates.push('hora_inicio = ?');
      values.push(hora_inicio);
    }
    if (hora_fin) {
      updates.push('hora_fin = ?');
      values.push(hora_fin);
    }
    if (cupo_maximo) {
      updates.push('cupo_maximo = ?');
      values.push(cupo_maximo);
    }
    if (precio !== undefined) {
      updates.push('precio = ?');
      values.push(precio);
    }
    if (deporte_id !== undefined) {
      updates.push('deporte_id = ?');
      values.push(deporte_id);
    }
    if (dia !== undefined) {
      updates.push('dia = ?');
      values.push(dia);
    }
    if (genero !== undefined) {
      updates.push('genero = ?');
      values.push(genero || null);
    }
    if (estado !== undefined) {
      updates.push('estado = ?');
      values.push(estado);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });
    }
    
    // Agregar horario_id al final
    values.push(horarioId);
    
    const [result] = await db.execute(
      `UPDATE horarios SET ${updates.join(', ')} WHERE horario_id = ?`,
      values
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado' });
    }
    
    // Limpiar cachÃ© para reflejar cambios en tiempo real
    cache.flushAll();
    
    console.log(`âœ… EdiciÃ³n rÃ¡pida aplicada: Horario ID ${horarioId}`);
    res.json({ success: true, mensaje: 'Horario actualizado correctamente' });
  } catch (error) {
    console.error('âŒ Error en ediciÃ³n rÃ¡pida de horario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Eliminar horario (soft delete)
app.delete('/api/admin/horarios/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const horarioId = req.params.id;
    
    // Verificar si tiene inscripciones activas
    const [inscripciones] = await db.execute(
      `SELECT COUNT(*) as total 
       FROM inscripcion_horarios 
       WHERE horario_id = ?`,
      [horarioId]
    );
    
    if (inscripciones[0].total > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `No se puede eliminar. Tiene ${inscripciones[0].total} inscripciÃ³n(es) activa(s)` 
      });
    }
    
    const [result] = await db.execute(
      'UPDATE horarios SET estado = "inactivo" WHERE horario_id = ?',
      [horarioId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado' });
    }
    
    // Limpiar cachÃ©
    cache.del(getCacheKey('horarios'));
    
    res.json({ success: true, message: 'Horario desactivado correctamente' });
  } catch (error) {
    console.error('Error al eliminar horario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Borrado definitivo de horario
app.delete('/api/admin/horarios/:id/forzar', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const horarioId = req.params.id;
    // Eliminar inscripciones asociadas primero
    await db.execute('DELETE FROM inscripcion_horarios WHERE horario_id = ?', [horarioId]);
    const [result] = await db.execute('DELETE FROM horarios WHERE horario_id = ?', [horarioId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado' });
    }
    cache.del(getCacheKey('horarios'));
    cache.flushAll();
    console.log(`ðŸ—‘ï¸ Horario eliminado definitivamente: ID ${horarioId}`);
    res.json({ success: true, message: 'Horario eliminado definitivamente' });
  } catch (error) {
    console.error('Error al eliminar horario definitivamente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ELIMINAR TODAS LAS INSCRIPCIONES DE UN USUARIO
app.delete('/api/admin/inscripciones/:dni', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const dni = req.params.dni;
    
    // Contar inscripciones antes de eliminar
    const [inscripciones] = await db.execute(
      `SELECT COUNT(*) as total 
       FROM inscripciones i
       JOIN alumnos a ON i.alumno_id = a.alumno_id
       WHERE a.dni = ?`,
      [dni]
    );
    
    const totalEliminadas = inscripciones[0].total;
    
    if (totalEliminadas === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No se encontraron inscripciones para este DNI' 
      });
    }
    
    // Primero eliminar inscripcion_horarios (si existen) - ON DELETE CASCADE lo harÃ¡ automÃ¡ticamente
    // Pero por si acaso lo hacemos manualmente primero
    await db.execute(
      `DELETE ih FROM inscripcion_horarios ih
       JOIN inscripciones i ON ih.inscripcion_id = i.inscripcion_id
       JOIN alumnos a ON i.alumno_id = a.alumno_id
       WHERE a.dni = ?`,
      [dni]
    );
    
    // Eliminar inscripciones (esto tambiÃ©n eliminarÃ¡ inscripcion_horarios por CASCADE)
    await db.execute(
      `DELETE i FROM inscripciones i
       JOIN alumnos a ON i.alumno_id = a.alumno_id
       WHERE a.dni = ?`,
      [dni]
    );
    
    // Limpiar cachÃ©s
    cache.del(getCacheKey('inscritos', 'all_all'));
    cache.del(getCacheKey('inscripciones', dni));
    cache.del(getCacheKey('horarios'));
    
    res.json({ 
      success: true, 
      message: 'Inscripciones eliminadas correctamente',
      eliminadas: totalEliminadas
    });
  } catch (error) {
    console.error('Error al eliminar inscripciones:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ==================== CONTROL DE PUERTA / CARNETS ====================

// POST /api/admin/carnets/validar-acceso
// Valida carnet en puerta, evalÃºa regla de pago mensual (dÃ­as 1-5 vs 6+) y registra asistencia de puerta
const handlerValidarAccesoPuerta = async (req, res) => {
  try {
    const admin = req.admin || null;
    const adminId = admin ? admin.admin_id : null;
    let { dni, forzar_ingreso, pago_clase, metodo_pago_clase, monto_clase } = req.body;
    const esPagoClase = !!pago_clase;
    const montoClaseNum = parseFloat(monto_clase || 15);
    const metodoClaseStr = (metodo_pago_clase || 'Efectivo').trim();
    const obsPagoClase = `Pago por clase: S/ ${montoClaseNum.toFixed(2)} (${metodoClaseStr})`;

    if (!dni) {
      return res.status(400).json({ success: false, error: 'DNI requerido' });
    }

    // Normalizar DNI
    if (dni.includes('dni=')) {
      const match = dni.match(/dni=([a-zA-Z0-9_-]+)/);
      if (match) dni = match[1];
    } else if (dni.includes('/')) {
      const parts = dni.split('/');
      dni = parts[parts.length - 1];
    }
    dni = dni.replace(/[^0-9a-zA-Z]/g, '').trim();

    // 1. Buscar alumno en MySQL
    const [alumnosRows] = await db.query(`
      SELECT 
        a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno,
        a.fecha_nacimiento, a.estado_pago, a.foto_carnet_url, a.estado, a.created_at
      FROM alumnos a
      WHERE a.dni = ?
      LIMIT 1
    `, [dni]);

    if (alumnosRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alumno no encontrado en el sistema con el DNI: ' + dni
      });
    }

    const alumno = alumnosRows[0];
    const nombreCompleto = `${alumno.nombres || ''} ${alumno.apellido_paterno || ''} ${alumno.apellido_materno || ''}`.trim();

    // 2. Obtener inscripciones y horarios del alumno
    const [inscripciones] = await db.query(`
      SELECT 
        i.inscripcion_id, i.plan, i.precio_mensual, i.estado,
        d.nombre AS deporte, d.deporte_id,
        h.horario_id, h.dia, h.hora_inicio, h.hora_fin, h.categoria
      FROM inscripciones i
      JOIN deportes d ON d.deporte_id = i.deporte_id
      LEFT JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id
      LEFT JOIN horarios h ON h.horario_id = ih.horario_id
      WHERE i.alumno_id = ? AND i.estado = 'activa'
    `, [alumno.alumno_id]);

    if (inscripciones.length === 0) {
      return res.json({
        success: true,
        activo: false,
        sin_clase_hoy: false,
        aviso: 'MEMBRESÃA INACTIVA - No ha pagado mensualidad',
        motivo: 'El alumno no tiene inscripciones activas',
        puede_autorizar: !!admin,
        alumno: {
          alumno_id: alumno.alumno_id,
          dni: alumno.dni,
          nombres: alumno.nombres,
          apellidos: `${alumno.apellido_paterno || ''} ${alumno.apellido_materno || ''}`.trim(),
          nombre_completo: nombreCompleto,
          foto_carnet_url: alumno.foto_carnet_url,
          fecha_nacimiento: alumno.fecha_nacimiento,
          deporte: 'Sin inscripciÃ³n',
          plan: 'Inactivo'
        },
        horario_hoy: null
      });
    }

    // 3. Fecha y hora local de PerÃº (UTC-5)
    const ahoraUtc = Date.now();
    const ahoraPeru = new Date(ahoraUtc - 5 * 3600 * 1000);
    const diaMes = ahoraPeru.getUTCDate();
    const fechaHoyStr = ahoraPeru.toISOString().split('T')[0];
    const horaActualStr = ahoraPeru.toISOString().split('T')[1].substring(0, 5);

    const NOMBRES_MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const mesActual = NOMBRES_MESES[ahoraPeru.getUTCMonth()];
    const anioActual = ahoraPeru.getUTCFullYear();

    // 4. Validar si el alumno tiene clase el dÃ­a de hoy
    const DIAS_SEMANA_MAP = ['DOMINGO','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO'];
    const norm = s => (s || '').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const diaSemanaHoy = DIAS_SEMANA_MAP[ahoraPeru.getUTCDay()];

    const horarioHoy = inscripciones.find(i => norm(i.dia) === diaSemanaHoy);
    const diasInscritos = Array.from(new Set(inscripciones.map(i => i.dia).filter(Boolean)));

    if (!horarioHoy && !forzar_ingreso && !esPagoClase) {
      // El alumno NO tiene clase hoy
      return res.json({
        success: true,
        activo: false,
        sin_clase_hoy: true,
        aviso: `SIN CLASE PROGRAMADA PARA HOY (${diaSemanaHoy})`,
        motivo: `El alumno no tiene horario programado para hoy ${diaSemanaHoy}. Sus dÃ­as de entrenamiento son: ${diasInscritos.join(', ')}.`,
        pase_entregado: false,
        asistencia_puerta_registrada: false,
        hora_ingreso: horaActualStr,
        puede_autorizar: !!admin,
        alumno: {
          alumno_id: alumno.alumno_id,
          dni: alumno.dni,
          nombres: alumno.nombres,
          apellidos: `${alumno.apellido_paterno || ''} ${alumno.apellido_materno || ''}`.trim(),
          nombre_completo: nombreCompleto,
          foto_carnet_url: alumno.foto_carnet_url,
          fecha_nacimiento: alumno.fecha_nacimiento,
          deporte: inscripciones[0]?.deporte || 'FÃºtbol',
          plan: inscripciones[0]?.plan || 'EconÃ³mico',
          categoria: inscripciones[0]?.categoria || ''
        },
        horario_hoy: null,
        dias_inscritos: diasInscritos
      });
    }

    // Horario a asignar: el de hoy si existe, o el primero si fue forzado por administraciÃ³n
    const horarioFinal = horarioHoy || inscripciones[0];
    const horarioIdFinal = horarioFinal?.horario_id || null;

    // 5. Evaluar Regla de MembresÃ­a (DÃ­a 1-5 vs DÃ­a 6+)
    let activo = false;
    let motivo = '';

    if (diaMes >= 1 && diaMes <= 5) {
      // DÃ­as 1 al 5: PerÃ­odo regular de gracia para pagar mensualidad
      activo = true;
      motivo = `PerÃ­odo regular de pago (DÃ­a ${diaMes} de 5 de ${mesActual})`;
    } else {
      // A partir del dÃ­a 6: Se exige mensualidad del mes actual confirmada
      const colAnio = global.COL_ANIO || 'anio';
      const [pagosMes] = await db.query(`
        SELECT pm.*
        FROM pagos_mensuales pm
        WHERE pm.alumno_id = ? 
          AND LOWER(pm.mes) = ? 
          AND pm.${colAnio} = ?
          AND pm.estado = 'confirmado'
        LIMIT 1
      `, [alumno.alumno_id, mesActual.toLowerCase(), anioActual]);

      if (pagosMes.length > 0) {
        activo = true;
        motivo = `Mensualidad de ${mesActual} ${anioActual} confirmada`;
      } else {
        // Verificar si es un alumno nuevo reciÃ©n matriculado en este mes actual
        const fechaCreacion = alumno.created_at ? new Date(alumno.created_at) : null;
        const inscritoEsteMes = fechaCreacion &&
          (fechaCreacion.getUTCFullYear() === anioActual) &&
          (fechaCreacion.getUTCMonth() === ahoraPeru.getUTCMonth()) &&
          (alumno.estado_pago === 'confirmado' || alumno.estado_pago === 'pagado');

        if (inscritoEsteMes) {
          activo = true;
          motivo = `MatrÃ­cula reciente confirmada (${mesActual} ${anioActual})`;
        } else {
          // Alumno sin mensualidad confirmada para este mes: INACTIVO
          const [pagosEstado] = await db.query(`
            SELECT pm.estado FROM pagos_mensuales pm
            WHERE pm.alumno_id = ? AND LOWER(pm.mes) = ? AND pm.${colAnio} = ?
            ORDER BY pm.pago_id DESC
            LIMIT 1
          `, [alumno.alumno_id, mesActual.toLowerCase(), anioActual]);

          activo = false;
          if (pagosEstado.length > 0 && pagosEstado[0].estado === 'pendiente') {
            motivo = `Comprobante de ${mesActual} subido, pendiente de aprobaciÃ³n por administraciÃ³n`;
          } else if (pagosEstado.length > 0 && pagosEstado[0].estado === 'rechazado') {
            motivo = `El pago de mensualidad de ${mesActual} fue rechazado por administraciÃ³n`;
          } else {
            motivo = `Sin pago de mensualidad confirmado para ${mesActual} (Vencido desde el 6 de ${mesActual})`;
          }
        }
      }
    }

    let asistenciaPuertaRegistrada = false;

    // 6. Si estÃ¡ activo o el admin forzÃ³ el ingreso manualmente (o pagÃ³ por clase):
    // NOTA DE SEGURIDAD: Solo registra asistencia en puerta si quien valida tiene sesiÃ³n de admin/encargado
    if (admin && (activo || forzar_ingreso || esPagoClase)) {
      if (horarioIdFinal) {
        // hora Lima (UTC-5) ya calculada en horaActualStr como HH:MM
        const horaPuertaLima = horaActualStr + ':00';
        const obsAsistencia = esPagoClase
          ? obsPagoClase
          : (forzar_ingreso ? 'Ingreso autorizado manualmente por administraciÃ³n' : 'Escaneo en puerta (MembresÃ­a activa)');

        await db.query(`
          INSERT INTO asistencias (alumno_id, horario_id, fecha, presente, asistencia_puerta, hora_puerta, observaciones, registrado_por)
          VALUES (?, ?, ?, 0, 1, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            asistencia_puerta = 1,
            hora_puerta = ?,
            observaciones = VALUES(observaciones),
            registrado_por = VALUES(registrado_por)
        `, [
          alumno.alumno_id,
          horarioIdFinal,
          fechaHoyStr,
          horaPuertaLima,
          obsAsistencia,
          adminId,
          horaPuertaLima
        ]);
        asistenciaPuertaRegistrada = true;

        const estadoMembresiaLog = esPagoClase
          ? 'pago_por_clase'
          : (activo ? 'activa' : 'autorizada_manual');
        const obsLog = esPagoClase
          ? obsPagoClase
          : (forzar_ingreso ? 'Autorizado manualmente por administraciÃ³n' : motivo);

        // Log en accesos_puerta
        await db.query(`
          INSERT INTO accesos_puerta (alumno_id, horario_id, fecha, hora, estado_membresia, autorizado_manual, registrado_por, observaciones)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          alumno.alumno_id,
          horarioIdFinal,
          fechaHoyStr,
          horaPuertaLima,
          estadoMembresiaLog,
          (forzar_ingreso || esPagoClase) ? 1 : 0,
          adminId,
          obsLog
        ]);
      }
    }

    const aviso = esPagoClase
      ? `INGRESO AUTORIZADO â€” PAGO POR CLASE S/ ${montoClaseNum.toFixed(2)}`
      : (activo
        ? 'MEMBRESÃA ACTIVA'
        : (forzar_ingreso ? 'INGRESO AUTORIZADO POR ADMINISTRACIÃ“N' : 'MEMBRESÃA INACTIVA - No ha pagado mensualidad'));

    return res.json({
      success: true,
      activo: activo || !!forzar_ingreso || esPagoClase,
      sin_clase_hoy: false,
      es_pago_clase: esPagoClase,
      monto_pago_clase: esPagoClase ? montoClaseNum : null,
      metodo_pago_clase: esPagoClase ? metodoClaseStr : null,
      estado_original: activo ? 'activa' : (esPagoClase ? 'pago_por_clase' : 'inactiva'),
      aviso,
      motivo: esPagoClase ? obsPagoClase : motivo,
      pase_entregado: activo || !!forzar_ingreso || esPagoClase,
      asistencia_puerta_registrada: asistenciaPuertaRegistrada,
      hora_ingreso: horaActualStr,
      puede_autorizar: !activo && !forzar_ingreso && !esPagoClase && !!admin,
      alumno: {
        alumno_id: alumno.alumno_id,
        dni: alumno.dni,
        nombres: alumno.nombres,
        apellidos: `${alumno.apellido_paterno || ''} ${alumno.apellido_materno || ''}`.trim(),
        nombre_completo: nombreCompleto,
        foto_carnet_url: alumno.foto_carnet_url,
        fecha_nacimiento: alumno.fecha_nacimiento,
        deporte: horarioFinal?.deporte || inscripciones[0]?.deporte || 'Deportes Jaguares',
        plan: horarioFinal?.plan || inscripciones[0]?.plan || 'EconÃ³mico',
        categoria: horarioFinal?.categoria || ''
      },
      horario_hoy: horarioFinal ? {
        horario_id: horarioFinal.horario_id,
        deporte: horarioFinal.deporte,
        dia: horarioFinal.dia,
        hora_inicio: horarioFinal.hora_inicio,
        hora_fin: horarioFinal.hora_fin,
        categoria: horarioFinal.categoria
      } : null,
      dias_inscritos: diasInscritos
    });
  } catch (err) {
    console.error('Error en validar-acceso:', err);
    return res.status(500).json({
      success: false,
      error: 'Error interno al validar acceso de carnet'
    });
  }
};

app.post('/api/admin/carnets/validar-acceso', verificarAutenticacion, handlerValidarAccesoPuerta);
app.post('/api/carnets/validar-acceso', verificarAutenticacion, handlerValidarAccesoPuerta);

// GET /api/admin/alumnos/:dni/asistencias â€” historial de asistencias de un alumno con doble asistencia (profesor y puerta)
app.get('/api/admin/alumnos/:dni/asistencias', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { dni } = req.params;
    const { fecha_inicio, fecha_fin } = req.query;
    const [alumno] = await db.execute(
      'SELECT alumno_id, nombres, apellido_paterno, apellido_materno FROM alumnos WHERE dni = ?',
      [dni]
    );
    if (alumno.length === 0) return res.status(404).json({ success: false, error: 'Alumno no encontrado' });

    let sql = `
      SELECT
        ast.fecha,
        ast.presente,
        COALESCE(ast.asistencia_puerta, 0) AS asistencia_puerta,
        TIME_FORMAT(ast.hora_puerta, '%H:%i') AS hora_puerta,
        ast.observaciones,
        d.nombre AS deporte,
        h.dia,
        h.hora_inicio,
        h.hora_fin,
        h.categoria
      FROM asistencias ast
      JOIN horarios h ON ast.horario_id = h.horario_id
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE ast.alumno_id = ?
    `;
    const params = [alumno[0].alumno_id];

    if (fecha_inicio && fecha_fin) {
      sql += ' AND ast.fecha BETWEEN ? AND ?';
      params.push(fecha_inicio, fecha_fin);
    } else if (fecha_inicio) {
      sql += ' AND ast.fecha >= ?';
      params.push(fecha_inicio);
    } else if (fecha_fin) {
      sql += ' AND ast.fecha <= ?';
      params.push(fecha_fin);
    }

    sql += ' ORDER BY ast.fecha DESC, d.nombre LIMIT 300';

    const [registros] = await db.execute(sql, params);

    const total = registros.length;
    const presentes = registros.filter(r => r.presente).length;
    const puertaOk = registros.filter(r => r.asistencia_puerta === 1 || r.asistencia_puerta === true || r.asistencia_puerta === '1').length;

    res.json({
      success: true,
      alumno: { ...alumno[0], dni },
      asistencias: registros,
      resumen: {
        total,
        presentes,
        ausentes: total - presentes,
        puerta_ok: puertaOk,
        sin_puerta: total - puertaOk
      }
    });
  } catch (error) {
    console.error('Error al obtener asistencias de alumno:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/admin/alumnos/:dni â€” elimina inscripciones + alumno completamente
app.delete('/api/admin/alumnos/:dni', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const { dni } = req.params;

    const [[alumno]] = await db.execute('SELECT alumno_id FROM alumnos WHERE dni = ?', [dni]);
    if (!alumno) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }
    const alumnoId = alumno.alumno_id;

    // Borrar en orden: tablas dependientes primero
    await db.execute(`DELETE ih FROM inscripcion_horarios ih
      JOIN inscripciones i ON ih.inscripcion_id = i.inscripcion_id
      WHERE i.alumno_id = ?`, [alumnoId]);
    await db.execute('DELETE FROM inscripciones WHERE alumno_id = ?', [alumnoId]);
    await db.execute('DELETE FROM asistencias WHERE alumno_id = ?', [alumnoId]);
    await db.execute('DELETE FROM ranking_puntos WHERE alumno_id = ?', [alumnoId]);
    try { await db.execute('DELETE FROM pagos_mensuales WHERE alumno_id = ?', [alumnoId]); } catch(e) { console.warn('pagos_mensuales no existe, omitiendo:', e.message); }
    try { await db.execute('DELETE FROM puntajes_alumnos WHERE alumno_id = ?', [alumnoId]); } catch(e) { console.warn('puntajes_alumnos no existe, omitiendo:', e.message); }
    try { await db.execute('DELETE FROM alumnos_del_mes WHERE alumno_id = ?', [alumnoId]); } catch(e) { console.warn('alumnos_del_mes no existe, omitiendo:', e.message); }
    await db.execute('DELETE FROM alumnos WHERE alumno_id = ?', [alumnoId]);

    // Limpiar cachÃ©
    cache.del(getCacheKey('inscritos', 'all_all'));
    cache.del(getCacheKey('inscripciones', dni));

    res.json({ success: true, message: 'Alumno eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar alumno:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS CRUD CATEGORÃAS ====================

// Obtener todas las categorÃ­as o filtradas por deporte
app.get('/api/admin/categorias', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const deporteId = req.query.deporte_id;
    
    // Asegurar encoding UTF-8
    await db.execute('SET NAMES utf8mb4');
    
    let query = `
      SELECT 
        c.categoria_id, c.deporte_id, d.nombre as deporte,
        c.nombre, c.descripcion, c.ano_min, c.ano_max,
        c.icono, c.orden, c.estado,
        c.created_at, c.updated_at
      FROM categorias c
      INNER JOIN deportes d ON c.deporte_id = d.deporte_id
    `;
    
    const params = [];
    
    if (deporteId) {
      query += ' WHERE c.deporte_id = ?';
      params.push(deporteId);
    }
    
    query += ' ORDER BY d.nombre, c.orden, c.nombre';
    
    const [categorias] = params.length > 0 
      ? await db.execute(query, params)
      : await db.execute(query);
    
    console.log(`âœ… CategorÃ­as obtenidas: ${categorias.length}`);
    res.json({ success: true, categorias });
  } catch (error) {
    console.error('âŒ Error al obtener categorÃ­as:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Crear nueva categorÃ­a
app.post('/api/admin/categorias', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const { deporte_id, nombre, descripcion, ano_min, ano_max, icono, orden } = req.body;
    
    if (!deporte_id || !nombre) {
      return res.status(400).json({ 
        success: false, 
        error: 'Los campos deporte_id y nombre son requeridos' 
      });
    }
    
    const [result] = await db.execute(
      `INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, icono, orden, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'activo')`,
      [
        deporte_id, nombre, descripcion || null, 
        ano_min || null, ano_max || null, icono || null, orden || 0
      ]
    );
    
    // Limpiar cachÃ©
    cache.flushAll();
    
    console.log(`âœ… CategorÃ­a creada: ${nombre} (ID: ${result.insertId})`);
    res.json({ success: true, categoria_id: result.insertId, mensaje: 'CategorÃ­a creada correctamente' });
  } catch (error) {
    console.error('âŒ Error al crear categorÃ­a:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, error: 'Ya existe una categorÃ­a con ese nombre para este deporte' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Actualizar categorÃ­a
app.put('/api/admin/categorias/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const categoriaId = req.params.id;
    const { deporte_id, nombre, descripcion, ano_min, ano_max, icono, orden, estado } = req.body;
    
    if (!nombre) {
      return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    }
    
    const [result] = await db.execute(
      `UPDATE categorias 
       SET deporte_id = ?, nombre = ?, descripcion = ?, ano_min = ?, ano_max = ?,
           icono = ?, orden = ?, estado = ?
       WHERE categoria_id = ?`,
      [
        deporte_id, nombre, descripcion || null, 
        ano_min || null, ano_max || null, icono || null, 
        orden || 0, estado || 'activo', categoriaId
      ]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'CategorÃ­a no encontrada' });
    }
    
    // Limpiar cachÃ©
    cache.flushAll();
    
    console.log(`âœ… CategorÃ­a actualizada: ID ${categoriaId}`);
    res.json({ success: true, mensaje: 'CategorÃ­a actualizada correctamente' });
  } catch (error) {
    console.error('âŒ Error al actualizar categorÃ­a:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, error: 'Ya existe una categorÃ­a con ese nombre para este deporte' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Eliminar categorÃ­a (soft delete)
app.delete('/api/admin/categorias/:id', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const categoriaId = req.params.id;
    
    // Verificar si tiene horarios asociados
    const [horarios] = await db.execute(
      'SELECT COUNT(*) as total FROM horarios WHERE categoria = (SELECT nombre FROM categorias WHERE categoria_id = ?) AND estado = "activo"',
      [categoriaId]
    );
    
    if (horarios[0].total > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `No se puede eliminar. Tiene ${horarios[0].total} horario(s) activo(s) asociado(s)` 
      });
    }
    
    const [result] = await db.execute(
      'UPDATE categorias SET estado = "inactivo" WHERE categoria_id = ?',
      [categoriaId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'CategorÃ­a no encontrada' });
    }
    
    // Limpiar cachÃ©
    cache.flushAll();
    
    console.log(`âœ… CategorÃ­a desactivada: ID ${categoriaId}`);
    res.json({ success: true, mensaje: 'CategorÃ­a desactivada correctamente' });
  } catch (error) {
    console.error('âŒ Error al eliminar categorÃ­a:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Borrado definitivo de categorÃ­a
app.delete('/api/admin/categorias/:id/forzar', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const categoriaId = req.params.id;
    const [result] = await db.execute(
      'DELETE FROM categorias WHERE categoria_id = ?',
      [categoriaId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'CategorÃ­a no encontrada' });
    }
    cache.flushAll();
    console.log(`ðŸ—‘ï¸ CategorÃ­a eliminada definitivamente: ID ${categoriaId}`);
    res.json({ success: true, mensaje: 'CategorÃ­a eliminada definitivamente' });
  } catch (error) {
    console.error('âŒ Error al eliminar categorÃ­a:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS AUXILIARES ====================

// Obtener lista de deportes activos (para selectores)
app.get('/api/admin/deportes-activos', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const [deportes] = await db.execute(`
      SELECT deporte_id, nombre, icono
      FROM deportes
      WHERE estado = 'activo'
      ORDER BY nombre ASC
    `);
    
    res.json({ success: true, deportes });
  } catch (error) {
    console.error('âŒ Error al obtener deportes activos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener estadÃ­sticas de un horario especÃ­fico
app.get('/api/admin/horarios/:id/estadisticas', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const horarioId = req.params.id;
    
    const [stats] = await db.execute(`
      SELECT 
        h.cupo_maximo,
        h.cupos_ocupados,
        COUNT(ih.inscripcion_horario_id) as total_inscritos
      FROM horarios h
      LEFT JOIN inscripcion_horarios ih ON h.horario_id = ih.horario_id
      WHERE h.horario_id = ?
      GROUP BY h.horario_id
    `, [horarioId]);
    
    if (stats.length === 0) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado' });
    }
    
    res.json({ success: true, estadisticas: stats[0] });
  } catch (error) {
    console.error('âŒ Error al obtener estadÃ­sticas de horario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para reporte de alumnos con filtros
app.get('/api/admin/reporte-alumnos', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const { deporte_id, dia, categoria } = req.query;
    
    let query = `
      SELECT DISTINCT
        COALESCE(a.dni, i.dni) as dni,
        COALESCE(a.nombres, i.nombres) as nombres,
        COALESCE(a.apellido_paterno, i.apellido_paterno) as apellido_paterno,
        COALESCE(a.apellido_materno, i.apellido_materno) as apellido_materno,
        COALESCE(a.fecha_nacimiento, i.fecha_nacimiento) as fecha_nacimiento,
        COALESCE(a.sexo, i.sexo) as sexo,
        COALESCE(a.telefono, i.telefono) as telefono,
        COALESCE(a.apoderado, i.apoderado) as apoderado,
        d.nombre as deporte,
        h.dia,
        h.hora_inicio,
        h.hora_fin,
        c.nombre as categoria
      FROM inscripciones i
      LEFT JOIN alumnos a ON i.alumno_id = a.alumno_id
      INNER JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      INNER JOIN horarios h ON ih.horario_id = h.horario_id
      INNER JOIN deportes d ON h.deporte_id = d.deporte_id
      LEFT JOIN categorias c ON h.categoria_id = c.categoria_id
      WHERE i.estado != 'cancelada'
        AND (i.estado = 'activa' OR i.estado_pago IN ('pagado', 'confirmado') OR a.estado_pago IN ('pagado', 'confirmado'))
    `;
    
    const params = [];
    
    if (deporte_id) {
      query += ` AND d.deporte_id = ?`;
      params.push(deporte_id);
    }
    
    if (dia) {
      query += ` AND h.dia = ?`;
      params.push(dia);
    }
    
    if (categoria) {
      query += ` AND c.nombre = ?`;
      params.push(categoria);
    }
    
    query += ` ORDER BY d.nombre, h.dia, h.hora_inicio, i.apellido_paterno, i.apellido_materno, i.nombres`;
    
    const [alumnos] = await db.execute(query, params);
    
    res.json({ success: true, alumnos });
  } catch (error) {
    console.error('âŒ Error al generar reporte de alumnos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manejo de errores del servidor
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`âŒ Error: El puerto ${PORT} ya estÃ¡ en uso`);
    console.error('   Cierra el otro proceso o usa un puerto diferente');
  } else {
    console.error('âŒ Error del servidor:', error);
  }
  process.exit(1);
});

// ==================== ENDPOINTS DE INSCRIPCIONES Y PAGOS ====================

/**
 * PUT /api/admin/alumnos/:dni/notas
 * Guardar observaciÃ³n/nota del alumno
 */
app.put('/api/admin/alumnos/:dni/notas', async (req, res) => {
  try {
    const { dni } = req.params;
    const { notas } = req.body;
    await db.query(
      'UPDATE alumnos SET notas_pago = ?, updated_at = NOW() WHERE dni = ?',
      [notas || null, dni]
    );
    const cacheKey = getCacheKey('consultas', dni);
    cache.del(cacheKey);
    console.log(`ðŸ“ ObservaciÃ³n actualizada para DNI ${dni}`);
    res.json({ success: true, message: 'ObservaciÃ³n guardada correctamente' });
  } catch (error) {
    console.error('âŒ Error al guardar nota:', error);
    res.status(500).json({ success: false, error: 'Error al guardar la observaciÃ³n' });
  }
});

/**
 * GET /api/admin/inscripciones
 * Obtener inscripciones con filtros: pendientes, confirmadas, todas
  /**
   * POST /api/admin/alumnos/:dni/notas
/**
 * Guardar observaciÃ³n/nota del alumno (compatibilidad)
 */
  app.post('/api/admin/alumnos/:dni/notas', async (req, res) => {
    try {
      const { dni } = req.params;
      const { notas } = req.body;
      await db.query(
        'UPDATE alumnos SET notas_pago = ?, updated_at = NOW() WHERE dni = ?',
        [notas || null, dni]
      );
      const cacheKey = getCacheKey('consultas', dni);
      cache.del(cacheKey);
      console.log(`ðŸ“ ObservaciÃ³n actualizada para DNI ${dni} (POST)`);
      res.json({ success: true, message: 'ObservaciÃ³n guardada correctamente' });
    } catch (error) {
      console.error('âŒ Error al guardar nota (POST):', error);
      res.status(500).json({ success: false, message: 'Error al guardar observaciÃ³n' });
    }
  });

/**
 * Query params: estado_pago (pendiente|confirmado|todos)
 */

/**
 * GET /api/admin/buscar-numero-operacion
 * Buscar pagos por nÃºmero de operaciÃ³n (anti-fraude)
 */
app.get('/api/admin/buscar-numero-operacion', async (req, res) => {
  try {
    const { numero_operacion } = req.query;
    if (!numero_operacion || numero_operacion.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Ingrese al menos 2 caracteres' });
    }
    const numOp = numero_operacion.trim();
    const [resultados] = await db.query(`
      SELECT 
        a.dni,
        a.nombres,
        CONCAT(a.apellido_paterno, ' ', a.apellido_materno) as apellidos,
        a.numero_operacion,
        a.estado_pago,
        a.comprobante_pago_url,
        a.monto_pago,
        a.fecha_pago,
        a.created_at as fecha_inscripcion,
        GROUP_CONCAT(DISTINCT d.nombre SEPARATOR ', ') as deportes
      FROM alumnos a
      LEFT JOIN inscripciones i ON a.alumno_id = i.alumno_id
      LEFT JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE a.numero_operacion LIKE ?
      GROUP BY a.alumno_id
      ORDER BY a.created_at DESC
      LIMIT 20
    `, [`%${numOp}%`]);
    
    // Verificar si hay duplicados exactos
    const exactos = resultados.filter(r => r.numero_operacion === numOp);
    const esDuplicado = exactos.length > 1;
    
    res.json({ 
      success: true, 
      resultados,
      total: resultados.length,
      es_duplicado: esDuplicado,
      mensaje_duplicado: esDuplicado ? `âš ï¸ ALERTA: El nÃºmero de operaciÃ³n "${numOp}" estÃ¡ registrado por ${exactos.length} alumnos diferentes` : null
    });
  } catch (error) {
    console.error('âŒ Error buscando nÃºmero de operaciÃ³n:', error);
    res.status(500).json({ success: false, error: 'Error al buscar' });
  }
});

app.get('/api/admin/inscripciones', async (req, res) => {
  try {
    const { estado_pago = 'todos', buscar = '', limite = 500, pagina = 1 } = req.query;
    
    let query = `
      SELECT 
        a.alumno_id,
        a.dni,
        a.nombres,
        CONCAT(a.apellido_paterno, ' ', a.apellido_materno) as apellidos,
        a.fecha_nacimiento,
        TIMESTAMPDIFF(YEAR, a.fecha_nacimiento, CURDATE()) as edad,
        a.sexo,
        a.telefono,
        a.email,
        a.estado as estado_usuario,
        a.estado_pago,
        a.fecha_pago,
        a.monto_pago,
        a.numero_operacion,
        a.comprobante_pago_url as url_comprobante,
        a.dni_frontal_url,
        a.dni_reverso_url,
        a.foto_carnet_url,
        a.notas_pago,
        a.created_at,
        a.updated_at,
        COUNT(i.inscripcion_id) as total_inscripciones,
        SUM(CASE WHEN i.estado = 'pendiente' THEN 1 ELSE 0 END) as inscripciones_pendientes,
        GROUP_CONCAT(DISTINCT d.nombre SEPARATOR ', ') as deportes_inscritos
      FROM alumnos a
      LEFT JOIN inscripciones i ON a.alumno_id = i.alumno_id AND i.estado IN ('activa', 'pendiente')
      LEFT JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Filtro por estado de pago
    if (estado_pago === 'pendiente') {
      query += ' AND (a.estado_pago = ? OR EXISTS (SELECT 1 FROM inscripciones ip WHERE ip.alumno_id = a.alumno_id AND ip.estado = "pendiente"))';
      params.push(estado_pago);
    } else if (estado_pago === 'confirmado') {
      query += ' AND (a.estado_pago = "confirmado" AND NOT EXISTS (SELECT 1 FROM inscripciones ip WHERE ip.alumno_id = a.alumno_id AND ip.estado = "pendiente"))';
    } else if (estado_pago !== 'todos') {
      query += ' AND a.estado_pago = ?';
      params.push(estado_pago);
    }
    
    // BÃºsqueda por DNI, nombre o apellido
    if (buscar) {
      query += ' AND (a.dni LIKE ? OR a.nombres LIKE ? OR CONCAT(a.apellido_paterno, " ", a.apellido_materno) LIKE ?)';
      const searchPattern = `%${buscar}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }
    
    query += ' GROUP BY a.alumno_id ORDER BY a.created_at DESC';
    
    // PaginaciÃ³n
    const offset = (parseInt(pagina) - 1) * parseInt(limite);
    query += ` LIMIT ${parseInt(limite)} OFFSET ${offset}`;
    
    const [inscripciones] = await db.query(query, params);
    
    // Contar total para paginaciÃ³n
    let countQuery = 'SELECT COUNT(DISTINCT a.alumno_id) as total FROM alumnos a WHERE 1=1';
    const countParams = [];
    
    if (estado_pago === 'pendiente') {
      countQuery += ' AND (a.estado_pago = ? OR EXISTS (SELECT 1 FROM inscripciones ip WHERE ip.alumno_id = a.alumno_id AND ip.estado = "pendiente"))';
      countParams.push(estado_pago);
    } else if (estado_pago === 'confirmado') {
      countQuery += ' AND (a.estado_pago = "confirmado" AND NOT EXISTS (SELECT 1 FROM inscripciones ip WHERE ip.alumno_id = a.alumno_id AND ip.estado = "pendiente"))';
    } else if (estado_pago !== 'todos') {
      countQuery += ' AND a.estado_pago = ?';
      countParams.push(estado_pago);
    }
    
    if (buscar) {
      countQuery += ' AND (a.dni LIKE ? OR a.nombres LIKE ? OR CONCAT(a.apellido_paterno, " ", a.apellido_materno) LIKE ?)';
      const searchPattern = `%${buscar}%`;
      countParams.push(searchPattern, searchPattern, searchPattern);
    }
    
    const [[{ total }]] = await db.query(countQuery, countParams);
    
    res.json({
      success: true,
      inscripciones,
      paginacion: {
        total,
        pagina: parseInt(pagina),
        limite: parseInt(limite),
        total_paginas: Math.ceil(total / parseInt(limite))
      }
    });
  } catch (error) {
    console.error('Error al obtener inscripciones:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/inscripciones/:dni
 * Obtener detalle completo de inscripciones por DNI
 */
app.get('/api/admin/inscripciones/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    
    // Datos del alumno
    const [alumnos] = await db.query(
      `SELECT 
        alumno_id,
        dni,
        nombres,
        CONCAT(apellido_paterno, ' ', apellido_materno) as apellidos,
        apellido_paterno,
        apellido_materno,
        fecha_nacimiento,
        TIMESTAMPDIFF(YEAR, fecha_nacimiento, CURDATE()) as edad,
        sexo,
        telefono,
        email,
        direccion,
        seguro_tipo,
        condicion_medica,
        apoderado,
        telefono_apoderado,
        dni_frontal_url,
        dni_reverso_url,
        foto_carnet_url,
        comprobante_pago_url,
        estado,
        estado_pago,
        fecha_pago,
        monto_pago,
        numero_operacion,
        notas_pago,
        created_at,
        updated_at
      FROM alumnos WHERE dni = ?`,
      [dni]
    );
    
    if (alumnos.length === 0) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }
    
    const usuario = alumnos[0];
    
    // Inscripciones activas con horarios
    const [inscripcionesRaw] = await db.query(`
      SELECT 
        i.inscripcion_id,
        i.estado as estado_inscripcion,
        i.fecha_inscripcion,
        i.plan,
        i.precio_mensual as precio,
        d.deporte_id,
        d.nombre as deporte,
        d.icono,
        h.horario_id,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
        h.categoria,
        h.nivel
      FROM inscripciones i
      JOIN deportes d ON i.deporte_id = d.deporte_id
      LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE i.alumno_id = ? AND i.estado IN ('activa', 'pendiente')
      ORDER BY d.nombre, h.dia, h.hora_inicio
    `, [usuario.alumno_id]);
    
    // Agrupar horarios por inscripciÃ³n para evitar duplicados en el resumen
    const inscripcionesMap = new Map();
    inscripcionesRaw.forEach(row => {
      const key = row.inscripcion_id;
      if (!inscripcionesMap.has(key)) {
        inscripcionesMap.set(key, {
          inscripcion_id: row.inscripcion_id,
          estado_inscripcion: row.estado_inscripcion,
          fecha_inscripcion: row.fecha_inscripcion,
          plan: row.plan,
          precio: row.precio,
          deporte_id: row.deporte_id,
          deporte: row.deporte,
          icono: row.icono,
          categoria: row.categoria,
          nivel: row.nivel,
          horarios: []
        });
      }
      if (row.dia && row.hora_inicio) {
        inscripcionesMap.get(key).horarios.push({
          horario_id: row.horario_id,
          dia: row.dia,
          hora_inicio: row.hora_inicio,
          hora_fin: row.hora_fin
        });
      }
    });
    
    // Convertir a array y expandir cada horario como un item separado para mostrar en UI
    const inscripciones = [];
    inscripcionesMap.forEach(inscripcion => {
      if (inscripcion.horarios.length > 0) {
        inscripcion.horarios.forEach(horario => {
          inscripciones.push({
            ...inscripcion,
            horario_id: horario.horario_id,
            dia: horario.dia,
            hora_inicio: horario.hora_inicio,
            hora_fin: horario.hora_fin
          });
        });
      } else {
        inscripciones.push(inscripcion);
      }
    });
    
    // Calcular resumen SIN duplicar inscripciones (usar el Map)
    const inscripcionesUnicas = Array.from(inscripcionesMap.values());
    const diasActivos = new Set();
    inscripcionesUnicas.forEach(ins => {
      ins.horarios.forEach(h => diasActivos.add(h.dia));
    });
    
    console.log('ðŸ“¤ ENVIANDO RESPUESTA ADMIN DETALLE DNI:', dni);
    console.log('   - Alumno ID:', usuario.alumno_id);
    console.log('   - DNI Frontal URL:', usuario.dni_frontal_url ? 'SÃ' : 'NO');
    console.log('   - DNI Reverso URL:', usuario.dni_reverso_url ? 'SÃ' : 'NO');
    console.log('   - Foto Carnet URL:', usuario.foto_carnet_url ? 'SÃ' : 'NO');
    console.log('   - Estado Pago:', usuario.estado_pago);
    
    const responseData = {
      success: true,
      alumno: usuario, // Cambiar "usuario" a "alumno" para consistencia con Google Sheets
      inscripciones, // Array expandido para mostrar cada horario
      resumen: {
        total_inscripciones: inscripcionesUnicas.length, // Contar inscripciones Ãºnicas
        deportes_distintos: new Set(inscripcionesUnicas.map(i => i.deporte)).size,
        dias_activos: diasActivos.size,
        monto_total: inscripcionesUnicas.reduce((sum, i) => sum + (parseFloat(i.precio) || 0), 0) // Sumar precio solo una vez por inscripciÃ³n
      }
    };
    
    res.json(responseData);
  } catch (error) {
    console.error('Error al obtener detalle de inscripciÃ³n:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/inscripciones/:dni/confirmar-pago
 * Confirmar pago de un usuario (cambia estado_pago a 'confirmado')
 */
app.put('/api/admin/inscripciones/:dni/confirmar-pago', async (req, res) => {
  try {
    const { dni } = req.params;
    const { monto_pago, numero_operacion, notas } = req.body;
    
    // Verificar que el alumno existe
    const [alumnos] = await db.query(
      'SELECT alumno_id, estado_pago FROM alumnos WHERE dni = ?',
      [dni]
    );
    
    if (alumnos.length === 0) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }
    
    const alumno = alumnos[0];
    
    // Verificar inscripciones pendientes del alumno
    const [inscPendientes] = await db.query(
      "SELECT inscripcion_id, precio_mensual FROM inscripciones WHERE alumno_id = ? AND estado = 'pendiente'",
      [alumno.alumno_id]
    );

    if (alumno.estado_pago === 'confirmado' && inscPendientes.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'El pago ya estÃ¡ confirmado y no hay inscripciones pendientes' 
      });
    }
    
    // Si el admin no enviÃ³ monto, calcularlo de las inscripciones pendientes del alumno
    let montoFinal = monto_pago ? parseFloat(monto_pago) : null;
    if (!montoFinal) {
      const [inscPend] = await db.query(
        'SELECT SUM(precio_mensual) as total FROM inscripciones WHERE alumno_id = ? AND estado = \'pendiente\'',
        [alumno.alumno_id]
      );
      montoFinal = parseFloat(inscPend[0]?.total || 0) || null;
      if (montoFinal) console.log(`ðŸ’° Monto calculado automÃ¡ticamente: S/ ${montoFinal} para DNI ${dni}`);
    }

    // Actualizar estado de pago en MySQL
    // COALESCE preserva el numero_operacion que cargÃ³ el alumno si el admin no envÃ­a uno nuevo
    await db.query(`
      UPDATE alumnos 
      SET 
        estado_pago = 'confirmado',
        fecha_pago = NOW(),
        monto_pago = ?,
        numero_operacion = COALESCE(?, numero_operacion),
        notas_pago = ?,
        updated_at = NOW()
      WHERE dni = ?
    `, [montoFinal, numero_operacion || null, notas || null, dni]);
    
    // Activar todas las inscripciones del alumno en MySQL
    await db.query(`
      UPDATE inscripciones 
      SET estado = 'activa', updated_at = NOW()
      WHERE alumno_id = ? AND estado = 'pendiente'
    `, [alumno.alumno_id]);
    
    // ==================== REGISTRAR PAGO MENSUAL DEL MES ACTUAL ====================
    // Cuando el admin confirma la inscripciÃ³n, el pago de inscripciÃ³n ya cubre
    // el primer mes. Se inserta un pago_mensual confirmado para que el alumno
    // no aparezca como "pendiente" en el reporte de pagos del mes.
    try {
      const ahora = new Date();
      // El sistema usa nombres de mes en espaÃ±ol (igual que el resto de pagos_mensuales)
      const NOMBRES_MESES_NORM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const mesNombreActual = NOMBRES_MESES_NORM[ahora.getMonth()];
      const anioActual = ahora.getFullYear();
      // Usar la misma columna dinÃ¡mica que el resto del sistema (puede ser 'aÃ±o' o 'anio')
      const colYear = global.COL_ANIO || 'a\u00f1o'; // 'aÃ±o' â€” fallback unicode-safe

      // Calcular monto total de las mensualidades activas del alumno
      const [inscripcionesActivas] = await db.query(`
        SELECT SUM(precio_mensual) as total_mensual
        FROM inscripciones
        WHERE alumno_id = ? AND estado = 'activa'
      `, [alumno.alumno_id]);
      const montoMensual = parseFloat(inscripcionesActivas[0]?.total_mensual || 0);

      if (montoMensual > 0) {
        // INSERT IGNORE evita duplicados si ya existe el pago del mes
        await db.query(
          'INSERT IGNORE INTO pagos_mensuales (alumno_id, mes, `' + colYear + '`, monto, estado, fecha_pago, created_at) ' +
          "VALUES (?, ?, ?, ?, 'confirmado', NOW(), NOW())",
          [alumno.alumno_id, mesNombreActual, anioActual, montoMensual]
        );
        console.log(`âœ… Pago mensual de ${mesNombreActual}/${anioActual} registrado como confirmado para alumno ID ${alumno.alumno_id} (S/ ${montoMensual})`);
      }
    } catch (pagoError) {
      // No fallar la confirmaciÃ³n si esto falla
      console.warn('âš ï¸ No se pudo registrar pago mensual automÃ¡tico:', pagoError.message);
    }

    // Obtener inscripciones activadas
    const [inscripcionesActivadas] = await db.query(`
      SELECT 
        i.inscripcion_id,
        d.nombre as deporte
      FROM inscripciones i
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.alumno_id = ? AND i.estado = 'activa'
    `, [alumno.alumno_id]);
    
    // ==================== SINCRONIZAR CON GOOGLE SHEETS ====================
    try {
      console.log(`ðŸ“¤ Sincronizando confirmaciÃ³n de pago con Google Sheets para DNI ${dni}...`);
      
      const sheetPayload = {
        action: 'confirmar_pago',
        token: APPS_SCRIPT_TOKEN,
        dni: dni,
        monto_pago: monto_pago || null,
        numero_operacion: numero_operacion || null,
        notas: notas || null,
        fecha_confirmacion: new Date().toISOString()
      };
      
      const sheetResponse = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetPayload)
      });
      
      const sheetData = await sheetResponse.json();
      
      if (sheetData.success) {
        console.log(`âœ… Pago confirmado en Google Sheets para DNI ${dni}`);
      } else {
        console.warn(`âš ï¸ No se pudo confirmar en Google Sheets: ${sheetData.error || 'Error desconocido'}`);
      }
    } catch (sheetError) {
      console.error('âŒ Error al sincronizar con Google Sheets:', sheetError.message);
      // No fallar la operaciÃ³n si Google Sheets falla, MySQL es la fuente principal
    }
    
    // ==================== INVALIDAR CACHÃ‰ ====================
    invalidateDNICache(dni);
    console.log(`ðŸ—‘ï¸ CachÃ© invalidado para DNI ${dni}`);
    
    res.json({
      success: true,
      mensaje: 'Pago confirmado exitosamente',
      dni,
      inscripciones_activadas: inscripcionesActivadas.length,
      detalle: inscripcionesActivadas
    });
  } catch (error) {
    console.error('Error al confirmar pago:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/inscripciones/activar/:inscripcionId
 * Activar una inscripciÃ³n especÃ­fica (por deporte)
 */
app.put('/api/admin/inscripciones/activar/:inscripcionId', async (req, res) => {
  try {
    const { inscripcionId } = req.params;
    
    const [inscripciones] = await db.query(
      `SELECT i.inscripcion_id, i.estado, i.alumno_id, d.nombre as deporte
       FROM inscripciones i
       JOIN deportes d ON i.deporte_id = d.deporte_id
       WHERE i.inscripcion_id = ?`,
      [inscripcionId]
    );
    
    if (inscripciones.length === 0) {
      return res.status(404).json({ success: false, error: 'InscripciÃ³n no encontrada' });
    }
    
    const inscripcion = inscripciones[0];
    
    if (inscripcion.estado === 'activa') {
      return res.status(400).json({ success: false, error: 'La inscripciÃ³n ya estÃ¡ activa' });
    }
    
    await db.query(
      `UPDATE inscripciones SET estado = 'activa', updated_at = NOW() WHERE inscripcion_id = ?`,
      [inscripcionId]
    );
    
    // Invalidar cachÃ© del alumno
    const [alumnoRows] = await db.query('SELECT dni FROM alumnos WHERE alumno_id = ?', [inscripcion.alumno_id]);
    if (alumnoRows.length > 0) {
      invalidateDNICache(alumnoRows[0].dni);
    }
    
    console.log(`âœ… InscripciÃ³n ${inscripcionId} (${inscripcion.deporte}) activada manualmente`);
    
    res.json({
      success: true,
      mensaje: `InscripciÃ³n de ${inscripcion.deporte} activada exitosamente`,
      deporte: inscripcion.deporte
    });
  } catch (error) {
    console.error('Error al activar inscripciÃ³n:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/inscripciones/pendiente/:inscripcionId
 * Marcar una inscripciÃ³n especÃ­fica como pendiente (por deporte)
 */
app.put('/api/admin/inscripciones/pendiente/:inscripcionId', async (req, res) => {
  try {
    const { inscripcionId } = req.params;
    
    const [inscripciones] = await db.query(
      `SELECT i.inscripcion_id, i.estado, i.alumno_id, d.nombre as deporte
       FROM inscripciones i
       JOIN deportes d ON i.deporte_id = d.deporte_id
       WHERE i.inscripcion_id = ?`,
      [inscripcionId]
    );
    
    if (inscripciones.length === 0) {
      return res.status(404).json({ success: false, error: 'InscripciÃ³n no encontrada' });
    }
    
    const inscripcion = inscripciones[0];
    
    if (inscripcion.estado === 'pendiente') {
      return res.status(400).json({ success: false, error: 'La inscripciÃ³n ya estÃ¡ pendiente' });
    }
    
    await db.query(
      `UPDATE inscripciones SET estado = 'pendiente', updated_at = NOW() WHERE inscripcion_id = ?`,
      [inscripcionId]
    );
    
    const [alumnoRows] = await db.query('SELECT dni FROM alumnos WHERE alumno_id = ?', [inscripcion.alumno_id]);
    if (alumnoRows.length > 0) {
      invalidateDNICache(alumnoRows[0].dni);
    }
    
    console.log(`â³ InscripciÃ³n ${inscripcionId} (${inscripcion.deporte}) marcada como pendiente`);
    
    res.json({
      success: true,
      mensaje: `${inscripcion.deporte} marcado como pendiente`,
      deporte: inscripcion.deporte
    });
  } catch (error) {
    console.error('Error al marcar pendiente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/inscripciones/:dni/rechazar-pago
 * Rechazar pago y marcar inscripciones como pendientes
 */

/**
 * DELETE /api/admin/inscripciones/individual/:inscripcionId
 * DELETE /api/admin/inscripcion/:inscripcionId
 * Eliminar una inscripciÃ³n especÃ­fica (por inscripcion_id) sin afectar otras inscripciones del alumno
 */
app.delete(['/api/admin/inscripciones/individual/:inscripcionId', '/api/admin/inscripcion/:inscripcionId'], async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
    const { inscripcionId } = req.params;

    // 1. Obtener datos de la inscripciÃ³n a eliminar
    const [rows] = await db.query(`
      SELECT i.inscripcion_id, i.alumno_id, i.estado, d.nombre as deporte, a.dni, a.nombres, a.apellido_paterno
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.alumno_id
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.inscripcion_id = ?
    `, [inscripcionId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'InscripciÃ³n no encontrada' });
    }

    const ins = rows[0];
    const alumnoId = ins.alumno_id;
    const dni = ins.dni;

    // 2. Contar cuÃ¡ntas otras inscripciones activas/pendientes le quedan al alumno
    const [restantes] = await db.query(`
      SELECT COUNT(*) as total
      FROM inscripciones
      WHERE alumno_id = ? AND inscripcion_id != ? AND estado IN ('activa', 'pendiente')
    `, [alumnoId, inscripcionId]);

    const tieneOtras = restantes[0].total > 0;

    // 3. Eliminar la inscripciÃ³n especÃ­fica
    // Se eliminan los horarios asociados para activar el trigger de liberaciÃ³n de cupos
    await db.query('DELETE FROM inscripcion_horarios WHERE inscripcion_id = ?', [inscripcionId]);
    await db.query('DELETE FROM inscripciones WHERE inscripcion_id = ?', [inscripcionId]);

    // 4. Si era su Ãºnica inscripciÃ³n activa, actualizar estado del alumno a 'inactivo'
    if (!tieneOtras) {
      await db.query("UPDATE alumnos SET estado = 'inactivo' WHERE alumno_id = ?", [alumnoId]);
      console.log(`ðŸ”´ Alumno ${dni} marcado inactivo (sin mÃ¡s inscripciones activas tras borrar inscripciÃ³n ${inscripcionId})`);
    } else {
      console.log(`ðŸŸ¢ Alumno ${dni} permanece activo con ${restantes[0].total} inscripciÃ³n(es) activa(s)`);
    }

    // 5. Ajustar mensualidades en pagos_mensuales si quedaron pendientes del mes actual
    try {
      const NOMBRES_MESES_NORM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const mesActual = NOMBRES_MESES_NORM[new Date().getMonth()];
      const [activasRows] = await db.query(
        `SELECT COALESCE(SUM(precio_mensual), 0) as total_mensual
         FROM inscripciones
         WHERE alumno_id = ? AND estado IN ('activa', 'pendiente')`,
        [alumnoId]
      );
      const nuevoMontoTotal = parseFloat(activasRows[0].total_mensual) || 0;
      if (nuevoMontoTotal > 0) {
        await db.query(
          "UPDATE pagos_mensuales SET monto = ? WHERE alumno_id = ? AND mes = ? AND estado = 'pendiente'",
          [nuevoMontoTotal, alumnoId, mesActual]
        );
      }
    } catch (ePm) {
      console.warn('Advertencia al recalcular pagos_mensuales:', ePm.message);
    }

    // 6. Limpiar cachÃ©s
    if (typeof invalidateDNICache === 'function') {
      invalidateDNICache(dni);
    }
    cache.del(getCacheKey('inscritos', 'all_all'));
    cache.del(getCacheKey('inscripciones', dni));
    cache.del(getCacheKey('horarios'));
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    if (inscritosKeys.length > 0) cache.del(inscritosKeys);

    console.log(`ðŸ—‘ï¸ InscripciÃ³n ${inscripcionId} (${ins.deporte}) eliminada exitosamente para DNI ${dni}`);

    const deporteLimpio = String(ins.deporte || '').replace(/FÃƒÂºtbol|FÃƒÂ°tbol|F\uFFFDtbol/gi, 'FÃºtbol');
    return res.json({
      success: true,
      mensaje: `InscripciÃ³n de ${deporteLimpio} eliminada correctamente`,
      tieneOtrasInscripciones: tieneOtras
    });

  } catch (error) {
    console.error('Error al eliminar inscripciÃ³n individual:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/inscripciones/:dni/rechazar-pago', async (req, res) => {
  try {
    const { dni } = req.params;
    const { motivo } = req.body;
    
    const [alumnos] = await db.query(
      'SELECT alumno_id FROM alumnos WHERE dni = ?',
      [dni]
    );
    
    if (alumnos.length === 0) {
      return res.status(404).json({ success: false, error: 'Alumno no encontrado' });
    }
    
    const alumno = alumnos[0];
    
    // Actualizar estado de pago a pendiente
    await db.query(`
      UPDATE alumnos 
      SET 
        estado_pago = 'pendiente',
        notas_pago = ?,
        updated_at = NOW()
      WHERE dni = ?
    `, [motivo || 'Pago rechazado por administrador', dni]);
    
    // Desactivar inscripciones
    await db.query(`
      UPDATE inscripciones 
      SET estado = 'pendiente', updated_at = NOW()
      WHERE alumno_id = ?
    `, [alumno.alumno_id]);
    
    // Invalidar cachÃ©
    invalidateDNICache(dni);
    console.log(`ðŸ—‘ï¸ CachÃ© invalidado para DNI ${dni} (pago rechazado)`);
    
    res.json({
      success: true,
      mensaje: 'Pago rechazado y inscripciones desactivadas'
    });
  } catch (error) {
    console.error('Error al rechazar pago:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/inscripciones/:inscripcionId/asignar-horarios
 * Asignar horarios a una inscripciÃ³n que no tiene horarios guardados
 * Body: { horarioIds: [1, 2, 3] }
 */
app.post('/api/admin/inscripciones/:inscripcionId/asignar-horarios', async (req, res) => {
  try {
    const { inscripcionId } = req.params;
    const { horarioIds } = req.body;
    
    if (!horarioIds || !Array.isArray(horarioIds) || horarioIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe proporcionar al menos un horario' });
    }
    
    // Verificar que la inscripciÃ³n existe
    const [inscripciones] = await db.query(
      'SELECT inscripcion_id, deporte_id FROM inscripciones WHERE inscripcion_id = ?',
      [inscripcionId]
    );
    
    if (inscripciones.length === 0) {
      return res.status(404).json({ success: false, error: 'InscripciÃ³n no encontrada' });
    }
    
    const inscripcion = inscripciones[0];
    
    // Verificar que los horarios existen y pertenecen al mismo deporte
    const [horariosValidos] = await db.query(
      `SELECT horario_id FROM horarios WHERE horario_id IN (?) AND deporte_id = ?`,
      [horarioIds, inscripcion.deporte_id]
    );
    
    if (horariosValidos.length === 0) {
      return res.status(400).json({ success: false, error: 'Los horarios no son vÃ¡lidos o no pertenecen al deporte de esta inscripciÃ³n' });
    }
    
    // Eliminar horarios anteriores de esta inscripciÃ³n
    await db.query('DELETE FROM inscripcion_horarios WHERE inscripcion_id = ?', [inscripcionId]);
    
    // Insertar nuevos horarios
    let horariosGuardados = 0;
    for (const horarioId of horarioIds) {
      // Verificar que el horario estÃ¡ en la lista de vÃ¡lidos
      if (horariosValidos.some(h => h.horario_id === parseInt(horarioId))) {
        await db.query(
          'INSERT INTO inscripcion_horarios (inscripcion_id, horario_id) VALUES (?, ?)',
          [inscripcionId, horarioId]
        );
        horariosGuardados++;
      }
    }
    
    console.log(`âœ… Asignados ${horariosGuardados} horarios a inscripciÃ³n ${inscripcionId}`);
    
    res.json({
      success: true,
      mensaje: `${horariosGuardados} horarios asignados correctamente`,
      horariosAsignados: horariosGuardados
    });
  } catch (error) {
    console.error('Error al asignar horarios:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/horarios-deporte/:deporteId
 * Obtener horarios disponibles para un deporte especÃ­fico (para asignaciÃ³n manual)
 */
app.get('/api/admin/horarios-deporte/:deporteId', async (req, res) => {
  try {
    const { deporteId } = req.params;
    
    const [horarios] = await db.query(`
      SELECT 
        h.horario_id,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
        h.categoria,
        h.nivel,
        h.cupo_maximo,
        h.cupos_ocupados,
        (h.cupo_maximo - h.cupos_ocupados) as cupo_disponible
      FROM horarios h
      WHERE h.deporte_id = ? AND h.estado = 'activo'
      ORDER BY 
        FIELD(h.dia, 'LUNES', 'MARTES', 'MIÃ‰RCOLES', 'JUEVES', 'VIERNES', 'SÃBADO', 'DOMINGO'),
        h.hora_inicio
    `, [deporteId]);
    
    res.json({
      success: true,
      horarios
    });
  } catch (error) {
    console.error('Error al obtener horarios del deporte:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/reportes/alumnos
 * Generar reporte de alumnos por deporte y/o dÃ­a
 * Query params: deporte_id, dia, categoria, estado (activa|todas)
 */
app.get('/api/admin/reportes/alumnos', async (req, res) => {
  try {
    const { deporte_id, dia, categoria, estado = 'activa' } = req.query;
    
    let query = `
      SELECT 
        a.dni,
        a.nombres,
        CONCAT(a.apellido_paterno, ' ', a.apellido_materno) as apellidos,
        a.fecha_nacimiento,
        TIMESTAMPDIFF(YEAR, a.fecha_nacimiento, CURDATE()) as edad,
        a.sexo,
        a.telefono,
        a.email,
        a.apoderado,
        a.telefono_apoderado,
        d.nombre as deporte,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
        h.categoria,
        h.nivel,
        i.plan,
        i.precio_mensual as precio,
        i.fecha_inscripcion,
        i.estado as estado_inscripcion,
        a.estado_pago
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.alumno_id
      JOIN deportes d ON i.deporte_id = d.deporte_id
      LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Filtros
    if (estado !== 'todas') {
      query += ' AND i.estado = ?';
      params.push(estado);
    }
    
    if (deporte_id) {
      query += ' AND d.deporte_id = ?';
      params.push(deporte_id);
    }
    
    if (dia) {
      query += ' AND h.dia = ?';
      params.push(dia.toUpperCase());
    }
    
    if (categoria) {
      query += ' AND h.categoria = ?';
      params.push(categoria);
    }
    
    query += ` 
      ORDER BY 
        d.nombre,
        h.dia,
        h.hora_inicio,
        h.categoria,
        a.apellido_paterno,
        a.nombres
    `;
    
    const [alumnos] = await db.query(query, params);
    
    // Agrupar por deporte + horario
    const agrupado = {};
    alumnos.forEach(alumno => {
      // Crear clave Ãºnica por deporte, dÃ­a, hora y categorÃ­a
      const key = `${alumno.deporte}_${alumno.dia || 'sin-horario'}_${alumno.hora_inicio || 'sin-hora'}_${alumno.categoria || 'sin-categoria'}`;
      
      if (!agrupado[key]) {
        agrupado[key] = {
          deporte: alumno.deporte,
          dia: alumno.dia || 'Sin horario',
          hora_inicio: alumno.hora_inicio || '',
          hora_fin: alumno.hora_fin || '',
          categoria: alumno.categoria || 'Sin categorÃ­a',
          nivel: alumno.nivel || '',
          alumnos: []
        };
      }
      agrupado[key].alumnos.push(alumno);
    });
    
    res.json({
      success: true,
      total_alumnos: alumnos.length,
      alumnos,
      agrupado: Object.values(agrupado),
      filtros_aplicados: { deporte_id, estado }
    });
  } catch (error) {
    console.error('Error al generar reporte:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/estadisticas/inscripciones
 * EstadÃ­sticas generales de inscripciones
 */
app.get('/api/admin/estadisticas/inscripciones', async (req, res) => {
  try {
    // Total alumnos
    const [[{ total_usuarios }]] = await db.query(
      'SELECT COUNT(*) as total_usuarios FROM alumnos'
    );
    
    // Alumnos por estado de pago
    const [estadosPago] = await db.query(`
      SELECT 
        estado_pago,
        COUNT(*) as cantidad
      FROM alumnos
      GROUP BY estado_pago
    `);
    
    // Inscripciones activas por deporte
    const [inscripcionesPorDeporte] = await db.query(`
      SELECT 
        d.nombre as deporte,
        COUNT(i.inscripcion_id) as total_inscripciones,
        COUNT(DISTINCT i.alumno_id) as alumnos_unicos
      FROM inscripciones i
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.estado = 'activa'
      GROUP BY d.nombre
      ORDER BY total_inscripciones DESC
    `);
    
    // Ingresos: suma de precio_mensual de inscripciones activas de alumnos confirmados
    const [[{ ingresos_confirmados }]] = await db.query(`
      SELECT COALESCE(SUM(i.precio_mensual), 0) as ingresos_confirmados
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.alumno_id
      WHERE i.estado = 'activa' AND a.estado_pago = 'confirmado'
    `);
    
    res.json({
      success: true,
      estadisticas: {
        total_usuarios,
        estados_pago: estadosPago,
        inscripciones_por_deporte: inscripcionesPorDeporte,
        ingresos_confirmados: parseFloat(ingresos_confirmados)
      }
    });
  } catch (error) {
    console.error('Error al obtener estadÃ­sticas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== CHATBOT ADMIN (GROQ) ====================

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const CHAT_SYSTEM_PROMPT = `Eres el asistente de administraciÃ³n de JAGUARES, una academia deportiva en PerÃº.
Tu funciÃ³n es ayudar al administrador a consultar informaciÃ³n de la base de datos de forma conversacional.

Cuando la pregunta requiera datos de la BD, responde ÃšNICAMENTE con un JSON:
{"tipo": "sql", "query": "SELECT ...", "descripcion": "quÃ© hace el query"}

Si NO necesita datos de la BD, responde con:
{"tipo": "respuesta", "texto": "tu respuesta aquÃ­"}

REGLAS ESTRICTAS:
- Solo SELECT, NUNCA INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE
- No consultar tabla: administradores
- No mostrar columnas: contrasena, hash_contrasena, password
- Siempre agregar LIMIT 100 mÃ¡ximo
- Usa JOINs cuando necesites info de mÃºltiples tablas
- Los nombres propios de alumnos estÃ¡n en columnas separadas: nombres, apellido_paterno, apellido_materno
- Para bÃºsqueda por nombre usa LIKE '%valor%' en nombres o apellido_paterno

DEFINICIONES IMPORTANTES (usa SIEMPRE estas definiciones):
- "inscritos" / "lista de inscritos" / "alumnos inscritos" = alumnos con inscripciÃ³n estado IN ('activa','pendiente'). Query: SELECT COUNT(DISTINCT a.alumno_id) FROM alumnos a JOIN inscripciones i ON a.alumno_id = i.alumno_id WHERE i.estado IN ('activa','pendiente')
- "todos los alumnos en el sistema" = SELECT COUNT(*) FROM alumnos (incluye datos histÃ³ricos/cancelados)
- "alumnos activos" = alumnos con estado='activo' en tabla alumnos
- "pagos pendientes" = alumnos con estado_pago='pendiente'
- Cuando el admin pregunta "cuÃ¡ntos tengo" sin contexto, asume INSCRITOS con estado='activa' o 'pendiente'

FÃ“RMULAS FINANCIERAS (Dashboard Financiero):
- "ingresos totales" / "total ingresos" = SUM(matriculas_pagadas) + SUM(precio_mensual) de inscripciones activas:
  SELECT COALESCE(SUM(CASE WHEN i.matricula_pagada=1 THEN d.matricula ELSE 0 END),0) + COALESCE(SUM(i.precio_mensual),0) as total_ingresos FROM inscripciones i JOIN deportes d ON i.deporte_id=d.deporte_id WHERE i.estado='activa'
- "ingresos del mes" / "ingresos este mes" = mismo cÃ¡lculo pero filtrado por MONTH(i.fecha_inscripcion)=MONTH(CURRENT_DATE()) AND YEAR(i.fecha_inscripcion)=YEAR(CURRENT_DATE())
- "ingresos de hoy" = mismo cÃ¡lculo con DATE(i.fecha_inscripcion)=CURRENT_DATE()
- "mensualidades" = SUM(i.precio_mensual) FROM inscripciones WHERE estado='activa'
- "matrÃ­culas cobradas" = SUM(CASE WHEN matricula_pagada=1 THEN d.matricula ELSE 0 END)
- "ingresos por deporte" = agrupar por d.nombre con SUM de mensualidades + matrÃ­culas de inscripciones activas
- "ingresos por alumno" = agrupar por a.alumno_id con SUM de mensualidades + matrÃ­culas, JOIN con alumnos e inscripciones activas
- "alumnos con mÃ¡s deportes" = COUNT(inscripciones activas) por alumno, ORDER BY cantidad DESC

ESQUEMA DE LA BASE DE DATOS:

alumnos: alumno_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, sexo(Masculino/Femenino), telefono, email, estado(activo/inactivo/suspendido), estado_pago(pendiente/confirmado/rechazado), apoderado, telefono_apoderado, created_at

inscripciones: inscripcion_id, alumno_id, deporte_id, estado(pendiente/activa/cancelada/suspendida), plan(EconÃ³mico/EstÃ¡ndar/Premium), precio_mensual, matricula_pagada(0/1), fecha_inicio, fecha_fin, fecha_inscripcion

deportes: deporte_id, nombre, matricula(precio de matrÃ­cula), estado(activo/inactivo)

horarios: horario_id, deporte_id, dia(LUNES/MARTES/MIERCOLES/JUEVES/VIERNES/SABADO/DOMINGO), hora_inicio, hora_fin, cupo_maximo, cupos_ocupados, estado(activo/inactivo/suspendido), categoria, nivel, ano_min, ano_max, genero(Masculino/Femenino/Mixto), precio, plan

profesores: profesor_id, nombres, apellidos, especialidad, estado(activo/inactivo)

profesor_deportes: id, admin_id, deporte_id, categoria, dia, horario_id

asistencias: asistencia_id, alumno_id, horario_id, fecha, presente(0=ausente/1=presente), observaciones

inscripcion_horarios: id, inscripcion_id, horario_id, estado(activo/inactivo)

pagos_mensuales: pago_id, alumno_id, mes, aÃ±o, monto, estado(pendiente/confirmado/rechazado)

categorias: categoria_id, deporte_id, nombre, ano_min, ano_max, estado(activo/inactivo)`;

app.post('/api/admin/chat', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje || typeof mensaje !== 'string' || mensaje.trim().length === 0 || mensaje.length > 600) {
      return res.status(400).json({ success: false, error: 'Mensaje invÃ¡lido' });
    }

    // Paso 1: Groq genera SQL o respuesta directa
    const groqRes1 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: CHAT_SYSTEM_PROMPT },
          { role: 'user', content: mensaje.trim() }
        ],
        temperature: 0.1,
        max_tokens: 800
      })
    });

    if (!groqRes1.ok) {
      const errBody = await groqRes1.text();
      console.error('âŒ Groq API error:', errBody);
      return res.status(502).json({ success: false, error: 'Error al conectar con el asistente IA' });
    }

    const groqData1 = await groqRes1.json();
    const rawText = groqData1.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] || '{}');
    } catch {
      parsed = { tipo: 'respuesta', texto: rawText };
    }

    // Respuesta directa sin SQL
    if (parsed.tipo === 'respuesta') {
      return res.json({ success: true, respuesta: parsed.texto });
    }

    // Paso 2: Ejecutar SQL con validaciones de seguridad
    if (parsed.tipo === 'sql' && parsed.query) {
      const query = parsed.query.trim();

      const forbiddenKeywords = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/i;
      if (forbiddenKeywords.test(query)) {
        return res.json({ success: true, respuesta: 'Solo puedo realizar consultas de lectura.' });
      }
      if (/\badministradores\b/i.test(query)) {
        return res.json({ success: true, respuesta: 'No tengo acceso a datos de administradores por seguridad.' });
      }
      if (!query.toUpperCase().trimStart().startsWith('SELECT')) {
        return res.json({ success: true, respuesta: 'Solo puedo ejecutar consultas SELECT.' });
      }

      let resultados;
      try {
        const [rows] = await db.execute(query);
        resultados = rows;
      } catch (sqlError) {
        console.error('âŒ Chat SQL error:', sqlError.message);
        return res.json({ success: true, respuesta: `No pude ejecutar esa consulta. Intenta reformular la pregunta.` });
      }

      if (resultados.length === 0) {
        return res.json({ success: true, respuesta: 'No encontrÃ© registros con esos criterios.' });
      }

      // Paso 3: Groq formatea los resultados
      const groqRes2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'system',
              content: 'Eres el asistente de JAGUARES academia deportiva. Responde en espaÃ±ol de forma clara y concisa. El admin te hizo una pregunta y te doy los datos de la BD. Presenta la info de forma legible: usa listas, resalta nÃºmeros importantes. Sin JSON, solo texto natural.'
            },
            {
              role: 'user',
              content: `Pregunta del admin: "${mensaje.trim()}"\n\nDatos obtenidos (${resultados.length} registros):\n${JSON.stringify(resultados.slice(0, 100))}`
            }
          ],
          temperature: 0.3,
          max_tokens: 600
        })
      });

      const groqData2 = await groqRes2.json();
      const respuestaFinal = groqData2.choices?.[0]?.message?.content || 'No pude formatear la respuesta.';

      return res.json({ success: true, respuesta: respuestaFinal, total: resultados.length });
    }

    res.json({ success: true, respuesta: 'No pude entender esa consulta. Intenta reformularla.' });
  } catch (error) {
    console.error('âŒ Error chatbot admin:', error);
    res.status(500).json({ success: false, error: 'Error interno del chatbot' });
  }
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('âŒ Error no capturado:', error);
  console.error('Stack trace:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('âŒ Promesa rechazada no manejada:', reason);
  console.error('Promise:', promise);
});
// ==================== ERROR HANDLERS ====================
// IMPORTANTE: Deben estar DESPUÃ‰S de todas las rutas

// 404 - Ruta no encontrada
app.use(notFoundHandler);

// Manejador global de errores
app.use(errorHandler);







