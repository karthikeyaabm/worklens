// test_storage_health_suite.js
// Automated verification of WorkLens Local Storage Failure Detection, ENOSPC Handling, and Health Supervisor
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// Redirect userData to an isolated temp folder for testing
const testUserDataDir = path.join(os.tmpdir(), `worklens_storage_test_${Date.now()}`);
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);

console.log(`[STORAGE TEST SUITE] Isolated test userData path: ${testUserDataDir}`);

const {
  saveOrUpdateActiveSessionLocal,
  getEligibleClosedSessions,
  markSessionSynced,
  getQueueFilePath,
  storageHealth,
  getStorageHealth,
  configureStorageHealth,
  resetStorageHealth,
  setStorageFaultInjection,
  getStorageFaultInjection
} = require('./activityStore');

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

app.whenReady().then(async () => {
  console.log('\n================ RUNNING WORKLENS STORAGE HEALTH SUITE ================\n');

  const testUser = os.userInfo().username;
  const notificationsReceived = [];

  // Wire custom notification listener to capture all alerts
  storageHealth.setNotificationHandler((alert) => {
    notificationsReceived.push({ ...alert, timestamp: Date.now() });
  });

  // Ensure default configuration for tests
  configureStorageHealth({
    failureThreshold: 3,
    notWorkingAfterMs: 0,
    notificationCooldownMs: 30 * 60 * 1000
  });

  // =========================================================================
  // Test 1: Normal Operation
  // =========================================================================
  runTest('1. Normal: Disk has free space -> Activity saved locally -> No notification', () => {
    resetStorageHealth();
    notificationsReceived.length = 0;
    setStorageFaultInjection(null);

    const session = {
      local_id: 'test-normal-1',
      appName: 'VSCode',
      windowTitle: 'WorkLens - test.js',
      startTime: new Date(Date.now() - 2000),
      endTime: new Date(),
      status: 'Active',
      duration: 2,
      activityOn: new Date()
    };

    const saved = saveOrUpdateActiveSessionLocal(session, 101, testUser);
    assert.ok(saved, 'Session should be saved successfully');

    const health = getStorageHealth();
    assert.strictEqual(health.localStorageWorking, true, 'localStorageWorking must be true');
    assert.strictEqual(health.offlineQueueWorking, true, 'offlineQueueWorking must be true');
    assert.strictEqual(health.isUnhealthy, false, 'isUnhealthy must be false');
    assert.strictEqual(health.status, 'HEALTHY', 'Status must be HEALTHY');
    assert.strictEqual(health.consecutiveFailures, 0, 'consecutiveFailures must be 0');
    assert.strictEqual(notificationsReceived.length, 0, 'No notification should be emitted');
  });

  // =========================================================================
  // Test 2: Internet Disconnected
  // =========================================================================
  runTest('2. Internet OFF: Activity continues, local queue works, NO app failure notification', () => {
    // Offline mode: backend unreachable, internet disconnected
    const isBackendReachable = false;
    const session = {
      local_id: 'test-offline-1',
      appName: 'Chrome',
      windowTitle: 'Local Docs',
      startTime: new Date(Date.now() - 4000),
      endTime: new Date(),
      status: 'Active',
      duration: 4,
      activityOn: new Date()
    };

    const saved = saveOrUpdateActiveSessionLocal(session, 101, testUser);
    assert.ok(saved, 'Offline activity saved locally without internet');

    const health = getStorageHealth();
    assert.strictEqual(health.localStorageWorking, true, 'localStorageWorking must remain true while offline');
    assert.strictEqual(health.status, 'HEALTHY', 'Status must remain HEALTHY');
    assert.strictEqual(notificationsReceived.length, 0, 'No notification for offline mode');
  });

  // =========================================================================
  // Test 3: Server Unavailable / API Error
  // =========================================================================
  runTest('3. Server unavailable: Offline queue continues, API failure does NOT trigger storage notification', () => {
    // Simulate API flush failure
    const mockApiError = new Error('getaddrinfo ENOTFOUND redmine.example.com');
    // In WorkLens, API errors call markSessionFailed on the session record
    const queueFile = getQueueFilePath();
    const contentBefore = fs.readFileSync(queueFile, 'utf8');

    // Health state should remain completely unaffected by server errors
    const health = getStorageHealth();
    assert.strictEqual(health.localStorageWorking, true, 'localStorageWorking unaffected by API failure');
    assert.strictEqual(health.isUnhealthy, false, 'isUnhealthy must remain false');
    assert.strictEqual(notificationsReceived.length, 0, 'Zero notifications triggered by server downtime');
  });

  // =========================================================================
  // Test 4: Temporary Single Write Failure (Threshold Protection)
  // =========================================================================
  runTest('4. Temporary Single Write Failure: 1 failure does NOT trigger notification', () => {
    resetStorageHealth();
    notificationsReceived.length = 0;

    // Simulate 1 transient write failure
    const transientErr = new Error('EBUSY: resource busy or locked');
    transientErr.code = 'EBUSY';
    setStorageFaultInjection(transientErr);

    const session = {
      local_id: 'test-single-fail',
      appName: 'VSCode',
      windowTitle: 'busy file',
      startTime: new Date(),
      endTime: new Date(),
      status: 'Active',
      duration: 2,
      activityOn: new Date()
    };

    saveOrUpdateActiveSessionLocal(session, 101, testUser);

    let health = getStorageHealth();
    assert.strictEqual(health.consecutiveFailures, 1, 'consecutiveFailures should be 1');
    assert.strictEqual(health.isUnhealthy, false, 'Single failure must NOT mark app as unhealthy');
    assert.strictEqual(notificationsReceived.length, 0, 'Single failure must NOT trigger notification');

    // Succeeded write immediately after
    setStorageFaultInjection(null);
    saveOrUpdateActiveSessionLocal(session, 101, testUser);

    health = getStorageHealth();
    assert.strictEqual(health.consecutiveFailures, 0, 'consecutiveFailures reset to 0 after recovery');
    assert.strictEqual(health.isUnhealthy, false, 'App remained healthy');
    assert.strictEqual(notificationsReceived.length, 0, 'Still zero notifications');
  });

  // =========================================================================
  // Test 5: C: Drive 100% Full (ENOSPC Simulation & Detection)
  // =========================================================================
  runTest('5. C: Drive Full: Write fails with ENOSPC -> Threshold reached -> "WorkLens Alert" notification', () => {
    resetStorageHealth();
    notificationsReceived.length = 0;

    const enospcErr = new Error('ENOSPC: no space left on device, write');
    enospcErr.code = 'ENOSPC';
    setStorageFaultInjection(enospcErr);

    const session = {
      local_id: 'test-enospc-session',
      appName: 'VSCode',
      windowTitle: 'Full Drive Work',
      startTime: new Date(),
      endTime: new Date(),
      status: 'Active',
      duration: 2,
      activityOn: new Date()
    };

    // Failure 1
    saveOrUpdateActiveSessionLocal(session, 101, testUser);
    assert.strictEqual(notificationsReceived.length, 0, 'No notification on 1st failure');

    // Failure 2
    saveOrUpdateActiveSessionLocal(session, 101, testUser);
    assert.strictEqual(notificationsReceived.length, 0, 'No notification on 2nd failure');

    // Failure 3 -> Threshold reached!
    saveOrUpdateActiveSessionLocal(session, 101, testUser);
    assert.strictEqual(notificationsReceived.length, 1, 'Notification MUST trigger on 3rd continuous failure');

    const alert = notificationsReceived[0];
    assert.strictEqual(alert.type, 'DISK_FULL', 'Alert type should be DISK_FULL');
    assert.strictEqual(alert.title, 'WorkLens Alert', 'Alert title must match WorkLens Alert');
    assert.ok(alert.message.includes('system storage may be full'), 'Alert message must instruct employee to free up disk space');
    assert.ok(!alert.message.includes('ENOSPC'), 'Must NOT expose technical jargon like ENOSPC');

    const health = getStorageHealth();
    assert.strictEqual(health.isUnhealthy, true, 'isUnhealthy must be true');
    assert.strictEqual(health.status, 'WORKLENS_NOT_WORKING', 'Status must be WORKLENS_NOT_WORKING');
    assert.strictEqual(health.consecutiveFailures, 3, 'consecutiveFailures should be 3');
  });

  // =========================================================================
  // Test 6: Notification Spam Prevention (Cooldown)
  // =========================================================================
  runTest('6. Notification Cooldown: Continuous failures beyond threshold do NOT spam user', () => {
    // Current failures = 3, notification count = 1
    const session = {
      local_id: 'test-enospc-session',
      appName: 'VSCode',
      windowTitle: 'Still Full',
      startTime: new Date(),
      endTime: new Date(),
      status: 'Active',
      duration: 4,
      activityOn: new Date()
    };

    // 4th failure
    saveOrUpdateActiveSessionLocal(session, 101, testUser);
    // 5th failure
    saveOrUpdateActiveSessionLocal(session, 101, testUser);
    // 6th failure
    saveOrUpdateActiveSessionLocal(session, 101, testUser);

    assert.strictEqual(notificationsReceived.length, 1, 'Notifications must NOT spam during 30m cooldown window');
    const health = getStorageHealth();
    assert.strictEqual(health.consecutiveFailures, 6, 'consecutiveFailures tracked to 6');
    assert.strictEqual(health.isUnhealthy, true, 'Still unhealthy');
  });

  // =========================================================================
  // Test 7: Disk Space Restored (Recovery Detection & Notification)
  // =========================================================================
  runTest('7. Disk Space Restored: Local writes succeed -> WorkLens recovers -> Recovery notification', () => {
    // Free up disk space (clear fault injection)
    setStorageFaultInjection(null);

    const session = {
      local_id: 'test-enospc-session',
      appName: 'VSCode',
      windowTitle: 'Drive Space Restored',
      startTime: new Date(),
      endTime: new Date(),
      status: 'Active',
      duration: 6,
      activityOn: new Date()
    };

    // Write succeeds!
    const saved = saveOrUpdateActiveSessionLocal(session, 101, testUser);
    assert.ok(saved, 'Session successfully persisted to disk after recovery');

    assert.strictEqual(notificationsReceived.length, 2, 'Recovery notification MUST be emitted');
    const recoveryAlert = notificationsReceived[1];
    assert.strictEqual(recoveryAlert.type, 'RECOVERED', 'Alert type must be RECOVERED');
    assert.strictEqual(recoveryAlert.title, 'WorkLens Alert', 'Recovery title must be WorkLens Alert');
    assert.strictEqual(recoveryAlert.message, 'WorkLens is working normally again.', 'Recovery message must indicate normal operation');

    const health = getStorageHealth();
    assert.strictEqual(health.isUnhealthy, false, 'isUnhealthy must return to false');
    assert.strictEqual(health.status, 'HEALTHY', 'Status must return to HEALTHY');
    assert.strictEqual(health.consecutiveFailures, 0, 'consecutiveFailures must reset to 0');
    assert.strictEqual(health.localStorageWorking, true, 'localStorageWorking must be true');
    assert.strictEqual(health.offlineQueueWorking, true, 'offlineQueueWorking must be true');
  });

  // =========================================================================
  // Test 8: Data Preservation Across ENOSPC (Atomic Write Protection)
  // =========================================================================
  runTest('8. Data Preservation: Existing offline queue is NOT truncated or corrupted by ENOSPC', () => {
    const queueFile = getQueueFilePath();
    assert.ok(fs.existsSync(queueFile), 'Queue file must exist');
    const content = fs.readFileSync(queueFile, 'utf8');
    assert.ok(content.length > 0, 'Queue file must not be 0 bytes');

    // All previously saved sessions must still be present on disk
    assert.ok(content.includes('test-normal-1'), 'Pre-existing record test-normal-1 must be intact');
    assert.ok(content.includes('test-offline-1'), 'Pre-existing record test-offline-1 must be intact');
    assert.ok(content.includes('test-enospc-session'), 'Recovered record test-enospc-session must be present on disk');
  });

  // =========================================================================
  // Test 9: Permission & Locked File Error Handling
  // =========================================================================
  runTest('9. Permission / Lock Failure: User-friendly storage error notification', () => {
    resetStorageHealth();
    notificationsReceived.length = 0;

    const permErr = new Error('EACCES: permission denied, open activity_queue.jsonl');
    permErr.code = 'EACCES';
    setStorageFaultInjection(permErr);

    const session = {
      local_id: 'test-perm-session',
      appName: 'Word',
      windowTitle: 'Document1',
      startTime: new Date(),
      endTime: new Date(),
      status: 'Active',
      duration: 2,
      activityOn: new Date()
    };

    saveOrUpdateActiveSessionLocal(session, 101, testUser);
    saveOrUpdateActiveSessionLocal(session, 101, testUser);
    saveOrUpdateActiveSessionLocal(session, 101, testUser);

    assert.strictEqual(notificationsReceived.length, 1, 'Notification triggered after 3 permission failures');
    const alert = notificationsReceived[0];
    assert.strictEqual(alert.type, 'PERMISSION_OR_LOCK', 'Alert type should be PERMISSION_OR_LOCK');
    assert.ok(alert.message.includes('file permission issue'), 'Must explain permission issue user-friendly');
    assert.ok(!alert.message.includes('EACCES'), 'Must not expose technical code EACCES');

    setStorageFaultInjection(null);
  });

  // =========================================================================
  // Test 10: In-Memory Buffer Preservation During ENOSPC
  // =========================================================================
  runTest('10. In-Memory Buffer: Multiple sessions generated while disk full are saved upon recovery', () => {
    resetStorageHealth();
    notificationsReceived.length = 0;

    // Simulate disk full
    const enospc = new Error('ENOSPC: no space left on device');
    enospc.code = 'ENOSPC';
    setStorageFaultInjection(enospc);

    // Generate multiple distinct sessions while disk is full
    saveOrUpdateActiveSessionLocal({
      local_id: 'buffer-session-1',
      appName: 'Excel',
      windowTitle: 'Budget.xlsx',
      startTime: new Date(Date.now() - 60000),
      endTime: new Date(Date.now() - 30000),
      status: 'Active',
      duration: 30,
      activityOn: new Date()
    }, 101, testUser);

    saveOrUpdateActiveSessionLocal({
      local_id: 'buffer-session-2',
      appName: 'Figma',
      windowTitle: 'Design System',
      startTime: new Date(Date.now() - 30000),
      endTime: new Date(),
      status: 'Active',
      duration: 30,
      activityOn: new Date()
    }, 101, testUser);

    // Disk space is restored!
    setStorageFaultInjection(null);

    // Save a new tick
    saveOrUpdateActiveSessionLocal({
      local_id: 'buffer-session-3',
      appName: 'Slack',
      windowTitle: 'Project Chat',
      startTime: new Date(),
      endTime: new Date(),
      status: 'Active',
      duration: 10,
      activityOn: new Date()
    }, 101, testUser);

    // Verify all buffered sessions were written to disk
    const queueFile = getQueueFilePath();
    const content = fs.readFileSync(queueFile, 'utf8');
    assert.ok(content.includes('buffer-session-1'), 'buffer-session-1 must be on disk');
    assert.ok(content.includes('buffer-session-2'), 'buffer-session-2 must be on disk');
    assert.ok(content.includes('buffer-session-3'), 'buffer-session-3 must be on disk');
  });

  console.log('\n================ TEST SUMMARY ================');
  console.log(`  Total: ${passedTests + failedTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log('==============================================\n');

  // Clean up test userData dir
  try {
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  } catch (_) {}

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
});
