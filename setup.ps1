# ══════════════════════════════════════════════════════
#  Seis Pimientas · Setup PostgreSQL en Windows
#  Ejecutar en PowerShell como ADMINISTRADOR
#  Click derecho en PowerShell → "Ejecutar como administrador"
# ══════════════════════════════════════════════════════

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Red
Write-Host "  ║   Seis Pimientas · Setup PostgreSQL   ║" -ForegroundColor Red
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Red
Write-Host ""

# ── PASO 1: Descargar PostgreSQL con winget ──────────────
Write-Host "→ Instalando PostgreSQL 16..." -ForegroundColor Yellow

winget install -e --id PostgreSQL.PostgreSQL.16 --accept-source-agreements --accept-package-agreements

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "winget no pudo instalarlo. Descargando instalador manual..." -ForegroundColor Yellow
    
    $url = "https://get.enterprisedb.com/postgresql/postgresql-16.3-1-windows-x64.exe"
    $out = "$env:TEMP\postgresql-installer.exe"
    
    Write-Host "→ Descargando desde EnterpriseDB..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $url -OutFile $out
    
    Write-Host "→ Ejecutando instalador..." -ForegroundColor Yellow
    Write-Host "   Durante la instalación:" -ForegroundColor Cyan
    Write-Host "   · Dejá el puerto en 5432 (default)" -ForegroundColor Cyan
    Write-Host "   · Anotá la contraseña que ponés para el usuario postgres" -ForegroundColor Cyan
    Write-Host "   · Dejá todo lo demás por defecto" -ForegroundColor Cyan
    Write-Host ""
    Start-Process -FilePath $out -Wait
}

# ── PASO 2: Agregar psql al PATH ─────────────────────────
Write-Host ""
Write-Host "→ Agregando psql al PATH..." -ForegroundColor Yellow

$pgPaths = @(
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\15\bin",
    "C:\Program Files\PostgreSQL\14\bin"
)

$currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$added = $false

foreach ($path in $pgPaths) {
    if (Test-Path $path) {
        if ($currentPath -notlike "*$path*") {
            [Environment]::SetEnvironmentVariable(
                "Path",
                "$currentPath;$path",
                "Machine"
            )
            Write-Host "   ✓ Agregado: $path" -ForegroundColor Green
        } else {
            Write-Host "   ✓ Ya estaba en PATH: $path" -ForegroundColor Green
        }
        $added = $true
        $env:Path += ";$path"
        break
    }
}

if (-not $added) {
    Write-Host "   ⚠ No se encontró la carpeta bin de PostgreSQL" -ForegroundColor Yellow
    Write-Host "   Buscando instalación..." -ForegroundColor Yellow
    $found = Get-ChildItem "C:\Program Files\PostgreSQL" -ErrorAction SilentlyContinue
    if ($found) {
        Write-Host "   Versiones encontradas:" -ForegroundColor Cyan
        $found | ForEach-Object { Write-Host "   · $($_.FullName)\bin" }
    }
}

# ── PASO 3: Verificar instalación ────────────────────────
Write-Host ""
Write-Host "→ Verificando instalación..." -ForegroundColor Yellow

try {
    $ver = & psql --version 2>&1
    Write-Host "   ✓ $ver" -ForegroundColor Green
} catch {
    Write-Host "   ⚠ psql no encontrado en esta sesión." -ForegroundColor Yellow
    Write-Host "   Cerrá y volvé a abrir PowerShell como admin." -ForegroundColor Yellow
}

# ── PASO 4: Crear usuario y base de datos ────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host "  CONFIGURACIÓN DE LA BASE DE DATOS" -ForegroundColor White
Write-Host "═══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Ingresá la contraseña del usuario postgres" -ForegroundColor Cyan
Write-Host "  (la que pusiste durante la instalación):" -ForegroundColor Cyan
Write-Host ""

$pgPassword = Read-Host "  Contraseña de postgres" -AsSecureString
$pgPlain    = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPassword))

Write-Host ""
Write-Host "  Ingresá la contraseña que usará sp_user" -ForegroundColor Cyan
Write-Host "  (la misma que pusiste en el .env como DB_PASSWORD):" -ForegroundColor Cyan
Write-Host ""

$spPassword = Read-Host "  Contraseña para sp_user" -AsSecureString
$spPlain    = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($spPassword))

Write-Host ""
Write-Host "→ Creando usuario sp_user y base de datos..." -ForegroundColor Yellow

$env:PGPASSWORD = $pgPlain

$sql = @"
CREATE USER sp_user WITH PASSWORD '$spPlain';
CREATE DATABASE seispimientas OWNER sp_user;
GRANT ALL PRIVILEGES ON DATABASE seispimientas TO sp_user;
"@

$sql | psql -U postgres

if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✓ Usuario sp_user creado" -ForegroundColor Green
    Write-Host "   ✓ Base de datos seispimientas creada" -ForegroundColor Green
} else {
    Write-Host "   ⚠ Hubo un error. Revisá la contraseña de postgres." -ForegroundColor Red
}

# ── PASO 5: Aplicar schema ───────────────────────────────
Write-Host ""
Write-Host "→ Aplicando schema de la base de datos..." -ForegroundColor Yellow

$projectPath = $PSScriptRoot
$schemaFile  = "$projectPath\db\migrations\001_schema.sql"

if (Test-Path $schemaFile) {
    $env:PGPASSWORD = $spPlain
    psql -U sp_user -d seispimientas -f $schemaFile

    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✓ Schema aplicado correctamente" -ForegroundColor Green
    } else {
        Write-Host "   ⚠ Error al aplicar el schema" -ForegroundColor Red
    }
} else {
    Write-Host "   ⚠ No se encontró el archivo:" -ForegroundColor Red
    Write-Host "   $schemaFile" -ForegroundColor Red
}

# ── PASO 6: Ejecutar seed ────────────────────────────────
Write-Host ""
Write-Host "→ Cargando datos iniciales (seed)..." -ForegroundColor Yellow

Set-Location $projectPath
$env:PGPASSWORD = $spPlain
node db/seed.js

# ── RESUMEN FINAL ────────────────────────────────────────
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║         ✓ SETUP COMPLETADO            ║" -ForegroundColor Green
Write-Host "  ╠═══════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  Para iniciar el servidor:            ║" -ForegroundColor White
Write-Host "  ║                                       ║" -ForegroundColor White
Write-Host "  ║    npm run dev                        ║" -ForegroundColor Cyan
Write-Host "  ║                                       ║" -ForegroundColor White
Write-Host "  ║  Verificar en el navegador:           ║" -ForegroundColor White
Write-Host "  ║    http://localhost:3000/health       ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
