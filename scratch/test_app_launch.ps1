$appExe = "C:\Users\karthikeya.kondavath\AppData\Local\Programs\worklens\WorkLens.exe"
if (-not (Test-Path $appExe)) {
    Write-Host "WorkLens.exe does not exist at $appExe"
    exit 1
}

Write-Host "Testing WorkLens.exe launch..."
$proc = Start-Process -FilePath $appExe -PassThru
Start-Sleep -Seconds 4

$isRunning = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
Write-Host "WorkLens started successfully: $([bool]$isRunning) (PID: $($proc.Id))"

# Check watchdog state file
$statePath = "$env:APPDATA\WorkLens\watchdog-state.json"
if (Test-Path $statePath) {
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    Write-Host "Watchdog state execPath: $($state.execPath)"
    Write-Host "Watchdog state intentionalShutdown: $($state.intentionalShutdown)"
}

# Stop test process
if ($isRunning) {
    Stop-Process -Id $proc.Id -Force
    Write-Host "Stopped test process."
}

Write-Host "Test complete."
