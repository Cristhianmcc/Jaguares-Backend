/**
 * Setup para tests - JAGUARES Backend
 * Configura entorno de pruebas sin afectar producción
 */

// Variables de entorno para tests
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_for_testing_only';

// Timeout extendido para operaciones de DB (ESM compatible)
// El timeout se configura en jest.config.js con testTimeout: 30000

// Silenciar console.log en tests (descomenta si necesitas debug)
// global.console = {
//   ...console,
//   log: jest.fn(),
// };
