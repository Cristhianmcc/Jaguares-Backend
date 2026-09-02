@echo off
setlocal
cd /d "%~dp0"

echo Iniciando la base de datos aislada de Jaguares CMS...
docker compose -f docker-compose.dev.yml up -d

if errorlevel 1 (
  echo.
  echo No se pudo iniciar Docker. Confirma que Docker Desktop este abierto.
  pause
  exit /b 1
)

echo.
echo Contenedor solicitado correctamente:
docker compose -f docker-compose.dev.yml ps
echo.
echo Puedes cerrar esta ventana.
pause
