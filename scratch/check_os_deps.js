const fs = require('fs');
const path = require('path');

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    if (file === 'node_modules' || file === 'dist' || file === '.git' || file === '.system_generated') return;
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFiles(fullPath));
      } else if (/\.(js|json|ps1|vbs|sh|nsh|bat)$/i.test(file)) {
        results.push(fullPath);
      }
    } catch (e) {}
  });
  return results;
}

const files = getFiles('.');
console.log('Total files found:', files.length);

const patterns = [
  { name: 'win32', re: /win32/i },
  { name: 'darwin', re: /darwin/i },
  { name: 'linux', re: /linux/i },
  { name: 'powershell', re: /powershell/i },
  { name: 'cmd_task', re: /(cmd\.exe|taskkill|tasklist|wmic|reg\.exe)/i },
  { name: 'watchdog', re: /(worklens-watchdog|watchdog)/i },
  { name: 'vbs_ps1', re: /\.(vbs|ps1|bat|sh)/i },
  { name: 'appdata', re: /(AppData|LOCALAPPDATA|APPDATA)/i },
  { name: 'native_deps', re: /(uiohook-napi|active-win)/i }
];

const matches = [];
files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    patterns.forEach(p => {
      if (p.re.test(line)) {
        matches.push(`[${p.name}] ${f}:${idx + 1}: ${line.trim().slice(0, 130)}`);
      }
    });
  });
});

console.log(`Total pattern matches: ${matches.length}`);
// Print first 60 matches
matches.slice(0, 80).forEach(m => console.log(m));
