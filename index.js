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

// ==================== CONFIGURACIÓN MYSQL ====================

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
    // Garantizar utf8mb4 en CADA conexión del pool
    db.pool.on('connection', (conn) => {
      conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
    });
    // Test de conexión
    const connection = await db.getConnection();
    await connection.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
    console.log('✅ Conexión a MySQL establecida correctamente (utf8mb4)');
    connection.release();
  } catch (error) {
    console.error('❌ Error al conectar con MySQL:', error);
    console.error('⚠️  El servidor continuará sin base de datos (usará Google Sheets)');
  }
}

// Inicializar base de datos
initDatabase();

const app = express();
app.set('trust proxy', 1); // Detrás de Cloudflare/nginx proxy
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

// ==================== SISTEMA DE CACHÉ MEJORADO ====================

// Crear instancia de caché con node-cache (más robusto que Map)
const cache = new NodeCache({
    stdTTL: 300,      // TTL por defecto: 5 minutos
    checkperiod: 60,  // Revisar expiración cada 60 segundos
    useClones: false  // No clonar objetos (mejor performance)
});

// TTLs específicos por tipo de dato (en segundos)
const CACHE_TTL = {
    horarios: 300,        // 5 minutos
    inscripciones: 120,   // 2 minutos
    consultas: 60,        // 1 minuto
    inscritos: 120,       // 2 minutos para lista de inscritos
    default: 300          // 5 minutos por defecto
};

/**
 * Genera clave de caché única
 */
function getCacheKey(tipo, id = '') {
    return id ? `${tipo}_${id}` : tipo;
}

/**
 * Invalida caché de un DNI específico (inscripciones + consultas)
 */
function invalidateDNICache(dni) {
    cache.del(getCacheKey('inscripciones', dni));
    cache.del(getCacheKey('consultas', dni));
    console.log(`🗑️ CACHÉ INVALIDADO para DNI ${dni}`);
}

/**
 * Obtiene estadísticas del caché
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

// Body parser con límite
app.use(express.json({ limit: '10mb' }));

// Sanitizar inputs para prevenir XSS
app.use(sanitizeInput);

// Rate limiting general (100 req/15min)
app.use(rateLimiterGeneral);

// ==================== ENDPOINTS UTILIDAD ====================

/**
 * Limpiar caché manualmente
 */
app.post('/api/cache/clear', (req, res) => {
  try {
    cache.flushAll();
    console.log('🗑️ CACHÉ LIMPIADO MANUALMENTE');
    res.json({
      success: true,
      mensaje: 'Caché limpiado correctamente'
    });
  } catch (error) {
    console.error('❌ Error al limpiar caché:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DEBUG: Ver datos exactos de horarios sin caché
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
    console.error('❌ Error en debug:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ENDPOINTS ACADEMIA DEPORTIVA ====================

// Endpoint para obtener horarios disponibles (CON CACHÉ y filtrado por edad)
app.get('/api/horarios', async (req, res) => {
  try {
    const anioNacimiento = req.query.anio_nacimiento || req.query.ano_nacimiento;
    const forceRefresh = req.query.refresh === 'true';
    
    // Clave de caché diferente si hay filtro de edad
    const cacheKey = getCacheKey('horarios', anioNacimiento || 'all');
    
    // Intentar obtener del caché (si no se fuerza refresh)
    if (!forceRefresh) {
      const cachedData = cache.get(cacheKey);
      if (cachedData) {
        console.log(`⚡ CACHÉ HIT: ${cacheKey}`);
        return res.json(cachedData);
      }
    } else {
      console.log(`🔄 FORCE REFRESH - Ignorando caché`);
    }
    
    console.log(`🌐 CACHÉ MISS: ${cacheKey} - Consultando MySQL`);
    
    // ==================== CONSULTA DESDE MYSQL ====================
    if (db) {
      try {
        console.log('🔍 Intentando consultar MySQL...');
        if (anioNacimiento) {
          console.log(`🎯 Filtrando por anio de nacimiento: ${anioNacimiento}`);
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
        if (anioNacimiento) {
          query += ` AND ? BETWEEN h.ano_min AND h.ano_max`;
          params.push(parseInt(anioNacimiento));
        }
        
        query += ` ORDER BY d.nombre, h.dia, h.hora_inicio`;
        
        console.log('📝 Query preparada:', query);
        console.log('📊 Parámetros:', params);
        
        const [rows] = params.length > 0 
          ? await db.execute(query, params)
          : await db.execute(query);
        
        console.log(`✅ Horarios obtenidos de MySQL: ${rows.length}`);
        if (anioNacimiento) {
          console.log(`   (filtrados para anio ${anioNacimiento})`);
          // Log de primeros 5 horarios para debug
          console.log('📋 Primeros horarios devueltos:');
          rows.slice(0, 5).forEach(h => {
            console.log(`   ID ${h.horario_id}: ${h.deporte} - ${h.dia} ${h.hora_inicio} - Categoría: "${h.categoria}" (${h.ano_min}-${h.ano_max})`);
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
        
        // Guardar en caché
        cache.set(cacheKey, data, CACHE_TTL.horarios);
        console.log(`💾 CACHÉ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.horarios}s)`);
        
        return res.json(data);
        
      } catch (mysqlError) {
        console.error('❌ Error en consulta MySQL:', mysqlError);
        console.log('⚠️  Intentando con Google Sheets como respaldo...');
        // Si falla MySQL, continuar con Google Sheets abajo
      }
    }
    
    // ==================== GOOGLE SHEETS (COMENTADO - RESPALDO) ====================
    /*
    // Si no está en caché, obtener de Apps Script
    let url = `${APPS_SCRIPT_URL}?action=horarios&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}`;
    
    // Agregar parámetro de anio si existe
    if (anioNacimiento) {
      url += `&anio_nacimiento=${encodeURIComponent(anioNacimiento)}`;
      console.log(`🎯 Solicitando horarios filtrados para anio ${anioNacimiento}`);
    }
    
    console.log('📡 URL COMPLETA que se enviará a Apps Script:');
    console.log(url);
    console.log('🔑 Token usado:', APPS_SCRIPT_TOKEN);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('📥 RESPUESTA de Apps Script:', JSON.stringify(data, null, 2));
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al obtener horarios');
    }
    
    // Guardar en caché (node-cache usa segundos)
    cache.set(cacheKey, data, CACHE_TTL.horarios);
    console.log(`💾 CACHÉ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.horarios}s, total: ${data.horarios?.length || 0} horarios)`);
    
    res.json(data);
    */
    
    // Si llegamos aquí sin MySQL, retornar error
    return res.status(503).json({
      success: false,
      error: 'Base de datos no disponible',
      message: 'No se pudo conectar a MySQL y Google Sheets está deshabilitado'
    });
    
  } catch (error) {
    console.error('❌ Error al obtener horarios:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al obtener horarios' 
    });
  }
});

// Endpoint para inscribir a múltiples horarios
app.post('/api/inscribir-multiple', rateLimiterInscripciones, async (req, res) => {
  try {
    const { alumno, horarios, comprobante } = req.body;
    
    console.log('📝 ==================== INSCRIPCIÓN MÚLTIPLE ====================');
    console.log('👤 ALUMNO:', JSON.stringify(alumno, null, 2));
    console.log('📅 HORARIOS (cantidad):', horarios.length);
    console.log('📋 HORARIOS DETALLE:', horarios.map(h => ({ 
      horario_id: h.horario_id, 
      deporte: h.deporte, 
      dia: h.dia, 
      hora: h.hora_inicio 
    })));
    
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
    
    // ⚠️ NUEVO: Limitar a máximo 10 horarios para prevenir abuso
    if (horarios.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Máximo 10 horarios por inscripción',
        message: 'Por favor, seleccione máximo 10 horarios. Si necesita más, contacte al administrador.'
      });
    }
    
    // ⚠️ Validar que el comprobante de pago sea obligatorio
    if (!comprobante) {
      return res.status(400).json({
        success: false,
        error: 'Comprobante de pago requerido',
        message: 'Debes subir el comprobante de pago con el número de operación para completar la inscripción.'
      });
    }

    // ⚠️ Validar que si viene comprobante tenga número de operación (obligatorio)
    if (comprobante && !comprobante.numero_operacion?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Número de operación requerido',
        message: 'Debes ingresar el número de operación de tu comprobante de pago.'
      });
    }

    // ⚠️ Validar número de operación duplicado (anti-fraude: evitar pasar el mismo pago)
    if (comprobante && comprobante.numero_operacion && db) {
      const numOp = comprobante.numero_operacion.trim();
      // No validar duplicados para valores genéricos como "-"
      if (numOp && numOp !== '-') {
        const [existentes] = await db.query(
          `SELECT a.dni, a.nombres, a.apellido_paterno 
           FROM alumnos a 
           WHERE a.numero_operacion = ? AND a.dni != ?`,
          [numOp, alumno.dni]
        );
        if (existentes.length > 0) {
          const otro = existentes[0];
          console.warn(`⚠️ DUPLICADO DE PAGO: Nro operación "${numOp}" ya usado por ${otro.nombres} ${otro.apellido_paterno} (DNI: ${otro.dni})`);
          return res.status(409).json({
            success: false,
            error: 'Número de operación duplicado',
            message: `Este número de operación ya fue registrado por otro alumno (DNI: ${otro.dni.substring(0, 4)}****). Si crees que es un error, contacta al administrador.`
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
        console.log('💾 Guardando inscripción en MySQL (transacción)...');
        
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
          console.log(`✅ Alumno encontrado en MySQL: ID ${alumnoId}`);
          // Traer datos reales de la BD para retornarlos en la respuesta
          const [alumnoReal] = await conn.query(
            'SELECT nombres, apellido_paterno, apellido_materno FROM alumnos WHERE alumno_id = ?',
            [alumnoId]
          );
          if (alumnoReal.length > 0) alumnoDBData = alumnoReal[0];
        } else {
          // Crear nuevo alumno (dentro de la transacción — se revierte si algo falla)
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
          console.log(`✅ Alumno creado en MySQL: ID ${alumnoId}`);
        }
        
        // 2. Validar que todos los horarios tengan horario_id
        const horariosInvalidos = horarios.filter(h => !h.horario_id);
        if (horariosInvalidos.length > 0) {
          console.error('❌ HORARIOS SIN ID:', horariosInvalidos);
          await conn.rollback();
          conn.release();
          return res.status(400).json({
            success: false,
            error: 'Horarios inválidos',
            message: 'Todos los horarios deben tener un ID válido. Por favor, seleccione horarios de la lista.',
            horarios_invalidos: horariosInvalidos.length
          });
        }
        
        // 3. Agrupar horarios por deporte
        const deportesMap = {};
        horarios.forEach(h => {
          const deporte = h.deporte || 'Fútbol';
          if (!deportesMap[deporte]) {
            deportesMap[deporte] = {
              horarios: [],
              plan: h.plan || 'Económico'
            };
          }
          deportesMap[deporte].horarios.push(h);
        });
        
        // Función para calcular precio
        const calcularPrecio = (cantidadDias, plan, deporte) => {
          // MAMAS FIT: precio fijo S/.60
          if (deporte === 'MAMAS FIT' || plan === 'MAMAS FIT') return 60;
          
          // Baby Fútbol: 1d=50, 2d=100, 3d=150
          if (plan === 'Baby Fútbol' || deporte === 'Baby Fútbol') {
            if (cantidadDias === 1) return 50;
            if (cantidadDias === 2) return 100;
            if (cantidadDias >= 3) return 150;
            return 50;
          }
          
          if (plan === 'Económico') {
            if (cantidadDias === 2) return 60;
            if (cantidadDias >= 3) return 80;
            return 60;
          }
          
          if (plan === 'Estándar') {
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
        
        // 3. Generar código de operación único (mismo formato que Apps Script)
        const fecha = new Date();
        const yyyymmdd = fecha.getFullYear().toString() + 
                         (fecha.getMonth() + 1).toString().padStart(2, '0') + 
                         fecha.getDate().toString().padStart(2, '0');
        const random = Math.random().toString(36).substring(2, 7).toUpperCase();
        codigoOperacion = `ACAD-${yyyymmdd}-${random}`;
        
        console.log(`📋 Código de Operación Generado: ${codigoOperacion}`);
        
        // Leer config de matrícula: si matricula_activa=false no se cobra matrícula
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
          console.warn('⚠️ No se pudo leer config matricula_activa, asumiendo activa:', e.message);
        }
        console.log(`💳 matricula_activa = ${matriculaActivaVal === 1 ? 'SÍ se cobra' : 'NO se cobra'}`);
        
        // 4. Guardar inscripciones
        
        // ♻️ LIMPIAR PENDIENTES PREVIAS: Si el alumno ya tenía inscripciones pendientes
        // (ej: el usuario volvió atrás desde la confirmación para editar), las eliminamos
        // para que pueda re-confirmar sin error. Solo bloqueamos las 'activas'.
        const [pendientesExistentes] = await conn.query(
          `SELECT inscripcion_id FROM inscripciones WHERE alumno_id = ? AND estado = 'pendiente'`,
          [alumnoId]
        );
        if (pendientesExistentes.length > 0) {
          const idsPendientes = pendientesExistentes.map(r => r.inscripcion_id);
          console.log(`♻️ Eliminando ${idsPendientes.length} inscripción(es) pendiente(s) previas del alumno ${alumnoId}: [${idsPendientes.join(', ')}]`);
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
        
        const inscripcionesIds = [];
        for (const [nombreDeporte, info] of Object.entries(deportesMap)) {
          // ⚠️ IMPORTANTE: Usar coincidencia EXACTA (=) en vez de LIKE.
          // LIKE '%Fútbol%' con índice sobre 'nombre' y colación utf8mb4_unicode_ci
          // (insensible a acentos) devuelve "Baby Futbol" antes que "Fútbol" alfabéticamente,
          // asignando el deporte_id incorrecto a todas las inscripciones.
          const [deporteRows] = await conn.query(
            'SELECT deporte_id FROM deportes WHERE nombre = ?',
            [nombreDeporte]
          );
          
          if (deporteRows.length === 0) {
            console.warn(`⚠️ Deporte no encontrado (exacto): ${nombreDeporte}`);
            continue;
          }
          
          const deporteId = deporteRows[0].deporte_id;
          const plan = info.plan;
          const cantidadDias = info.horarios.length;
          const precioMensual = calcularPrecio(cantidadDias, plan, nombreDeporte);
          
          // ⚠️ VALIDACIÓN: Solo bloquear si ya existe inscripción ACTIVA (no pendiente, esas ya se limpiaron)
          const [inscripcionActiva] = await conn.query(
            `SELECT inscripcion_id, estado, plan, precio_mensual 
             FROM inscripciones 
             WHERE alumno_id = ? AND deporte_id = ? AND estado = 'activa'
             LIMIT 1`,
            [alumnoId, deporteId]
          );
          
          if (inscripcionActiva.length > 0) {
            const inscExist = inscripcionActiva[0];
            console.warn(`⚠️ DUPLICADO ACTIVO: Alumno ${alumnoId} ya tiene inscripción ACTIVA en ${nombreDeporte} (ID: ${inscExist.inscripcion_id})`);
            await conn.rollback();
            conn.release();
            return res.status(409).json({
              success: false,
              error: 'Inscripción duplicada',
              message: `Ya tienes una inscripción activa en ${nombreDeporte}. No puedes inscribirte dos veces en el mismo deporte.`,
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
          
          console.log(`✅ Inscripción: ${nombreDeporte} - ${plan} - S/.${precioMensual}`);
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
                console.log(`✅ Horario guardado: Inscripción ${inscripcionId} -> Horario ${horario.horario_id}`);
              } catch (horarioError) {
                // Si falla un horario individual, toda la transacción debe revertirse
                throw horarioError;
              }
            } else {
              console.error(`❌ Horario sin ID para inscripción ${inscripcionId}:`, horario);
            }
          }
        }
        
        console.log(`✅ Total horarios guardados: ${horariosGuardados} de ${horarios.length}`);
        
        if (horariosGuardados === 0) {
          console.error('⚠️ ADVERTENCIA: No se guardó ningún horario');
        }
        
        // Todo salió bien → confirmar la transacción (alumno + inscripciones + horarios)
        await conn.commit();
        conn.release();

        // Guardar número de operación en tabla alumnos si viene con comprobante
        if (comprobante && comprobante.numero_operacion) {
          const numOp = comprobante.numero_operacion.trim();
          if (numOp) {
            try {
              await db.query(
                `UPDATE alumnos SET numero_operacion = ?, updated_at = NOW() WHERE alumno_id = ?`,
                [numOp, alumnoId]
              );
              console.log(`✅ Número de operación guardado: ${numOp}`);
            } catch (numOpErr) {
              console.error('❌ Error guardando número de operación:', numOpErr.message);
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
        
        console.log('✅ INSCRIPCIÓN GUARDADA EN MYSQL');
      } catch (mysqlError) {
        // Revertir TODOS los cambios: alumno, inscripciones y horarios quedan como si nada
        try { await conn.rollback(); } catch (_) {}
        conn.release();

        console.error('❌ Error MySQL:', mysqlError);
        // Construir mensaje orientativo según el código MySQL
        let mensajeUsuario = 'No se pudo completar la inscripción. Por favor intente nuevamente.';
        let codigoError = mysqlError.code || 'UNKNOWN';
        if (codigoError === 'ER_DUP_ENTRY') {
          mensajeUsuario = 'El alumno ya tiene una inscripción registrada para este deporte.';
        } else if (codigoError === 'ER_NO_REFERENCED_ROW_2') {
          mensajeUsuario = 'Uno de los horarios seleccionados ya no está disponible. Vuelve y selecciona otro.';
        } else if (['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED'].includes(codigoError)) {
          mensajeUsuario = 'Conexión con la base de datos interrumpida. Intente nuevamente en unos segundos.';
        }
        return res.status(500).json({
          success: false,
          error: 'Error al guardar inscripción',
          message: mensajeUsuario,
          codigo: codigoError,
          detalles: mysqlError.sqlMessage || mysqlError.message || codigoError
        });
      }
    }
    
    // INVALIDAR CACHÉ
    const horariosKeys = cache.keys().filter(k => k.startsWith('horarios_'));
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(horariosKeys);
    cache.del(inscritosKeys);
    if (alumno.dni) {
      invalidateDNICache(alumno.dni);
    }
    console.log('🗑️ CACHÉ INVALIDADO');

    // ==================== SINCRONIZAR CON APPS SCRIPT EN BACKGROUND (NO BLOQUEANTE) ====================
    // Disparar la sincronización en background sin bloquear la respuesta al usuario
    setImmediate(() => {
      const payload = {
        token: APPS_SCRIPT_TOKEN,
        action: 'inscribir_multiple',
        codigo_operacion: codigoOperacion,
        alumno,
        horarios
      };
      console.log('📤 [BG] Enviando a Apps Script en background...');
      Promise.race([
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r => r.json()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 5min')), 300000))
      ])
      .then(async (appsScriptResponse) => {
        if (appsScriptResponse.success) {
          console.log('✅ [BG] Apps Script sync exitoso - Datos en Google Sheets');
          // Actualizar URLs de documentos si están disponibles
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
              console.log('✅ [BG] URLs de documentos actualizadas en MySQL');
            } catch (e) {
              console.error('❌ [BG] Error actualizando URLs:', e.message);
            }
          }
          
          // ====== SUBIR COMPROBANTE DESPUÉS DE QUE LA INSCRIPCIÓN SE SINCRONIZÓ ======
          // Esto evita race condition: carpeta ya existe + PAGOS ya tiene el código
          if (comprobante && comprobante.imagen && comprobante.nombre_archivo) {
            console.log('📸 [BG] Subiendo comprobante encadenado tras inscripción exitosa...');
            try {
              const compResp = await Promise.race([
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
                }).then(r => r.json()),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout comprobante 3min')), 180000))
              ]);
              if (compResp.success && compResp.url_comprobante && db) {
                await db.query(
                  `UPDATE alumnos SET comprobante_pago_url = ? WHERE alumno_id = ?`,
                  [compResp.url_comprobante, inscripcionData.alumnoId]
                );
                console.log(`✅ [BG] Comprobante subido a Drive: ${compResp.url_comprobante}`);
              } else {
                console.error('❌ [BG] Apps Script error al subir comprobante encadenado:', compResp.error);
              }
            } catch (compErr) {
              console.error('❌ [BG] Falló subida de comprobante encadenado:', compErr.message);
            }
          }
        } else {
          console.error('❌ [BG] Apps Script retornó error (inscripción ya guardada en MySQL):', appsScriptResponse.error);
        }
      })
      .catch(err => {
        console.error('❌ [BG] Apps Script falló (inscripción ya guardada en MySQL):', err.message);
      });
    });
    
    // Responder inmediatamente con éxito de MySQL (formato compatible con tests)
    res.json({
      success: true,
      message: 'Inscripción registrada exitosamente',
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
    
    // ==================== CONSULTAR DESDE MYSQL (PRINCIPAL) ====================
    if (db) {
      try {
        console.log(`🔍 Consultando inscripciones de DNI ${dni} en MySQL...`);
        
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
        
        console.log(`✅ Inscripciones activas encontradas en MySQL: ${rows.length}`);
        console.log(`📊 Datos:`, JSON.stringify(rows, null, 2));
        
        return res.json({
          success: true,
          inscripciones: rows,
          total: rows.length,
          source: 'mysql'
        });
        
      } catch (mysqlError) {
        console.error('❌ Error en MySQL, intentando con Google Sheets:', mysqlError);
        // Continuar con Google Sheets como fallback
      }
    }
    
    // ==================== GOOGLE SHEETS (FALLBACK) ====================
    console.log('⚠️ Consultando Google Sheets como fallback...');
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
    console.error('❌ Error al obtener inscripciones:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al obtener inscripciones' 
    });
  }
});

// Endpoint: Eliminar un día/horario de una inscripción existente
app.post('/api/eliminar-horario', async (req, res) => {
  try {
    const { dni, inscripcion_id, horario_id } = req.body;

    if (!dni || !inscripcion_id || !horario_id) {
      return res.status(400).json({ success: false, error: 'Datos incompletos' });
    }
    if (!db) return res.status(503).json({ success: false, error: 'Base de datos no disponible' });

    // 1. Validar que la inscripción pertenece al DNI y está activa
    const [inscRows] = await db.query(`
      SELECT i.inscripcion_id, i.plan, d.nombre as deporte
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.alumno_id
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE a.dni = ? AND i.inscripcion_id = ? AND i.estado = 'activa'
    `, [dni, inscripcion_id]);

    if (inscRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Inscripción no encontrada o no está activa' });
    }

    // 2. Verificar que quedan más de 1 día (no dejar inscripción vacía)
    const [countRows] = await db.query(
      'SELECT COUNT(*) as total FROM inscripcion_horarios WHERE inscripcion_id = ?',
      [inscripcion_id]
    );
    if (countRows[0].total <= 1) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar el único día registrado. Si deseas cancelar la inscripción, contacta al administrador.'
      });
    }

    // 3. Eliminar el horario
    const [del] = await db.query(
      'DELETE FROM inscripcion_horarios WHERE inscripcion_id = ? AND horario_id = ?',
      [inscripcion_id, horario_id]
    );
    if (del.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado en esta inscripción' });
    }

    // 4. Recalcular precio_mensual con el nuevo total de días
    const [totalRows] = await db.query(
      'SELECT COUNT(*) as total FROM inscripcion_horarios WHERE inscripcion_id = ?',
      [inscripcion_id]
    );
    const totalDias = totalRows[0].total;
    const { plan, deporte } = inscRows[0];

    const calcularPrecio = (dias, plan, deporte) => {
      if (deporte === 'MAMAS FIT' || plan === 'MAMAS FIT') return 60;
      if (plan === 'Baby Fútbol' || deporte === 'Baby Fútbol') {
        if (dias === 1) return 50; if (dias === 2) return 100; return 150;
      }
      if (plan === 'Económico') { if (dias === 2) return 60; if (dias >= 3) return 80; return 60; }
      if (plan === 'Estándar') { if (dias === 1) return 40; if (dias === 2) return 80; return 120; }
      if (plan === 'Premium') { if (dias === 2) return 100; return 150; }
      return 60;
    };
    const nuevoPrecio = calcularPrecio(totalDias, plan, deporte);
    await db.query('UPDATE inscripciones SET precio_mensual = ? WHERE inscripcion_id = ?', [nuevoPrecio, inscripcion_id]);

    // 5. Limpiar caché
    cache.del(getCacheKey('consultas', dni));
    console.log(`🗑️ Horario ${horario_id} eliminado de inscripción ${inscripcion_id}. Días restantes: ${totalDias}. Precio: S/.${nuevoPrecio}`);

    res.json({
      success: true,
      message: 'Día eliminado correctamente',
      nuevo_precio: nuevoPrecio,
      total_dias: totalDias
    });
  } catch (error) {
    console.error('❌ Error al eliminar horario:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar el horario. Intente nuevamente.' });
  }
});

// Endpoint: Agregar un día/horario a una inscripción existente
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

    // 1. Validar que la inscripción pertenece al DNI y está activa
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
        error: 'Inscripción no encontrada o no está activa'
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
        error: 'El horario no corresponde al deporte inscrito o no está disponible'
      });
    }

    // 2b. Validar que la categoría y plan del nuevo horario coincidan con los horarios existentes
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
          error: `El horario seleccionado es de categoría ${catNueva}, pero tu inscripción es de categoría ${catExistente}.`
        });
      }
      if (planExistente && planNuevo && planExistente !== planNuevo) {
        return res.status(400).json({
          success: false,
          error: `El horario seleccionado corresponde al plan ${planNuevo}, pero tu inscripción es del plan ${planExistente}.`
        });
      }
    }

    // 3. Verificar que no esté ya inscrito en ese horario
    const [existRows] = await db.query(`
      SELECT 1 FROM inscripcion_horarios
      WHERE inscripcion_id = ? AND horario_id = ?
    `, [inscripcion_id, horario_id]);

    if (existRows.length > 0) {
      return res.status(409).json({ success: false, error: 'Ya estás inscrito en ese horario' });
    }

    // 4. Insertar el nuevo horario
    await db.query(`
      INSERT INTO inscripcion_horarios (inscripcion_id, horario_id) VALUES (?, ?)
    `, [inscripcion_id, horario_id]);

    // 5. Recalcular precio_mensual según el nuevo total de días
    const [totalDiasRows] = await db.query(`
      SELECT COUNT(*) as total FROM inscripcion_horarios WHERE inscripcion_id = ?
    `, [inscripcion_id]);
    const totalDias = totalDiasRows[0].total;

    const [planRows] = await db.query(`
      SELECT plan FROM inscripciones WHERE inscripcion_id = ?
    `, [inscripcion_id]);
    const plan = planRows[0]?.plan || 'Económico';
    const deporteNombre = inscripcion.deporte;

    // Misma lógica que el endpoint de inscripción
    const calcularPrecio = (cantidadDias, plan, deporte) => {
      if (deporte === 'MAMAS FIT' || plan === 'MAMAS FIT') return 60;
      if (plan === 'Baby Fútbol' || deporte === 'Baby Fútbol') {
        if (cantidadDias === 1) return 50;
        if (cantidadDias === 2) return 100;
        if (cantidadDias >= 3) return 150;
        return 50;
      }
      if (plan === 'Económico') {
        if (cantidadDias === 2) return 60;
        if (cantidadDias >= 3) return 80;
        return 60;
      }
      if (plan === 'Estándar') {
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

    console.log(`💰 precio_mensual actualizado: S/.${nuevoPrecio} (${totalDias} días, plan ${plan})`);

    // 6. Limpiar caché del DNI
    const cacheKeyConsulta = getCacheKey('consultas', dni);
    cache.del(cacheKeyConsulta);

    console.log(`✅ Horario ${horario_id} (${horRows[0].dia} ${horRows[0].hora_inicio}) agregado a inscripción ${inscripcion_id} (DNI ${dni})`);

    res.json({
      success: true,
      message: `Día ${horRows[0].dia} agregado correctamente a ${inscripcion.deporte}`,
      nuevo_precio: nuevoPrecio,
      total_dias: totalDias
    });

  } catch (error) {
    console.error('❌ Error al agregar horario:', error);
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
    
    // INVALIDAR CACHÉ después de registrar pago
    if (alumno.dni) {
      invalidateDNICache(alumno.dni);
    }
    console.log('🗑️ CACHÉ INVALIDADO tras registrar pago');
    
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
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    const horariosKeys = cache.keys().filter(k => k.startsWith('horarios_'));
    cache.del(inscritosKeys);
    cache.del(horariosKeys);
    console.log('🗑️ CACHÉ INVALIDADO tras eliminar usuario');
    
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
    const cacheKey = getCacheKey('consultas', dni);
    
    // Intentar obtener del caché
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`⚡ CACHÉ HIT: ${cacheKey}`);
      return res.json(cachedData);
    }
    
    console.log(`🌐 CACHÉ MISS: ${cacheKey}`);
    
    // ==================== CONSULTAR MYSQL PRIMERO ====================
    if (db) {
      try {
        console.log(`🔍 Consultando estado para DNI ${dni} en MySQL...`);
        
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
            error: 'No se encontró ninguna inscripción con ese DNI'
          });
        }
        
        const alumno = alumnoRows[0];
        
        // Validar que el usuario esté activo
        if (alumno.estado === 'inactivo') {
          return res.status(403).json({
            success: false,
            inactivo: true,
            error: 'Tu cuenta ha sido desactivada. Por favor contacta al administrador.'
          });
        }
        
        // Obtener inscripciones activas y suspendidas (no canceladas)
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
          WHERE i.alumno_id = ? AND i.estado IN ('activa', 'suspendida')
        `, [alumno.alumno_id]);
        
        // Obtener horarios de cada inscripción
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
            ORDER BY FIELD(h.dia, 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO')
          `, [inscripcion.inscripcion_id]);
          
          if (horarios.length > 0) {
            horarios.forEach(h => {
              horariosCompletos.push({
                inscripcion_id: inscripcion.inscripcion_id,
                horario_id: h.horario_id,
                deporte: inscripcion.deporte,
                sede: 'Sede Principal',
                plan: inscripcion.plan || 'Económico',
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
              plan: inscripcion.plan || 'Económico',
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

        // ✅ AUTO-REPARAR: Si faltan URLs de documentos, consultarlas en Apps Script y guardarlas
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
                // Guardar en MySQL para la próxima vez
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
                console.log(`✅ URLs de documentos recuperadas de Apps Script para DNI ${dni}`);
              }
            }
          } catch (e) {
            console.warn(`⚠️ No se pudieron recuperar URLs de Apps Script para DNI ${dni}:`, e.message);
          }
        }

        // Cachear resultado
        cache.set(cacheKey, resultado, CACHE_TTL.consultas);
        console.log(`💾 CACHÉ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.consultas}s)`);
        console.log(`✅ Consulta desde MySQL - Estado pago: ${alumno.estado_pago}`);
        
        return res.json(resultado);
        
      } catch (mysqlError) {
        console.error('❌ Error en MySQL, usando Google Sheets:', mysqlError.message);
        // Continuar con Google Sheets como fallback
      }
    }
    
    // ==================== GOOGLE SHEETS FALLBACK ====================
    console.log('⚠️ Consultando Google Sheets como fallback...');
    const url = `${APPS_SCRIPT_URL}?action=consultar_inscripcion&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al consultar inscripción');
    }
    
    // Solo cachear si la consulta fue exitosa
    if (data.success) {
      cache.set(cacheKey, data, CACHE_TTL.consultas);
      console.log(`💾 CACHÉ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.consultas}s)`);
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

// Endpoint: Obtener datos de inscripción por código de operación
app.get('/api/inscripcion/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    if (!codigo) {
      return res.status(400).json({
        success: false,
        error: 'Código de operación requerido'
      });
    }
    
    console.log(`🔍 Buscando inscripción con código: ${codigo}`);
    
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
        error: 'No se encontró ninguna inscripción con ese código'
      });
    }
    
    // Agrupar horarios por inscripción
    const primerInscripcion = inscripciones[0];
    const horarios = inscripciones.map(ins => ({
      deporte: ins.deporte,
      precio: parseFloat(ins.precio || 0),
      matricula: parseFloat(ins.matricula || 0)
    }));
    
    // Calcular deportes nuevos para matrícula
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
    
    console.log(`✅ Inscripción encontrada: ${datos.alumno} (${datos.dni})`);
    
    res.json(datos);
  } catch (error) {
    console.error('❌ Error al obtener inscripción:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener inscripción'
    });
  }
});

// Endpoint: Subir comprobante de pago
app.post('/api/subir-comprobante', async (req, res) => {
  try {
    const { codigo_operacion, dni, alumno, imagen, nombre_archivo } = req.body;
    
    // Validaciones básicas
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
        error: 'Formato de imagen inválido. Debe ser Base64 con prefijo data:image/'
      });
    }
    
    console.log(`📸 Subiendo comprobante para DNI ${dni}, código: ${codigo_operacion}`);

    // Validar que el código existe en MySQL (no depender del Sheet)
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
          error: 'Código de operación no encontrado. Verifica tu inscripción.'
        });
      }
      // Marcar en MySQL que el comprobante fue recibido (pendiente de subir a Drive)
      await db.query(
        `UPDATE inscripciones SET estado = 'pendiente' 
         WHERE codigo_operacion = ? AND estado = 'pendiente'`,
        [codigo_operacion]
      );
    }

    // Invalidar caché inmediatamente
    invalidateDNICache(dni);

    // Responder éxito al usuario de inmediato
    res.json({
      success: true,
      message: 'Comprobante recibido correctamente. Será procesado en breve.',
      url_comprobante: null
    });

    // Subir a Apps Script / Google Drive en background
    setImmediate(() => {
      console.log(`📤 [BG] Subiendo comprobante a Drive para código: ${codigo_operacion}`);
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
          console.log(`✅ [BG] Comprobante subido a Drive: ${data.url_comprobante}`);
        } else {
          console.error('❌ [BG] Apps Script error al subir comprobante:', data.error);
        }
      })
      .catch(err => {
        console.error('❌ [BG] Falló subida de comprobante a Drive:', err.message);
      });
    });

  } catch (error) {
    console.error('❌ Error al subir comprobante:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al subir comprobante' 
    });
  }
});

/**
 * POST /api/subir-comprobante-tardio/:dni
 * Subir comprobante después de la inscripción (para usuarios que eligieron efectivo)
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
        error: 'Número de operación requerido',
        message: 'Debes ingresar el número de operación de tu comprobante de pago.'
      });
    }
    
    if (!imagen.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Formato de imagen inválido. Debe ser Base64 con prefijo data:image/'
      });
    }
    
    console.log(`📸 Subida tardía de comprobante para DNI ${dni}`);
    
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
      console.error('❌ Error del Apps Script al subir comprobante tardío:', data.error);
      return res.status(response.status || 500).json({
        success: false,
        error: data.error || 'Error al subir comprobante a Google Drive'
      });
    }
    
    const urlComprobante = data.url_comprobante;
    console.log('✅ Comprobante subido a Drive:', urlComprobante);
    
    // Actualizar MySQL con la URL del comprobante y el número de operación
    await db.query(
      'UPDATE alumnos SET comprobante_pago_url = ?, numero_operacion = ?, updated_at = NOW() WHERE dni = ?',
      [urlComprobante, numero_operacion.trim(), dni]
    );
    console.log('✅ MySQL actualizado con URL del comprobante y número de operación');
    
    // Invalidar caché
    invalidateDNICache(dni);
    
    res.json({
      success: true,
      message: 'Comprobante subido exitosamente',
      url_comprobante: urlComprobante
    });
    
  } catch (error) {
    console.error('❌ Error al subir comprobante tardío:', error);
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
app.post('/api/pago-mensual', async (req, res) => {
  try {
    const { dni, alumno, imagen, nombre_archivo, mes, monto } = req.body;
    
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
        error: 'Formato de imagen inválido. Debe ser Base64 con prefijo data:image/'
      });
    }
    
    console.log(`💳 Pago mensual recibido - DNI: ${dni}, Mes: ${mes}`);
    
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
      console.error('❌ Error del Apps Script al subir pago mensual:', data.error);
      return res.status(response.status || 500).json({
        success: false,
        error: data.error || 'Error al subir comprobante a Google Drive'
      });
    }
    
    const urlComprobante = data.url_comprobante;
    console.log('✅ Pago mensual subido a Drive:', urlComprobante);
    
    // Extraer mes y año del string (formato: "enero-2026" o "enero de 2026")
    const fechaActual = new Date();
    const mesNombre = mes.split(/[-\s]/)[0]; // "enero"
    const anioActual = fechaActual.getFullYear();
    
    // Registrar en MySQL el pago mensual
    await db.query(
      `INSERT INTO pagos_mensuales (alumno_id, mes, anio, monto, comprobante_url, estado, metodo_pago, fecha_pago, created_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', 'Transferencia/Plin', NOW(), NOW())
       ON DUPLICATE KEY UPDATE 
         comprobante_url = VALUES(comprobante_url),
         monto = VALUES(monto),
         estado = 'pendiente',
         fecha_pago = NOW()`,
      [alumnoDb.alumno_id, mesNombre, anioActual, monto || 0, urlComprobante]
    );
    console.log('✅ Pago mensual registrado en MySQL');
    
    // Invalidar caché
    invalidateDNICache(dni);
    
    res.json({
      success: true,
      message: 'Pago mensual registrado exitosamente',
      driveUrl: urlComprobante
    });
    
  } catch (error) {
    console.error('❌ Error al registrar pago mensual:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al registrar pago mensual' 
    });
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
        error: 'Acción inválida. Use: pausar o reactivar'
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
    
    // Verificar que la inscripción pertenece al alumno
    const [inscripciones] = await db.query(
      'SELECT inscripcion_id, estado FROM inscripciones WHERE inscripcion_id = ? AND alumno_id = ?',
      [inscripcion_id, alumnoId]
    );
    
    if (inscripciones.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Inscripción no encontrada o no pertenece al alumno'
      });
    }
    
    const estadoActual = inscripciones[0].estado;
    const nuevoEstado = accion === 'pausar' ? 'suspendida' : 'activa';
    
    // Validar transición de estado
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
    
    // Actualizar estado de la inscripción
    await db.query(
      'UPDATE inscripciones SET estado = ? WHERE inscripcion_id = ?',
      [nuevoEstado, inscripcion_id]
    );
    
    console.log(`✅ Inscripción ${inscripcion_id} ${accion === 'pausar' ? 'pausada' : 'reactivada'} para DNI ${dni}`);
    
    // Invalidar caché
    invalidateDNICache(dni);
    
    res.json({
      success: true,
      message: `Deporte ${accion === 'pausar' ? 'pausado' : 'reactivado'} exitosamente`,
      nuevo_estado: nuevoEstado
    });
    
  } catch (error) {
    console.error('❌ Error al toggle deporte:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al cambiar estado del deporte'
    });
  }
});

// ==================== ENDPOINTS ADMINISTRACIÓN ====================

// ==================== ENDPOINTS ADMINISTRACIÓN ====================

// Login de administrador con JWT y bcrypt
app.post('/api/admin/login', rateLimiterLogin, async (req, res) => {
  try {
    const { usuario, email, password, contrasena } = req.body;
    
    // LOG TEMPORAL PARA DEBUG
    console.log('🔍 LOGIN ATTEMPT:', {
      usuario,
      email,
      password: password ? '***' : undefined,
      contrasena: contrasena ? '***' : undefined
    });
    
    // Aceptar tanto 'password' como 'contrasena' y 'usuario' o 'email'
    const passwordInput = password || contrasena;
    const userInput = usuario || email;
    
    if (!userInput || !passwordInput) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos',
        message: 'Usuario/Email y contraseña son requeridos'
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
        error: 'Credenciales inválidas',
        message: 'Usuario/Email o contraseña incorrectos'
      });
    }
    
    const admin = admins[0];
    
    // Verificar si está bloqueado
    if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
      return res.status(423).json({
        success: false,
        error: 'Cuenta bloqueada',
        message: 'Demasiados intentos fallidos. Intente más tarde.'
      });
    }
    
    // Verificar contraseña
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
        error: 'Credenciales inválidas',
        message: 'Usuario/Email o contraseña incorrectos'
      });
    }
    
    // Login exitoso - resetear intentos y actualizar último acceso
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
    console.error('❌ Error en login admin:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error en el servidor',
      message: 'Error al procesar login'
    });
  }
});

/**
 * GET /api/configuracion/matricula_activa
 * Endpoint público para que el frontend verifique si se cobra matrícula
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
    console.error('❌ Error al obtener configuración:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener configuración'
    });
  }
});

/**
 * PUT /api/admin/configuracion/:clave
 * Actualizar una configuración específica
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
    
    console.log(`✅ Configuración actualizada: ${clave} = ${valorStr}`);
    
    res.json({
      success: true,
      message: 'Configuración actualizada',
      clave,
      valor: valor
    });
  } catch (error) {
    console.error('❌ Error al actualizar configuración:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar configuración'
    });
  }
});

// Obtener todos los inscritos (PROTEGIDO)
app.get('/api/admin/inscritos', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    const { dia, deporte } = req.query;
    
    // Crear clave de caché única basada en los filtros
    const cacheKey = `inscritos_${dia || 'all'}_${deporte || 'all'}`;
    
    // Intentar obtener del caché
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log(`⚡ CACHÉ HIT: ${cacheKey}`);
      return res.json(cachedData);
    }
    
    console.log(`🌐 CACHÉ MISS: ${cacheKey} - Consultando MySQL`);
    
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
          query += ` AND d.nombre LIKE ?`;
          params.push(`%${deporte}%`);
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
          telefono: row.telefono,
          email: row.email,
          deporte: row.deporte,
          horario: row.horario_completo || '-',
          estado_usuario: row.estado_usuario,
          estado: row.estado_inscripcion,
          estado_pago: row.estado_pago,
          fecha_registro: row.fecha_registro
        }));
        
        const data = {
          success: true,
          inscritos: alumnosConDatos,
          total: alumnosConDatos.length,
          filtros: { dia, deporte },
          source: 'mysql'
        };
        
        // Guardar en caché
        cache.set(cacheKey, data, CACHE_TTL.inscritos);
        console.log(`💾 CACHÉ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.inscritos}s, total: ${alumnosConDatos.length})`);
        
        return res.json(data);
      } catch (mysqlError) {
        console.error('❌ Error en MySQL:', mysqlError);
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

    // Guardar en caché
    cache.set(cacheKey, data, CACHE_TTL.inscritos);
    console.log(`💾 CACHÉ GUARDADO: ${cacheKey} (TTL: ${CACHE_TTL.inscritos}s)`);

    res.json(data);
  } catch (error) {
    console.error('❌ Error al listar inscritos:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al listar inscritos' 
    });
  }
});

// Cambiar contraseña del administrador actual (PROTEGIDO)
app.post('/api/admin/cambiar-password', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    const { password_actual, password_nueva } = req.body;
    const adminId = req.user.id; // Cambiado de req.usuario.admin_id a req.user.id

    if (!password_actual || !password_nueva) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere la contraseña actual y la nueva contraseña'
      });
    }

    if (password_nueva.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La nueva contraseña debe tener al menos 6 caracteres'
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

    // Verificar contraseña actual
    const passwordMatch = await bcrypt.compare(password_actual, admins[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: 'Contraseña actual incorrecta' });
    }

    // Generar hash de la nueva contraseña
    const newPasswordHash = await bcrypt.hash(password_nueva, 10);

    // Actualizar contraseña
    await db.query(
      'UPDATE administradores SET password_hash = ?, updated_at = NOW() WHERE admin_id = ?',
      [newPasswordHash, adminId]
    );

    res.json({
      success: true,
      message: 'Contraseña actualizada correctamente'
    });
  } catch (error) {
    console.error('❌ Error al cambiar contraseña:', error);
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
        error: 'La contraseña debe tener al menos 6 caracteres'
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
        error: 'El usuario o email ya están registrados'
      });
    }

    // Hash de la contraseña
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
    console.error('❌ Error al crear usuario:', error);
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
    console.error('❌ Error al listar usuarios:', error);
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

    // No puede eliminarse a sí mismo
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
    console.error('❌ Error al eliminar usuario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener estadísticas financieras detalladas (PROTEGIDO)
app.get('/api/admin/estadisticas-financieras', verificarAutenticacion, verificarAdmin, rateLimiterAdmin, async (req, res) => {
  try {
    // CALCULAR DIRECTAMENTE DESDE MYSQL PARA PRECISIÓN EXACTA
    if (!db) {
      throw new Error('Base de datos no disponible');
    }

    // 1. RESUMEN GENERAL - Solo inscripciones activas
    // MATRÍCULA: S/ 20.00 por cada inscripción activa (sin importar matricula_pagada)
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

    // 2. INGRESOS DEL MES ACTUAL - Solo inscripciones activas del mes
    const [ingresosMes] = await db.query(`
      SELECT 
        SUM(CASE WHEN i.matricula_pagada = 1 THEN d.matricula ELSE 0 END) as matriculas_mes,
        SUM(i.precio_mensual) as mensualidades_mes
      FROM inscripciones i
      INNER JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.estado = 'activa'
        AND MONTH(i.fecha_inscripcion) = MONTH(CURRENT_DATE())
        AND YEAR(i.fecha_inscripcion) = YEAR(CURRENT_DATE())
    `);

    // 3. INGRESOS DE HOY - Solo inscripciones activas de hoy
    const [ingresosHoy] = await db.query(`
      SELECT 
        SUM(CASE WHEN i.matricula_pagada = 1 THEN d.matricula ELSE 0 END) as matriculas_hoy,
        SUM(i.precio_mensual) as mensualidades_hoy
      FROM inscripciones i
      INNER JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.estado = 'activa'
        AND DATE(i.fecha_inscripcion) = CURRENT_DATE()
    `);

    // 4. ESTADÍSTICAS POR DEPORTE - Solo inscripciones activas
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

    // 5. ESTADÍSTICAS POR ALUMNO (TOP 20) - Solo con inscripciones activas
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
    const mesData = ingresosMes[0];
    const hoyData = ingresosHoy[0];

    const estadisticas = {
      resumen: {
        totalAlumnosActivos: parseInt(resumen.total_alumnos_activos) || 0,
        totalInscripcionesActivas: parseInt(resumen.total_inscripciones_activas) || 0,
        totalMatriculas: parseFloat(resumen.total_matriculas) || 0,
        totalMensualidades: parseFloat(resumen.total_mensualidades) || 0,
        totalIngresosActivos: parseFloat(resumen.total_ingresos) || 0,
        ingresosMes: (parseFloat(mesData.matriculas_mes) || 0) + (parseFloat(mesData.mensualidades_mes) || 0),
        ingresosHoy: (parseFloat(hoyData.matriculas_hoy) || 0) + (parseFloat(hoyData.mensualidades_hoy) || 0)
      },
      porDeporte: porDeporte.map(d => ({
        deporte: d.deporte,
        totalInscritos: parseInt(d.total_inscritos) || 0,
        matriculas: parseFloat(d.matriculas) || 0,
        mensualidades: parseFloat(d.mensualidades) || 0,
        total: parseFloat(d.total) || 0
      })),
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

    console.log('📊 Estadísticas financieras calculadas:', {
      alumnos: estadisticas.resumen.totalAlumnosActivos,
      inscripciones: estadisticas.resumen.totalInscripcionesActivas,
      ingresos: `S/ ${estadisticas.resumen.totalIngresosActivos.toFixed(2)}`
    });

    res.json({
      success: true,
      estadisticas
    });

  } catch (error) {
    console.error('❌ Error al obtener estadísticas financieras:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al obtener estadísticas' 
    });
  }
});

// ==================== FIN ENDPOINTS ADMINISTRACIÓN ====================

// Endpoint: Desactivar usuario (soft delete - marca como inactivo)
app.post('/api/desactivar-usuario', async (req, res) => {
  try {
    const { dni } = req.body;
    
    if (!dni || dni.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'DNI inválido'
      });
    }
    
    // ==================== DESACTIVAR EN MYSQL ====================
    if (db) {
      try {
        console.log(`🔴 Desactivando usuario DNI ${dni} en MySQL...`);
        
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
          
          // Desactivar todas las inscripciones del alumno (usar 'cancelada' según ENUM)
          await db.query(
            `UPDATE inscripciones SET estado = 'cancelada' WHERE alumno_id = ?`,
            [alumnoId]
          );
          
          console.log(`✅ Usuario ${dni} desactivado en MySQL (estado: cancelada)`);
        }
        
        // INVALIDAR CACHÉ
        invalidateDNICache(dni);
        const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
        cache.del(inscritosKeys);
        console.log('🗑️ CACHÉ INVALIDADO tras desactivar usuario');
        
        // También sincronizar con Google Sheets como backup
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
          console.log('📊 Sincronizado con Google Sheets');
        } catch (sheetError) {
          console.warn('⚠️ No se pudo sincronizar con Sheets:', sheetError.message);
        }
        
        return res.json({
          success: true,
          message: 'Usuario desactivado correctamente'
        });
        
      } catch (mysqlError) {
        console.error('❌ Error en MySQL:', mysqlError);
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
    
    // INVALIDAR CACHÉ después de desactivar usuario
    invalidateDNICache(dni);
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(inscritosKeys);
    console.log('🗑️ CACHÉ INVALIDADO tras desactivar usuario');
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al desactivar usuario:', error);
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
        error: 'DNI inválido'
      });
    }
    
    // ==================== REACTIVAR EN MYSQL ====================
    if (db) {
      try {
        console.log(`🟢 Reactivando usuario DNI ${dni} en MySQL...`);
        
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
          
          console.log(`✅ Usuario ${dni} reactivado en MySQL (inscripciones: cancelada → activa)`);
        }
        
        // INVALIDAR CACHÉ
        invalidateDNICache(dni);
        const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
        cache.del(inscritosKeys);
        console.log('🗑️ CACHÉ INVALIDADO tras reactivar usuario');
        
        // También sincronizar con Google Sheets como backup
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
          console.log('📊 Sincronizado con Google Sheets');
        } catch (sheetError) {
          console.warn('⚠️ No se pudo sincronizar con Sheets:', sheetError.message);
        }
        
        return res.json({
          success: true,
          message: 'Usuario reactivado correctamente'
        });
        
      } catch (mysqlError) {
        console.error('❌ Error en MySQL:', mysqlError);
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
    
    // INVALIDAR CACHÉ después de reactivar usuario
    invalidateDNICache(dni);
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(inscritosKeys);
    console.log('🗑️ CACHÉ INVALIDADO tras reactivar usuario');
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al reactivar usuario:', error);
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
        error: 'DNI inválido'
      });
    }
    
    const url = `${APPS_SCRIPT_URL}?action=activar_inscripciones&token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}&dni=${encodeURIComponent(dni)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error al activar inscripciones');
    }
    
    // INVALIDAR CACHÉ después de activar inscripciones
    invalidateDNICache(dni);
    const horariosKeys = cache.keys().filter(k => k.startsWith('horarios_'));
    const inscritosKeys = cache.keys().filter(k => k.startsWith('inscritos_'));
    cache.del(horariosKeys);
    cache.del(inscritosKeys);
    console.log('🗑️ CACHÉ INVALIDADO tras activar inscripciones');
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error al activar inscripciones:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al activar inscripciones' 
    });
  }
});

// ==================== ENDPOINT PÚBLICO DE RANKING ====================
// Ranking público para mostrar en la página principal
app.get('/api/public/ranking', async (req, res) => {
    try {
        const mesActual = new Date().getMonth() + 1;
        const anioActual = new Date().getFullYear();
        
        // Función auxiliar para convertir URLs de Google Drive a formato de imagen directa
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
                // Usar el formato de thumbnail de Google que es más confiable
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
        
        // Si no hay datos del mes actual, devolver array vacío
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
        console.error('Error obteniendo ranking público:', error);
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
        // Verificar usuario/email únicos
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
            return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 8 caracteres' });
        }
        const hash = await bcrypt.hash(password, 10);
        await db.query('UPDATE administradores SET password_hash = ? WHERE admin_id = ? AND rol = ?', [hash, adminId, 'profesor']);
        res.json({ success: true });
    } catch (error) {
        console.error('Error en PUT /api/admin/docentes/password:', error);
        res.status(500).json({ success: false, error: 'Error al actualizar contraseña' });
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
        console.log(`🗑️ Docente eliminado: ${docente.nombre_completo} (ID: ${adminId})`);
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
        if (existe.length > 0) return res.status(400).json({ success: false, error: 'Esta asignación ya existe' });

        await db.query(
            'INSERT INTO profesor_deportes (admin_id, deporte_id, categoria, dia, horario_id) VALUES (?, ?, ?, ?, ?)',
            [admin_id, horario.deporte_id, horario.categoria, horario.dia, horario_id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error en POST /api/admin/asignaciones-docentes:', error);
        res.status(500).json({ success: false, error: 'Error al crear asignación' });
    }
});

// DELETE /api/admin/asignaciones-docentes/:id
app.delete('/api/admin/asignaciones-docentes/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM profesor_deportes WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error en DELETE /api/admin/asignaciones-docentes:', error);
        res.status(500).json({ success: false, error: 'Error al eliminar asignación' });
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

// GET /api/admin/dias?deporte_id=X&categoria=Y  — días distintos para deporte+categoría
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
        res.status(500).json({ success: false, error: 'Error al obtener días' });
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

// GET /api/admin/exportar-asistencias-json — datos para generar Excel en el cliente
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

        // Función para escapar valores CSV (comillas dobles si contiene coma/comilla/salto)
        const esc = (v) => {
            const s = v == null ? '' : String(v).trim();
            return s.includes(';') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const SEP = ';';
        const headers = ['Fecha', 'Deporte', 'Categoría', 'Día', 'Hora Inicio', 'Hora Fin', 'Alumno', 'DNI', 'Asistencia'];
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

        // BOM UTF-8 para que Excel detecte la codificación correctamente
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
// Devuelve las clases del profesor para el día indicado (o todas si no se especifica)
app.get('/api/profesor/mis-clases', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const diaParam = req.query.dia ? req.query.dia.toUpperCase() : null;
        const fechaHoy = req.query.fecha || new Date().toISOString().split('T')[0];

        // Mapa de nombres en español mixto a uppercase (por si viene 'Lunes' en lugar de 'LUNES')
        const diaMap = {
            'LUNES': 'LUNES', 'MARTES': 'MARTES', 'MIERCOLES': 'MIERCOLES',
            'MIÉRCOLES': 'MIERCOLES', 'JUEVES': 'JUEVES', 'VIERNES': 'VIERNES',
            'SABADO': 'SABADO', 'SÁBADO': 'SABADO', 'DOMINGO': 'DOMINGO'
        };
        const dia = diaParam ? (diaMap[diaParam] || diaParam) : null;

        let query = `
            SELECT
                pd.horario_id,
                d.nombre AS deporte,
                pd.categoria,
                h.dia,
                h.hora_inicio,
                h.hora_fin,
                h.cupo_maximo,
                COALESCE(COUNT(DISTINCT CASE WHEN i.estado = 'activa' THEN ih.inscripcion_id END), 0) AS total_alumnos,
                (SELECT COUNT(*) FROM asistencias ast WHERE ast.horario_id = pd.horario_id AND ast.fecha = ?) > 0 AS asistencia_hoy
            FROM profesor_deportes pd
            JOIN horarios h ON h.horario_id = pd.horario_id
            JOIN deportes d ON d.deporte_id = pd.deporte_id
            LEFT JOIN inscripcion_horarios ih ON ih.horario_id = pd.horario_id
            LEFT JOIN inscripciones i ON i.inscripcion_id = ih.inscripcion_id
            WHERE pd.admin_id = ?
        `;
        const params = [fechaHoy, adminId];

        if (dia) {
            query += ' AND h.dia = ?';
            params.push(dia);
        }

        query += ' GROUP BY pd.horario_id, d.nombre, pd.categoria, h.dia, h.hora_inicio, h.hora_fin, h.cupo_maximo ORDER BY h.hora_inicio';

        const [rows] = await db.query(query, params);

        const clases = rows.map(r => ({
            horario_id: r.horario_id,
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
// Devuelve los deportes únicos (sin repetir) asignados al profesor
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
// Devuelve las categorías del profesor para un deporte específico
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
        res.status(500).json({ success: false, error: 'Error al obtener categorías', categorias: [] });
    }
});

// GET /api/profesor/dias-categoria?deporte_id=X&categoria=Y
// Devuelve los días disponibles para una categoría
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
        res.status(500).json({ success: false, error: 'Error al obtener días', dias: [] });
    }
});

// GET /api/profesor/horarios-categoria?deporte_id=X&categoria=Y&dia=Z
// Devuelve los horarios del profesor para deporte/categoría/día
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
// Devuelve los alumnos inscritos en un horario con su estado de asistencia de hoy
app.get('/api/profesor/alumnos-clase/:horarioId', verificarAutenticacion, async (req, res) => {
    try {
        const { horarioId } = req.params;
        // Usar fecha enviada por el cliente (hora local Perú) si viene, sino UTC
        const fechaHoy = req.query.fecha || new Date().toISOString().split('T')[0];

        // Datos del horario
        const [[horario]] = await db.query(`
            SELECT h.horario_id, d.nombre AS deporte, h.categoria, h.dia, h.hora_inicio, h.hora_fin
            FROM horarios h
            JOIN deportes d ON d.deporte_id = h.deporte_id
            WHERE h.horario_id = ?
        `, [horarioId]);

        if (!horario) {
            return res.status(404).json({ success: false, error: 'Horario no encontrado' });
        }

        // Alumnos inscritos + asistencia de hoy si existe
        const [alumnos] = await db.query(`
            SELECT
                a.alumno_id,
                CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) AS nombre_completo,
                a.dni,
                CASE WHEN ast.asistencia_id IS NOT NULL THEN 1 ELSE 0 END AS asistencia_registrada,
                COALESCE(ast.presente, 1) AS presente
            FROM inscripciones i
            JOIN inscripcion_horarios ih ON ih.inscripcion_id = i.inscripcion_id
            JOIN alumnos a ON a.alumno_id = i.alumno_id
            LEFT JOIN asistencias ast ON ast.alumno_id = a.alumno_id
                AND ast.horario_id = ? AND ast.fecha = ?
            WHERE ih.horario_id = ?
              AND i.estado = 'activa'
            ORDER BY a.apellido_paterno, a.nombres
        `, [horarioId, fechaHoy, horarioId]);

        res.json({ success: true, horario, alumnos });
    } catch (error) {
        console.error('Error en /api/profesor/alumnos-clase:', error);
        res.status(500).json({ success: false, error: 'Error al obtener alumnos', alumnos: [] });
    }
});

// POST /api/profesor/guardar-asistencia
// Guarda la asistencia de una clase y recalcula ranking automáticamente
app.post('/api/profesor/guardar-asistencia', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { horario_id, fecha, asistencias } = req.body;

        if (!horario_id || !fecha || !Array.isArray(asistencias)) {
            return res.status(400).json({ success: false, error: 'Datos incompletos' });
        }

        // 1. Guardar asistencias
        for (const a of asistencias) {
            await db.query(`
                INSERT INTO asistencias (alumno_id, horario_id, fecha, presente, registrado_por)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE presente = VALUES(presente), registrado_por = VALUES(registrado_por)
            `, [a.alumno_id, horario_id, fecha, a.presente ? 1 : 0, adminId]);
        }

        // 2. Recalcular puntos de asistencia del mes automáticamente
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
            console.error('Error al recalcular ranking automático:', rankError);
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
        const limite = Math.min(parseInt(req.query.limite) || 20, 60);

        const [rows] = await db.query(`
            SELECT
                ast.fecha,
                SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes,
                SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS ausentes,
                COUNT(*) AS total
            FROM asistencias ast
            WHERE ast.horario_id = ?
            GROUP BY ast.fecha
            ORDER BY ast.fecha DESC
            LIMIT ?
        `, [horarioId, limite]);

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
app.get('/api/profesor/datos-exportar', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { horario_id, mes, anio } = req.query;

        if (!horario_id || !mes || !anio) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros: horario_id, mes, anio' });
        }

        // Verificar que el horario pertenece al profesor
        const [[horario]] = await db.query(`
            SELECT h.horario_id, d.nombre AS deporte, h.categoria, h.dia, h.hora_inicio, h.hora_fin
            FROM horarios h
            JOIN deportes d ON d.deporte_id = h.deporte_id
            JOIN profesor_deportes pd ON pd.horario_id = h.horario_id AND pd.admin_id = ?
            WHERE h.horario_id = ?
        `, [adminId, horario_id]);

        if (!horario) {
            return res.status(403).json({ success: false, error: 'Horario no autorizado' });
        }

        // Obtener todas las fechas de clase de ese mes para ese horario
        const [fechasRows] = await db.query(`
            SELECT DISTINCT ast.fecha
            FROM asistencias ast
            WHERE ast.horario_id = ?
              AND MONTH(ast.fecha) = ? AND YEAR(ast.fecha) = ?
            ORDER BY ast.fecha ASC
        `, [horario_id, mes, anio]);

        const fechas = fechasRows.map(r =>
            r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : String(r.fecha).split('T')[0]
        );

        // Obtener todos los alumnos inscritos en ese horario
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
            WHERE ih.horario_id = ?
            ORDER BY a.apellido_paterno, a.nombres
        `, [horario_id]);

        // Obtener todas las asistencias del mes para ese horario
        const [asistencias] = await db.query(`
            SELECT alumno_id, fecha, presente
            FROM asistencias
            WHERE horario_id = ?
              AND MONTH(fecha) = ? AND YEAR(fecha) = ?
        `, [horario_id, mes, anio]);

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
// Devuelve el ranking de alumnos para el deporte/categoría del profesor
app.get('/api/profesor/ranking', verificarAutenticacion, async (req, res) => {
    try {
        const adminId = req.admin.admin_id;
        const { deporte_id, categoria } = req.query;

        // Verificar que el profesor tiene asignado ese deporte/categoría
        const [check] = await db.query(
            'SELECT id FROM profesor_deportes WHERE admin_id = ? AND deporte_id = ? AND (? IS NULL OR categoria = ?)',
            [adminId, deporte_id, categoria || null, categoria || null]
        );
        if (check.length === 0) {
            return res.status(403).json({ success: false, error: 'No autorizado para este deporte/categoría' });
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
        res.status(500).json({ success: false, error: 'Error al obtener categorías', categorias: [] });
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

        // Condición de deporte
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

    // Verificar conexión MySQL
    if (db) {
      try {
        const [rows] = await db.query('SELECT 1 as health');
        if (rows[0].health === 1) {
          healthInfo.database = 'connected'; // Actualizar estado
          
          // Obtener estadísticas básicas
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
// Estos endpoints están OBSOLETOS y han sido reemplazados por los endpoints principales
// que usan MySQL + Apps Script. NO HABILITAR - causarán conflictos

/*
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

FIN BLOQUE LEGACY COMENTADO */

console.log('⚠️  Endpoints legacy deshabilitados - usando solo MySQL + Apps Script');

// ==================== ENDPOINTS ADMINISTRATIVOS CACHÉ ====================

// Ver estadísticas del caché
app.get('/api/cache/stats', (req, res) => {
  const stats = getCacheStats();
  res.json({
    success: true,
    cache: stats
  });
});

// Limpiar todo el caché
app.post('/api/cache/clear', (req, res) => {
  cache.flushAll();
  console.log('🗑️ TODO EL CACHÉ HA SIDO LIMPIADO');
  res.json({
    success: true,
    message: 'Caché limpiado correctamente'
  });
});

// ==================== ENDPOINTS DE REUBICACIONES ====================

// Obtener deportes con sus categorías para reubicaciones
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

    // Para cada deporte, obtener sus categorías únicas
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

// Obtener alumnos agrupados por categoría para un deporte
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

    // 1. Obtener TODAS las categorías únicas de horarios de este deporte
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

    // 3. Crear mapa de categorías con sus alumnos
    const categoriasMap = {};
    
    // Inicializar todas las categorías de horarios (incluso las vacías)
    categoriasHorarios.forEach(cat => {
      categoriasMap[cat.categoria] = {
        alumnos: [],
        precio: cat.precio
      };
    });

    // Agregar categoría para alumnos sin horario asignado
    categoriasMap['Sin asignar'] = { alumnos: [], precio: 0 };

    // Asignar alumnos a sus categorías
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

    // Convertir a array, filtrando la categoría "Sin asignar" si está vacía
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

// Preview de reubicación - muestra qué cambiaría
app.get('/api/admin/reubicaciones/preview', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { inscripcionId, categoriaDestino, deporteId } = req.query;

    // Obtener info actual de la inscripción con o sin horario
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
      return res.status(404).json({ success: false, error: 'Inscripción no encontrada' });
    }

    const actual = inscripcionActual[0];
    const categoriaActual = actual.categoria_actual || 'Sin asignar';
    const precioActual = parseFloat(actual.precio_inscripcion) || 0;

    // Obtener horarios disponibles en la categoría destino
    const [horariosDestino] = await db.query(`
      SELECT horario_id, dia, hora_inicio, hora_fin, precio
      FROM horarios
      WHERE deporte_id = ? 
        AND categoria = ?
        AND estado = 'activo'
      ORDER BY FIELD(dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO')
    `, [deporteId, categoriaDestino]);

    // Obtener precio de la categoría destino
    const precioNuevo = horariosDestino.length > 0 ? parseFloat(horariosDestino[0].precio) || 0 : 0;

    // Construir días actuales
    let diasActuales = ['Sin horario asignado'];
    if (actual.dia && actual.hora_inicio) {
      // Si hay más horarios actuales, obtenerlos
      const [todosHorariosActuales] = await db.query(`
        SELECT h.dia, h.hora_inicio, h.hora_fin 
        FROM inscripcion_horarios ih
        INNER JOIN horarios h ON ih.horario_id = h.horario_id
        WHERE ih.inscripcion_id = ?
        ORDER BY FIELD(h.dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO')
      `, [inscripcionId]);
      
      diasActuales = todosHorariosActuales.map(h => `${h.dia} ${h.hora_inicio} - ${h.hora_fin}`);
    }

    // La nueva categoría asigna TODOS sus horarios activos al alumno
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

// Ejecutar reubicación
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

    // Verificar que la inscripción existe
    const [inscripcionVerify] = await connection.query(
      'SELECT inscripcion_id, precio_mensual FROM inscripciones WHERE inscripcion_id = ? AND deporte_id = ?',
      [inscripcionId, deporteId]
    );
    if (inscripcionVerify.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Inscripción no encontrada' });
    }

    // Obtener TODOS los días actuales del alumno en esta inscripción
    const [horariosActualesInfo] = await connection.query(`
      SELECT ih.horario_id, h.dia 
      FROM inscripcion_horarios ih
      INNER JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE ih.inscripcion_id = ? AND h.deporte_id = ?
      ORDER BY FIELD(h.dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO')
    `, [inscripcionId, deporteId]);

    const diasActualesMover = horariosActualesInfo.map(h => h.dia);

    // Obtener TODOS los horarios activos de la categoría destino
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
        error: `No hay horarios disponibles en la categoría ${categoriaDestino}` 
      });
    }

    // Asignar TODOS los horarios de la categoría destino (independientemente de los días actuales)
    const horariosAsignados = todosHorariosDestino.filter(h => h.cupo_disponible > 0);

    if (horariosAsignados.length === 0) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        error: `No hay cupos disponibles en la categoría ${categoriaDestino}` 
      });
    }

    const nuevoPrecio = horariosAsignados[0].precio;

    // Obtener TODOS los horarios actuales de esta inscripción para este deporte
    const [todosHorariosActuales] = await connection.query(`
      SELECT ih.horario_id 
      FROM inscripcion_horarios ih
      INNER JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE ih.inscripcion_id = ? AND h.deporte_id = ?
    `, [inscripcionId, deporteId]);

    // Liberar cupos de TODOS los horarios anteriores
    for (const horario of todosHorariosActuales) {
      await connection.query(
        'UPDATE horarios SET cupos_ocupados = cupos_ocupados - 1 WHERE horario_id = ? AND cupos_ocupados > 0',
        [horario.horario_id]
      );
    }

    // Eliminar TODOS los horarios anteriores de esta inscripción para este deporte
    if (todosHorariosActuales.length > 0) {
      const horarioIds = todosHorariosActuales.map(h => h.horario_id);
      await connection.query(
        'DELETE FROM inscripcion_horarios WHERE inscripcion_id = ? AND horario_id IN (?)',
        [inscripcionId, horarioIds]
      );
    }

    // Ocupar cupos e insertar TODOS los nuevos horarios asignados
    for (const horario of horariosAsignados) {
      await connection.query(
        'UPDATE horarios SET cupos_ocupados = cupos_ocupados + 1 WHERE horario_id = ?',
        [horario.horario_id]
      );
      await connection.query(
        'INSERT INTO inscripcion_horarios (inscripcion_id, horario_id) VALUES (?, ?)',
        [inscripcionId, horario.horario_id]
      );
    }

    // Actualizar el precio de la inscripción
    if (nuevoPrecio) {
      await connection.query(
        'UPDATE inscripciones SET precio_mensual = ? WHERE inscripcion_id = ?',
        [nuevoPrecio, inscripcionId]
      );
    }

    await connection.commit();

    // Limpiar caché relacionado
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

// ─────────────────────────────────────────────────────────────
// MÓDULO: Editor de Landing Page
// ─────────────────────────────────────────────────────────────
const LANDING_CONTENT_PATH = path.join(__dirname, 'landing-content.json');

// Configurar multer para subida de imágenes de la landing
const UPLOADS_DIR = path.join(__dirname, '..', 'react', 'public', 'assets', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `landing-${Date.now()}-${Math.random().toString(36).slice(2,7)}${ext}`;
    cb(null, name);
  }
});
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo se permiten imágenes'));
    cb(null, true);
  }
});

// POST /api/admin/upload-image
app.post('/api/admin/upload-image', verificarAutenticacion, verificarAdmin, imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen' });
  const url = `/assets/uploads/${req.file.filename}`;
  console.log(`[LandingEditor] Imagen subida: ${url}`);
  res.json({ success: true, url });
});


function leerLandingContent() {
  try {
    const raw = fs.readFileSync(LANDING_CONTENT_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// GET /api/admin/landing-content  — lectura pública (usada por Home si quiere)
app.get('/api/admin/landing-content', async (req, res) => {
  try {
    const content = leerLandingContent();
    if (!content) return res.status(404).json({ success: false, error: 'Contenido no encontrado' });
    res.json({ success: true, data: content });
  } catch (error) {
    console.error('Error leyendo landing-content:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// PUT /api/admin/landing-content  — escritura protegida (solo admins)
app.put('/api/admin/landing-content', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const nuevoContenido = req.body;
    if (!nuevoContenido || typeof nuevoContenido !== 'object') {
      return res.status(400).json({ success: false, error: 'Cuerpo inválido' });
    }

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

// POST /api/admin/landing-content/reset — restaurar valores por defecto
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
// MÓDULO 3 — Landing content con persistencia en MySQL
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

  // hero — fields: title, subtitle, description, image, sport, accent
  const slides = content?.hero?.slides || [];
  slides.forEach((s, i) => {
    pushText('hero', i, 'title',       s.title);
    pushText('hero', i, 'subtitle',    s.subtitle);
    pushText('hero', i, 'description', s.description);
    pushText('hero', i, 'sport',       s.sport);
    pushText('hero', i, 'accent',      s.accent);
    if (s.image) pushImage('hero', i, 'image', s.image);
  });

  // deportes — fields: titulo, descripcion, imagen, categoria, fecha, destacado
  const deportes = content?.deportes || [];
  deportes.forEach((d, i) => {
    pushText('deportes', i, 'titulo',      d.titulo);
    pushText('deportes', i, 'descripcion', d.descripcion);
    pushText('deportes', i, 'categoria',   d.categoria);
    pushText('deportes', i, 'fecha',       d.fecha);
    pushText('deportes', i, 'destacado',   d.destacado ? '1' : '0');
    if (d.imagen) pushImage('deportes', i, 'imagen', d.imagen);
  });

  // estadisticas — flat object: gente, partidos, anos, trofeos
  const est = content?.estadisticas || {};
  pushText('estadisticas', 0, 'gente',    est.gente);
  pushText('estadisticas', 0, 'partidos', est.partidos);
  pushText('estadisticas', 0, 'anos',     est.anos);
  pushText('estadisticas', 0, 'trofeos',  est.trofeos);

  // docentes — fields: nombre, especialidad, foto
  const docentes = content?.docentes || [];
  docentes.forEach((d, i) => {
    pushText('docentes', i, 'nombre',       d.nombre);
    pushText('docentes', i, 'especialidad', d.especialidad);
    if (d.foto) pushImage('docentes', i, 'foto', d.foto);
  });

  // cta — fields: titulo, subtitulo, botonTexto, botonEnlace + imagen
  const cta = content?.cta || {};
  pushText('cta', 0, 'titulo',      cta.titulo);
  pushText('cta', 0, 'subtitulo',   cta.subtitulo);
  pushText('cta', 0, 'botonTexto',  cta.botonTexto);
  pushText('cta', 0, 'botonEnlace', cta.botonEnlace);
  if (cta.imagen) pushImage('cta', 0, 'imagen', cta.imagen);

  // general — fields: nombreClub, copyright, facebook, whatsapp
  const gen = content?.general || {};
  pushText('general', 0, 'nombreClub', gen.nombreClub);
  pushText('general', 0, 'copyright',  gen.copyright);
  pushText('general', 0, 'facebook',   gen.facebook);
  pushText('general', 0, 'whatsapp',   gen.whatsapp);

  // tipografia — fields: fuenteTitulos, pesoTitulos, fuenteCuerpo
  const tip = content?.tipografia || {};
  pushText('tipografia', 0, 'fuenteTitulos', tip.fuenteTitulos);
  pushText('tipografia', 0, 'pesoTitulos',   tip.pesoTitulos);
  pushText('tipografia', 0, 'fuenteCuerpo',  tip.fuenteCuerpo);

  // partidos — array de 4 partidos, cada uno con equipoLocal, equipoVisita, fecha, resultado, liga, season, sede
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

  // novedades — header (subtitulo, titulo) + array de items
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

  // patrocinadores — array de sponsors con nombre, enlace e imagen opcional
  const sponsors = content?.patrocinadores || [];
  sponsors.forEach((sp, i) => {
    pushText('patrocinadores', i, 'nombre', sp.nombre);
    pushText('patrocinadores', i, 'enlace', sp.enlace);
    if (sp.imagen) pushImage('patrocinadores', i, 'logo', sp.imagen);
  });

  // galeria — botonTexto + 6 items con alt e imagen
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

  // estadisticas — flat object (no es array)
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
      titulo:    tIdx['novedades|0|titulo']    || 'Últimas Novedades',
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
      botonTexto: tIdx['galeria|0|botonTexto'] || 'Síguenos en Facebook',
      items: Array.from({ length: 6 }, (_, i) => ({
        imagen: iIdx[`galeria|${i + 1}|imagen`] || '',
        alt:    tIdx[`galeria|${i + 1}|alt`]    || '',
      }))
    }
  };
}

// GET /api/landing
// Devuelve el contenido activo de la landing para el público.
// Prioridad: landing_versions (status=published) → landing_texts/images → JSON fallback
app.get('/api/landing', async (req, res) => {
  try {
    // Cache: 30 s browser + stale-while-revalidate 60 s para CDN/proxy
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');

    // Módulo 5: buscar versión publicada en landing_versions
    const [vRows] = await db.query(
      `SELECT content FROM landing_versions WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`
    );
    if (vRows.length > 0) {
      const content = typeof vRows[0].content === 'string'
        ? JSON.parse(vRows[0].content)
        : vRows[0].content;
      return res.json({ success: true, source: 'versions', data: content });
    }

    // Módulo 3 fallback: landing_texts / landing_images
    const [textRows]  = await db.query('SELECT section_slug, item_index, clave, valor FROM landing_texts');
    const [imageRows] = await db.query('SELECT section_slug, item_index, clave, url FROM landing_images');

    if (textRows.length === 0 && imageRows.length === 0) {
      const json = leerLandingContent();
      return res.json({ success: true, source: 'json', data: json });
    }

    const data = rowsToContent(textRows, imageRows);
    res.json({ success: true, source: 'db', data });
  } catch (error) {
    console.error('[Landing] Error GET /api/landing:', error);
    res.status(500).json({ success: false, error: 'Error al leer contenido' });
  }
});

// POST /api/landing/update
// Guarda el contenido completo en la BD Y en landing-content.json.
// Requiere autenticación de admin.
app.post('/api/landing/update', verificarAutenticacion, verificarAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const content = req.body;
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ success: false, error: 'Cuerpo inválido' });
    }

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

    // También persistir en JSON para backward-compat con endpoints viejos
    const meta = {
      ultimaActualizacion: new Date().toISOString(),
      actualizadoPor: req.usuario?.email || 'admin'
    };
    const contentConMeta = { ...content, _meta: meta };
    fs.writeFileSync(LANDING_CONTENT_PATH, JSON.stringify(contentConMeta, null, 2), 'utf-8');

    console.log(`[Landing] Contenido actualizado en BD+JSON por ${meta.actualizadoPor}. Textos: ${texts.length}, Imágenes: ${images.length}`);
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
// Útil para la primera carga o para resetear desde el archivo.
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
    console.log(`[Landing] Seed completado. Textos: ${texts.length}, Imágenes: ${images.length}`);
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
// Alias del endpoint de subida de imágenes que ya existe.
// Usa el mismo middleware multer (imageUpload).
app.post('/api/landing/upload-image', verificarAutenticacion, verificarAdmin, imageUpload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen' });
    const url = `/assets/uploads/${req.file.filename}`;
    console.log(`[Landing] Imagen subida: ${url}`);
    res.json({ success: true, url, originalName: req.file.originalname });
  } catch (error) {
    console.error('[Landing] Error subiendo imagen:', error);
    res.status(500).json({ success: false, error: 'Error al subir imagen' });
  }
});

// ==============================================================
// MÓDULO 5 — SISTEMA DE PUBLICACIÓN DE VERSIONES
// ==============================================================

// GET /api/landing/versions
// Lista todas las versiones (sin el campo content para no saturar).
// Requiere autenticación de admin.
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
// Devuelve el contenido completo de una versión específica.
// Requiere autenticación de admin.
app.get('/api/landing/versions/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT id, label, notes, status, content, created_at, created_by, published_at, published_by
       FROM landing_versions WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Versión no encontrada' });

    const version = rows[0];
    if (typeof version.content === 'string') version.content = JSON.parse(version.content);
    res.json({ success: true, version });
  } catch (error) {
    console.error('[Versions] Error GET /api/landing/versions/:id:', error);
    res.status(500).json({ success: false, error: 'Error al leer versión' });
  }
});

// POST /api/landing/draft
// Guarda el contenido actual como un nuevo borrador.
// NO modifica la versión publicada ni afecta al público.
// Requiere autenticación de admin.
app.post('/api/landing/draft', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const content = req.body;
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ success: false, error: 'Cuerpo inválido' });
    }

    const autor = req.usuario?.email || 'admin';
    const now   = new Date();
    const label  = content._draftLabel
      || `Borrador · ${now.toLocaleDateString('es-PE')} ${now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;
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
    res.json({ success: true, draftId, label, message: 'Borrador guardado. La landing pública no ha cambiado.' });
  } catch (error) {
    console.error('[Versions] Error POST /api/landing/draft:', error);
    res.status(500).json({ success: false, error: 'Error al guardar borrador' });
  }
});

// POST /api/landing/publish/:id
// Publica una versión específica:
//   1. Archiva la versión publicada actual (si existe)
//   2. Marca la versión target como 'published'
//   3. Actualiza landing_texts/images para backward compat
//   4. Actualiza landing-content.json
// Requiere autenticación de admin.
app.post('/api/landing/publish/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { id } = req.params;
    const autor   = req.usuario?.email || 'admin';

    // 1. Verificar que la versión existe y está en estado válido
    const [rows] = await conn.query(
      `SELECT id, label, status, content FROM landing_versions WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) {
      conn.release();
      return res.status(404).json({ success: false, error: 'Versión no encontrada' });
    }
    const version = rows[0];
    if (version.status === 'archived') {
      // Permitir rollback desde archivado — continuar igual
    }

    const content = typeof version.content === 'string'
      ? JSON.parse(version.content)
      : version.content;

    await conn.beginTransaction();

    // 2. Archivar la versión publicada actual
    await conn.query(
      `UPDATE landing_versions SET status = 'archived' WHERE status = 'published' AND id != ?`,
      [id]
    );

    // 3. Publicar la versión target
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

    console.log(`[Versions] Versión #${id} ("${version.label}") publicada por ${autor}`);
    res.json({
      success: true,
      message: `Versión "${version.label}" publicada exitosamente. La landing pública ya muestra el nuevo contenido.`,
      publishedId: Number(id),
      label: version.label,
      publishedAt: new Date().toISOString(),
      publishedBy: autor,
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[Versions] Error POST /api/landing/publish/:id:', error);
    res.status(500).json({ success: false, error: 'Error al publicar versión' });
  } finally {
    conn.release();
  }
});

// DELETE /api/landing/versions/:id
// Elimina un borrador. No se pueden eliminar versiones publicadas ni archivadas.
// Requiere autenticación de admin.
app.delete('/api/landing/versions/:id', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT id, label, status FROM landing_versions WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Versión no encontrada' });

    if (rows[0].status === 'published') {
      return res.status(409).json({ success: false, error: 'No se puede eliminar la versión publicada actualmente.' });
    }

    await db.query(`DELETE FROM landing_versions WHERE id = ?`, [id]);
    console.log(`[Versions] Versión #${id} ("${rows[0].label}") eliminada`);
    res.json({ success: true, message: `Versión "${rows[0].label}" eliminada.` });
  } catch (error) {
    console.error('[Versions] Error DELETE /api/landing/versions/:id:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar versión' });
  }
});

// ==============================================================
// FIN MÓDULO 5
// ==============================================================

// ==============================================================
// MÓDULO 6 — ORDEN DE SECCIONES (landing_structure)
// ==============================================================

// SECCIONES POR DEFECTO (refleja el orden actual de Home.jsx)
const DEFAULT_SECTION_STRUCTURE = [
  { section_slug: 'hero',           orden: 10,  visible: 1 },
  { section_slug: 'partidos',       orden: 20,  visible: 1 },
  { section_slug: 'deportes',       orden: 30,  visible: 1 },
  { section_slug: 'ranking',        orden: 40,  visible: 1 },
  { section_slug: 'estadisticas',   orden: 50,  visible: 1 },
  { section_slug: 'cta',            orden: 60,  visible: 1 },
  { section_slug: 'docentes',       orden: 70,  visible: 1 },
  { section_slug: 'novedades',      orden: 80,  visible: 1 },
  { section_slug: 'patrocinadores', orden: 90,  visible: 1 },
  { section_slug: 'inscripcion',    orden: 100, visible: 1 },
  { section_slug: 'galeria',        orden: 110, visible: 1 },
];

// GET /api/landing/structure
// Público — la landing pública lo consume para ordenar secciones.
// Si la tabla está vacía devuelve los valores por defecto.
app.get('/api/landing/structure', async (req, res) => {
  try {
    // Cache: 60 s browser + stale-while-revalidate 120 s (el orden de secciones cambia poco)
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

    const [rows] = await db.query(
      `SELECT section_slug, orden, visible FROM landing_structure ORDER BY orden ASC`
    );

    // Si la tabla no tiene datos, devolver defaults y no romperse
    if (rows.length === 0) {
      return res.json({ success: true, source: 'defaults', sections: DEFAULT_SECTION_STRUCTURE });
    }

    // Mezclar: lo que hay en DB + defaults para secciones no registradas
    const dbSlugs = new Set(rows.map(r => r.section_slug));
    const missing = DEFAULT_SECTION_STRUCTURE.filter(d => !dbSlugs.has(d.section_slug));
    const all = [...rows, ...missing].sort((a, b) => a.orden - b.orden);

    res.json({ success: true, source: 'db', sections: all });
  } catch (error) {
    // Si la tabla no existe, devolver defaults sin llenar logs de errores
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.json({ success: true, source: 'defaults', sections: DEFAULT_SECTION_STRUCTURE });
    }
    console.error('[Structure] Error GET /api/landing/structure:', error);
    // Fallback seguro: nunca romper la landing por fallo de estructura
    res.json({ success: true, source: 'fallback', sections: DEFAULT_SECTION_STRUCTURE });
  }
});

// POST /api/landing/structure
// Admin only — guarda el nuevo orden de secciones.
// Body: { sections: [{section_slug, orden, visible}] }
app.post('/api/landing/structure', verificarAutenticacion, verificarAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { sections } = req.body;
    if (!Array.isArray(sections) || sections.length === 0) {
      conn.release();
      return res.status(400).json({ success: false, error: 'Se esperaba sections: [{section_slug, orden, visible}]' });
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
// FIN MÓDULO 6
// ==============================================================

// ==============================================================
// FIN MÓDULO 3
// ==============================================================

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(70));
  console.log('🚀 SERVIDOR BACKEND JAGUARES - MODO PRODUCCIÓN');
  console.log('='.repeat(70));
  console.log('');
  console.log(`📍 URL Base:        http://localhost:${PORT}`);
  console.log(`🗄️  Base de Datos:  MySQL 8.0 (Puerto 3307)`);
  console.log(`⚡ Caché:           NodeCache activado`);
  console.log('');
  console.log('🔒 SEGURIDAD ACTIVADA:');
  console.log('  ✅ JWT Authentication (8h expiry)');
  console.log('  ✅ Rate Limiting (100 req/15min general, 10 req/hour inscripciones)');
  console.log('  ✅ CORS Restricción (localhost + whitelist)');
  console.log('  ✅ Helmet Security Headers');
  console.log('  ✅ XSS Sanitization');
  console.log('  ✅ Bcrypt Password Hashing');
  console.log('');
  console.log('🏃 ENDPOINTS PÚBLICOS:');
  console.log(`  GET    /api/health                         - Health check`);
  console.log(`  GET    /api/horarios                       - Listado de horarios disponibles`);
  console.log(`  POST   /api/inscribir-multiple             - Inscripción múltiple (rate limited)`);
  console.log(`  GET    /api/mis-inscripciones/:dni         - Consultar inscripciones por DNI`);
  console.log(`  GET    /api/validar-dni/:dni               - Validar existencia de DNI`);
  console.log('');
  console.log('🔐 ENDPOINTS PROTEGIDOS (Requieren JWT):');
  console.log(`  POST   /api/admin/login                    - Autenticación admin`);
  console.log(`  GET    /api/admin/inscritos                - Listado completo de inscritos`);
  console.log(`  GET    /api/admin/estadisticas-financieras - Estadísticas financieras`);
  console.log('');
  console.log('⏳ Esperando peticiones...');
  console.log('='.repeat(70));
  console.log('');
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
    
    console.log(`✅ Deportes obtenidos: ${deportes.length}`);
    res.json({ success: true, deportes });
  } catch (error) {
    console.error('❌ Error al obtener deportes:', error);
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
    
    // Limpiar caché de horarios
    cache.flushAll();
    
    console.log(`✅ Deporte creado: ${nombre} (ID: ${result.insertId})`);
    res.json({ success: true, deporte_id: result.insertId, mensaje: 'Deporte creado correctamente' });
  } catch (error) {
    console.error('❌ Error al crear deporte:', error);
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
    
    // Limpiar caché
    cache.flushAll();
    
    console.log(`✅ Deporte actualizado: ID ${deporteId}`);
    res.json({ success: true, mensaje: 'Deporte actualizado correctamente' });
  } catch (error) {
    console.error('❌ Error al actualizar deporte:', error);
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
    
    // Limpiar caché
    cache.flushAll();
    
    console.log(`✅ Deporte desactivado: ID ${deporteId}`);
    res.json({ success: true, mensaje: 'Deporte desactivado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar deporte:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Eliminar deporte PERMANENTEMENTE (hard delete)
app.delete('/api/admin/deportes/:id/eliminar-permanente', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const deporteId = req.params.id;
    
    // Iniciar transacción (usar query en lugar de execute para transacciones)
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
      
      // 4. Eliminar categorías del deporte
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
      
      // Confirmar transacción (usar query en lugar de execute)
      await db.query('COMMIT');
      
      // Limpiar caché
      cache.flushAll();
      
      console.log(`🗑️ Deporte ELIMINADO PERMANENTEMENTE: ID ${deporteId}`);
      console.log(`   - Horarios eliminados: ${horariosResult.affectedRows}`);
      console.log(`   - Categorías eliminadas: ${categoriasResult.affectedRows}`);
      
      res.json({ 
        success: true, 
        mensaje: 'Deporte y todos sus datos asociados eliminados permanentemente',
        detalles: {
          horarios_eliminados: horariosResult.affectedRows,
          categorias_eliminadas: categoriasResult.affectedRows
        }
      });
    } catch (error) {
      // Revertir transacción en caso de error (usar query en lugar de execute)
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('❌ Error al eliminar deporte permanentemente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS PLANES ====================

// GET público (usado por selección de horarios)
app.get('/api/planes', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const [planes] = await db.execute(
      'SELECT * FROM planes WHERE activo = TRUE ORDER BY orden ASC, plan_id ASC'
    );
    res.json({ success: true, planes });
  } catch (error) {
    console.error('❌ Error GET /api/planes:', error);
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
    console.error('❌ Error GET /api/admin/planes:', error);
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
    console.error('❌ Error POST /api/admin/planes:', error);
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
    console.error('❌ Error PUT /api/admin/planes:', error);
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
    console.error('❌ Error DELETE /api/admin/planes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS NIVELES ====================

// GET público
app.get('/api/niveles', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const [niveles] = await db.execute(
      'SELECT * FROM niveles WHERE activo = TRUE ORDER BY orden ASC, nivel_id ASC'
    );
    res.json({ success: true, niveles });
  } catch (error) {
    console.error('❌ Error GET /api/niveles:', error);
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
    console.error('❌ Error GET /api/admin/niveles:', error);
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
    console.error('❌ Error POST /api/admin/niveles:', error);
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
    console.error('❌ Error PUT /api/admin/niveles:', error);
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
    console.error('❌ Error DELETE /api/admin/niveles:', error);
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
    
    console.log(`✅ Horarios obtenidos: ${horarios.length}`);
    res.json({ success: true, horarios });
  } catch (error) {
    console.error('❌ Error al obtener horarios:', error);
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
    
    // Limpiar caché
    cache.flushAll();
    
    console.log(`✅ Horario creado: ID ${result.insertId}`);
    res.json({ success: true, horario_id: result.insertId, mensaje: 'Horario creado correctamente' });
  } catch (error) {
    console.error('❌ Error al crear horario:', error);
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
    
    // Limpiar caché
    cache.flushAll();
    
    console.log(`✅ Horario actualizado: ID ${horarioId}`);
    res.json({ success: true, mensaje: 'Horario actualizado correctamente' });
  } catch (error) {
    console.error('❌ Error al actualizar horario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Edición rápida de horario (solo campos esenciales)
app.put('/api/admin/horarios/:id/edicion-rapida', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    
    const horarioId = req.params.id;
    const { categoria, nivel, plan, ano_min, ano_max, hora_inicio, hora_fin, cupo_maximo, precio, deporte_id, dia, genero, estado } = req.body;
    
    // Validar que el cupo máximo no sea menor a los cupos ocupados
    if (cupo_maximo) {
      const [horarioActual] = await db.execute(
        'SELECT cupos_ocupados FROM horarios WHERE horario_id = ?',
        [horarioId]
      );
      
      if (horarioActual.length > 0 && cupo_maximo < horarioActual[0].cupos_ocupados) {
        return res.status(400).json({ 
          success: false, 
          error: `El cupo máximo no puede ser menor a los cupos ocupados (${horarioActual[0].cupos_ocupados})` 
        });
      }
    }
    
    // Construir query dinámico solo con los campos enviados
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
    
    // Limpiar caché para reflejar cambios en tiempo real
    cache.flushAll();
    
    console.log(`✅ Edición rápida aplicada: Horario ID ${horarioId}`);
    res.json({ success: true, mensaje: 'Horario actualizado correctamente' });
  } catch (error) {
    console.error('❌ Error en edición rápida de horario:', error);
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
        error: `No se puede eliminar. Tiene ${inscripciones[0].total} inscripción(es) activa(s)` 
      });
    }
    
    const [result] = await db.execute(
      'UPDATE horarios SET estado = "inactivo" WHERE horario_id = ?',
      [horarioId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado' });
    }
    
    // Limpiar caché
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
    console.log(`🗑️ Horario eliminado definitivamente: ID ${horarioId}`);
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
    
    // Primero eliminar inscripcion_horarios (si existen) - ON DELETE CASCADE lo hará automáticamente
    // Pero por si acaso lo hacemos manualmente primero
    await db.execute(
      `DELETE ih FROM inscripcion_horarios ih
       JOIN inscripciones i ON ih.inscripcion_id = i.inscripcion_id
       JOIN alumnos a ON i.alumno_id = a.alumno_id
       WHERE a.dni = ?`,
      [dni]
    );
    
    // Eliminar inscripciones (esto también eliminará inscripcion_horarios por CASCADE)
    await db.execute(
      `DELETE i FROM inscripciones i
       JOIN alumnos a ON i.alumno_id = a.alumno_id
       WHERE a.dni = ?`,
      [dni]
    );
    
    // Limpiar cachés
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

// GET /api/admin/alumnos/:dni/asistencias — historial de asistencias de un alumno
app.get('/api/admin/alumnos/:dni/asistencias', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { dni } = req.params;
    const [alumno] = await db.execute(
      'SELECT alumno_id, nombres, apellido_paterno, apellido_materno FROM alumnos WHERE dni = ?',
      [dni]
    );
    if (alumno.length === 0) return res.status(404).json({ success: false, error: 'Alumno no encontrado' });

    const [registros] = await db.execute(`
      SELECT
        ast.fecha,
        ast.presente,
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
      ORDER BY ast.fecha DESC, d.nombre
      LIMIT 200
    `, [alumno[0].alumno_id]);

    const total = registros.length;
    const presentes = registros.filter(r => r.presente).length;

    res.json({
      success: true,
      alumno: { ...alumno[0], dni },
      asistencias: registros,
      resumen: { total, presentes, ausentes: total - presentes }
    });
  } catch (error) {
    console.error('Error al obtener asistencias de alumno:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/admin/alumnos/:dni — elimina inscripciones + alumno completamente
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

    // Limpiar caché
    cache.del(getCacheKey('inscritos', 'all_all'));
    cache.del(getCacheKey('inscripciones', dni));

    res.json({ success: true, message: 'Alumno eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar alumno:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ENDPOINTS CRUD CATEGORÍAS ====================

// Obtener todas las categorías o filtradas por deporte
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
    
    console.log(`✅ Categorías obtenidas: ${categorias.length}`);
    res.json({ success: true, categorias });
  } catch (error) {
    console.error('❌ Error al obtener categorías:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Crear nueva categoría
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
    
    // Limpiar caché
    cache.flushAll();
    
    console.log(`✅ Categoría creada: ${nombre} (ID: ${result.insertId})`);
    res.json({ success: true, categoria_id: result.insertId, mensaje: 'Categoría creada correctamente' });
  } catch (error) {
    console.error('❌ Error al crear categoría:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, error: 'Ya existe una categoría con ese nombre para este deporte' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Actualizar categoría
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
      return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
    }
    
    // Limpiar caché
    cache.flushAll();
    
    console.log(`✅ Categoría actualizada: ID ${categoriaId}`);
    res.json({ success: true, mensaje: 'Categoría actualizada correctamente' });
  } catch (error) {
    console.error('❌ Error al actualizar categoría:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, error: 'Ya existe una categoría con ese nombre para este deporte' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Eliminar categoría (soft delete)
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
      return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
    }
    
    // Limpiar caché
    cache.flushAll();
    
    console.log(`✅ Categoría desactivada: ID ${categoriaId}`);
    res.json({ success: true, mensaje: 'Categoría desactivada correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar categoría:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Borrado definitivo de categoría
app.delete('/api/admin/categorias/:id/forzar', async (req, res) => {
  try {
    if (!db) throw new Error('Base de datos no disponible');
    const categoriaId = req.params.id;
    const [result] = await db.execute(
      'DELETE FROM categorias WHERE categoria_id = ?',
      [categoriaId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
    }
    cache.flushAll();
    console.log(`🗑️ Categoría eliminada definitivamente: ID ${categoriaId}`);
    res.json({ success: true, mensaje: 'Categoría eliminada definitivamente' });
  } catch (error) {
    console.error('❌ Error al eliminar categoría:', error);
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
    console.error('❌ Error al obtener deportes activos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener estadísticas de un horario específico
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
    console.error('❌ Error al obtener estadísticas de horario:', error);
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
        i.dni,
        i.nombres,
        i.apellido_paterno,
        i.apellido_materno,
        i.fecha_nacimiento,
        i.sexo,
        i.telefono,
        i.apoderado,
        d.nombre as deporte,
        h.dia,
        h.hora_inicio,
        h.hora_fin,
        c.nombre as categoria
      FROM inscripciones i
      INNER JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      INNER JOIN horarios h ON ih.horario_id = h.horario_id
      INNER JOIN deportes d ON h.deporte_id = d.deporte_id
      LEFT JOIN categorias c ON h.categoria_id = c.categoria_id
      WHERE i.estado_pago = 'pagado'
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
    console.error('❌ Error al generar reporte de alumnos:', error);
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

// ==================== ENDPOINTS DE INSCRIPCIONES Y PAGOS ====================

/**
 * PUT /api/admin/alumnos/:dni/notas
 * Guardar observación/nota del alumno
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
    console.log(`📝 Observación actualizada para DNI ${dni}`);
    res.json({ success: true, message: 'Observación guardada correctamente' });
  } catch (error) {
    console.error('❌ Error al guardar nota:', error);
    res.status(500).json({ success: false, error: 'Error al guardar la observación' });
  }
});

/**
 * GET /api/admin/inscripciones
 * Obtener inscripciones con filtros: pendientes, confirmadas, todas
  /**
   * POST /api/admin/alumnos/:dni/notas
/**
 * Guardar observación/nota del alumno (compatibilidad)
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
      console.log(`📝 Observación actualizada para DNI ${dni} (POST)`);
      res.json({ success: true, message: 'Observación guardada correctamente' });
    } catch (error) {
      console.error('❌ Error al guardar nota (POST):', error);
      res.status(500).json({ success: false, message: 'Error al guardar observación' });
    }
  });

/**
 * Query params: estado_pago (pendiente|confirmado|todos)
 */

/**
 * GET /api/admin/buscar-numero-operacion
 * Buscar pagos por número de operación (anti-fraude)
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
      mensaje_duplicado: esDuplicado ? `⚠️ ALERTA: El número de operación "${numOp}" está registrado por ${exactos.length} alumnos diferentes` : null
    });
  } catch (error) {
    console.error('❌ Error buscando número de operación:', error);
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
        GROUP_CONCAT(DISTINCT d.nombre SEPARATOR ', ') as deportes_inscritos
      FROM alumnos a
      LEFT JOIN inscripciones i ON a.alumno_id = i.alumno_id AND i.estado = 'activa'
      LEFT JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Filtro por estado de pago
    if (estado_pago !== 'todos') {
      query += ' AND a.estado_pago = ?';
      params.push(estado_pago);
    }
    
    // Búsqueda por DNI, nombre o apellido
    if (buscar) {
      query += ' AND (a.dni LIKE ? OR a.nombres LIKE ? OR CONCAT(a.apellido_paterno, " ", a.apellido_materno) LIKE ?)';
      const searchPattern = `%${buscar}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }
    
    query += ' GROUP BY a.alumno_id ORDER BY a.created_at DESC';
    
    // Paginación
    const offset = (parseInt(pagina) - 1) * parseInt(limite);
    query += ` LIMIT ${parseInt(limite)} OFFSET ${offset}`;
    
    const [inscripciones] = await db.query(query, params);
    
    // Contar total para paginación
    let countQuery = 'SELECT COUNT(DISTINCT a.alumno_id) as total FROM alumnos a WHERE 1=1';
    const countParams = [];
    
    if (estado_pago !== 'todos') {
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
    
    // Agrupar horarios por inscripción para evitar duplicados en el resumen
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
    
    console.log('📤 ENVIANDO RESPUESTA ADMIN DETALLE DNI:', dni);
    console.log('   - Alumno ID:', usuario.alumno_id);
    console.log('   - DNI Frontal URL:', usuario.dni_frontal_url ? 'SÍ' : 'NO');
    console.log('   - DNI Reverso URL:', usuario.dni_reverso_url ? 'SÍ' : 'NO');
    console.log('   - Foto Carnet URL:', usuario.foto_carnet_url ? 'SÍ' : 'NO');
    console.log('   - Estado Pago:', usuario.estado_pago);
    
    const responseData = {
      success: true,
      alumno: usuario, // Cambiar "usuario" a "alumno" para consistencia con Google Sheets
      inscripciones, // Array expandido para mostrar cada horario
      resumen: {
        total_inscripciones: inscripcionesUnicas.length, // Contar inscripciones únicas
        deportes_distintos: new Set(inscripcionesUnicas.map(i => i.deporte)).size,
        dias_activos: diasActivos.size,
        monto_total: inscripcionesUnicas.reduce((sum, i) => sum + (parseFloat(i.precio) || 0), 0) // Sumar precio solo una vez por inscripción
      }
    };
    
    res.json(responseData);
  } catch (error) {
    console.error('Error al obtener detalle de inscripción:', error);
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
    
    if (alumno.estado_pago === 'confirmado') {
      return res.status(400).json({ 
        success: false, 
        error: 'El pago ya está confirmado' 
      });
    }
    
    // Actualizar estado de pago en MySQL
    await db.query(`
      UPDATE alumnos 
      SET 
        estado_pago = 'confirmado',
        fecha_pago = NOW(),
        monto_pago = ?,
        numero_operacion = ?,
        notas_pago = ?,
        updated_at = NOW()
      WHERE dni = ?
    `, [monto_pago || null, numero_operacion || null, notas || null, dni]);
    
    // Activar todas las inscripciones del alumno en MySQL
    await db.query(`
      UPDATE inscripciones 
      SET estado = 'activa', updated_at = NOW()
      WHERE alumno_id = ? AND estado = 'pendiente'
    `, [alumno.alumno_id]);
    
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
      console.log(`📤 Sincronizando confirmación de pago con Google Sheets para DNI ${dni}...`);
      
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
        console.log(`✅ Pago confirmado en Google Sheets para DNI ${dni}`);
      } else {
        console.warn(`⚠️ No se pudo confirmar en Google Sheets: ${sheetData.error || 'Error desconocido'}`);
      }
    } catch (sheetError) {
      console.error('❌ Error al sincronizar con Google Sheets:', sheetError.message);
      // No fallar la operación si Google Sheets falla, MySQL es la fuente principal
    }
    
    // ==================== INVALIDAR CACHÉ ====================
    invalidateDNICache(dni);
    console.log(`🗑️ Caché invalidado para DNI ${dni}`);
    
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
 * PUT /api/admin/inscripciones/:dni/rechazar-pago
 * Rechazar pago y marcar inscripciones como pendientes
 */
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
    
    // Invalidar caché
    invalidateDNICache(dni);
    console.log(`🗑️ Caché invalidado para DNI ${dni} (pago rechazado)`);
    
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
 * Asignar horarios a una inscripción que no tiene horarios guardados
 * Body: { horarioIds: [1, 2, 3] }
 */
app.post('/api/admin/inscripciones/:inscripcionId/asignar-horarios', async (req, res) => {
  try {
    const { inscripcionId } = req.params;
    const { horarioIds } = req.body;
    
    if (!horarioIds || !Array.isArray(horarioIds) || horarioIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe proporcionar al menos un horario' });
    }
    
    // Verificar que la inscripción existe
    const [inscripciones] = await db.query(
      'SELECT inscripcion_id, deporte_id FROM inscripciones WHERE inscripcion_id = ?',
      [inscripcionId]
    );
    
    if (inscripciones.length === 0) {
      return res.status(404).json({ success: false, error: 'Inscripción no encontrada' });
    }
    
    const inscripcion = inscripciones[0];
    
    // Verificar que los horarios existen y pertenecen al mismo deporte
    const [horariosValidos] = await db.query(
      `SELECT horario_id FROM horarios WHERE horario_id IN (?) AND deporte_id = ?`,
      [horarioIds, inscripcion.deporte_id]
    );
    
    if (horariosValidos.length === 0) {
      return res.status(400).json({ success: false, error: 'Los horarios no son válidos o no pertenecen al deporte de esta inscripción' });
    }
    
    // Eliminar horarios anteriores de esta inscripción
    await db.query('DELETE FROM inscripcion_horarios WHERE inscripcion_id = ?', [inscripcionId]);
    
    // Insertar nuevos horarios
    let horariosGuardados = 0;
    for (const horarioId of horarioIds) {
      // Verificar que el horario está en la lista de válidos
      if (horariosValidos.some(h => h.horario_id === parseInt(horarioId))) {
        await db.query(
          'INSERT INTO inscripcion_horarios (inscripcion_id, horario_id) VALUES (?, ?)',
          [inscripcionId, horarioId]
        );
        horariosGuardados++;
      }
    }
    
    console.log(`✅ Asignados ${horariosGuardados} horarios a inscripción ${inscripcionId}`);
    
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
 * Obtener horarios disponibles para un deporte específico (para asignación manual)
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
        FIELD(h.dia, 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'),
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
 * Generar reporte de alumnos por deporte y/o día
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
      // Crear clave única por deporte, día, hora y categoría
      const key = `${alumno.deporte}_${alumno.dia || 'sin-horario'}_${alumno.hora_inicio || 'sin-hora'}_${alumno.categoria || 'sin-categoria'}`;
      
      if (!agrupado[key]) {
        agrupado[key] = {
          deporte: alumno.deporte,
          dia: alumno.dia || 'Sin horario',
          hora_inicio: alumno.hora_inicio || '',
          hora_fin: alumno.hora_fin || '',
          categoria: alumno.categoria || 'Sin categoría',
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
 * Estadísticas generales de inscripciones
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
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== CHATBOT ADMIN (GROQ) ====================

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const CHAT_SYSTEM_PROMPT = `Eres el asistente de administración de JAGUARES, una academia deportiva en Perú.
Tu función es ayudar al administrador a consultar información de la base de datos de forma conversacional.

Cuando la pregunta requiera datos de la BD, responde ÚNICAMENTE con un JSON:
{"tipo": "sql", "query": "SELECT ...", "descripcion": "qué hace el query"}

Si NO necesita datos de la BD, responde con:
{"tipo": "respuesta", "texto": "tu respuesta aquí"}

REGLAS ESTRICTAS:
- Solo SELECT, NUNCA INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE
- No consultar tabla: administradores
- No mostrar columnas: contrasena, hash_contrasena, password
- Siempre agregar LIMIT 100 máximo
- Usa JOINs cuando necesites info de múltiples tablas
- Los nombres propios de alumnos están en columnas separadas: nombres, apellido_paterno, apellido_materno
- Para búsqueda por nombre usa LIKE '%valor%' en nombres o apellido_paterno

DEFINICIONES IMPORTANTES (usa SIEMPRE estas definiciones):
- "inscritos" / "lista de inscritos" / "alumnos inscritos" = alumnos con inscripción estado IN ('activa','pendiente'). Query: SELECT COUNT(DISTINCT a.alumno_id) FROM alumnos a JOIN inscripciones i ON a.alumno_id = i.alumno_id WHERE i.estado IN ('activa','pendiente')
- "todos los alumnos en el sistema" = SELECT COUNT(*) FROM alumnos (incluye datos históricos/cancelados)
- "alumnos activos" = alumnos con estado='activo' en tabla alumnos
- "pagos pendientes" = alumnos con estado_pago='pendiente'
- Cuando el admin pregunta "cuántos tengo" sin contexto, asume INSCRITOS con estado='activa' o 'pendiente'

FÓRMULAS FINANCIERAS (Dashboard Financiero):
- "ingresos totales" / "total ingresos" = SUM(matriculas_pagadas) + SUM(precio_mensual) de inscripciones activas:
  SELECT COALESCE(SUM(CASE WHEN i.matricula_pagada=1 THEN d.matricula ELSE 0 END),0) + COALESCE(SUM(i.precio_mensual),0) as total_ingresos FROM inscripciones i JOIN deportes d ON i.deporte_id=d.deporte_id WHERE i.estado='activa'
- "ingresos del mes" / "ingresos este mes" = mismo cálculo pero filtrado por MONTH(i.fecha_inscripcion)=MONTH(CURRENT_DATE()) AND YEAR(i.fecha_inscripcion)=YEAR(CURRENT_DATE())
- "ingresos de hoy" = mismo cálculo con DATE(i.fecha_inscripcion)=CURRENT_DATE()
- "mensualidades" = SUM(i.precio_mensual) FROM inscripciones WHERE estado='activa'
- "matrículas cobradas" = SUM(CASE WHEN matricula_pagada=1 THEN d.matricula ELSE 0 END)
- "ingresos por deporte" = agrupar por d.nombre con SUM de mensualidades + matrículas de inscripciones activas
- "ingresos por alumno" = agrupar por a.alumno_id con SUM de mensualidades + matrículas, JOIN con alumnos e inscripciones activas
- "alumnos con más deportes" = COUNT(inscripciones activas) por alumno, ORDER BY cantidad DESC

ESQUEMA DE LA BASE DE DATOS:

alumnos: alumno_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, sexo(Masculino/Femenino), telefono, email, estado(activo/inactivo/suspendido), estado_pago(pendiente/confirmado/rechazado), apoderado, telefono_apoderado, created_at

inscripciones: inscripcion_id, alumno_id, deporte_id, estado(pendiente/activa/cancelada/suspendida), plan(Económico/Estándar/Premium), precio_mensual, matricula_pagada(0/1), fecha_inicio, fecha_fin, fecha_inscripcion

deportes: deporte_id, nombre, matricula(precio de matrícula), estado(activo/inactivo)

horarios: horario_id, deporte_id, dia(LUNES/MARTES/MIERCOLES/JUEVES/VIERNES/SABADO/DOMINGO), hora_inicio, hora_fin, cupo_maximo, cupos_ocupados, estado(activo/inactivo/suspendido), categoria, nivel, ano_min, ano_max, genero(Masculino/Femenino/Mixto), precio, plan

profesores: profesor_id, nombres, apellidos, especialidad, estado(activo/inactivo)

profesor_deportes: id, admin_id, deporte_id, categoria, dia, horario_id

asistencias: asistencia_id, alumno_id, horario_id, fecha, presente(0=ausente/1=presente), observaciones

inscripcion_horarios: id, inscripcion_id, horario_id, estado(activo/inactivo)

pagos_mensuales: pago_id, alumno_id, mes, anio, monto, estado(pendiente/confirmado/rechazado)

categorias: categoria_id, deporte_id, nombre, ano_min, ano_max, estado(activo/inactivo)`;

app.post('/api/admin/chat', verificarAutenticacion, verificarAdmin, async (req, res) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje || typeof mensaje !== 'string' || mensaje.trim().length === 0 || mensaje.length > 600) {
      return res.status(400).json({ success: false, error: 'Mensaje inválido' });
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
      console.error('❌ Groq API error:', errBody);
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
        console.error('❌ Chat SQL error:', sqlError.message);
        return res.json({ success: true, respuesta: `No pude ejecutar esa consulta. Intenta reformular la pregunta.` });
      }

      if (resultados.length === 0) {
        return res.json({ success: true, respuesta: 'No encontré registros con esos criterios.' });
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
              content: 'Eres el asistente de JAGUARES academia deportiva. Responde en español de forma clara y concisa. El admin te hizo una pregunta y te doy los datos de la BD. Presenta la info de forma legible: usa listas, resalta números importantes. Sin JSON, solo texto natural.'
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
    console.error('❌ Error chatbot admin:', error);
    res.status(500).json({ success: false, error: 'Error interno del chatbot' });
  }
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
  console.error('Stack trace:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
  console.error('Promise:', promise);
});
// ==================== ERROR HANDLERS ====================
// IMPORTANTE: Deben estar DESPUÉS de todas las rutas

// 404 - Ruta no encontrada
app.use(notFoundHandler);

// Manejador global de errores
app.use(errorHandler);





