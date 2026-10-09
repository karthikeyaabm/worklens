# WorkLens Watchdog / Auto-Recovery Monitor
# Ensures WorkLens remains continuously running and automatically restarts on crash or Task Manager termination.

param (
    [switch]$RunOnce,
    [string]$CustomTarget = ""
)

$ErrorActionPreference = "Continue"

# 1. Resolve Application and Data Directories
$AppData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ApplicationData)
$WorkLensDataDir = Join-Path $AppData "WorkLens"
$LogsDir = Join-Path $WorkLensDataDir "logs"
$StateFile = Join-Path $WorkLensDataDir "watchdog-state.json"
$LockFile = Join-Path $WorkLensDataDir "watchdog.lock"

if (-not (Test-Path $WorkLensDataDir)) {
    New-Item -ItemType Directory -Path $WorkLensDataDir -Force | Out-Null
}
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

# 2. Logging Function (matching WorkLens logger convention)
function Write-WatchdogLog {
    param (
        [string]$Message,
        [string]$Level = "INFO"
    )
    $todayStr = (Get-Date).ToString("yyyy-MM-dd")
    $logFile = Join-Path $LogsDir "worklens-watchdog-$todayStr.log"
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
    $logLine = "[$timestamp] [$Level] [Watchdog] $Message"

    try {
        Add-Content -Path $logFile -Value $logLine -Encoding UTF8
    } catch {}

    Write-Host $logLine
}

# 3. Log Cleanup (prune logs older than 7 days)
function Cleanup-OldLogs {
    try {
        $files = Get-ChildItem -Path $LogsDir -Filter "worklens-watchdog-*.log"
        $cutoff = (Get-Date).AddDays(-7)
        foreach ($f in $files) {
            if ($f.LastWriteTime -lt $cutoff) {
                Remove-Item -Path $f.FullName -Force -ErrorAction SilentlyContinue
                Write-WatchdogLog "Deleted old watchdog log: $($f.Name)" "INFO"
            }
        }
    } catch {}
}

# 4. Enforce Single Watchdog Instance
function Test-SingleWatchdogInstance {
    if (Test-Path $LockFile) {
        try {
            $lockPid = [int](Get-Content -Path $LockFile -Raw).Trim()
            if ($lockPid -and $lockPid -ne $PID) {
                $proc = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
                if ($proc -and ($proc.ProcessName -eq "powershell" -or $proc.ProcessName -eq "pwsh" -or $proc.ProcessName -eq "node")) {
                    Write-WatchdogLog "Another watchdog instance is already running (PID: $lockPid). Exiting." "WARN"
                    exit 0
                }
            }
        } catch {}
    }
    Set-Content -Path $LockFile -Value $PID -Force
}

# Clean lock file on exit
Register-EngineEvent -SourceIdentifier ([System.Guid]::NewGuid().ToString()) -EventName PowerShell.Exiting -Action {
    if (Test-Path $LockFile) {
        Remove-Item -Path $LockFile -Force -ErrorAction SilentlyContinue
    }
} | Out-Null

# 5. Native Windows Notification Helper
function Show-WindowsNotification {
    param (
        [string]$Title,
        [string]$Message,
        [string]$IconType = "Warning"
    )
    try {
        [System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null
        $icon = [System.Windows.Forms.MessageBoxIcon]::Information
        if ($IconType -eq "Warning") {
            $icon = [System.Windows.Forms.MessageBoxIcon]::Warning
        } elseif ($IconType -eq "Error") {
            $icon = [System.Windows.Forms.MessageBoxIcon]::Error
        }
        [System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null
    } catch {
        Write-WatchdogLog "Failed to show notification: $_" "WARN"
    }
}

# 6. Resolve WorkLens Executable Path
function Get-WorkLensTarget {
    # Check if a custom target was passed
    if ($CustomTarget -and (Test-Path $CustomTarget)) {
        return @{ Path = $CustomTarget; Arguments = "--recovered" }
    }

    # Check watchdog state file for last recorded path
    if (Test-Path $StateFile) {
        try {
            $stateContent = Get-Content -Path $StateFile -Raw | ConvertFrom-Json
            if ($stateContent.execPath -and (Test-Path $stateContent.execPath)) {
                $args = "--recovered"
                if ($stateContent.isPackaged -eq $false -and $stateContent.appPath) {
                    $args = "`"$($stateContent.appPath)`" --recovered"
                }
                return @{ Path = $stateContent.execPath; Arguments = $args }
            }
        } catch {}
    }

    # Check relative installed production path (when running from <installDir>\resources\watchdog)
    $relativeInstalledExe = Join-Path $PSScriptRoot "..\..\WorkLens.exe"
    if (Test-Path $relativeInstalledExe) {
        $resolved = (Resolve-Path $relativeInstalledExe).Path
        return @{ Path = $resolved; Arguments = "--recovered" }
    }

    # Check installed production path
    $localApp = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
    $installedExe = Join-Path $localApp "Programs\worklens\WorkLens.exe"
    if (Test-Path $installedExe) {
        return @{ Path = $installedExe; Arguments = "--recovered" }
    }

    # Check unpacked dist path
    $unpackedExe = Join-Path $PSScriptRoot "..\dist\win-unpacked\WorkLens.exe"
    if (Test-Path $unpackedExe) {
        $resolved = (Resolve-Path $unpackedExe).Path
        return @{ Path = $resolved; Arguments = "--recovered" }
    }

    # Check local development electron
    $electronExe = Join-Path $PSScriptRoot "..\node_modules\electron\dist\electron.exe"
    $appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    if (Test-Path $electronExe) {
        return @{ Path = $electronExe; Arguments = "`"$appRoot`" --recovered" }
    }

    return $null
}

# 7. Check if WorkLens process is currently running
function Test-IsWorkLensRunning {
    # 1. Check for WorkLens.exe
    $worklensProcs = Get-Process -Name "WorkLens" -ErrorAction SilentlyContinue
    if ($worklensProcs -and $worklensProcs.Count -gt 0) {
        return $true
    }

    # 2. Check for development electron process running WorkLens
    try {
        $electronProcs = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue
        if ($electronProcs) {
            foreach ($p in $electronProcs) {
                if ($p.CommandLine -and ($p.CommandLine -like "*WorkLens*" -or $p.CommandLine -like "*main.js*")) {
                    return $true
                }
            }
        }
    } catch {}

    return $false
}

# 8. Check if an intentional shutdown occurred
function Test-IsIntentionalShutdown {
    if (Test-Path $StateFile) {
        try {
            $state = Get-Content -Path $StateFile -Raw | ConvertFrom-Json
            if ($state -and $state.intentionalShutdown -eq $true) {
                # Consider it valid if timestamp is within the last 5 minutes
                $diffSeconds = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [int64]$state.timestamp) / 1000
                if ($diffSeconds -ge 0 -and $diffSeconds -le 300) {
                    return $true
                }
            }
        } catch {}
    }
    return $false
}

# 9. Clear intentional shutdown flag
function Clear-IntentionalShutdown {
    if (Test-Path $StateFile) {
        try {
            $state = Get-Content -Path $StateFile -Raw | ConvertFrom-Json
            if ($state) {
                $state.intentionalShutdown = $false
                $state | ConvertTo-Json | Set-Content -Path $StateFile -Force
            }
        } catch {}
    }
}

# ==========================================
# MAIN WATCHDOG SUPERVISION LOOP
# ==========================================

Test-SingleWatchdogInstance
Cleanup-OldLogs

Write-WatchdogLog "Watchdog started" "INFO"

# Restart loop protection: max 3 attempts within 5 minutes (300 seconds)
$MAX_RESTARTS = 3
$RESTART_WINDOW_SECONDS = 300
$GRACE_PERIOD_SECONDS = 5
$POLL_INTERVAL_SECONDS = 3

$restartTimestamps = [System.Collections.ArrayList]@()
$wasRunningBefore = $false
$lastStatusLogged = ""

# Initial check on startup
$initialRunning = Test-IsWorkLensRunning
if ($initialRunning) {
    $wasRunningBefore = $true
    Write-WatchdogLog "WorkLens process detected" "INFO"
} else {
    Write-WatchdogLog "WorkLens process not detected" "INFO"
    
    # Check if this is a fresh boot / login where WorkLens should start
    if (-not (Test-IsIntentionalShutdown)) {
        Write-WatchdogLog "Starting WorkLens on initial watchdog startup..." "INFO"
        $target = Get-WorkLensTarget
        if ($target) {
            Start-Process -FilePath $target.Path -ArgumentList $target.Arguments
            Start-Sleep -Seconds 3
            if (Test-IsWorkLensRunning) {
                $wasRunningBefore = $true
                Write-WatchdogLog "WorkLens restarted successfully" "INFO"
            } else {
                Write-WatchdogLog "Watchdog error: Initial launch failed to start WorkLens" "ERROR"
            }
        } else {
            Write-WatchdogLog "Watchdog error: Could not resolve WorkLens executable target" "ERROR"
        }
    } else {
        Write-WatchdogLog "WorkLens intentional shutdown flag present on startup. Awaiting manual user start." "INFO"
    }
}

while ($true) {
    Start-Sleep -Seconds $POLL_INTERVAL_SECONDS

    $isRunning = Test-IsWorkLensRunning

    if ($isRunning) {
        if (-not $wasRunningBefore) {
            Write-WatchdogLog "WorkLens process detected" "INFO"
            $wasRunningBefore = $true
            # Clear intentional shutdown flag once WorkLens is back up and running
            Clear-IntentionalShutdown
        }
        continue
    }

    # If we reach here, WorkLens is NOT running
    if ($wasRunningBefore) {
        # Transition from RUNNING -> NOT RUNNING
        $wasRunningBefore = $false

        # Check if this was an intentional shutdown (system reboot/shutdown, auto-update, or controlled exit)
        if (Test-IsIntentionalShutdown) {
            Write-WatchdogLog "WorkLens intentional shutdown detected. Skipping restart." "INFO"
            continue
        }

        # WorkLens stopped unexpectedly (Crash or Task Manager End Task)
        Write-WatchdogLog "WorkLens crash/termination detected" "WARN"

        # Grace period before restart
        Write-WatchdogLog "Waiting grace period of $GRACE_PERIOD_SECONDS seconds..." "INFO"
        Start-Sleep -Seconds $GRACE_PERIOD_SECONDS

        # Double check if user manually started it or if it recovered during grace period
        if (Test-IsWorkLensRunning) {
            Write-WatchdogLog "WorkLens detected running after grace period. Resuming normal monitoring." "INFO"
            $wasRunningBefore = $true
            continue
        }

        # Restart Loop Protection: Filter timestamps within the sliding window
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $validTimestamps = [System.Collections.ArrayList]@()
        foreach ($ts in $restartTimestamps) {
            if (($now - $ts) -lt $RESTART_WINDOW_SECONDS) {
                [void]$validTimestamps.Add($ts)
            }
        }
        $restartTimestamps = $validTimestamps

        if ($restartTimestamps.Count -ge $MAX_RESTARTS) {
            Write-WatchdogLog "Restart limit reached ($MAX_RESTARTS attempts within $($RESTART_WINDOW_SECONDS / 60) minutes). Halting automatic restarts temporarily." "ERROR"
            Show-WindowsNotification -Title "WorkLens Recovery Alert" -Message "WorkLens could not be started after multiple attempts.`nPlease contact support." -IconType "Warning"
            
            # Cooldown sleep for 60 seconds before resetting check
            Start-Sleep -Seconds 60
            continue
        }

        # Increment and log attempt
        $attemptNum = $restartTimestamps.Count + 1
        Write-WatchdogLog "Restart attempt #$attemptNum" "INFO"
        [void]$restartTimestamps.Add($now)

        # Resolve target and launch
        $target = Get-WorkLensTarget
        if ($target) {
            try {
                Write-WatchdogLog "Launching: $($target.Path) $($target.Arguments)" "INFO"
                Start-Process -FilePath $target.Path -ArgumentList $target.Arguments
                
                # Allow launch initialization
                Start-Sleep -Seconds 4

                if (Test-IsWorkLensRunning) {
                    Write-WatchdogLog "WorkLens restarted successfully" "INFO"
                    $wasRunningBefore = $true
                } else {
                    Write-WatchdogLog "Watchdog error: WorkLens process was not found after launch attempt" "ERROR"
                }
            } catch {
                Write-WatchdogLog "Watchdog error during launch: $_" "ERROR"
            }
        } else {
            Write-WatchdogLog "Watchdog error: Unable to determine WorkLens executable path" "ERROR"
        }
    } else {
        # WorkLens was already not running and is still not running
        # If not an intentional shutdown, attempt recovery if not at limit
        if (-not (Test-IsIntentionalShutdown)) {
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            $validTimestamps = [System.Collections.ArrayList]@()
            foreach ($ts in $restartTimestamps) {
                if (($now - $ts) -lt $RESTART_WINDOW_SECONDS) {
                    [void]$validTimestamps.Add($ts)
                }
            }
            $restartTimestamps = $validTimestamps

            if ($restartTimestamps.Count -lt $MAX_RESTARTS) {
                $attemptNum = $restartTimestamps.Count + 1
                Write-WatchdogLog "WorkLens process not detected. Triggering recovery." "INFO"
                Write-WatchdogLog "Restart attempt #$attemptNum" "INFO"
                [void]$restartTimestamps.Add($now)

                $target = Get-WorkLensTarget
                if ($target) {
                    try {
                        Start-Process -FilePath $target.Path -ArgumentList $target.Arguments
                        Start-Sleep -Seconds 4
                        if (Test-IsWorkLensRunning) {
                            Write-WatchdogLog "WorkLens restarted successfully" "INFO"
                            $wasRunningBefore = $true
                        } else {
                            Write-WatchdogLog "Watchdog error: Process not detected after restart" "ERROR"
                        }
                    } catch {
                        Write-WatchdogLog "Watchdog error: $_" "ERROR"
                    }
                }
            }
        }
    }
}
