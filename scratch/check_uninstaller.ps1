$paths = @(
    "C:\Users\karthikeya.kondavath\AppData\Local\Programs\worklens\Uninstall WorkLens.exe",
    "dist\WorkLens-Setup-1.1.7.__uninstaller.exe"
)

foreach ($exePath in $paths) {
    if (-not (Test-Path $exePath)) {
        Write-Host "File not found: $exePath"
        continue
    }
    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $exePath))
    $textUni = [System.Text.Encoding]::Unicode.GetString($bytes)
    $textAscii = [System.Text.Encoding]::ASCII.GetString($bytes)

    $hasUac = ($textUni.Contains("UAC") -or $textAscii.Contains("UAC"))
    $hasWatchdog = ($textUni.Contains("WorkLensWatchdog") -or $textAscii.Contains("WorkLensWatchdog"))
    $hasExedir = ($textUni.Contains("WorkLens.exe") -or $textAscii.Contains("WorkLens.exe"))
    $hasNsis = ($textUni.Contains("Nullsoft") -or $textAscii.Contains("Nullsoft"))

    Write-Host "Uninstaller binary analysis for: $exePath"
    Write-Host " - Size: $($bytes.Length) bytes"
    Write-Host " - Is NSIS binary: $hasNsis"
    Write-Host " - Contains UAC: $hasUac"
    Write-Host " - Contains WorkLensWatchdog: $hasWatchdog"
    Write-Host " - Contains WorkLens.exe: $hasExedir"
}

$bytes = [System.IO.File]::ReadAllBytes($exePath)
$textUni = [System.Text.Encoding]::Unicode.GetString($bytes)
$textAscii = [System.Text.Encoding]::ASCII.GetString($bytes)

$hasUac = ($textUni.Contains("UAC") -or $textAscii.Contains("UAC"))
$hasWatchdog = ($textUni.Contains("WorkLensWatchdog") -or $textAscii.Contains("WorkLensWatchdog"))
$hasExedir = ($textUni.Contains("WorkLens.exe") -or $textAscii.Contains("WorkLens.exe"))

Write-Host "Uninstaller binary analysis:"
Write-Host " - Path: $exePath"
Write-Host " - Size: $($bytes.Length) bytes"
Write-Host " - Contains UAC plugin/routines: $hasUac"
Write-Host " - Contains WorkLensWatchdog cleanup: $hasWatchdog"
Write-Host " - Contains WorkLens.exe validation: $hasExedir"
