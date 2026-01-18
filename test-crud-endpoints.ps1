# Script de prueba para endpoints CRUD
# Ejecutar desde la carpeta server

Write-Host "`n========== PRUEBAS CRUD SISTEMA JAGUARES ==========" -ForegroundColor Cyan
Write-Host "Probando endpoints de Deportes y Horarios`n" -ForegroundColor Cyan

$baseUrl = "http://localhost:3002"

# Test 1: Obtener deportes
Write-Host "`n[TEST 1] GET /api/admin/deportes" -ForegroundColor Yellow
try {
    $deportes = Invoke-RestMethod -Uri "$baseUrl/api/admin/deportes" -Method Get
    Write-Host "✅ Deportes obtenidos: $($deportes.deportes.Count)" -ForegroundColor Green
    if ($deportes.deportes.Count -gt 0) {
        Write-Host "   Primer deporte: $($deportes.deportes[0].nombre)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}

# Test 2: Obtener horarios
Write-Host "`n[TEST 2] GET /api/admin/horarios" -ForegroundColor Yellow
try {
    $horarios = Invoke-RestMethod -Uri "$baseUrl/api/admin/horarios" -Method Get
    Write-Host "✅ Horarios obtenidos: $($horarios.horarios.Count)" -ForegroundColor Green
    if ($horarios.horarios.Count -gt 0) {
        Write-Host "   Primer horario: $($horarios.horarios[0].deporte) - $($horarios.horarios[0].dia) $($horarios.horarios[0].hora_inicio)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}

# Test 3: Obtener deportes activos (para selector)
Write-Host "`n[TEST 3] GET /api/admin/deportes-activos" -ForegroundColor Yellow
try {
    $deportesActivos = Invoke-RestMethod -Uri "$baseUrl/api/admin/deportes-activos" -Method Get
    Write-Host "✅ Deportes activos: $($deportesActivos.deportes.Count)" -ForegroundColor Green
    $deportesActivos.deportes | ForEach-Object {
        Write-Host "   - $($_.nombre) (ID: $($_.deporte_id))" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}

# Test 4: Crear deporte de prueba
Write-Host "`n[TEST 4] POST /api/admin/deportes (crear deporte de prueba)" -ForegroundColor Yellow
try {
    $nuevoDeporte = @{
        nombre = "Test Deporte $(Get-Date -Format 'HHmmss')"
        descripcion = "Deporte creado automáticamente para prueba"
        icono = "🧪"
        matricula = 25.00
    } | ConvertTo-Json
    
    $resultado = Invoke-RestMethod -Uri "$baseUrl/api/admin/deportes" -Method Post -Body $nuevoDeporte -ContentType "application/json"
    Write-Host "✅ Deporte creado con ID: $($resultado.deporte_id)" -ForegroundColor Green
    $deporteTestId = $resultado.deporte_id
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}

# Test 5: Actualizar deporte de prueba
if ($deporteTestId) {
    Write-Host "`n[TEST 5] PUT /api/admin/deportes/$deporteTestId (actualizar)" -ForegroundColor Yellow
    try {
        $actualizarDeporte = @{
            nombre = "Test Deporte Actualizado"
            descripcion = "Descripción actualizada"
            icono = "✅"
            matricula = 30.00
            estado = "activo"
        } | ConvertTo-Json
        
        $resultado = Invoke-RestMethod -Uri "$baseUrl/api/admin/deportes/$deporteTestId" -Method Put -Body $actualizarDeporte -ContentType "application/json"
        Write-Host "✅ Deporte actualizado correctamente" -ForegroundColor Green
    } catch {
        Write-Host "❌ Error: $_" -ForegroundColor Red
    }
}

# Test 6: Eliminar (desactivar) deporte de prueba
if ($deporteTestId) {
    Write-Host "`n[TEST 6] DELETE /api/admin/deportes/$deporteTestId (desactivar)" -ForegroundColor Yellow
    try {
        $resultado = Invoke-RestMethod -Uri "$baseUrl/api/admin/deportes/$deporteTestId" -Method Delete
        Write-Host "✅ Deporte desactivado correctamente" -ForegroundColor Green
    } catch {
        Write-Host "❌ Error: $_" -ForegroundColor Red
    }
}

Write-Host "`n========== PRUEBAS COMPLETADAS ==========" -ForegroundColor Cyan
Write-Host "`nPuedes acceder al panel CRUD en: http://localhost:3002/../admin-crud.html" -ForegroundColor Green
Write-Host "O desde el panel de administración: http://localhost:3002/../admin-panel.html`n" -ForegroundColor Green
