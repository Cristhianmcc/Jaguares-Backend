@echo off
REM ====================================================================
REM IMPORTAR BASE DE DATOS A AWS RDS
REM ====================================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║          IMPORTAR BASE DE DATOS A AWS RDS                  ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Configuración
set RDS_HOST=jaguares-db.c5esiyoi0f3c.us-east-2.rds.amazonaws.com
set RDS_USER=admin
set RDS_DB=jaguares_db

echo Configuración:
echo    Host: %RDS_HOST%
echo    User: %RDS_USER%
echo    Database: %RDS_DB%
echo.

REM Pedir contraseña de forma segura (no se muestra al escribir)
set /p RDS_PASS="Ingrese la contraseña de AWS RDS (root): "

echo.
echo 📋 Paso 1: Probando conexión...
mysql -h %RDS_HOST% -u %RDS_USER% -p%RDS_PASS% -e "SELECT 1;" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ ERROR: No se pudo conectar. Verifica tu contraseña.
    pause
    exit /b 1
)
echo ✅ Conectado exitosamente.
echo.

echo 📋 Paso 2: Importando estructura (schema-production.sql)...
mysql -h %RDS_HOST% -u %RDS_USER% -p%RDS_PASS% < schema-production.sql
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error al importar estructura.
    pause
    exit /b 1
)
echo ✅ Estructura importada.
echo.

echo 📋 Paso 3: Importando datos esenciales (data-essential.sql)...
mysql -h %RDS_HOST% -u %RDS_USER% -p%RDS_PASS% %RDS_DB% < data-essential.sql
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error al importar datos.
    pause
    exit /b 1
)
echo ✅ Datos importados.
echo.

echo ╔════════════════════════════════════════════════════════════╗
echo ║              IMPORTACION COMPLETADA                        ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
pause
