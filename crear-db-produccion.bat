@echo off
REM ====================================================================
REM CREAR BASE DE DATOS PARA PRODUCCION (VACIA)
REM ====================================================================
REM Este script crea una base de datos limpia para AWS RDS
REM Incluye: estructura + datos esenciales (deportes, horarios, admins)
REM Excluye: alumnos, inscripciones, pagos de prueba
REM ====================================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║     CREAR BASE DE DATOS PARA PRODUCCION (AWS RDS)         ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Configuración
set DB_USER=jaguares_user
set DB_PASS=jaguares_pass
set DB_HOST=localhost
set DB_PORT=3308
set DB_NAME=jaguares_db

echo 📋 Paso 1: Exportando estructura de tablas...
echo.

REM Exportar solo estructura (sin datos)
mysqldump -u %DB_USER% -p%DB_PASS% -h %DB_HOST% -P %DB_PORT% ^
  --no-data ^
  --routines --triggers --events ^
  --databases %DB_NAME% ^
  --no-tablespaces ^
  --result-file="schema-production.sql"

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error al exportar estructura
    pause
    exit /b 1
)

echo ✅ Estructura exportada: schema-production.sql
echo.

echo 📋 Paso 2: Exportando datos esenciales...
echo    (deportes, horarios, administradores)
echo.

REM Exportar solo datos esenciales
mysqldump -u %DB_USER% -p%DB_PASS% -h %DB_HOST% -P %DB_PORT% ^
  --no-create-info ^
  --tables deportes horarios administradores ^
  %DB_NAME% ^
  --no-tablespaces ^
  --result-file="data-essential.sql"

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error al exportar datos esenciales
    pause
    exit /b 1
)

echo ✅ Datos esenciales exportados: data-essential.sql
echo.

echo ╔════════════════════════════════════════════════════════════╗
echo ║                  ARCHIVOS CREADOS                          ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo 📁 schema-production.sql
echo    - Estructura de todas las tablas
echo    - Triggers y procedimientos
echo    - Vistas
echo.
echo 📁 data-essential.sql
echo    - 8 deportes configurados
echo    - 153 horarios con categorías
echo    - Usuarios administradores
echo.
echo ✅ Base de datos lista para AWS RDS
echo.
echo 📝 Próximo paso:
echo    1. Crear instancia RDS en AWS
echo    2. Ejecutar: importar-a-rds.bat
echo.

pause
