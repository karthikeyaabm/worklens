# Test End Task / Crash recovery flow in real time

$ErrorActionPreference = "Continue"

Write-Host "================ TEST: TASK MANAGER END TASK AUTO-RECOVERY ================" -ForegroundColor Cyan

$AppData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ApplicationData)
$WorkLensDataDir = Join-Path $AppData "WorkLens"
$LogsDir = Join-Path $WorkLensDataDir "logs"
$StateFile = Join-Path $WorkLensDataDir "watchdog-state.json"
$LockFile = Join-Path $WorkLensDataDir "watchdog.lock"

# Clear lock file
if (Test-Path $LockFile) { Remove-Item $LockFile -Force -ErrorAction SilentlyContinue }

# Configure state with intentionalShutdown = $false
$state = @{
    execPath = "$PSScriptRoot\..\node_modules\electron\dist\electron.exe"
    appPath = (Resolve-Path "$PSScriptRoot\..").Path
    isPackaged = $false
    intentionalShutdown = $false
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
$state | ConvertTo-Json | Set-Content -Path $StateFile -Force

$psScript = "$PSScriptRoot\..\watchdog\worklens-watchdog.ps1"
$watchdogProc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$psScript`"" -PassThru

Write-Host "[Watchdog PID: $($watchdogProc.Id)] Started. Waiting 5s for steady state..."
Start-Sleep -Seconds 5

# Find running electron process for WorkLens
$elec = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*WorkLens*" -or $_.CommandLine -like "*main.js*" } | Select-Object -First 1

if ($elec) {
    Write-Host "[Simulation] Simulating Task Manager -> End Task on PID $($elec.ProcessId)..." -ForegroundColor Yellow
    # Stop-Process -Force calls Windows TerminateProcess (identical to Task Manager End Task)
    Stop-Process -Id $elec.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "[Simulation] Process $($elec.ProcessId) terminated via TerminateProcess." -ForegroundColor Yellow
} else {
    Write-Host "[Simulation] Note: No electron process currently running. Watchdog will detect and recover." -ForegroundColor Yellow
}

Write-Host "[Watchdog] Waiting 12 seconds for Watchdog to detect termination (grace period 5s + restart 4s)..."
Start-Sleep -Seconds 12

# Check log file for restart events
$todayStr = (Get-Date).ToString("yyyy-MM-dd")
$logFile = Join-Path $LogsDir "worklens-watchdog-$todayStr.log"
Write-Host "`n[Watchdog Log Output]:" -ForegroundColor Magenta
Get-Content $logFile -Tail 15 | ForEach-Object { Write-Host "   $_" }

# Cleanup watchdog
if ($watchdogProc -and -not $watchdogProc.HasExited) {
    Stop-Process -Id $watchdogProc.Id -Force -ErrorAction SilentlyContinue
}
if (Test-Path $LockFile) { Remove-Item $LockFile -Force -ErrorAction SilentlyContinue }

Write-Host "`n================ TEST COMPLETED ================" -ForegroundColor Cyan
