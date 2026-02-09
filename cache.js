const NodeCache = require('node-cache');

/**
 * Sistema de caché en memoria para el backend
 * TTL (Time To Live) en segundos:
 * - horarios: 300s (5 minutos)
 * - inscripciones: 120s (2 minutos)
 * - consultas: 60s (1 minuto)
 */

// Crear instancia de caché con configuración por defecto
const cache = new NodeCache({
    stdTTL: 300, // TTL por defecto: 5 minuto
    checkperiod: 60, // Revisar expiración cada 60 segundos
    useClones: false // No clonar objetos (mejor performance)
});

// TTLs específicos por tipo de dato
const CACHE_TTL = {
    horarios: 300,        // 5 minutos
    inscripciones: 120,   // 2 minutos
    consultas: 60,        // 1 minuto
    default: 300          // 5 minutos
};

/**
 * Genera una clave de caché única
 * @param {string} tipo - Tipo de dato (horarios, inscripciones, consultas)
 * @param {string} id - Identificador único (dni, año_nacimiento, etc.)
 */
function getCacheKey(tipo, id = '') {
    return id ? `${tipo}_${id}` : tipo;
}

/**
 * Middleware de caché para Express
 * Intenta devolver datos cacheados antes de ejecutar el handler
 */
function cacheMiddleware(tipo) {
    return (req, res, next) => {
        // Generar clave de caché según el endpoint y parámetros
        let cacheKey;
        
        if (tipo === 'horarios') {
            const añoNacimiento = req.query.año_nacimiento || req.query.ano_nacimiento;
            cacheKey = getCacheKey('horarios', añoNacimiento || 'all');
        } else if (tipo === 'inscripciones' || tipo === 'consultas') {
            const dni = req.params.dni || req.body.dni;
            if (!dni) return next(); // Sin DNI, no cachear
            cacheKey = getCacheKey(tipo, dni);
        } else {
            cacheKey = getCacheKey(tipo);
        }

        // Intentar obtener del caché
        const cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            console.log(`⚡ CACHÉ HIT: ${cacheKey}`);
            return res.json(cachedData);
        }

        console.log(`🌐 CACHÉ MISS: ${cacheKey} - Consultando Google Sheets`);

        // Guardar referencia para usar en el handler
        req.cacheKey = cacheKey;
        req.cacheTTL = CACHE_TTL[tipo] || CACHE_TTL.default;

        next();
    };
}

/**
 * Guarda datos en el caché
 * @param {string} key - Clave de caché
 * @param {any} data - Datos a cachear
 * @param {number} ttl - Tiempo de vida en segundos
 */
function setCacheData(key, data, ttl) {
    const success = cache.set(key, data, ttl);
    if (success) {
        console.log(`💾 CACHÉ GUARDADO: ${key} (TTL: ${ttl}s)`);
    }
    return success;
}

/**
 * Invalida caché específico o por patrón
 * @param {string} pattern - Patrón de clave (ej: 'inscripciones_12345678')
 */
function invalidateCache(pattern) {
    if (pattern.includes('*')) {
        // Invalidar múltiples claves por patrón
        const keys = cache.keys();
        const toDelete = keys.filter(key => {
            const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
            return regex.test(key);
        });
        
        cache.del(toDelete);
        console.log(`🗑️ CACHÉ INVALIDADO: ${toDelete.length} claves con patrón "${pattern}"`);
        return toDelete.length;
    } else {
        // Invalidar clave específica
        const deleted = cache.del(pattern);
        console.log(`🗑️ CACHÉ INVALIDADO: ${pattern}`);
        return deleted;
    }
}

/**
 * Invalida caché de un DNI específico (inscripciones + consultas)
 */
function invalidateDNICache(dni) {
    const deleted = [];
    deleted.push(cache.del(getCacheKey('inscripciones', dni)));
    deleted.push(cache.del(getCacheKey('consultas', dni)));
    console.log(`🗑️ CACHÉ INVALIDADO para DNI ${dni}: inscripciones + consultas`);
    return deleted.filter(d => d > 0).length;
}

/**
 * Obtiene estadísticas del caché
 */
function getCacheStats() {
    const stats = cache.getStats();
    const keys = cache.keys();
    
    return {
        hits: stats.hits,
        misses: stats.misses,
        keys: stats.keys,
        ksize: stats.ksize,
        vsize: stats.vsize,
        hitRate: stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%' : '0%',
        activeKeys: keys
    };
}

/**
 * Limpia todo el caché
 */
function clearAllCache() {
    cache.flushAll();
    console.log('🗑️ TODO EL CACHÉ HA SIDO LIMPIADO');
}

module.exports = {
    cache,
    CACHE_TTL,
    getCacheKey,
    cacheMiddleware,
    setCacheData,
    invalidateCache,
    invalidateDNICache,
    getCacheStats,
    clearAllCache
};
