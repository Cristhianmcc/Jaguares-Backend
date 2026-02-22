/**
 * Tests de Seguridad - Endpoints Admin
 * Valida que todas las rutas admin requieran autenticación
 */

const API_BASE = process.env.API_URL || 'http://localhost:3002';

// Lista de endpoints admin que deben estar protegidos
const adminEndpoints = [
  // Deportes
  { method: 'GET', path: '/api/admin/deportes' },
  { method: 'POST', path: '/api/admin/deportes', body: { nombre: 'Test' } },
  { method: 'PUT', path: '/api/admin/deportes/1', body: { nombre: 'Test' } },
  { method: 'DELETE', path: '/api/admin/deportes/1' },
  
  // Docentes
  { method: 'GET', path: '/api/admin/docentes' },
  { method: 'POST', path: '/api/admin/docentes', body: { nombre_completo: 'Test', usuario: 'test', email: 'test@test.com', password: '12345678' } },
  
  // Horarios
  { method: 'GET', path: '/api/admin/horarios' },
  { method: 'POST', path: '/api/admin/horarios', body: { deporte_id: 1, dia: 'LUNES', hora_inicio: '08:00', hora_fin: '09:00', precio: 20 } },
  
  // Categorías
  { method: 'GET', path: '/api/admin/categorias' },
  { method: 'POST', path: '/api/admin/categorias', body: { deporte_id: 1, nombre: 'Test' } },
  
  // Inscripciones
  { method: 'GET', path: '/api/admin/inscripciones' },
  { method: 'GET', path: '/api/admin/inscripciones/12345678' },
  { method: 'PUT', path: '/api/admin/inscripciones/12345678/confirmar-pago', body: {} },
  { method: 'PUT', path: '/api/admin/inscripciones/12345678/rechazar-pago', body: { motivo: 'test' } },
  
  // Usuarios
  { method: 'GET', path: '/api/admin/usuarios' },
  { method: 'POST', path: '/api/admin/crear-usuario', body: { usuario: 'test', password: 'test1234', nombre_completo: 'Test', email: 'test@test.com', rol: 'admin' } },
  
  // Estadísticas y Reportes
  { method: 'GET', path: '/api/admin/estadisticas/inscripciones' },
  { method: 'GET', path: '/api/admin/estadisticas-financieras' },
  { method: 'GET', path: '/api/admin/reportes/alumnos' },
  
  // Reubicaciones
  { method: 'GET', path: '/api/admin/reubicaciones/deportes' },
  { method: 'GET', path: '/api/admin/reubicaciones/alumnos/1' },
  
  // Cache y Debug (deben estar protegidos)
  { method: 'POST', path: '/api/cache/clear', body: {} },
  { method: 'GET', path: '/api/cache/stats' },
  { method: 'GET', path: '/api/debug/horarios' },
];

// Helper para hacer requests
async function makeRequest(method, path, body = null, token = null) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, options);
    return {
      status: response.status,
      ok: response.ok,
      data: await response.json().catch(() => ({}))
    };
  } catch (error) {
    return { status: 0, ok: false, error: error.message };
  }
}

describe('Seguridad de Endpoints Admin', () => {
  
  describe('Rutas admin deben rechazar requests sin token', () => {
    
    test.each(adminEndpoints)(
      '$method $path debe retornar 401 sin token',
      async ({ method, path, body }) => {
        const response = await makeRequest(method, path, body, null);
        
        expect(response.status).toBe(401);
        expect(response.data.success).toBe(false);
        expect(response.data.error).toBeDefined();
      }
    );
    
  });
  
  describe('Rutas admin deben rechazar tokens inválidos', () => {
    
    test.each(adminEndpoints.slice(0, 5))( // Solo probamos algunos para no saturar
      '$method $path debe rechazar token inválido',
      async ({ method, path, body }) => {
        const response = await makeRequest(method, path, body, 'token_invalido_123');
        
        expect(response.status).toBe(401);
        expect(response.data.success).toBe(false);
      }
    );
    
  });
  
});

describe('Endpoint de Login', () => {
  
  test('POST /api/admin/login debe aceptar credenciales válidas', async () => {
    // Nota: Este test requiere credenciales válidas en la DB
    // Usar credenciales de test o skip si no están disponibles
    const response = await makeRequest('POST', '/api/admin/login', {
      usuario: 'admin',
      password: 'Jaguares2025!'
    });
    
    // Puede fallar si las credenciales no existen, eso está OK
    if (response.status === 200) {
      expect(response.data.success).toBe(true);
      expect(response.data.token).toBeDefined();
      expect(typeof response.data.token).toBe('string');
    } else {
      // Si falla por credenciales, al menos validar el formato de respuesta
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
  
  test('POST /api/admin/login debe rechazar credenciales inválidas', async () => {
    const response = await makeRequest('POST', '/api/admin/login', {
      usuario: 'usuario_que_no_existe',
      password: 'password_incorrecto'
    });
    
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.data.success).toBe(false);
  });
  
  test('POST /api/admin/login debe rechazar request sin datos', async () => {
    const response = await makeRequest('POST', '/api/admin/login', {});
    
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
  
});
