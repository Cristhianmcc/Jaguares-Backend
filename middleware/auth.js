/**
 * MIDDLEWARE DE AUTENTICACIÓN - SISTEMA JAGUARES
 * Protege endpoints administrativos con JWT
 */

import jwt from 'jsonwebtoken';

const JWT_EXPIRES_IN = '8h'; // Token válido por 8 horas

// Se resuelve al usarlo porque index.js carga .env después de importar este módulo.
// En producción nunca se permite una clave escrita en el código.
const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET;
    if (secret && secret.length >= 32) return secret;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET no está configurado o es demasiado corto');
    }
    return secret || 'jaguares_desarrollo_local_no_usar_en_produccion_2026';
};

/**
 * Middleware de autenticación
 * Verifica que el usuario tenga un token JWT válido
 */
export const verificarAutenticacion = (req, res, next) => {
    try {
        // Obtener token del header Authorization
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: 'No autorizado',
                message: 'Token de autenticación no proporcionado'
            });
        }

        // El formato esperado es: "Bearer TOKEN"
        const token = authHeader.startsWith('Bearer ') 
            ? authHeader.substring(7) 
            : authHeader;

        // Verificar token
        const decoded = jwt.verify(token, getJwtSecret());
        
        // Agregar información del usuario al request
        req.user = decoded;
        
        // También setear req.admin para compatibilidad con endpoints de profesor
        req.admin = {
            admin_id: decoded.administrador_id || decoded.id,
            usuario: decoded.username,
            nombre_completo: decoded.nombre_completo,
            rol: decoded.rol || decoded.role
        };
        
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expirado',
                message: 'El token de autenticación ha expirado. Por favor, inicie sesión nuevamente.'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Token inválido',
                message: 'El token de autenticación no es válido.'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Error de autenticación',
            message: 'Error al verificar autenticación'
        });
    }
};

/**
 * Middleware para verificar rol de administrador
 */
export const verificarAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'No autorizado',
            message: 'Autenticación requerida'
        });
    }

    const role = req.user.rol || req.user.role;
    if (!['admin', 'super_admin'].includes(role)) {
        return res.status(403).json({
            success: false,
            error: 'Acceso denegado',
            message: 'Se requieren privilegios de administrador'
        });
    }

    next();
};

/**
 * Generar token JWT haciendo copia
 */
export const generarToken = (usuario) => {
    const payload = {
        id: usuario.administrador_id,
        username: usuario.username,
        role: usuario.rol || 'admin',
        nombre_completo: usuario.nombre_completo,
        rol: usuario.rol || 'admin'
    };

    return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Verificar token (función auxiliar)
 */
export const verificarToken = (token) => {
    try {
        return jwt.verify(token, getJwtSecret());
    } catch (error) {
        return null;
    }
};
