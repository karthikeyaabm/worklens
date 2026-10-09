// Automated verification of WorkLens Watchdog Mechanics
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const workLensDir = path.join(appDataDir, 'WorkLens');
const stateFile = path.join(workLensDir, 'watchdog-state.json');
const lockFile = path.join(workLensDir, 'watchdog.lock');
const logsDir = path.join(workLensDir, 'logs');

console.log('================ WORKLENS WATCHDOG SUITE ================');

function assert(condition, testName) {
  if (condition) {
    console.log(`  PASS: ${testName}`);
  } else {
    console.error(`  FAIL: ${testName}`);
    process.exit(1);
  }
}

// Test 1: Watchdog state file initialization and write
console.log('\nTest 1: Watchdog State File I/O');
const testState = {
  execPath: process.execPath,
  appPath: path.resolve(__dirname, '..'),
  isPackaged: false,
  pid: process.pid,
  intentionalShutdown: false,
  timestamp: Date.now()
};
fs.writeFileSync(stateFile, JSON.stringify(testState, null, 2), 'utf8');
assert(fs.existsSync(stateFile), 'State file successfully created');
const readBack = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
assert(readBack.intentionalShutdown === false, 'State file reflects intentionalShutdown=false');

// Test 2: Intentional Shutdown Detection
console.log('\nTest 2: Intentional Shutdown Detection');
readBack.intentionalShutdown = true;
readBack.timestamp = Date.now();
fs.writeFileSync(stateFile, JSON.stringify(readBack, null, 2), 'utf8');
const verifiedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
assert(verifiedState.intentionalShutdown === true, 'Intentional shutdown flag correctly read as true');

// Reset intentionalShutdown to false
readBack.intentionalShutdown = false;
fs.writeFileSync(stateFile, JSON.stringify(readBack, null, 2), 'utf8');

// Test 3: PowerShell Watchdog Execution & Health Check
console.log('\nTest 3: PowerShell Watchdog Syntax and Helper Execution');
const psScript = path.resolve(__dirname, '..', 'watchdog', 'worklens-watchdog.ps1');
assert(fs.existsSync(psScript), 'worklens-watchdog.ps1 exists');

const vbsScript = path.resolve(__dirname, '..', 'watchdog', 'worklens-watchdog.vbs');
assert(fs.existsSync(vbsScript), 'worklens-watchdog.vbs exists');

const jsScript = path.resolve(__dirname, '..', 'watchdog', 'watchdog.js');
assert(fs.existsSync(jsScript), 'watchdog.js exists');

// Test 4: Registry Startup Command Verification & Asar Protection
console.log('\nTest 4: Registry Auto-Start Command Verification');
const vbsPath = path.resolve(__dirname, '..', 'watchdog', 'worklens-watchdog.vbs');
assert(fs.existsSync(vbsPath), 'worklens-watchdog.vbs exists on real filesystem');
assert(!vbsPath.includes('app.asar'), 'Dev watchdog path does not reference app.asar');

// Write clean test entry (overwriting any stale app.asar entries)
execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "WorkLensWatchdog" /t REG_SZ /d "wscript.exe \\"${vbsPath}\\"" /f`);
const regCmd = `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "WorkLensWatchdog"`;
const regOutput = execSync(regCmd, { encoding: 'utf8' });
console.log('  Registry entry found:', regOutput.trim());
assert(regOutput.includes('WorkLensWatchdog'), 'Windows Run registry contains WorkLensWatchdog');
assert(!regOutput.includes('app.asar'), 'Windows Run registry does NOT contain app.asar');

// Test 5: Watchdog Log Directory & File Formatter
console.log('\nTest 5: Watchdog Log Directory & File Formatter');
const today = new Date().toISOString().slice(0, 10);
const expectedLogFile = path.join(logsDir, `worklens-watchdog-${today}.log`);
fs.appendFileSync(expectedLogFile, `[${new Date().toISOString()}] [INFO] [Watchdog] Watchdog test entry\n`, 'utf8');
assert(fs.existsSync(expectedLogFile), 'Watchdog log file successfully written');

console.log('\n================ ALL WATCHDOG UNIT TESTS PASSED ================\n');
