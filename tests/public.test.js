/**
 * Tests de Endpoints Públicos
 * Valida que las rutas públicas funcionen correctamente sin autenticación
 */

const API_BASE = process.env.API_URL || 'http://localhost:3002';

// Helper para hacer requests
async function makeRequest(method, path, body = null) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
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

describe('Endpoints Públicos - Sin autenticación requerida', () => {
  
  describe('GET /api/horarios', () => {
    
    test('debe retornar lista de horarios', async () => {
      const response = await makeRequest('GET', '/api/horarios');
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.data)).toBe(true);
    });
    
    test('debe retornar estructura correcta de horario', async () => {
      const response = await makeRequest('GET', '/api/horarios');
      
      if (response.data.data && response.data.data.length > 0) {
        const horario = response.data.data[0];
        
        // Validar campos esperados
        expect(horario).toHaveProperty('id');
        expect(horario).toHaveProperty('nombre'); // nombre del deporte
      }
    });
    
  });
  
  describe('GET /api/deportes', () => {
    
    test('debe retornar lista de deportes', async () => {
      const response = await makeRequest('GET', '/api/deportes');
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.data)).toBe(true);
    });
    
  });
  
  describe('GET /api/categorias', () => {
    
    test('debe retornar lista de categorías', async () => {
      const response = await makeRequest('GET', '/api/categorias');
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.data)).toBe(true);
    });
    
  });
  
  describe('GET /api/health', () => {
    
    test('debe retornar estado del servidor', async () => {
      const response = await makeRequest('GET', '/api/health');
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.status).toBe('ok');
    });
    
  });
  
  describe('POST /api/consultar-dni', () => {
    
    test('debe aceptar formato de DNI válido', async () => {
      const response = await makeRequest('POST', '/api/consultar-dni', {
        dni: '12345678'
      });
      
      // Puede retornar 200 (encontrado) o 404 (no encontrado)
      // Pero no debe retornar 401 (no requiere auth)
      expect(response.status).not.toBe(401);
      expect([200, 404, 400]).toContain(response.status);
    });
    
    test('debe rechazar DNI con formato inválido', async () => {
      const response = await makeRequest('POST', '/api/consultar-dni', {
        dni: 'abc'
      });
      
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.data.success).toBe(false);
    });
    
  });
  
});

describe('Endpoints de Profesor - Requieren token de profesor', () => {
  
  const profesorEndpoints = [
    { method: 'GET', path: '/api/profesor/info' },
    { method: 'GET', path: '/api/profesor/horarios' },
    { method: 'GET', path: '/api/profesor/alumnos/1' },
    { method: 'GET', path: '/api/profesor/asistencias/1' },
    { method: 'GET', path: '/api/profesor/estadisticas' },
  ];
  
  test.each(profesorEndpoints)(
    '$method $path debe rechazar sin token',
    async ({ method, path }) => {
      const response = await makeRequest(method, path);
      
      expect(response.status).toBe(401);
      expect(response.data.success).toBe(false);
    }
  );
  
});

describe('Validación de Inscripciones', () => {
  
  test('POST /api/inscribir debe validar datos requeridos', async () => {
    const response = await makeRequest('POST', '/api/inscribir', {});
    
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.data.success).toBe(false);
  });
  
  test('POST /api/inscribir debe rechazar DNI inválido', async () => {
    const response = await makeRequest('POST', '/api/inscribir', {
      alumno: {
        dni: 'invalido',
        nombre: 'Test',
        apellidos: 'Test',
        fecha_nacimiento: '2015-01-01'
      },
      padre: {
        dni: '12345678',
        nombre: 'Padre Test',
        telefono: '999999999',
        email: 'test@test.com'
      },
      horarios: [1]
    });
    
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.data.success).toBe(false);
  });
  
});
