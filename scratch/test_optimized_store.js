const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const realUserData = path.join(process.env.APPDATA, 'WorkLens');
app.setPath('userData', realUserData);

const queueFilePath = path.join(realUserData, 'activity_queue.jsonl');

function normalizeToLocalDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.length >= 10 && trimmed.charCodeAt(4) === 45 && trimmed.charCodeAt(7) === 45) {
      return trimmed.slice(0, 10);
    }
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymdMatch) return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
    const dmyMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const yyyy = parsed.getFullYear();
      const mm = String(parsed.getMonth() + 1).padStart(2, '0');
      const dd = String(parsed.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return null;
}

// Read and build indexed map
const rawContent = fs.readFileSync(queueFilePath, 'utf8');
const lines = rawContent.split('\n');
const chunks = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line) chunks.push(JSON.parse(line));
}

const dateIndex = new Map();
for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i];
  const dStr = normalizeToLocalDateStr(c.start_time || c.activity_on);
  if (dStr) {
    let list = dateIndex.get(dStr);
    if (!list) {
      list = [];
      dateIndex.set(dStr, list);
    }
    list.push(c);
  }
}

console.log(`Total indexed chunks: ${chunks.length}, unique dates: ${dateIndex.size}`);

// Benchmark indexed lookups
const user = os.userInfo().username;
const todayStr = '2026-10-22';
const yestStr = '2026-10-21';

const l7 = [];
for (let i = 0; i < 7; i++) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  l7.push(normalizeToLocalDateStr(d));
}

const l30 = [];
for (let i = 0; i < 30; i++) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  l30.push(normalizeToLocalDateStr(d));
}

const runs = 10;
const times = { today: [], yest: [], l7: [], l30: [] };

for (let r = 0; r < runs; r++) {
  // Today query
  const t0 = performance.now();
  const todayList = (dateIndex.get(todayStr) || []).filter(c => !c.user_id || c.user_id === 890);
  times.today.push(performance.now() - t0);

  // Yesterday query
  const t1 = performance.now();
  const yestList = (dateIndex.get(yestStr) || []).filter(c => !c.user_id || c.user_id === 890);
  times.yest.push(performance.now() - t1);

  // Last 7 days query
  const t2 = performance.now();
  const l7Durations = {};
  l7.forEach(ds => {
    l7Durations[ds] = 0;
    const clist = dateIndex.get(ds) || [];
    for (let j = 0; j < clist.length; j++) {
      if (clist[j].status && clist[j].status.toLowerCase() === 'active') {
        l7Durations[ds] += (clist[j].duration || 0);
      }
    }
  });
  times.l7.push(performance.now() - t2);

  // Last 30 days query
  const t3 = performance.now();
  const l30Durations = {};
  l30.forEach(ds => {
    l30Durations[ds] = 0;
    const clist = dateIndex.get(ds) || [];
    for (let j = 0; j < clist.length; j++) {
      if (clist[j].status && clist[j].status.toLowerCase() === 'active') {
        l30Durations[ds] += (clist[j].duration || 0);
      }
    }
  });
  times.l30.push(performance.now() - t3);
}

const avg = arr => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3);
console.log('\n================ OPTIMIZED QUERY BENCHMARK ================');
console.log(`Today query:        avg: ${avg(times.today)} ms`);
console.log(`Yesterday query:    avg: ${avg(times.yest)} ms`);
console.log(`Last 7 Days query:  avg: ${avg(times.l7)} ms`);
console.log(`Last 30 Days query: avg: ${avg(times.l30)} ms`);
console.log('===========================================================\n');

if (app) app.quit();
process.exit(0);
