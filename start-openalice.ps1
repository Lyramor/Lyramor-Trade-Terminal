# ============================================================
#  OpenAlice one-click launcher
#  1) Connects Cloudflare WARP (bypasses ISP DNS block)
#  2) Waits until WARP is "Connected"
#  3) Runs run.ps1 (starts UTA + Alice, opens at http://localhost:47331)
#
#  Double-click the Desktop shortcut, or run:
#    powershell -ExecutionPolicy Bypass -File .\start-openalice.ps1
# ============================================================

Set-Location -Path $PSScriptRoot

$warp = "C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe"

Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host "  Step 1/2 : Connecting Cloudflare WARP ..." -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Yellow

if (Test-Path $warp) {
  try { & $warp connect | Out-Null } catch {}
  $connected = $false
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    $status = & $warp status 2>$null
    if ($status -match "Connected") { $connected = $true; break }
  }
  if ($connected) {
    Write-Host "  WARP connected. Network healthy." -ForegroundColor Green
  } else {
    Write-Host "  WARNING: WARP did not report Connected in time." -ForegroundColor Red
    Write-Host "  Brokers / crypto / FRED may fail (ISP DNS block)." -ForegroundColor Red
    Write-Host "  You can open the 1.1.1.1 app and toggle Connect manually." -ForegroundColor Yellow
  }
} else {
  Write-Host "  warp-cli not found at:" -ForegroundColor Red
  Write-Host "    $warp" -ForegroundColor Red
  Write-Host "  Skipping WARP - broker endpoints will likely be DNS-blocked." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host "  Step 2/2 : Starting Lyramor (UTA + Alice) ..." -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host ""

# Hand off to the existing launcher (starts UTA, waits health, runs Alice).
& "$PSScriptRoot\run.ps1"
