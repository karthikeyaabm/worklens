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

const categories = {
  powershell_or_cmd: /(powershell|cmd\.exe|wscript|taskkill|tasklist|wmic|reg\.exe|reg query|reg delete)/i,
  os_branching: /(process\.platform|win32|darwin|linux)/i,
  paths_and_env: /(%APPDATA%|process\.env\.APPDATA|LOCALAPPDATA|HKCU|Software\\Microsoft\\Windows)/i,
  native_dependencies: /(active-win|uiohook-napi|electron-builder)/i,
  watchdog: /(watchdog)/i,
  teams_meeting: /(teams|meeting|audio|AudioDeviceCmdlets)/i,
  icon_extraction: /(icon|extractIcon|Get-Process)/i
};

const results = {};
Object.keys(categories).forEach(k => results[k] = []);

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    Object.keys(categories).forEach(cat => {
      if (categories[cat].test(line)) {
        results[cat].push(`${f}:${idx + 1}: ${line.trim()}`);
      }
    });
  });
});

Object.keys(results).forEach(cat => {
  console.log(`\n========================================`);
  console.log(`CATEGORY: ${cat} (Total: ${results[cat].length})`);
  console.log(`========================================`);
  results[cat].slice(0, 30).forEach(m => console.log(m));
  if (results[cat].length > 30) {
    console.log(`... and ${results[cat].length - 30} more`);
  }
});
