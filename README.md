# 🐆 Jaguares Backend - Sistema de Gestión Deportiva

Backend Node.js + Express para el sistema de inscripciones y gestión de la Academia Deportiva Jaguares.

## 🚀 Características

- ✅ API RESTful con Express.js
- ✅ Base de datos MySQL 8.0
- ✅ Autenticación JWT con bcrypt
- ✅ Rate Limiting para protección DDoS
- ✅ Integración con Google Apps Script
- ✅ CORS configurado
- ✅ Helmet para seguridad HTTP
- ✅ Sistema de caché con NodeCache
- ✅ Soporte para PostgreSQL (opcional)

## 📋 Requisitos

- Node.js 18+
- MySQL 8.0 (o PostgreSQL 15+)
- npm o yarn

## 🔧 Instalación

1. **Clonar el repositorio:**
```bash
git clone https://github.com/Cristhianmcc/Jaguares-Backend.git
cd Jaguares-Backend
```

2. **Instalar dependencias:**
```bash
npm install
```

3. **Configurar variables de entorno:**
```bash
cp .env.example .env
```

Editar `.env` con tus credenciales:
```env
# Servidor
PORT=3002
NODE_ENV=production

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=tu_usuario
DB_PASSWORD=tu_password
DB_NAME=jaguares_db
DB_CONNECTION_LIMIT=10

# JWT
JWT_SECRET=tu_clave_secreta_muy_larga_y_segura

# Apps Script (opcional)
APPS_SCRIPT_URL=https://script.google.com/macros/s/TU_ID/exec
APPS_SCRIPT_TOKEN=tu_token
```

4. **Crear la base de datos:**
```bash
mysql -u root -p < schema-production.sql
```

5. **Iniciar el servidor:**
```bash
npm start
```

El servidor estará disponible en `http://localhost:3002`

## 📁 Estructura del Proyecto

```
├── index.js                 # Servidor principal
├── middleware/
│   ├── auth.js             # Autenticación JWT
│   └── security.js         # Rate limiting y sanitización
├── config/
│   └── database-postgresql.js  # Configuración PostgreSQL
├── utils/
│   └── postgres-helpers.js     # Helpers de PostgreSQL
├── schema-production.sql   # Esquema de base de datos
└── package.json           # Dependencias
```

## 🔐 Endpoints API

### Públicos

- `GET /api/health` - Health check
- `GET /api/horarios` - Listado de horarios disponibles
- `POST /api/inscribir-multiple` - Inscripción múltiple
- `GET /api/mis-inscripciones/:dni` - Consultar inscripciones
- `GET /api/validar-dni/:dni` - Validar DNI

### Protegidos (requieren JWT)

- `POST /api/admin/login` - Autenticación admin
- `GET /api/admin/inscritos` - Listado de inscritos
- `GET /api/admin/estadisticas-financieras` - Estadísticas
- `GET /api/admin/alumnos` - Gestión de alumnos
- `POST /api/admin/alumnos` - Crear alumno
- `PUT /api/admin/alumnos/:id` - Actualizar alumno
- `DELETE /api/admin/alumnos/:id` - Eliminar alumno

## 🐳 Despliegue con Docker

```bash
# Construir imagen
docker build -t jaguares-backend .

# Ejecutar contenedor
docker run -p 3002:3002 --env-file .env jaguares-backend
```

## 🔒 Seguridad

- Contraseñas hasheadas con bcrypt (10 rounds)
- Tokens JWT con expiración de 8 horas
- Rate limiting: 100 req/15min general, 10 req/hora inscripciones
- Protección XSS con helmet
- CORS configurado con whitelist
- Validación de entrada de datos

## 📊 Base de Datos

### Tablas principales:
- `deportes` - Catálogo de deportes
- `horarios` - Horarios disponibles
- `alumnos` - Datos de estudiantes
- `inscripciones` - Inscripciones activas
- `inscripcion_horarios` - Relación inscripción-horarios
- `administradores` - Usuarios admin
- `pagos` - Registro de pagos
- `asistencias` - Control de asistencia

## 🌐 Despliegue en AWS RDS

El proyecto está preparado para AWS RDS MySQL. Ver scripts:
- `backup-produccion.bat` - Backup desde RDS
- `importar-a-rds.bat` - Importar a RDS

## 📝 Scripts SQL Útiles

- `schema-production.sql` - Esquema completo
- `crear-tablas-usuarios-inscripciones.sql` - Tablas de usuarios
- `insertar-categorias-produccion.sql` - Categorías iniciales

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/mejora`)
3. Commit tus cambios (`git commit -am 'Agregar mejora'`)
4. Push a la rama (`git push origin feature/mejora`)
5. Crea un Pull Request

## 📄 Licencia

Este proyecto es privado - Academia Deportiva Jaguares

## 👥 Autores

- **Cristhian Pachacama** - Desarrollo Full Stack

## 🔗 Enlaces

- [Frontend Repository](https://github.com/Cristhianmcc/Jaguares-Frontend)
- [Documentación Completa](https://github.com/Cristhianmcc/Jaguares-Backend/wiki)
