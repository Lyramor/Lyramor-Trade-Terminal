# Lyramor launcher (production bundle) - Windows
# Runs the compiled UTA + Alice from dist/, which is fast and reliable on Windows.
# Prereq: run 'pnpm build' once first. Re-run build after pulling new code.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\run.ps1
# Stop:   close this window, or run  Get-Process node | Stop-Process -Force

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# --- Config ---------------------------------------------------------------
$env:OPENALICE_HOME = "$env:USERPROFILE\.openalice"   # user-data home (~/.openalice)
$UtaPort  = 47333
$WebPort  = 47331   # open THIS one in your browser
$McpPort  = 47332

if (-not (Test-Path "dist/main.js") -or -not (Test-Path "services/uta/dist/uta.js")) {
  Write-Host "Build output missing. Run 'pnpm build' first." -ForegroundColor Red
  exit 1
}

# --- IDX MCP (data saham BEI) --------------------------------------------
# Optional sidecar: serves 8 BEI stock tools over SSE on 4002, read from the
# IDX-API SQLite at ~/idx-api/data/database.sqlite. Registered with Claude Code
# at USER scope (~/.claude.json), so every claude session — including the ones
# inside Lyramor workspaces — sees the tools. Skipped silently when it isn't
# installed or something already holds the port, so this never blocks Lyramor.
# Refresh the data with:  cd ~/idx-api ; deno run -A SyncMcp.ts
$IdxDir  = "$env:USERPROFILE\idx-mcp-server"
$IdxPort = 4002
$idx = $null
if ((Test-Path "$IdxDir\server.ts") -and -not (Get-NetTCPConnection -LocalPort $IdxPort -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "Starting IDX MCP (data saham BEI) on port $IdxPort ..." -ForegroundColor Cyan
  $idx = Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory $IdxDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$env:OPENALICE_HOME\idx-mcp.log" -RedirectStandardError "$env:OPENALICE_HOME\idx-mcp.err.log"
}

Write-Host "Starting UTA (broker carrier) on port $UtaPort ..." -ForegroundColor Cyan
$env:OPENALICE_UTA_PORT = "$UtaPort"
$uta = Start-Process -FilePath "node" -ArgumentList "services/uta/dist/uta.js" -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput "$env:OPENALICE_HOME\uta.log" -RedirectStandardError "$env:OPENALICE_HOME\uta.err.log"

# Wait for UTA health
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$UtaPort/__uta/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { Write-Host "UTA did not become healthy in time." -ForegroundColor Red; $uta.Kill(); exit 1 }
Write-Host "UTA ready." -ForegroundColor Green

Write-Host "Starting Alice (agent runtime + UI) on port $WebPort ..." -ForegroundColor Cyan
$env:OPENALICE_WEB_PORT = "$WebPort"
$env:OPENALICE_MCP_PORT = "$McpPort"
$env:OPENALICE_UI_PORT  = "$WebPort"
$env:OPENALICE_UTA_URL  = "http://127.0.0.1:$UtaPort"

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host "  Open Lyramor in your browser:  http://localhost:$WebPort" -ForegroundColor Yellow
Write-Host "  First run prints an admin token below. Copy it to log in." -ForegroundColor Yellow
Write-Host "  Press Ctrl+C here to stop Alice. UTA keeps running in background."
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host ""

# Run Alice in the foreground so you see its logs + the admin token.
try {
  node dist/main.js
} finally {
  Write-Host "Stopping UTA ..." -ForegroundColor Cyan
  try { $uta.Kill() } catch {}
  if ($idx) {
    Write-Host "Stopping IDX MCP ..." -ForegroundColor Cyan
    try { $idx.Kill() } catch {}
  }
}
