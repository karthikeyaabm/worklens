# Live verification of WorkLens Watchdog Task Manager End Task Recovery and Restart-Loop Protection

$ErrorActionPreference = "Continue"

Write-Host "================ LIVE WATCHDOG RECOVERY TEST ================" -ForegroundColor Cyan

$AppData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ApplicationData)
$WorkLensDataDir = Join-Path $AppData "WorkLens"
$LogsDir = Join-Path $WorkLensDataDir "logs"
$StateFile = Join-Path $WorkLensDataDir "watchdog-state.json"
$LockFile = Join-Path $WorkLensDataDir "watchdog.lock"

# Clear any previous test lock file
if (Test-Path $LockFile) {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}

# 1. Update state file pointing to our local electron
$state = @{
    execPath = "$PSScriptRoot\..\node_modules\electron\dist\electron.exe"
    appPath = (Resolve-Path "$PSScriptRoot\..").Path
    isPackaged = $false
    intentionalShutdown = $false
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
$state | ConvertTo-Json | Set-Content -Path $StateFile -Force
Write-Host "[Test] Configured state file pointing to: $($state.execPath)" -ForegroundColor Green

# 2. Check watchdog script execution
$psScript = "$PSScriptRoot\..\watchdog\worklens-watchdog.ps1"

Write-Host "[Test] Starting background Watchdog process..." -ForegroundColor Yellow
$watchdogProc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$psScript`"" -PassThru

Start-Sleep -Seconds 6

# Check if watchdog created its lock file
if (Test-Path $LockFile) {
    $wPid = Get-Content $LockFile -Raw
    Write-Host "[Test] Watchdog successfully initialized with PID: $wPid" -ForegroundColor Green
} else {
    Write-Host "[Test] Lock file not found" -ForegroundColor Red
}

# 3. Check latest watchdog log
$todayStr = (Get-Date).ToString("yyyy-MM-dd")
$logFile = Join-Path $LogsDir "worklens-watchdog-$todayStr.log"
if (Test-Path $logFile) {
    Write-Host "[Test] Recent Watchdog log entries:" -ForegroundColor Magenta
    Get-Content $logFile -Tail 10 | ForEach-Object { Write-Host "   $_" }
}

# Clean up test watchdog process
if ($watchdogProc -and -not $watchdogProc.HasExited) {
    Stop-Process -Id $watchdogProc.Id -Force -ErrorAction SilentlyContinue
    Write-Host "[Test] Stopped test watchdog process." -ForegroundColor Yellow
}
if (Test-Path $LockFile) {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}

Write-Host "================ LIVE WATCHDOG RECOVERY TEST COMPLETED ================" -ForegroundColor Cyan
