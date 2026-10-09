/**
 * WorkLens Watchdog / Auto-Recovery Monitor (Node.js engine)
 * 
 * Periodically verifies WorkLens process health and automatically recovers
 * the application if terminated unexpectedly (crash, kill, or Task Manager End Task).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');

const appDataDir = process.env.APPDATA || (process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Roaming')
  : path.join(os.homedir(), '.config'));

const workLensDataDir = path.join(appDataDir, 'WorkLens');
const logsDir = path.join(workLensDataDir, 'logs');
const stateFile = path.join(workLensDataDir, 'watchdog-state.json');
const lockFile = path.join(workLensDataDir, 'watchdog.lock');

if (!fs.existsSync(workLensDataDir)) {
  fs.mkdirSync(workLensDataDir, { recursive: true });
}
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function getFormattedDate(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function logWatchdog(message, level = 'INFO') {
  const todayStr = getFormattedDate();
  const logFile = path.join(logsDir, `worklens-watchdog-${todayStr}.log`);
  const now = new Date().toISOString();
  const line = `[${now}] [${level}] [Watchdog] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (_) {}
  console.log(`[${level}] ${message}`);
}

// Single instance check
try {
  if (fs.existsSync(lockFile)) {
    const existingPid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    if (existingPid && existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0);
        logWatchdog(`Another watchdog instance is already running (PID: ${existingPid}). Exiting.`, 'WARN');
        process.exit(0);
      } catch (_) {
        // PID does not exist, lock file is stale
      }
    }
  }
  fs.writeFileSync(lockFile, String(process.pid), 'utf8');
} catch (err) {
  logWatchdog(`Failed to acquire lock file: ${err.message}`, 'WARN');
}

process.on('exit', () => {
  try {
    if (fs.existsSync(lockFile)) {
      const pid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
      if (pid === process.pid) {
        fs.unlinkSync(lockFile);
      }
    }
  } catch (_) {}
});

function isWorkLensRunning() {
  return new Promise((resolve) => {
    // Check Tasklist for WorkLens.exe or electron running WorkLens
    exec('tasklist /FO CSV /NH', (err, stdout) => {
      if (err) return resolve(false);
      const lines = stdout.toLowerCase();
      if (lines.includes('"worklens.exe"')) {
        return resolve(true);
      }

      // In dev mode, check electron commandline
      exec('powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'electron.exe\'\\" | Select-Object -ExpandProperty CommandLine"', (cmdErr, cmdOut) => {
        if (!cmdErr && cmdOut) {
          const outLower = cmdOut.toLowerCase();
          if (outLower.includes('worklens') || outLower.includes('main.js')) {
            return resolve(true);
          }
        }
        resolve(false);
      });
    });
  });
}

function isIntentionalShutdown() {
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state && state.intentionalShutdown) {
        const diffSeconds = (Date.now() - (state.timestamp || 0)) / 1000;
        if (diffSeconds >= 0 && diffSeconds <= 300) {
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

function clearIntentionalShutdown() {
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      state.intentionalShutdown = false;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    }
  } catch (_) {}
}

function resolveWorkLensTarget() {
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state.execPath && fs.existsSync(state.execPath)) {
        if (!state.isPackaged && state.appPath) {
          return { file: state.execPath, args: [state.appPath, '--recovered'] };
        }
        return { file: state.execPath, args: ['--recovered'] };
      }
    }
  } catch (_) {}

  const relativeInstalledExe = path.resolve(__dirname, '..', '..', 'WorkLens.exe');
  if (fs.existsSync(relativeInstalledExe)) {
    return { file: relativeInstalledExe, args: ['--recovered'] };
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const installedExe = path.join(localAppData, 'Programs', 'worklens', 'WorkLens.exe');
  if (fs.existsSync(installedExe)) {
    return { file: installedExe, args: ['--recovered'] };
  }

  const unpackedExe = path.resolve(__dirname, '..', 'dist', 'win-unpacked', 'WorkLens.exe');
  if (fs.existsSync(unpackedExe)) {
    return { file: unpackedExe, args: ['--recovered'] };
  }

  const electronExe = path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const appRoot = path.resolve(__dirname, '..');
  if (fs.existsSync(electronExe)) {
    return { file: electronExe, args: [appRoot, '--recovered'] };
  }

  return null;
}

const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const GRACE_PERIOD_MS = 5000; // 5 seconds
const POLL_INTERVAL_MS = 3000; // 3 seconds

let restartTimestamps = [];
let wasRunningBefore = false;

logWatchdog('Watchdog started');

async function checkLoop() {
  try {
    const isRunning = await isWorkLensRunning();

    if (isRunning) {
      if (!wasRunningBefore) {
        logWatchdog('WorkLens process detected');
        wasRunningBefore = true;
        clearIntentionalShutdown();
      }
      return;
    }

    // WorkLens is NOT running
    if (wasRunningBefore) {
      wasRunningBefore = false;

      if (isIntentionalShutdown()) {
        logWatchdog('WorkLens intentional shutdown detected. Skipping restart.');
        return;
      }

      logWatchdog('WorkLens crash/termination detected', 'WARN');
      logWatchdog('Waiting grace period of 5 seconds...');
      await new Promise(r => setTimeout(r, GRACE_PERIOD_MS));

      // Re-check after grace period
      if (await isWorkLensRunning()) {
        logWatchdog('WorkLens detected running after grace period.');
        wasRunningBefore = true;
        return;
      }

      const now = Date.now();
      restartTimestamps = restartTimestamps.filter(t => (now - t) < RESTART_WINDOW_MS);

      if (restartTimestamps.length >= MAX_RESTARTS) {
        logWatchdog(`Restart limit reached (${MAX_RESTARTS} attempts within 5 minutes). Halting automatic restarts temporarily.`, 'ERROR');
        return;
      }

      const attemptNum = restartTimestamps.length + 1;
      logWatchdog(`Restart attempt #${attemptNum}`);
      restartTimestamps.push(now);

      const target = resolveWorkLensTarget();
      if (target) {
        const child = spawn(target.file, target.args, {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        await new Promise(r => setTimeout(r, 4000));
        if (await isWorkLensRunning()) {
          logWatchdog('WorkLens restarted successfully');
          wasRunningBefore = true;
        } else {
          logWatchdog('Watchdog error: WorkLens process not found after restart', 'ERROR');
        }
      } else {
        logWatchdog('Watchdog error: Could not resolve WorkLens executable target', 'ERROR');
      }
    } else {
      // WorkLens was not running on initial check or subsequent checks
      if (!isIntentionalShutdown()) {
        const now = Date.now();
        restartTimestamps = restartTimestamps.filter(t => (now - t) < RESTART_WINDOW_MS);

        if (restartTimestamps.length < MAX_RESTARTS) {
          const attemptNum = restartTimestamps.length + 1;
          logWatchdog('WorkLens process not detected');
          logWatchdog(`Restart attempt #${attemptNum}`);
          restartTimestamps.push(now);

          const target = resolveWorkLensTarget();
          if (target) {
            const child = spawn(target.file, target.args, {
              detached: true,
              stdio: 'ignore'
            });
            child.unref();

            await new Promise(r => setTimeout(r, 4000));
            if (await isWorkLensRunning()) {
              logWatchdog('WorkLens restarted successfully');
              wasRunningBefore = true;
            }
          }
        }
      }
    }
  } catch (err) {
    logWatchdog(`Watchdog error: ${err.message}`, 'ERROR');
  }
}

// Start polling loop
setInterval(checkLoop, POLL_INTERVAL_MS);
// Run first check immediately
checkLoop();
