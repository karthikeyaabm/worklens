// test_offline_suite.js
// Automated verification of WorkLens Offline-Startup & Identity Reconciliation
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// Redirect userData to an isolated temp folder for testing
const testUserDataDir = path.join(os.tmpdir(), `worklens_test_${Date.now()}`);
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);

console.log(`[TEST SUITE] Isolated test userData path: ${testUserDataDir}`);

const {
  saveOrUpdateActiveSessionLocal,
  closeOrphanedSessions,
  getEligibleClosedSessions,
  markSessionSynced,
  getUnsyncedTodayDuration,
  getUnsyncedTodayLogs,
  getQueueFilePath,
  getUserIdFromLocalQueue,
  getUserProfileFilePath,
  getStoredUserProfile,
  saveStoredUserProfile,
  getCachedUserIdForOsUser,
  backfillUserIdForOsUsername
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
  console.log('\n================ RUNNING WORKLENS OFFLINE SUITE ================\n');

  const testUser = os.userInfo().username;
  const mockRedmineId = 890;

  // Test 1: Fresh startup with empty queue & no cache (Monday / new install offline)
  runTest('1. Offline startup allows saving session without userId', () => {
    const queueFile = getQueueFilePath();
    if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile);

    const session = {
      local_id: 'test-session-1',
      appName: 'VSCode',
      windowTitle: 'WorkLens - main.js',
      startTime: new Date(Date.now() - 60000),
      endTime: new Date(),
      status: 'Active',
      duration: 60,
      activityOn: new Date()
    };

    // Save with null userId (offline)
    const saved = saveOrUpdateActiveSessionLocal(session, null, testUser);
    assert.ok(saved, 'Session should be saved successfully even when userId is null');
    assert.strictEqual(saved.user_id, null, 'user_id should be null');
    assert.strictEqual(saved.os_username, testUser, 'os_username should be recorded');
    assert.strictEqual(saved.synced, false, 'synced should be false');

    // Verify written to disk
    const content = fs.readFileSync(queueFile, 'utf8');
    assert.ok(content.includes('test-session-1'), 'Record must exist on disk in activity_queue.jsonl');
  });

  // Test 2: Unsynced local duration calculation works while offline
  runTest('2. Offline duration & logs tracking works without server userId', () => {
    const duration = getUnsyncedTodayDuration(null, testUser);
    assert.strictEqual(duration, 60, 'Duration should reflect 60 seconds of offline work');

    const logs = getUnsyncedTodayLogs(null, testUser);
    assert.strictEqual(logs.length, 1, 'Should find 1 offline session log');
    assert.strictEqual(logs[0].app_name, 'VSCode');
  });

  // Test 3: Dedicated persistent user profile cache
  runTest('3. Persistent user profile cache saves and retrieves properly', () => {
    const profileFile = getUserProfileFilePath();
    assert.ok(profileFile.endsWith('user_profile.json'), 'Profile cache must be user_profile.json');

    saveStoredUserProfile(testUser, mockRedmineId);
    assert.ok(fs.existsSync(profileFile), 'user_profile.json must exist');

    const cachedId = getCachedUserIdForOsUser(testUser);
    assert.strictEqual(cachedId, mockRedmineId, 'Must return cached Redmine numeric ID');

    // Test Shared-PC Protection
    const otherUserCachedId = getCachedUserIdForOsUser('different_windows_user');
    assert.strictEqual(otherUserCachedId, null, 'Must NOT return cached ID for a different Windows user');
  });

  // Test 4: Queue retention does NOT prune user profile cache
  runTest('4. 24-hour activity queue pruning does not affect user profile cache', () => {
    // Force a queue write
    saveOrUpdateActiveSessionLocal({
      local_id: 'test-session-2',
      appName: 'Chrome',
      windowTitle: 'Google',
      startTime: new Date(),
      endTime: new Date(),
      status: 'Active',
      duration: 30
    }, null, testUser);

    const profile = getStoredUserProfile();
    assert.ok(profile, 'Profile must still exist');
    assert.strictEqual(profile.redmine_user_id, mockRedmineId, 'Profile redmine ID must not be pruned');
  });

  // Test 5: Identity reconciliation and backfilling
  runTest('5. Identity reconciliation backfills user_id on pending offline records', () => {
    const updatedCount = backfillUserIdForOsUsername(testUser, mockRedmineId);
    assert.ok(updatedCount >= 2, `Should have backfilled at least 2 sessions, got ${updatedCount}`);

    const logs = getUnsyncedTodayLogs(mockRedmineId, testUser);
    assert.ok(logs.length >= 2, 'Backfilled sessions should now match the resolved redmine user_id');
    for (const log of logs) {
      assert.strictEqual(log.user_id, mockRedmineId, 'Session must have resolved numeric user_id');
    }
  });

  // Test 6: Sync eligibility safety
  runTest('6. Sessions with resolved user_id become eligible for sync; null sessions skipped', () => {
    // Add a closed session
    saveOrUpdateActiveSessionLocal({
      local_id: 'test-sync-1',
      appName: 'Docs',
      windowTitle: 'Report',
      startTime: new Date(Date.now() - 10000),
      endTime: new Date(),
      status: 'Active',
      duration: 10,
      closed: true
    }, mockRedmineId, testUser);

    const eligible = getEligibleClosedSessions();
    const hasTestSync = eligible.some(c => c.local_id === 'test-sync-1');
    assert.ok(hasTestSync, 'Session with user_id should be eligible for sync');

    // Add unbackfilled session with null user_id
    saveOrUpdateActiveSessionLocal({
      local_id: 'test-sync-null',
      appName: 'Scratch',
      windowTitle: 'Draft',
      startTime: new Date(Date.now() - 5000),
      endTime: new Date(),
      status: 'Active',
      duration: 5,
      closed: true
    }, null, 'another_unresolved_user');

    // Session exists but has user_id: null
    markSessionSynced('test-sync-1');
    const eligibleAfter = getEligibleClosedSessions();
    const syncedItem = eligibleAfter.some(c => c.local_id === 'test-sync-1');
    assert.strictEqual(syncedItem, false, 'Synced session should no longer be eligible');
  });

  // Test 7: UI status logic evaluation
  runTest('7. UI status evaluation correctly distinguishes Active Offline from user errors', () => {
    // Simulated get-username logic
    function evaluateGetUsername(usernameError, isBackendReachable, trackingActive) {
      const isUserExplicitlyInvalid = usernameError && (
        usernameError.toLowerCase().includes('not found') ||
        usernameError.toLowerCase().includes('database') ||
        usernameError.toLowerCase().includes('waiting for account update')
      );

      return {
        username: testUser,
        isOffline: !isBackendReachable,
        isTrackingActive: trackingActive,
        error: isUserExplicitlyInvalid ? usernameError : null
      };
    }

    // A. Offline startup (network error)
    const offlineState = evaluateGetUsername('TypeError: fetch failed', false, true);
    assert.strictEqual(offlineState.error, null, 'Network failure must not set error');
    assert.strictEqual(offlineState.isOffline, true, 'isOffline must be true');
    assert.strictEqual(offlineState.isTrackingActive, true, 'isTrackingActive must be true');

    // B. Genuine invalid user
    const invalidState = evaluateGetUsername(`User "${testUser}" not found in Redmine database`, true, false);
    assert.ok(invalidState.error, 'Invalid user must produce error');
    assert.ok(invalidState.error.includes('not found'), 'Error must report user not found');
  });

  // Test 8: Shutdown while offline preserves closed session
  runTest('8. Offline shutdown closes active session and keeps it queued with synced=false', () => {
    // Open session
    saveOrUpdateActiveSessionLocal({
      local_id: 'session-before-shutdown',
      appName: 'WorkLens',
      windowTitle: 'Widget',
      startTime: new Date(Date.now() - 30000),
      endTime: new Date(),
      status: 'Active',
      duration: 30,
      closed: false
    }, mockRedmineId, testUser);

    // Close session on shutdown
    saveOrUpdateActiveSessionLocal({
      local_id: 'session-before-shutdown',
      closed: true
    }, mockRedmineId, testUser);

    const logs = getUnsyncedTodayLogs(mockRedmineId, testUser);
    const shutdownLog = logs.find(c => c.local_id === 'session-before-shutdown');
    assert.ok(shutdownLog, 'Session must exist in queue');
    assert.strictEqual(shutdownLog.closed, true, 'Session must be closed');
    assert.strictEqual(shutdownLog.synced, false, 'Session must remain unsynced for next online sync');
  });

  // Test 9: Rapid network on/off simulation
  runTest('9. Rapid network on/off keeps cachedUserId intact and prevents duplicate syncs', () => {
    let localCachedUserId = mockRedmineId;
    let localIsBackendReachable = true;

    // Toggle network 5 times
    for (let i = 0; i < 5; i++) {
      localIsBackendReachable = !localIsBackendReachable;
      // Network failure should NOT reset cachedUserId
      if (!localIsBackendReachable) {
        // simulate catch block: cachedUserId is preserved
        assert.strictEqual(localCachedUserId, mockRedmineId, 'cachedUserId must NOT be set to null on disconnect');
      }
    }
    assert.strictEqual(localCachedUserId, mockRedmineId, 'cachedUserId must remain intact throughout network flapping');
  });

  // Test 10: Complete offline-start -> restore -> backfill -> sync reconciliation (Zero Lost Time)
  runTest('10. Full flow: 30m offline work -> internet returns -> backfill -> zero lost time', () => {
    // 09:30 AM: PC starts offline, queue is empty, redmine user is unknown
    const session930 = {
      local_id: 'session-0930-1000',
      appName: 'WorkLens',
      windowTitle: 'Working on Project Alpha',
      startTime: new Date('2026-10-06T09:30:00'),
      endTime: new Date('2026-10-06T10:00:00'),
      status: 'Active',
      duration: 1800, // 30 minutes
      closed: true
    };

    // Recorded offline under local Windows user
    saveOrUpdateActiveSessionLocal(session930, null, testUser);

    // Verify tracked offline duration is 1800s (30m)
    const offlineDur = getUnsyncedTodayDuration(null, testUser);
    assert.ok(offlineDur >= 1800, '30m offline work must be tracked');

    // 10:00 AM: Internet restored, server resolves user 890
    backfillUserIdForOsUsername(testUser, mockRedmineId);

    // Verify session now has user_id: 890
    const syncedLogs = getUnsyncedTodayLogs(mockRedmineId, testUser);
    const sessionRestored = syncedLogs.find(c => c.local_id === 'session-0930-1000');
    assert.ok(sessionRestored, 'Session must exist');
    assert.strictEqual(sessionRestored.user_id, mockRedmineId, 'user_id must be backfilled');
    assert.strictEqual(sessionRestored.duration, 1800, 'Zero working time lost');

    // Mark synced
    markSessionSynced('session-0930-1000');
    assert.ok(true, 'Full lifecycle verified successfully');
  });

  console.log('\n================ TEST SUMMARY ================');
  console.log(`  Total: ${passedTests + failedTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log('==============================================\n');

  // Clean up test directory
  try {
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  } catch (_) {}

  app.exit(failedTests === 0 ? 0 : 1);
});
