@echo off
REM ====================================================================
REM SCRIPT DE BACKUP AUTOMATICO - BASE DE DATOS JAGUARES
REM ====================================================================
REM Este script crea un backup completo de la base de datos MySQL
REM Incluye: estructura, datos, triggers, procedimientos, vistas
REM ====================================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║          BACKUP AUTOMATICO - BASE DE DATOS JAGUARES        ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Configuración
set DB_USER=jaguares_user
set DB_PASS=jaguares_pass
set DB_HOST=localhost
set DB_PORT=3308
set DB_NAME=jaguares_db

REM Crear carpeta de backups si no existe
if not exist "backups" mkdir backups

REM Generar nombre de archivo con fecha y hora
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set FECHA=%datetime:~0,8%
set HORA=%datetime:~8,6%
set TIMESTAMP=%FECHA%-%HORA%

set BACKUP_FILE=backups\backup-jaguares-%TIMESTAMP%.sql

echo 📅 Fecha: %FECHA:~0,4%-%FECHA:~4,2%-%FECHA:~6,2%
echo ⏰ Hora: %HORA:~0,2%:%HORA:~2,2%:%HORA:~4,2%
echo 📁 Archivo: %BACKUP_FILE%
echo.
echo 🔄 Generando backup...
echo.

REM Ejecutar mysqldump
mysqldump -u %DB_USER% -p%DB_PASS% -h %DB_HOST% -P %DB_PORT% ^
  --databases %DB_NAME% ^
  --routines ^
  --triggers ^
  --events ^
  --single-transaction ^
  --add-drop-database ^
  --no-tablespaces ^
  --result-file="%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ BACKUP COMPLETADO EXITOSAMENTE
    echo.
    echo 📊 Información del backup:
    for %%A in ("%BACKUP_FILE%") do (
        echo    Tamaño: %%~zA bytes
        echo    Ubicación: %%~fA
    )
    echo.
    
    REM Contar backups existentes
    for /f %%i in ('dir /b backups\backup-jaguares-*.sql 2^>nul ^| find /c /v ""') do set COUNT=%%i
    echo 📦 Total de backups guardados: %COUNT%
    echo.
    
    REM Sugerencia de limpieza si hay muchos backups
    if %COUNT% GTR 10 (
        echo ⚠️  SUGERENCIA: Tienes más de 10 backups guardados.
        echo    Considera eliminar los más antiguos para ahorrar espacio.
        echo.
    )
    
) else (
    echo.
    echo ❌ ERROR AL CREAR BACKUP
    echo    Verifica que MySQL esté corriendo y las credenciales sean correctas.
    echo.
)

echo ╔════════════════════════════════════════════════════════════╗
echo ║                    PROCESO FINALIZADO                      ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

pause
