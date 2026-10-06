# Test restart-loop protection (maximum 3 restarts in 5 minutes)

$ErrorActionPreference = "Continue"

Write-Host "================ TEST: RESTART-LOOP PROTECTION ================" -ForegroundColor Cyan

$AppData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ApplicationData)
$WorkLensDataDir = Join-Path $AppData "WorkLens"
$LogsDir = Join-Path $WorkLensDataDir "logs"
$LockFile = Join-Path $WorkLensDataDir "watchdog.lock"
if (Test-Path $LockFile) { Remove-Item $LockFile -Force -ErrorAction SilentlyContinue }

# Clear previous watchdog processes
Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*worklens-watchdog.ps1*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Target dummy script that immediately exits to simulate repetitive crash
$dummyCrashTarget = Join-Path $PSScriptRoot "dummy_crash.cmd"
Set-Content -Path $dummyCrashTarget -Value "@exit 1" -Force

$psScript = "$PSScriptRoot\..\watchdog\worklens-watchdog.ps1"
$watchdogProc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$psScript`"", "-CustomTarget", "`"$dummyCrashTarget`"" -PassThru

Write-Host "[Watchdog PID: $($watchdogProc.Id)] Started with crashing target. Waiting 30s to observe 3 restart attempts and loop limit trigger..."
Start-Sleep -Seconds 30

$todayStr = (Get-Date).ToString("yyyy-MM-dd")
$logFile = Join-Path $LogsDir "worklens-watchdog-$todayStr.log"
Write-Host "`n[Watchdog Log Output]:" -ForegroundColor Magenta
Get-Content $logFile -Tail 20 | ForEach-Object { Write-Host "   $_" }

# Cleanup
if ($watchdogProc -and -not $watchdogProc.HasExited) {
    Stop-Process -Id $watchdogProc.Id -Force -ErrorAction SilentlyContinue
}
if (Test-Path $LockFile) { Remove-Item $LockFile -Force -ErrorAction SilentlyContinue }
if (Test-Path $dummyCrashTarget) { Remove-Item $dummyCrashTarget -Force -ErrorAction SilentlyContinue }

Write-Host "`n================ TEST COMPLETED ================" -ForegroundColor Cyan
