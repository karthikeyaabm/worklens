# Test script: verify that uninstaller aborts cleanly when elevation is cancelled or not granted
$appDir = "C:\Users\karthikeya.kondavath\AppData\Local\Programs\worklens"
$exePath = Join-Path $appDir "WorkLens.exe"
$uninstPath = Join-Path $appDir "Uninstall WorkLens.exe"
$queuePath = "$env:APPDATA\WorkLens\activity_queue.jsonl"
$profilePath = "$env:APPDATA\WorkLens\user_profile.json"

Write-Host "=========================================="
Write-Host "WorkLens Uninstall Guard Verification Test"
Write-Host "=========================================="

# 1. Pre-state check
$appExistsBefore = Test-Path $exePath
$uninstExistsBefore = Test-Path $uninstPath
$queueLengthBefore = (Get-Item $queuePath).Length
$profileLengthBefore = (Get-Item $profilePath).Length

Write-Host "[Pre-Check]"
Write-Host " - WorkLens.exe exists: $appExistsBefore"
Write-Host " - Uninstall WorkLens.exe exists: $uninstExistsBefore"
Write-Host " - activity_queue.jsonl size: $queueLengthBefore bytes"
Write-Host " - user_profile.json size: $profileLengthBefore bytes"

# Check registry
$regBefore = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like '*WorkLens*' }
Write-Host " - HKCU Uninstall entry exists: $([bool]$regBefore)"
Write-Host " - DisplayVersion: $($regBefore.DisplayVersion)"

Write-Host ""
Write-Host "[Testing Uninstaller Launch without elevation]"
$proc = Start-Process -FilePath $uninstPath -ArgumentList "/currentuser", "/S" -PassThru
Start-Sleep -Seconds 2
$running = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
Write-Host "Uninstaller process running: $([bool]$running) (PID: $($proc.Id))"

if ($running) {
    Write-Host "Process is waiting (e.g. for UAC or elevation). Terminating test process..."
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Seconds 1
} else {
    Write-Host "Process completed/exited with exit code: $($proc.ExitCode)"
}

# Post-Check: verify application files and registry are 100% intact
Write-Host ""
Write-Host "[Post-Check after uninstaller run]"
$appExistsAfter = Test-Path $exePath
$uninstExistsAfter = Test-Path $uninstPath
$queueLengthAfter = (Get-Item $queuePath).Length
$profileLengthAfter = (Get-Item $profilePath).Length
$regAfter = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like '*WorkLens*' }

Write-Host " - WorkLens.exe still exists: $appExistsAfter"
Write-Host " - Uninstall WorkLens.exe still exists: $uninstExistsAfter"
Write-Host " - activity_queue.jsonl size: $queueLengthAfter bytes (preserved: $($queueLengthBefore -eq $queueLengthAfter))"
Write-Host " - user_profile.json size: $profileLengthAfter bytes (preserved: $($profileLengthBefore -eq $profileLengthAfter))"
Write-Host " - HKCU Uninstall entry exists: $([bool]$regAfter)"
Write-Host "=========================================="
