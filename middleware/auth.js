/**
 * MIDDLEWARE DE AUTENTICACIÓN - SISTEMA JAGUARES
 * Protege endpoints administrativos con JWT
 */

import jwt from 'jsonwebtoken';

// Secret key para JWT (en producción debe estar en .env)
const JWT_SECRET = process.env.JWT_SECRET || 'jaguares_secret_key_2025_cambiar_en_produccion';
const JWT_EXPIRES_IN = '8h'; // Token válido por 8 horas

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
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Agregar información del usuario al request
        req.user = decoded;
        
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

    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            error: 'Acceso denegado',
            message: 'Se requieren privilegios de administrador'
        });
    }

    next();
};

/**
 * Generar token JWT
 */
export const generarToken = (usuario) => {
    const payload = {
        id: usuario.administrador_id,
        username: usuario.username,
        role: 'admin',
        nombre: usuario.nombre_completo,
        rol: usuario.rol || 'admin'
    };

    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Verificar token (función auxiliar)
 */
export const verificarToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
};
