// test_username_verification_suite.js
// Comprehensive verification test suite for WorkLens First-Launch Username Verification

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// 1. Setup isolated test environment
const testUserDataDir = path.join(os.tmpdir(), `worklens_verify_test_${Date.now()}`);
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);

console.log(`[TEST SUITE] Isolated test userData path: ${testUserDataDir}`);

const {
  saveStoredUserProfile,
  clearStoredUserProfile,
  getStoredUserProfile,
  getStoredVerifiedUser,
  getCachedUserIdForOsUser,
  backfillUserIdForOsUsername,
  saveOrUpdateActiveSessionLocal,
  getAllTodayLogs,
  getUserProfileFilePath
} = require('./activityStore');

const redmineClient = require('./redmineClient');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
    failedTests++;
  }
}

async function runSuite() {
  console.log('================================================================================');
  console.log('       WORKLENS FIRST-LAUNCH USERNAME VERIFICATION TEST SUITE                   ');
  console.log('================================================================================\n');

  // -----------------------------------------------------------------------------
  // 1. FRESH INSTALLATION & FIRST-LAUNCH BEHAVIOR
  // -----------------------------------------------------------------------------
  console.log('[1] Fresh Installation & First-Launch Identity State:');

  runTest('1.1 Initial state has no user profile and getStoredVerifiedUser() returns null', () => {
    clearStoredUserProfile();
    const verified = getStoredVerifiedUser();
    assert.strictEqual(verified, null, 'Fresh launch should have no verified user');
    const profile = getStoredUserProfile();
    assert.strictEqual(profile, null, 'Fresh launch should have no stored profile');
  });

  runTest('1.2 Empty or whitespace profile cannot be considered verified', () => {
    const filePath = getUserProfileFilePath();
    fs.writeFileSync(filePath, JSON.stringify({ username: '   ', redmine_user_id: null }), 'utf8');
    assert.strictEqual(getStoredVerifiedUser(), null, 'Profile with whitespace/null ID is not verified');
    clearStoredUserProfile();
  });

  // -----------------------------------------------------------------------------
  // 2. BACKEND API VERIFICATION & VALIDATION LOGIC
  // -----------------------------------------------------------------------------
  console.log('\n[2] Backend API Verification & Source-of-Truth Logic:');

  await runAsyncTest('2.1 Valid admin-assigned username successfully resolves via Redmine API', async () => {
    const validUsername = 'karthikeya.kondavath';
    const response = await redmineClient.get('/today_timesheet.json', { user_id: validUsername });
    assert.ok(response && response.user, 'API should return user object for valid username');
    assert.strictEqual(typeof response.user.id, 'number', 'user.id must be a number');
    assert.ok(response.user.id > 0, 'user.id must be positive integer');
    assert.ok(response.user.name, 'user.name must be present');
  });

  await runAsyncTest('2.2 Invalid username is rejected by backend (404 / user not found)', async () => {
    const invalidUsername = 'nonexistent.employee.999999';
    let rejected = false;
    let errorMessage = '';

    try {
      const response = await redmineClient.get('/today_timesheet.json', { user_id: invalidUsername });
      if (!response || !response.user) {
        rejected = true;
      }
    } catch (err) {
      rejected = true;
      errorMessage = String(err.message || err);
    }

    assert.ok(rejected, 'Invalid username must be rejected by backend');
    assert.ok(
      errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('Not Found') || errorMessage === '',
      'Error should indicate 404 / not found'
    );
  });

  // -----------------------------------------------------------------------------
  // 3. SECURE IDENTITY STORAGE & SESSION RECOVERY
  // -----------------------------------------------------------------------------
  console.log('\n[3] Secure Identity Storage & Session Persistence:');

  runTest('3.1 Successfully verified username is saved to user_profile.json', () => {
    const verifiedUsername = 'karthikeya.kondavath';
    const redmineId = 890;
    const employeeName = 'Karthikeya Kondavathri';

    saveStoredUserProfile(verifiedUsername, redmineId, employeeName);

    const verified = getStoredVerifiedUser();
    assert.ok(verified !== null, 'getStoredVerifiedUser should return verified user');
    assert.strictEqual(verified.username, verifiedUsername);
    assert.strictEqual(verified.userId, redmineId);
    assert.strictEqual(verified.employeeName, employeeName);
    assert.ok(verified.verifiedAt, 'verifiedAt timestamp should be set');
    assert.ok(verified.lastResolvedAt, 'lastResolvedAt timestamp should be set');
  });

  runTest('3.2 Subsequent launch recovers verified user from persistent profile without re-prompt', () => {
    const verified = getStoredVerifiedUser();
    assert.ok(verified !== null, 'Subsequent launch should retrieve stored identity');
    assert.strictEqual(verified.username, 'karthikeya.kondavath');
    assert.strictEqual(verified.userId, 890);
  });

  runTest('3.3 User identity is decoupled from Windows PC username', () => {
    // Save an admin-assigned username that differs from Windows OS username
    const customAdminUser = 'admin.assigned.user';
    saveStoredUserProfile(customAdminUser, 777, 'Assigned Employee');

    const verified = getStoredVerifiedUser();
    assert.strictEqual(verified.username, customAdminUser, 'Must use admin-assigned username, not OS username');
    assert.notStrictEqual(verified.username, os.userInfo().username, 'Verified identity must be decoupled from OS user');

    // Restore test user
    saveStoredUserProfile('karthikeya.kondavath', 890, 'Karthikeya Kondavathri');
  });

  runTest('3.4 User revocation clears identity and returns system to unverified state', () => {
    assert.ok(getStoredVerifiedUser() !== null, 'Precondition: user is verified');
    clearStoredUserProfile();
    assert.strictEqual(getStoredVerifiedUser(), null, 'After revocation, verified user must be null');
    assert.strictEqual(getStoredUserProfile(), null, 'user_profile.json must be removed on revocation');
  });

  // -----------------------------------------------------------------------------
  // 4. OFFLINE TRACKING & IDENTITY RECONCILIATION
  // -----------------------------------------------------------------------------
  console.log('\n[4] Offline Tracking with Verified Identity:');

  runTest('4.1 Offline sessions record under verified admin-assigned username', () => {
    const verifiedUsername = 'karthikeya.kondavath';
    const userId = 890;
    saveStoredUserProfile(verifiedUsername, userId, 'Karthikeya Kondavathri');

    const session = {
      appName: 'Code.exe',
      windowTitle: 'WorkLens Project - VS Code',
      startTime: new Date(Date.now() - 300000),
      endTime: new Date(),
      duration: 300,
      status: 'Active',
      closed: true
    };

    const saved = saveOrUpdateActiveSessionLocal(session, userId, verifiedUsername);
    assert.ok(saved, 'Session must save locally');
    assert.strictEqual(saved.os_username, verifiedUsername, 'Session must record verified admin-assigned username');
    assert.strictEqual(saved.user_id, userId);

    const todayLogs = getAllTodayLogs(userId, verifiedUsername);
    assert.ok(todayLogs.length > 0, 'Local logs query by verified username must find the record');
  });

  runTest('4.2 Backfilling pending offline records associates them with verified userId', () => {
    const verifiedUsername = 'offline.employee';
    const session = {
      appName: 'Chrome.exe',
      windowTitle: 'Documentation',
      startTime: new Date(Date.now() - 120000),
      endTime: new Date(),
      duration: 120,
      status: 'Active',
      closed: true
    };

    saveOrUpdateActiveSessionLocal(session, null, verifiedUsername);
    const updatedCount = backfillUserIdForOsUsername(verifiedUsername, 555);
    assert.ok(updatedCount >= 1, 'Should backfill at least 1 pending session');
  });

  // -----------------------------------------------------------------------------
  // 5. REGISTRATION SCREEN UI & ASSET VERIFICATION
  // -----------------------------------------------------------------------------
  console.log('\n[5] Registration Screen HTML/CSS/JS & IPC Verification:');

  runTest('5.1 renderer/register.html exists and contains required message and form elements', () => {
    const htmlPath = path.join(__dirname, 'renderer', 'register.html');
    assert.ok(fs.existsSync(htmlPath), 'register.html must exist');
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Required exact workflow message
    assert.ok(
      content.includes('Enter the username provided by your administrator.'),
      'Must contain exact message: "Enter the username provided by your administrator."'
    );

    // Form elements
    assert.ok(content.includes('id="registration-form"'), 'Must contain #registration-form');
    assert.ok(content.includes('id="username-input"'), 'Must contain #username-input');
    assert.ok(content.includes('id="submit-btn"'), 'Must contain #submit-btn');
    assert.ok(content.includes('id="error-container"'), 'Must contain #error-container');
    assert.ok(content.includes('id="loading-container"'), 'Must contain #loading-container');
    assert.ok(content.includes('id="reg-close-btn"'), 'Must contain #reg-close-btn');
  });

  runTest('5.2 renderer/register.css exists and provides Fluent/Glassmorphism styling', () => {
    const cssPath = path.join(__dirname, 'renderer', 'register.css');
    assert.ok(fs.existsSync(cssPath), 'register.css must exist');
    const content = fs.readFileSync(cssPath, 'utf8');

    assert.ok(content.includes('.window-container'), 'Must style .window-container');
    assert.ok(content.includes('.titlebar'), 'Must style draggable .titlebar');
    assert.ok(content.includes('.username-field'), 'Must style .username-field');
    assert.ok(content.includes('.submit-button'), 'Must style .submit-button');
    assert.ok(content.includes('.error-banner'), 'Must style .error-banner');
  });

  runTest('5.3 renderer/register.js handles submission, empty validation, and exact invalid message', () => {
    const jsPath = path.join(__dirname, 'renderer', 'register.js');
    assert.ok(fs.existsSync(jsPath), 'register.js must exist');
    const content = fs.readFileSync(jsPath, 'utf8');

    // Required exact invalid username message
    assert.ok(
      content.includes('Invalid username. Please enter the username provided by your administrator.'),
      'Must contain exact message: "Invalid username. Please enter the username provided by your administrator."'
    );
    assert.ok(content.includes('verifyUsername'), 'Must invoke window.api.verifyUsername');
  });

  runTest('5.4 preload.js exposes verifyUsername and closeRegistrationWindow', () => {
    const preloadPath = path.join(__dirname, 'preload.js');
    const content = fs.readFileSync(preloadPath, 'utf8');

    assert.ok(content.includes('verifyUsername'), 'preload.js must expose verifyUsername');
    assert.ok(content.includes('closeRegistrationWindow'), 'preload.js must expose closeRegistrationWindow');
    assert.ok(content.includes('verify-username'), 'Must invoke IPC channel verify-username');
  });

  // -----------------------------------------------------------------------------
  // 6. MAIN PROCESS LIFECYCLE & INTEGRATION INTEGRITY
  // -----------------------------------------------------------------------------
  console.log('\n[6] Main Process Lifecycle & Protection Guards:');

  runTest('6.1 main.js integrates registration window, verified guard, and verification handler', () => {
    const mainPath = path.join(__dirname, 'main.js');
    const content = fs.readFileSync(mainPath, 'utf8');

    assert.ok(content.includes('createRegistrationWindow'), 'main.js must define createRegistrationWindow');
    assert.ok(content.includes('showRegistrationWindow'), 'main.js must define showRegistrationWindow');
    assert.ok(content.includes('startVerifiedApplication'), 'main.js must define startVerifiedApplication');
    assert.ok(content.includes('handleUserRevocation'), 'main.js must define handleUserRevocation');
    assert.ok(content.includes('isUserVerified'), 'main.js must define isUserVerified');
    assert.ok(content.includes('getActiveUsername'), 'main.js must define getActiveUsername');
    assert.ok(content.includes("ipcMain.handle('verify-username'"), 'main.js must register verify-username IPC');
    assert.ok(content.includes("ipcMain.handle('close-registration-window'"), 'main.js must register close-registration-window IPC');
  });

  runTest('6.2 Auto-start and tray handlers enforce isUserVerified() check', () => {
    const mainPath = path.join(__dirname, 'main.js');
    const content = fs.readFileSync(mainPath, 'utf8');

    // showAndFocusWindow guard
    assert.ok(content.includes('if (!isUserVerified()) {\n    showRegistrationWindow();') ||
              content.includes('if (!isUserVerified()) {\r\n    showRegistrationWindow();'),
      'showAndFocusWindow must guard against unverified user'
    );

    // second-instance guard
    assert.ok(content.includes("app.on('second-instance', () => {\n      if (!isUserVerified())") ||
              content.includes("app.on('second-instance', () => {\r\n      if (!isUserVerified())"),
      'second-instance must guard against unverified user'
    );
  });

  runTest('6.3 Tray context menu does not provide a Quit option', () => {
    const mainPath = path.join(__dirname, 'main.js');
    const content = fs.readFileSync(mainPath, 'utf8');

    const trayFnMatch = content.match(/function createTray\(\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(trayFnMatch, 'createTray function must exist');
    const trayFnBody = trayFnMatch[1];

    assert.ok(!trayFnBody.includes("'Quit'") && !trayFnBody.includes('"Quit"'), 'Tray context menu must not contain Quit option');
  });

  // Cleanup test temp directory
  try {
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n================================================================================');
  console.log(`TEST SUMMARY: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('================================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSuite().catch(err => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});
