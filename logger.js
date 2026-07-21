const path = require('path');
const fs = require('fs');
const log = require('electron-log');

// Logs location: %APPDATA%\WorkLens\logs
const appDataDir = process.env.APPDATA || (process.platform === 'win32'
  ? path.join(require('os').homedir(), 'AppData', 'Roaming')
  : path.join(require('os').homedir(), '.config'));

const logsDir = path.join(appDataDir, 'WorkLens', 'logs');

// Ensure log directory exists
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (err) {
  // Directory creation error handling
}

// Helper to format date in YYYY-MM-DD format using local time
function getFormattedDate(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 1. Configure level
log.transports.file.level = 'info';

// 2. Daily Log File resolution: worklens-YYYY-MM-DD.log
log.transports.file.resolvePathFn = () => {
  const todayStr = getFormattedDate();
  return path.join(logsDir, `worklens-${todayStr}.log`);
};

// 3. File Size Protection: 10 MB limit
log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB

log.transports.file.archiveLogFn = (file) => {
  const oldPath = file.path || file.toString();
  if (!oldPath || !fs.existsSync(oldPath)) return;
  const inf = path.parse(oldPath);
  let archivePath = path.join(inf.dir, `${inf.name}.old${inf.ext}`);
  let index = 1;
  while (fs.existsSync(archivePath)) {
    archivePath = path.join(inf.dir, `${inf.name}.${index}${inf.ext}`);
    index++;
  }
  try {
    fs.renameSync(oldPath, archivePath);
  } catch (err) {
    try {
      file.clear();
    } catch (_) {}
  }
};

// 4. Automatic Cleanup routine on startup
function cleanupOldLogs() {
  log.info('Cleanup started');
  try {
    if (!fs.existsSync(logsDir)) {
      log.info('Number of log files found: 0');
      log.info('Files deleted: 0');
      log.info('Files kept: 0');
      log.info('Cleanup completed');
      return;
    }

    const files = fs.readdirSync(logsDir);
    log.info(`Number of log files found: ${files.length}`);

    const todayStr = getFormattedDate();
    const todayPrefix = `worklens-${todayStr}`;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let deletedCount = 0;
    let keptCount = 0;

    for (const file of files) {
      // Ignore today's log file
      if (file.startsWith(todayPrefix)) {
        keptCount++;
        continue;
      }

      const filePath = path.join(logsDir, file);
      let isOlderThan7Days = false;

      // Extract date string from worklens-YYYY-MM-DD pattern
      const match = file.match(/^worklens-(\d{4}-\d{2}-\d{2})/);
      if (match) {
        const fileDateStr = match[1];
        const [year, month, day] = fileDateStr.split('-').map(Number);
        const fileDate = new Date(year, month - 1, day);
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);

        const diffDays = Math.floor((todayDate.getTime() - fileDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 7) {
          isOlderThan7Days = true;
        }
      } else {
        // Fallback for files without YYYY-MM-DD pattern
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > SEVEN_DAYS_MS) {
            isOlderThan7Days = true;
          }
        } catch (e) {
          // Skip if stat fails
        }
      }

      if (isOlderThan7Days) {
        try {
          fs.unlinkSync(filePath);
          deletedCount++;
          log.info(`Deleted old log: ${file}`);
        } catch (unlinkErr) {
          log.error(`Failed to delete old log: ${file}`, unlinkErr);
          keptCount++;
        }
      } else {
        keptCount++;
      }
    }

    log.info(`Files deleted: ${deletedCount}`);
    log.info(`Files kept: ${keptCount}`);
    log.info('Cleanup completed');
  } catch (err) {
    log.error('Log cleanup failed:', err);
  }
}

// Execute cleanup immediately on startup
cleanupOldLogs();

module.exports = log;
