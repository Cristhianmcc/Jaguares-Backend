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
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

let db;

async function initDatabase() {
  try {
    db = await mysql.createPool(dbConfig);
    // Test de conexión
    const connection = await db.getConnection();
    console.log('✅ Conexión a MySQL establecida correctamente');
    connection.release();
  } catch (error) {
    console.error('❌ Error al conectar con MySQL:', error);
    console.error('⚠️  El servidor continuará sin base de datos (usará Google Sheets)');
  }
}

// Inicializar base de datos
initDatabase();

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
    const año = req.query.año || 2019;
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

    const [results] = await pool.execute(query, [parseInt(año)]);

    res.json({
      año_consultado: parseInt(año),
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
    const añoNacimiento = req.query.año_nacimiento || req.query.ano_nacimiento;
    const forceRefresh = req.query.refresh === 'true';

    // Clave de caché diferente si hay filtro de edad
    const cacheKey = getCacheKey('horarios', añoNacimiento || 'all');

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
        if (añoNacimiento) {
          console.log(`🎯 Filtrando por año de nacimiento: ${añoNacimiento}`);
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

        // Agregar filtro por edad si se proporciona año de nacimiento
        if (añoNacimiento) {
          query += ` AND ? BETWEEN h.ano_min AND h.ano_max`;
          params.push(parseInt(añoNacimiento));
        }

        query += ` ORDER BY d.nombre, h.dia, h.hora_inicio`;

        console.log('📝 Query preparada:', query);
        console.log('📊 Parámetros:', params);

        const [rows] = params.length > 0
          ? await db.execute(query, params)
          : await db.execute(query);

        console.log(`✅ Horarios obtenidos de MySQL: ${rows.length}`);
        if (añoNacimiento) {
          console.log(`   (filtrados para año ${añoNacimiento})`);
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
          filtradoPorEdad: !!añoNacimiento,
          añoNacimiento: añoNacimiento || null,
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
    
    // Agregar parámetro de año si existe
    if (añoNacimiento) {
      url += `&año_nacimiento=${encodeURIComponent(añoNacimiento)}`;
      console.log(`🎯 Solicitando horarios filtrados para año ${añoNacimiento}`);
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
    const { alumno, horarios } = req.body;

    console.log('📝 ==================== INSCRIPCIÓN MÚLTIPLE ====================');
    console.log('👤 ALUMNO:', JSON.stringify(alumno, null, 2));
    console.log('📅 HORARIOS (cantidad):', horarios.length);

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

    // ==================== GUARDAR EN MYSQL PRIMERO (MySQL-First Approach) ====================
    let inscripcionData = null;
    let codigoOperacion = null;

    if (db) {
      try {
        console.log('💾 Guardando inscripción en MySQL (prioridad)...');

        // 1. Verificar o crear alumno
        const [alumnoRows] = await db.query(
          'SELECT alumno_id FROM alumnos WHERE dni = ?',
          [alumno.dni]
        );

        let alumnoId;
        let alumnoCreado = false;

        if (alumnoRows.length > 0) {
          alumnoId = alumnoRows[0].alumno_id;
          console.log(`✅ Alumno encontrado en MySQL: ID ${alumnoId}`);
        } else {
          // Crear nuevo alumno
          alumnoCreado = true;
          const fechaNacimiento = alumno.fecha_nacimiento || '2010-01-01';

          const [insertResult] = await db.query(
            `INSERT INTO alumnos (
              dni, nombres, apellido_paterno, apellido_materno, 
              fecha_nacimiento, sexo, telefono, email, direccion,
              seguro_tipo, condicion_medica, apoderado, telefono_apoderado,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              alumno.telefono_apoderado || null,
              new Date() // created_at
            ]
          );
          alumnoId = insertResult.insertId;
          console.log(`✅ Alumno creado en MySQL: ID ${alumnoId}`);
        }

        // 2. Validar que todos los horarios tengan horario_id
        const horariosInvalidos = horarios.filter(h => !h.horario_id);
        if (horariosInvalidos.length > 0) {
          console.error('❌ HORARIOS SIN ID:', horariosInvalidos);
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
          const esMamasFit = deporte === 'MAMAS FIT';

          if (esMamasFit) return 60;

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

        // 4. Guardar inscripciones
        const inscripcionesIds = [];
        for (const [nombreDeporte, info] of Object.entries(deportesMap)) {
          const [deporteRows] = await db.query(
            'SELECT deporte_id FROM deportes WHERE nombre LIKE ?',
            [`%${nombreDeporte}%`]
          );

          if (deporteRows.length === 0) {
            console.warn(`⚠️ Deporte no encontrado: ${nombreDeporte}`);
            continue;
          }

          const deporteId = deporteRows[0].deporte_id;
          const plan = info.plan;
          const cantidadDias = info.horarios.length;
          const precioMensual = calcularPrecio(cantidadDias, plan, nombreDeporte);

          // ⚠️ VALIDACIÓN: Verificar si ya existe inscripción activa para este alumno + deporte
          const [inscripcionExistente] = await db.query(
            `SELECT inscripcion_id, estado, plan, precio_mensual 
             FROM inscripciones 
             WHERE alumno_id = ? AND deporte_id = ? AND estado IN ('activa', 'pendiente')
             LIMIT 1`,
            [alumnoId, deporteId]
          );

          if (inscripcionExistente.length > 0) {
            const inscExist = inscripcionExistente[0];
            console.warn(`⚠️ DUPLICADO DETECTADO: Alumno ${alumnoId} ya tiene inscripción ${inscExist.estado} en ${nombreDeporte} (ID: ${inscExist.inscripcion_id})`);

            // Retornar error al cliente
            return res.status(409).json({
              success: false,
              error: 'Inscripción duplicada',
              message: `Ya existe una inscripción ${inscExist.estado} para ${nombreDeporte}. No se puede inscribir dos veces en el mismo deporte.`,
              deporte: nombreDeporte,
              inscripcion_existente: {
                id: inscExist.inscripcion_id,
                estado: inscExist.estado,
                plan: inscExist.plan,
                precio: inscExist.precio_mensual
              }
            });
          }

          const [result] = await db.query(
            `INSERT INTO inscripciones (codigo_operacion, alumno_id, deporte_id, plan, precio_mensual, matricula_pagada, estado, fecha_inscripcion)
             VALUES (?, ?, ?, ?, ?, 0, 'pendiente', NOW())`,
            [codigoOperacion, alumnoId, deporteId, plan, precioMensual]
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
                await db.query(
                  `INSERT INTO inscripciones_horarios (inscripcion_id, horario_id)
                   VALUES (?, ?)`,
                  [inscripcionId, horario.horario_id]
                );
                horariosGuardados++;
                console.log(`✅ Horario guardado: Inscripción ${inscripcionId} -> Horario ${horario.horario_id}`);
              } catch (horarioError) {
                console.error(`❌ Error guardando horario ${horario.horario_id} para inscripción ${inscripcionId}:`, horarioError.message);
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

        inscripcionData = {
          alumnoId,
          alumnoCreado,
          inscripcionIds: inscripcionesIds,
          success: true
        };

        console.log('✅ INSCRIPCIÓN GUARDADA EN MYSQL');
      } catch (mysqlError) {
        console.error('❌ Error MySQL:', mysqlError);
        return res.status(500).json({
          success: false,
          error: 'Error al guardar inscripción',
          message: 'No se pudo completar la inscripción. Intente nuevamente.'
        });
      }
    }

    // ==================== SINCRONIZAR CON APPS SCRIPT (BLOQUEANTE - DEBE COMPLETARSE) ====================
    // Enviar a Apps Script y ESPERAR respuesta (timeout 30 segundos)
    const payload = {
      token: APPS_SCRIPT_TOKEN,
      action: 'inscribir_multiple',
      codigo_operacion: codigoOperacion, // Enviar el código generado por MySQL
      alumno,
      horarios
    };

    console.log('📤 Enviando a Apps Script (Google Sheets)...');

    try {
      const appsScriptResponse = await Promise.race([
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r => r.json()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de 30 segundos')), 30000))
      ]);

      if (appsScriptResponse.success) {
        console.log('✅ Apps Script sync exitoso - Datos guardados en Google Sheets');

        // Actualizar URLs de documentos si están disponibles
        if (appsScriptResponse.urls_documentos && inscripcionData) {
          // Obtener URL del comprobante desde la respuesta de Apps Script
          // Apps Script puede devolver el comprobante en diferentes lugares:
          // 1. appsScriptResponse.url_comprobante (inscripción directa)
          // 2. appsScriptResponse.pago.url_comprobante (desde consultarInscripcion)
          const urlComprobante = appsScriptResponse.url_comprobante ||
            (appsScriptResponse.pago && appsScriptResponse.pago.url_comprobante) ||
            null;

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
              urlComprobante,
              inscripcionData.alumnoId
            ]
          );
          console.log('✅ URLs de documentos actualizadas en MySQL');
          if (urlComprobante) {
            console.log('✅ URL de comprobante guardada: ' + urlComprobante.substring(0, 50) + '...');
          } else {
            console.log('⚠️ No se recibió URL de comprobante desde Apps Script');
          }
        }
      } else {
        console.error('❌ Apps Script retornó error:', appsScriptResponse.error);

        // ROLLBACK: Eliminar datos de MySQL porque Apps Script falló
        console.log('🔄 ROLLBACK: Eliminando datos de MySQL...');

        try {
          // Eliminar inscripciones creadas
          if (inscripcionData && inscripcionData.inscripcionIds) {
            const inscripcionIds = inscripcionData.inscripcionIds.map(i => i.inscripcionId);
            await db.query(
              `DELETE FROM inscripciones WHERE inscripcion_id IN (${inscripcionIds.join(',')})`,
            );
            console.log(`✅ Eliminadas ${inscripcionIds.length} inscripciones`);
          }

          // Eliminar alumno si se creó nuevo
          if (inscripcionData && inscripcionData.alumnoCreado) {
            await db.query('DELETE FROM alumnos WHERE alumno_id = ?', [inscripcionData.alumnoId]);
            console.log(`✅ Eliminado alumno ID ${inscripcionData.alumnoId}`);
          }
        } catch (rollbackErr) {
          console.error('❌ Error en rollback:', rollbackErr);
        }

        return res.status(500).json({
          success: false,
          error: 'Error al procesar inscripción',
          message: appsScriptResponse.error || 'No se pudo completar la inscripción. Por favor, intenta nuevamente.',
          detalles: appsScriptResponse.error && appsScriptResponse.error.includes('Ya estás inscrito') ? 'DUPLICADO' : null
        });
      }
    } catch (err) {
      console.error('❌ ERROR CRÍTICO: Apps Script falló:', err.message);

      // ROLLBACK: Eliminar datos de MySQL porque Apps Script falló
      console.log('🔄 ROLLBACK: Eliminando datos de MySQL...');

      try {
        // Eliminar inscripciones creadas
        if (inscripcionData && inscripcionData.inscripcionIds) {
          const inscripcionIds = inscripcionData.inscripcionIds.map(i => i.inscripcionId);
          await db.query(
            `DELETE FROM inscripciones WHERE inscripcion_id IN (${inscripcionIds.join(',')})`,
          );
          console.log(`✅ Eliminadas ${inscripcionIds.length} inscripciones`);
        }

        // Eliminar alumno si se creó nuevo
        if (inscripcionData && inscripcionData.alumnoCreado) {
          await db.query('DELETE FROM alumnos WHERE alumno_id = ?', [inscripcionData.alumnoId]);
          console.log(`✅ Eliminado alumno ID ${inscripcionData.alumnoId}`);
        }
      } catch (rollbackErr) {
        console.error('❌ Error en rollback:', rollbackErr);
      }

      return res.status(500).json({
        success: false,
        error: 'Error al procesar inscripción',
        message: 'No se pudo completar la inscripción debido a un error de conexión con Google Sheets. Por favor, intenta nuevamente en unos momentos.'
      });
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

    // Responder inmediatamente con éxito de MySQL (formato compatible con tests)
    res.json({
      success: true,
      message: 'Inscripción registrada exitosamente',
      codigo_operacion: codigoOperacion,
      alumno: {
        alumno_id: inscripcionData.alumnoId,
        dni: alumno.dni,
        nombres: alumno.nombres,
        apellido_paterno: alumno.apellidoPaterno,
        apellido_materno: alumno.apellidoMaterno
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
            YEAR(i.fecha_inscripcion) as año_inscripcion
          FROM inscripciones i
          INNER JOIN alumnos a ON i.alumno_id = a.alumno_id
          INNER JOIN deportes d ON i.deporte_id = d.deporte_id
          WHERE a.dni = ? AND i.estado = 'activa'
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

        // Obtener inscripciones activas
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
          WHERE i.alumno_id = ? AND i.estado = 'activa'
        `, [alumno.alumno_id]);

        // Obtener horarios de cada inscripción
        const horariosCompletos = [];
        for (const inscripcion of inscripciones) {
          const [horarios] = await db.query(`
            SELECT 
              h.dia,
              TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
              TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
              h.categoria
            FROM inscripciones_horarios ih
            JOIN horarios h ON ih.horario_id = h.horario_id
            WHERE ih.inscripcion_id = ?
            ORDER BY FIELD(h.dia, 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO')
          `, [inscripcion.inscripcion_id]);

          if (horarios.length > 0) {
            horarios.forEach(h => {
              horariosCompletos.push({
                deporte: inscripcion.deporte,
                sede: 'Sede Principal',
                plan: inscripcion.plan || 'Económico',
                dia: h.dia,
                hora_inicio: h.hora_inicio,
                hora_fin: h.hora_fin,
                categoria: h.categoria,
                precio: inscripcion.precio_mensual,
                fecha_inscripcion: inscripcion.fecha_inscripcion
              });
            });
          } else {
            horariosCompletos.push({
              deporte: inscripcion.deporte,
              sede: 'Sede Principal',
              plan: inscripcion.plan || 'Económico',
              dia: 'Por definir',
              hora_inicio: null,
              hora_fin: null,
              categoria: '',
              precio: inscripcion.precio_mensual,
              fecha_inscripcion: inscripcion.fecha_inscripcion
            });
          }
        }

        // Calcular monto total
        const montoTotal = inscripciones.reduce((sum, i) => sum + parseFloat(i.precio_mensual || 0), 0);

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

    // Reenviar al Apps Script
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: APPS_SCRIPT_TOKEN,
        action: 'subir_comprobante',
        codigo_operacion,
        dni,
        alumno,
        imagen,
        nombre_archivo
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.error('❌ Error del Apps Script:', data.error);
      return res.status(response.status || 500).json(data);
    }

    console.log('✅ Comprobante subido exitosamente:', data.url_comprobante);

    // Invalidar caché de consulta para este DNI
    invalidateDNICache(dni);

    res.json(data);
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
    const { imagen, nombre_archivo, metodo_pago = 'Transferencia bancaria' } = req.body;

    // Validaciones
    if (!imagen || !nombre_archivo) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos. Se requiere: imagen y nombre_archivo'
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

    // Actualizar MySQL con la URL del comprobante
    await db.query(
      'UPDATE alumnos SET comprobante_pago_url = ?, updated_at = NOW() WHERE dni = ?',
      [urlComprobante, dni]
    );
    console.log('✅ MySQL actualizado con URL del comprobante');

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
    const anio = fechaActual.getFullYear();

    // Registrar en MySQL el pago mensual (usando estructura existente de la tabla)
    await db.query(
      `INSERT INTO pagos_mensuales (alumno_id, mes, año, monto, comprobante_url, estado, metodo_pago, fecha_pago, created_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', 'Transferencia/Plin', NOW(), NOW())
       ON DUPLICATE KEY UPDATE 
         comprobante_url = VALUES(comprobante_url),
         monto = VALUES(monto),
         estado = 'pendiente',
         fecha_pago = NOW()`,
      [alumnoDb.alumno_id, mesNombre, anio, monto || 0, urlComprobante]
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
            d.nombre as deporte,
            h.dia,
            TIME_FORMAT(h.hora_inicio, '%H:%i') as hora_inicio,
            TIME_FORMAT(h.hora_fin, '%H:%i') as hora_fin,
            i.estado as estado_inscripcion
          FROM alumnos a
          INNER JOIN inscripciones i ON a.alumno_id = i.alumno_id
          INNER JOIN deportes d ON i.deporte_id = d.deporte_id
          LEFT JOIN inscripciones_horarios ih ON i.inscripcion_id = ih.inscripcion_id
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

        query += ` ORDER BY a.created_at DESC`;

        const [alumnos] = params.length > 0
          ? await db.execute(query, params)
          : await db.execute(query);

        // Procesar resultados: agrupar por DNI ya que el JOIN puede duplicar filas
        const alumnosMap = new Map();

        alumnos.forEach(row => {
          const dni = row.dni;

          if (!alumnosMap.has(dni)) {
            alumnosMap.set(dni, {
              alumno_id: row.alumno_id,
              dni: row.dni,
              nombres: row.nombres,
              apellidos: `${row.apellido_paterno || ''} ${row.apellido_materno || ''}`.trim(),
              telefono: row.telefono,
              email: row.email,
              deporte: row.deporte,
              dia: row.dia,
              hora_inicio: row.hora_inicio,
              hora_fin: row.hora_fin,
              estado_usuario: row.estado_usuario,
              estado: row.estado_inscripcion,
              estado_pago: row.estado_pago,
              fecha_registro: row.fecha_registro
            });
          }
        });

        const alumnosConDatos = Array.from(alumnosMap.values());

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
        SUM(d.matricula) as total_matriculas,
        SUM(i.precio_mensual) as total_mensualidades,
        SUM(d.matricula) + SUM(i.precio_mensual) as total_ingresos
      FROM inscripciones i
      INNER JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.estado = 'activa'
    `);

    // 2. INGRESOS DEL MES ACTUAL - Solo inscripciones activas del mes
    const [ingresosMes] = await db.query(`
      SELECT 
        SUM(d.matricula) as matriculas_mes,
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
        SUM(d.matricula) as matriculas_hoy,
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
        SUM(d.matricula) as matriculas,
        SUM(i.precio_mensual) as mensualidades,
        SUM(d.matricula) + SUM(i.precio_mensual) as total
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
        SUM(dep.matricula) as matriculas,
        SUM(i.precio_mensual) as mensualidades,
        SUM(dep.matricula) + SUM(i.precio_mensual) as total
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

// ==================== ENDPOINTS PROFESORES ====================

/**
 * Obtener deportes asignados al profesor
 */
app.get('/api/profesor/mis-deportes', verificarAutenticacion, async (req, res) => {
  try {
    const adminId = req.admin.admin_id;
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Base de datos no disponible'
      });
    }
    
    // Obtener deportes asignados al profesor
    const [deportes] = await db.query(`
      SELECT DISTINCT d.deporte_id, d.nombre, d.icono
      FROM profesor_deportes pd
      INNER JOIN deportes d ON pd.deporte_id = d.deporte_id
      WHERE pd.admin_id = ? AND d.estado = 'activo'
      ORDER BY d.nombre
    `, [adminId]);
    
    res.json({
      success: true,
      deportes: deportes
    });
    
  } catch (error) {
    console.error('Error al obtener deportes del profesor:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener deportes asignados'
    });
  }
});

/**
 * Obtener clases del profesor para un día específico
 */
app.get('/api/profesor/mis-clases', verificarAutenticacion, async (req, res) => {
  try {
    const adminId = req.admin.admin_id;
    const { dia } = req.query;
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Base de datos no disponible'
      });
    }
    
    if (!dia) {
      return res.status(400).json({
        success: false,
        error: 'Día requerido'
      });
    }
    
    // Obtener horarios del profesor para el día especificado
    const [horarios] = await db.query(`
      SELECT 
        h.horario_id,
        d.nombre as deporte,
        h.categoria,
        h.dia,
        h.hora_inicio,
        h.hora_fin,
        COUNT(DISTINCT ih.inscripcion_id) as total_alumnos
      FROM profesor_deportes pd
      INNER JOIN horarios h ON pd.deporte_id = h.deporte_id 
        AND (pd.categoria IS NULL OR pd.categoria = h.categoria)
        AND (pd.dia IS NULL OR pd.dia = h.dia)
      INNER JOIN deportes d ON h.deporte_id = d.deporte_id
      LEFT JOIN inscripcion_horarios ih ON h.horario_id = ih.horario_id
      WHERE pd.admin_id = ? 
        AND h.dia = ?
        AND h.estado = 'activo'
      GROUP BY h.horario_id, d.nombre, h.categoria, h.dia, h.hora_inicio, h.hora_fin
      ORDER BY h.hora_inicio
    `, [adminId, dia]);
    
    res.json({
      success: true,
      clases: horarios
    });
    
  } catch (error) {
    console.error('Error al obtener clases del profesor:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener clases'
    });
  }
});

/**
 * Obtener categorías de un deporte asignado al profesor
 */
app.get('/api/profesor/categorias-deporte/:deporteId', verificarAutenticacion, async (req, res) => {
  try {
    const adminId = req.admin.admin_id;
    const { deporteId } = req.params;
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Base de datos no disponible'
      });
    }
    
    // Obtener categorías únicas del deporte
    const [categorias] = await db.query(`
      SELECT DISTINCT h.categoria
      FROM profesor_deportes pd
      INNER JOIN horarios h ON pd.deporte_id = h.deporte_id
        AND (pd.categoria IS NULL OR pd.categoria = h.categoria)
      WHERE pd.admin_id = ? 
        AND pd.deporte_id = ?
        AND h.estado = 'activo'
        AND h.categoria IS NOT NULL
      ORDER BY h.categoria
    `, [adminId, deporteId]);
    
    res.json({
      success: true,
      categorias: categorias
    });
    
  } catch (error) {
    console.error('Error al obtener categorías:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener categorías'
    });
  }
});

/**
 * Obtener horarios de una categoría específica
 */
app.get('/api/profesor/horarios-categoria', verificarAutenticacion, async (req, res) => {
  try {
    const adminId = req.admin.admin_id;
    const { deporte_id, categoria, dia } = req.query;
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Base de datos no disponible'
      });
    }
    
    if (!deporte_id || !categoria || !dia) {
      return res.status(400).json({
        success: false,
        error: 'Parámetros incompletos'
      });
    }
    
    const [horarios] = await db.query(`
      SELECT 
        h.horario_id,
        h.hora_inicio,
        h.hora_fin,
        h.dia
      FROM profesor_deportes pd
      INNER JOIN horarios h ON pd.deporte_id = h.deporte_id
        AND (pd.categoria IS NULL OR pd.categoria = h.categoria)
        AND (pd.dia IS NULL OR pd.dia = h.dia)
      WHERE pd.admin_id = ?
        AND h.deporte_id = ?
        AND h.categoria = ?
        AND h.dia = ?
        AND h.estado = 'activo'
      ORDER BY h.hora_inicio
    `, [adminId, deporte_id, categoria, dia]);
    
    res.json({
      success: true,
      horarios: horarios
    });
    
  } catch (error) {
    console.error('Error al obtener horarios:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener horarios'
    });
  }
});

/**
 * Obtener alumnos de una clase específica
 */
app.get('/api/profesor/alumnos-clase/:horarioId', verificarAutenticacion, async (req, res) => {
  try {
    const adminId = req.admin.admin_id;
    const { horarioId } = req.params;
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Base de datos no disponible'
      });
    }
    
    // Verificar que el profesor tenga acceso a este horario
    const [acceso] = await db.query(`
      SELECT h.horario_id
      FROM horarios h
      INNER JOIN profesor_deportes pd ON h.deporte_id = pd.deporte_id
        AND (pd.categoria IS NULL OR pd.categoria = h.categoria)
        AND (pd.dia IS NULL OR pd.dia = h.dia)
      WHERE h.horario_id = ? AND pd.admin_id = ?
    `, [horarioId, adminId]);
    
    if (acceso.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'No tienes acceso a esta clase'
      });
    }
    
    // Obtener info del horario
    const [horario] = await db.query(`
      SELECT 
        h.horario_id,
        d.nombre as deporte,
        h.categoria,
        h.dia,
        h.hora_inicio,
        h.hora_fin
      FROM horarios h
      INNER JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE h.horario_id = ?
    `, [horarioId]);
    
    // Obtener alumnos inscritos en este horario
    const fechaHoy = new Date().toISOString().split('T')[0];
    
    const [alumnos] = await db.query(`
      SELECT 
        a.alumno_id,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) as nombre_completo,
        asist.asistencia_id,
        asist.presente,
        CASE WHEN asist.asistencia_id IS NOT NULL THEN TRUE ELSE FALSE END as asistencia_registrada
      FROM inscripcion_horarios ih
      INNER JOIN inscripciones i ON ih.inscripcion_id = i.inscripcion_id
      INNER JOIN alumnos a ON i.alumno_id = a.alumno_id
      LEFT JOIN asistencias asist ON asist.alumno_id = a.alumno_id 
        AND asist.horario_id = ih.horario_id 
        AND asist.fecha = ?
      WHERE ih.horario_id = ?
        AND i.estado = 'activa'
        AND a.estado = 'activo'
      ORDER BY a.apellido_paterno, a.apellido_materno, a.nombres
    `, [fechaHoy, horarioId]);
    
    res.json({
      success: true,
      horario: horario[0],
      alumnos: alumnos
    });
    
  } catch (error) {
    console.error('Error al obtener alumnos de la clase:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener alumnos'
    });
  }
});

/**
 * Guardar asistencia de una clase
 */
app.post('/api/profesor/guardar-asistencia', verificarAutenticacion, async (req, res) => {
  try {
    const adminId = req.admin.admin_id;
    const { horario_id, fecha, asistencias } = req.body;
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Base de datos no disponible'
      });
    }
    
    if (!horario_id || !fecha || !asistencias || !Array.isArray(asistencias)) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos'
      });
    }
    
    // Verificar acceso del profesor al horario
    const [acceso] = await db.query(`
      SELECT h.horario_id
      FROM horarios h
      INNER JOIN profesor_deportes pd ON h.deporte_id = pd.deporte_id
        AND (pd.categoria IS NULL OR pd.categoria = h.categoria)
        AND (pd.dia IS NULL OR pd.dia = h.dia)
      WHERE h.horario_id = ? AND pd.admin_id = ?
    `, [horario_id, adminId]);
    
    if (acceso.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'No tienes acceso a esta clase'
      });
    }
    
    // Registrar asistencias (INSERT ON DUPLICATE KEY UPDATE)
    for (const asist of asistencias) {
      await db.query(`
        INSERT INTO asistencias (alumno_id, horario_id, fecha, presente, registrado_por)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          presente = VALUES(presente),
          registrado_por = VALUES(registrado_por)
      `, [asist.alumno_id, horario_id, fecha, asist.presente, adminId]);
    }
    
    console.log(`✅ Asistencia guardada por profesor ID ${adminId} - Horario ${horario_id} - ${asistencias.length} alumnos`);
    
    res.json({
      success: true,
      message: 'Asistencia guardada correctamente',
      total_registros: asistencias.length
    });
    
  } catch (error) {
    console.error('Error al guardar asistencia:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar asistencia'
    });
  }
});

/**
 * Obtener reporte de asistencias del profesor
 */
app.get('/api/profesor/reporte-asistencias', verificarAutenticacion, async (req, res) => {
  try {
    const adminId = req.admin.admin_id;
    const { fecha_inicio, fecha_fin, deporte_id } = req.query;
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Base de datos no disponible'
      });
    }
    
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        success: false,
        error: 'Fechas requeridas'
      });
    }
    
    // Construir filtros
    let filtroDeporte = '';
    let params = [adminId, fecha_inicio, fecha_fin];
    
    if (deporte_id) {
      filtroDeporte = 'AND h.deporte_id = ?';
      params.push(deporte_id);
    }
    
    // Estadísticas generales
    const [stats] = await db.query(`
      SELECT 
        SUM(CASE WHEN asist.presente = 1 THEN 1 ELSE 0 END) as total_presentes,
        SUM(CASE WHEN asist.presente = 0 THEN 1 ELSE 0 END) as total_ausentes
      FROM asistencias asist
      INNER JOIN horarios h ON asist.horario_id = h.horario_id
      INNER JOIN profesor_deportes pd ON h.deporte_id = pd.deporte_id
        AND (pd.categoria IS NULL OR pd.categoria = h.categoria)
        AND (pd.dia IS NULL OR pd.dia = h.dia)
      WHERE pd.admin_id = ?
        AND asist.fecha BETWEEN ? AND ?
        ${filtroDeporte}
    `, params);
    
    // Asistencias por fecha (para gráfico)
    const [porFecha] = await db.query(`
      SELECT 
        asist.fecha,
        SUM(CASE WHEN asist.presente = 1 THEN 1 ELSE 0 END) as presentes,
        SUM(CASE WHEN asist.presente = 0 THEN 1 ELSE 0 END) as ausentes
      FROM asistencias asist
      INNER JOIN horarios h ON asist.horario_id = h.horario_id
      INNER JOIN profesor_deportes pd ON h.deporte_id = pd.deporte_id
        AND (pd.categoria IS NULL OR pd.categoria = h.categoria)
        AND (pd.dia IS NULL OR pd.dia = h.dia)
      WHERE pd.admin_id = ?
        AND asist.fecha BETWEEN ? AND ?
        ${filtroDeporte}
      GROUP BY asist.fecha
      ORDER BY asist.fecha
    `, params);
    
    // Detalle por alumno
    const [porAlumno] = await db.query(`
      SELECT 
        a.alumno_id,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', a.apellido_materno) as nombre_completo,
        SUM(CASE WHEN asist.presente = 1 THEN 1 ELSE 0 END) as total_presentes,
        SUM(CASE WHEN asist.presente = 0 THEN 1 ELSE 0 END) as total_ausentes
      FROM asistencias asist
      INNER JOIN alumnos a ON asist.alumno_id = a.alumno_id
      INNER JOIN horarios h ON asist.horario_id = h.horario_id
      INNER JOIN profesor_deportes pd ON h.deporte_id = pd.deporte_id
        AND (pd.categoria IS NULL OR pd.categoria = h.categoria)
        AND (pd.dia IS NULL OR pd.dia = h.dia)
      WHERE pd.admin_id = ?
        AND asist.fecha BETWEEN ? AND ?
        ${filtroDeporte}
      GROUP BY a.alumno_id, a.nombres, a.apellido_paterno, a.apellido_materno
      ORDER BY a.apellido_paterno, a.apellido_materno
    `, params);
    
    res.json({
      success: true,
      estadisticas: {
        total_presentes: stats[0]?.total_presentes || 0,
        total_ausentes: stats[0]?.total_ausentes || 0,
        por_fecha: porFecha,
        por_alumno: porAlumno
      }
    });
    
  } catch (error) {
    console.error('Error al generar reporte:', error);
    res.status(500).json({
      success: false,
      error: 'Error al generar reporte'
    });
  }
});

// ==================== FIN ENDPOINTS PROFESORES ====================

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
    const { categoria, nivel, plan, ano_min, ano_max, hora_inicio, hora_fin, cupo_maximo, precio } = req.body;

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
       FROM inscripciones_horarios 
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
      LEFT JOIN inscripciones_horarios ih ON h.horario_id = ih.horario_id
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
 * GET /api/admin/inscripciones
 * Obtener inscripciones con filtros: pendientes, confirmadas, todas
 * Query params: estado_pago (pendiente|confirmado|todos)
 */
app.get('/api/admin/inscripciones', async (req, res) => {
  try {
    const { estado_pago = 'todos', buscar = '', limite = 100, pagina = 1 } = req.query;

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
      LEFT JOIN inscripciones_horarios ih ON i.inscripcion_id = ih.inscripcion_id
      LEFT JOIN horarios h ON ih.horario_id = h.horario_id
      WHERE i.alumno_id = ? AND i.estado = 'activa'
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
      SET estado = 'inactivo', updated_at = NOW()
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
      LEFT JOIN inscripciones_horarios ih ON i.inscripcion_id = ih.inscripcion_id
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

    // Ingresos
    const [[{ ingresos_confirmados }]] = await db.query(`
      SELECT COALESCE(SUM(monto_pago), 0) as ingresos_confirmados
      FROM alumnos
      WHERE estado_pago = 'confirmado'
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