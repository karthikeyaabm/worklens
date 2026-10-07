param([string]$FilePath)

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $FilePath))
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

if ($text -match '<requestedExecutionLevel\s+level="([^"]+)"') {
    Write-Host "File: $FilePath -> requestedExecutionLevel: $($matches[1])"
} else {
    Write-Host "File: $FilePath -> No requestedExecutionLevel found in UTF-8"
}
