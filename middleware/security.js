/**
 * MIDDLEWARES DE SEGURIDAD - SISTEMA JAGUARES
 * Rate limiting, CORS, Helmet, etc.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';

/**
 * Rate Limiter General
 * Limita requests por IP - excluye rutas de admin
 * Configuración balanceada para desarrollo y producción
 */
export const rateLimiterGeneral = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 500, // máximo 500 requests por minuto (balanceado para uso real y pruebas)
    message: {
        success: false,
        error: 'Demasiadas solicitudes',
        message: 'Ha excedido el límite de solicitudes. Por favor, intente más tarde.',
        retryAfter: '1 minuto'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // Store de memoria por defecto (en producción considerar Redis)
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    // Excluir rutas de admin del rate limiting general
    skip: (req) => {
        return req.path.startsWith('/api/admin');
    }
});

/**
 * Rate Limiter para Inscripciones
 * Previene abuso pero permite uso legítimo: 30 inscripciones por hora
 */
export const rateLimiterInscripciones = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 30, // máximo 30 inscripciones por hora (aumentado para familias grandes)
    message: {
        success: false,
        error: 'Límite de inscripciones alcanzado',
        message: 'Ha alcanzado el límite de inscripciones por hora. Por favor, intente más tarde.',
        retryAfter: '1 hora'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Identificar por IP (IPv6-safe) + DNI si está disponible
    keyGenerator: (req) => {
        const dni = req.body?.alumno?.dni || req.body?.dni || req.params?.dni || '';
        const ip = ipKeyGenerator(req); // IPv6-safe
        return dni ? `${ip}-${dni}` : ip;
    }
});

/**
 * Rate Limiter para Login
 * Previene ataques de fuerza bruta: 5 intentos por 15 minutos
 */
export const rateLimiterLogin = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // máximo 5 intentos
    message: {
        success: false,
        error: 'Demasiados intentos de login',
        message: 'Ha excedido el límite de intentos de inicio de sesión. Por favor, intente en 15 minutos.',
        retryAfter: '15 minutos'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true // No contar requests exitosos
});

/**
 * Rate Limiter para Admin
 * Muy permisivo para usuarios autenticados - no bloquear trabajo admin
 */
export const rateLimiterAdmin = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 1000, // máximo 1000 requests por minuto (prácticamente sin límite)
    message: {
        success: false,
        error: 'Límite de solicitudes alcanzado',
        message: 'Ha excedido el límite de solicitudes administrativas.',
        retryAfter: '1 minuto'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true // No contar requests exitosos
});

/**
 * Configuración de CORS
 * Restringida a dominios específicos
 */
export const corsOptions = {
    origin: function (origin, callback) {
        // Dominios permitidos
        const whitelist = [
            'http://localhost:3000',
            'http://localhost:5500',
            'http://localhost:5501',
            'http://localhost:5502',
            'http://localhost:8080',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5500',
            'http://127.0.0.1:5501',
            'http://127.0.0.1:5502',
            'http://127.0.0.1:8080',
            // Producción Dokploy (Legacy)
            'http://187.77.6.232.nip.io',
            'http://api.187.77.6.232.nip.io',
            // Producción Dominio Real
            'https://jaguarescar.com',
            'https://api.jaguarescar.com',
            'https://www.jaguarescar.com'
        ];

        // Permitir requests sin origin (como Postman, curl, apps móviles)
        if (!origin || whitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`🚫 CORS bloqueó origin: ${origin}`);
            callback(new Error('No permitido por CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma'],
    exposedHeaders: ['Authorization']
};

/**
 * Configuración de Helmet
 * Headers de seguridad
 */
export const helmetConfig = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    frameguard: {
        action: 'deny'
    },
    noSniff: true,
    xssFilter: true
});

/**
 * Middleware de validación de entrada
 * Sanitiza inputs para prevenir XSS
 */
export const sanitizeInput = (req, res, next) => {
    // Función para limpiar strings
    const cleanString = (str) => {
        if (typeof str !== 'string') return str;
        
        // Remover tags HTML
        let clean = str.replace(/<[^>]*>/g, '');
        
        // Escapar caracteres peligrosos
        clean = clean
            .replace(/[<>]/g, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+=/gi, '');
        
        return clean.trim();
    };

    // Limpiar body
    if (req.body && typeof req.body === 'object') {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = cleanString(req.body[key]);
            }
        }
    }

    // Limpiar query params
    if (req.query && typeof req.query === 'object') {
        for (const key in req.query) {
            if (typeof req.query[key] === 'string') {
                req.query[key] = cleanString(req.query[key]);
            }
        }
    }

    // Limpiar params
    if (req.params && typeof req.params === 'object') {
        for (const key in req.params) {
            if (typeof req.params[key] === 'string') {
                req.params[key] = cleanString(req.params[key]);
            }
        }
    }

    next();
};

/**
 * Middleware de manejo de errores global
 * Siempre devuelve JSON
 */
export const errorHandler = (err, req, res, next) => {
    // Log del error
    console.error('❌ Error:', {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        url: req.url,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString()
    });

    // Determinar código de estado
    const statusCode = err.statusCode || err.status || 500;

    // Respuesta JSON consistente
    res.status(statusCode).json({
        success: false,
        error: err.name || 'Error',
        message: err.message || 'Ha ocurrido un error interno',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

/**
 * Middleware para rutas no encontradas (404)
 */
export const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada',
        message: `La ruta ${req.method} ${req.url} no existe`,
        availableEndpoints: [
            '/api/health',
            '/api/deportes',
            '/api/horarios',
            '/api/inscribir-multiple',
            '/api/alumno/:dni',
            '/api/admin/*'
        ]
    });
};
