# Polymarket Terminal - Local Deployment Script
# Builds the React frontend, then starts the FastAPI backend on http://localhost:8000

$root = $PSScriptRoot
$node = "C:\Program Files\nodejs\node.exe"
$vite = "$root\terminal\node_modules\vite\bin\vite.js"
$tsc  = "$root\terminal\node_modules\typescript\bin\tsc"
$py   = "C:\Program Files\Python311\python.exe"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  POLYMARKET TERMINAL - LOCAL DEPLOYMENT" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# 1. TypeScript type-check
Write-Host "[1/2] Type-checking TypeScript..." -ForegroundColor Yellow
Push-Location "$root\terminal"
& $node $tsc --noEmit 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "TypeScript errors found. Fix them and re-run." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "      OK" -ForegroundColor Green

# 2. Vite production build
Write-Host "[2/2] Building frontend (Vite)..." -ForegroundColor Yellow
Push-Location "$root\terminal"
& $node $vite build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "      Build complete -> terminal/dist" -ForegroundColor Green

# Launch
Write-Host ""
Write-Host "  Open your browser at: http://localhost:8000" -ForegroundColor White
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

Set-Location $root
& $py -m uvicorn terminal.backend.main:app --host 0.0.0.0 --port 8000
