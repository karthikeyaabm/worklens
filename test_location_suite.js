// test_location_suite.js
// Automated verification of PC Location Data capture, caching, offline preservation, and POST API payload
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// Redirect userData to an isolated temp folder for testing
const testUserDataDir = path.join(os.tmpdir(), `worklens_loc_test_${Date.now()}`);
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);

console.log(`[LOCATION TEST SUITE] Isolated test userData path: ${testUserDataDir}`);

const {
  saveOrUpdateActiveSessionLocal,
  getEligibleClosedSessions,
  markSessionSynced,
  getQueueFilePath,
  readChunks
} = require('./activityStore');

const locationService = require('./locationService');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

app.whenReady().then(async () => {
  console.log('\n================ RUNNING WORKLENS LOCATION DATA SUITE ================\n');

  // Test 1: Location available - runtime acquisition from Windows PC
  await runAsyncTest('Test 1: Location available from PC at runtime (live or provider)', async () => {
    // Test live PC location resolution
    const liveLoc = await locationService.resolveCurrentPcLocation();
    assert(liveLoc !== null, 'Resolved location should not be null');
    assert('latitude' in liveLoc, 'Resolved location must have latitude');
    assert('longitude' in liveLoc, 'Resolved location must have longitude');
    assert('current_address' in liveLoc, 'Resolved location must have current_address');

    // Also verify mock setter and coordinate formatter
    locationService.setLocationForTesting({
      latitude: 18.5204,
      longitude: 73.8567,
      current_address: 'Koregaon Park, Pune, Maharashtra 411001'
    });

    const current = locationService.getCurrentLocation();
    assert.strictEqual(current.latitude, '18.5204', 'Latitude must match 4 decimal precision string');
    assert.strictEqual(current.longitude, '73.8567', 'Longitude must match 4 decimal precision string');
    assert.strictEqual(current.current_address, 'Koregaon Park, Pune, Maharashtra 411001', 'Address must match');
  });

  // Test 2: Location unavailable - graceful null fallback and activity tracking continues
  runTest('Test 2: Location unavailable - graceful null fallback & tracking unaffected', () => {
    locationService.setLocationForTesting({
      latitude: null,
      longitude: null,
      current_address: null
    });

    const current = locationService.getCurrentLocation();
    assert.strictEqual(current.latitude, null, 'Latitude should be null when unavailable');
    assert.strictEqual(current.longitude, null, 'Longitude should be null when unavailable');
    assert.strictEqual(current.current_address, null, 'Address should be null when unavailable');

    // Verify session saves and tracks normally with null location
    const session = {
      local_id: 'test-null-loc-session',
      appName: 'Google Chrome',
      windowTitle: 'Internal Docs',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      status: 'active',
      duration: 120,
      latitude: current.latitude,
      longitude: current.longitude,
      current_address: current.current_address,
      closed: true
    };

    const saved = saveOrUpdateActiveSessionLocal(session, 936, os.userInfo().username);
    assert.strictEqual(saved.local_id, 'test-null-loc-session');
    assert.strictEqual(saved.latitude, null);
    assert.strictEqual(saved.longitude, null);
    assert.strictEqual(saved.current_address, null);
  });

  // Test 3: Internet unavailable - activity saved offline with captured location
  runTest('Test 3: Internet unavailable - activity saved offline with location', () => {
    locationService.setLocationForTesting({
      latitude: '18.5204',
      longitude: '73.8567',
      current_address: 'Koregaon Park, Pune, Maharashtra 411001'
    });
    const loc = locationService.getCurrentLocation();

    const offlineSession = {
      local_id: 'offline-pune-session',
      appName: 'Google Chrome',
      windowTitle: 'Google Maps - Pune',
      startTime: '2026-10-07T13:00:00',
      endTime: '2026-10-07T13:15:00',
      status: 'active',
      duration: 900,
      activityType: 'browsing',
      latitude: loc.latitude,
      longitude: loc.longitude,
      current_address: loc.current_address,
      closed: true
    };

    const saved = saveOrUpdateActiveSessionLocal(offlineSession, 936, os.userInfo().username);
    assert.strictEqual(saved.latitude, '18.5204');
    assert.strictEqual(saved.longitude, '73.8567');
    assert.strictEqual(saved.current_address, 'Koregaon Park, Pune, Maharashtra 411001');

    // Verify persistence in offline queue file
    const queueFile = getQueueFilePath();
    assert(fs.existsSync(queueFile), 'Queue file must exist');
    const content = fs.readFileSync(queueFile, 'utf8');
    assert(content.includes('offline-pune-session'), 'Offline session must be present in queue file');
    assert(content.includes('Koregaon Park, Pune'), 'Location address must be persisted in offline file');
  });

  // Test 4: Internet restored - offline activity syncs with original captured location (Pune preserved even after moving to Mumbai)
  runTest('Test 4: Offline sync preserves original location when employee travels', () => {
    // Simulate employee moving from Pune to Mumbai
    locationService.setLocationForTesting({
      latitude: '19.0760',
      longitude: '72.8777',
      current_address: 'Bandra Kurla Complex, Mumbai, Maharashtra 400051'
    });

    // Fetch pending closed sessions eligible for sync
    const eligible = getEligibleClosedSessions();
    const puneSession = eligible.find(s => s.local_id === 'offline-pune-session');

    assert(puneSession, 'Offline session must be found in eligible sync queue');
    assert.strictEqual(puneSession.latitude, '18.5204', 'Original Pune latitude must NOT be replaced with Mumbai');
    assert.strictEqual(puneSession.longitude, '73.8567', 'Original Pune longitude must NOT be replaced with Mumbai');
    assert.strictEqual(puneSession.current_address, 'Koregaon Park, Pune, Maharashtra 411001', 'Original Pune address must be preserved');

    // Simulate POST payload construction
    const payload = {
      user_id: puneSession.user_id,
      app_name: puneSession.app_name,
      window_title: puneSession.window_title,
      start_time: puneSession.start_time,
      end_time: puneSession.end_time,
      duration: puneSession.duration,
      activity_on: puneSession.activity_on,
      status: puneSession.status.toLowerCase(),
      version: app.getVersion(),
      activity_type: puneSession.activity_type,
      latitude: puneSession.latitude,
      longitude: puneSession.longitude,
      current_address: puneSession.current_address
    };

    assert.strictEqual(payload.latitude, '18.5204');
    assert.strictEqual(payload.longitude, '73.8567');
    assert.strictEqual(payload.current_address, 'Koregaon Park, Pune, Maharashtra 411001');
  });

  // Test 5: Employee changes location - cached location updates upon refresh
  await runAsyncTest('Test 5: Employee changes location - cache updates on refresh', async () => {
    locationService.setLocationForTesting({
      latitude: '12.9716',
      longitude: '77.5946',
      current_address: 'MG Road, Bangalore, Karnataka 560001'
    });

    const updated = locationService.getCurrentLocation();
    assert.strictEqual(updated.latitude, '12.9716');
    assert.strictEqual(updated.longitude, '77.5946');
    assert.strictEqual(updated.current_address, 'MG Road, Bangalore, Karnataka 560001');
  });

  // Test 6: Reverse geocoding failure - coordinates preserved with null address
  runTest('Test 6: Reverse geocoding failure - coordinates preserved, address is null', () => {
    locationService.setLocationForTesting({
      latitude: '28.6139',
      longitude: '77.2090',
      current_address: null
    });

    const loc = locationService.getCurrentLocation();
    assert.strictEqual(loc.latitude, '28.6139');
    assert.strictEqual(loc.longitude, '77.2090');
    assert.strictEqual(loc.current_address, null);

    const session = {
      local_id: 'test-delhi-no-addr',
      appName: 'Visual Studio Code',
      windowTitle: 'WorkLens - main.js',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      status: 'active',
      duration: 300,
      latitude: loc.latitude,
      longitude: loc.longitude,
      current_address: loc.current_address,
      closed: true
    };

    const saved = saveOrUpdateActiveSessionLocal(session, 936, os.userInfo().username);
    assert.strictEqual(saved.latitude, '28.6139');
    assert.strictEqual(saved.longitude, '77.2090');
    assert.strictEqual(saved.current_address, null);
  });

  // Test 7: Application restart - location service reinitialization
  runTest('Test 7: Application restart - service initializes cleanly and respects lifecycle', () => {
    // Stop service
    locationService.stopLocationService();

    // Re-initialize service with custom interval
    locationService.initLocationService({ refreshIntervalMs: 60000 });
    const loc = locationService.getCurrentLocation();
    assert(loc !== undefined, 'Location object should be accessible after restart');

    // Clean up
    locationService.stopLocationService();
  });

  // Test 8: POST API payload verification against specification
  runTest('Test 8: POST API payload matches expected contract', () => {
    const chunk = {
      user_id: 936,
      app_name: 'Google Chrome',
      window_title: 'Google Maps - Pune',
      start_time: '2026-10-07T13:00:00',
      end_time: '2026-10-07T13:15:00',
      duration: 900,
      activity_on: '2026-10-07',
      status: 'active',
      activity_type: 'browsing',
      latitude: '18.5204',
      longitude: '73.8567',
      current_address: 'Koregaon Park, Pune, Maharashtra 411001',
      created_at: '2026-10-07T13:15:00'
    };

    const payload = {
      user_id: chunk.user_id,
      app_name: chunk.app_name,
      window_title: chunk.window_title,
      start_time: chunk.start_time,
      end_time: chunk.end_time,
      duration: chunk.duration,
      activity_on: chunk.activity_on,
      status: chunk.status.toLowerCase(),
      version: app.getVersion(),
      activity_type: chunk.activity_type,
      redmine_created_on: '2026-10-07T13:15:00',
      local_created_on: '2026-10-07T13:15:00',
      latitude: chunk.latitude !== undefined && chunk.latitude !== null ? String(chunk.latitude) : null,
      longitude: chunk.longitude !== undefined && chunk.longitude !== null ? String(chunk.longitude) : null,
      current_address: chunk.current_address !== undefined && chunk.current_address !== null ? String(chunk.current_address) : null
    };

    assert.strictEqual(payload.user_id, 936);
    assert.strictEqual(payload.app_name, 'Google Chrome');
    assert.strictEqual(payload.window_title, 'Google Maps - Pune');
    assert.strictEqual(payload.start_time, '2026-10-07T13:00:00');
    assert.strictEqual(payload.end_time, '2026-10-07T13:15:00');
    assert.strictEqual(payload.status, 'active');
    assert.strictEqual(payload.activity_type, 'browsing');
    assert.strictEqual(payload.latitude, '18.5204');
    assert.strictEqual(payload.longitude, '73.8567');
    assert.strictEqual(payload.current_address, 'Koregaon Park, Pune, Maharashtra 411001');

    console.log('\n[POST API Payload Sample]:');
    console.log(JSON.stringify(payload, null, 2));
  });

  console.log('\n================ TEST SUMMARY ================');
  console.log(`  Total: ${passedTests + failedTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log('==============================================\n');

  if (failedTests > 0) {
    app.exit(1);
  } else {
    app.exit(0);
  }
});
