/**
 * Jest Configuration
 * Configurado para ES Modules y tests de integración API
 */

export default {
  // Usar entorno jsdom para fetch nativo
  testEnvironment: 'node',
  
  // Directorio de tests
  testMatch: ['**/tests/**/*.test.js'],
  
  // Ignorar node_modules
  testPathIgnorePatterns: ['/node_modules/'],
  
  // Timeout para tests de integración (requests HTTP)
  testTimeout: 30000,
  
  // Setup global
  setupFilesAfterEnv: ['./tests/setup.js'],
  
  // Verbose output
  verbose: true,
  
  // Transformar ES modules
  transform: {},
  
  // Extensiones a procesar
  moduleFileExtensions: ['js', 'json'],
  
  // Reportar cobertura
  collectCoverageFrom: [
    'index.js',
    'middleware/**/*.js',
    '!**/node_modules/**'
  ],
  
  // Para ES Modules en Node.js
  extensionsToTreatAsEsm: [],
};
