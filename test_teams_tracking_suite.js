// test_teams_tracking_suite.js
// Unit and integration test suite for WorkLens Microsoft Teams Call/Meeting tracking.

const { TeamsActivityTracker, TEAMS_STATES } = require('./teamsActivityTracker');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log('\n================ RUNNING WORKLENS TEAMS ACTIVITY TRACKING SUITE ================\n');

// 1. Test 1: Teams chat open, no activity for 5+ minutes
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: false, webcam: false });
  const winInfo = {
    owner: { name: 'Microsoft Teams', path: 'C:\\Program Files\\WindowsApps\\MSTeams\\ms-teams.exe' },
    title: 'Chat | General Discussion | Microsoft Teams'
  };

  const res = tracker.evaluate({
    isTeamsForeground: true,
    winInfo,
    osIdleTimeSeconds: 305,
    now: new Date('2026-10-08T10:05:00Z')
  });

  assert(res.state === TEAMS_STATES.IDLE, '1. Teams chat with 5+ min inactivity transitions to IDLE');
  assert(res.status === 'Inactive', '1. Teams chat with 5+ min inactivity has status Inactive');
  assert(res.suppressPopup === false, '1. Teams chat with 5+ min inactivity does NOT suppress popup');
}

// 2. Test 2: Teams chat open, user actively typing/clicking
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: false, webcam: false });
  const winInfo = {
    owner: { name: 'Microsoft Teams', path: 'C:\\Program Files\\WindowsApps\\MSTeams\\ms-teams.exe' },
    title: 'Chat | General Discussion | Microsoft Teams'
  };

  const res = tracker.evaluate({
    isTeamsForeground: true,
    winInfo,
    osIdleTimeSeconds: 15,
    now: new Date('2026-10-08T10:00:15Z')
  });

  assert(res.state === TEAMS_STATES.CHAT_ACTIVE, '2. Teams chat with user activity remains in CHAT_ACTIVE');
  assert(res.status === 'Active', '2. Teams chat with user activity has status Active');
  assert(res.suppressPopup === false, '2. Teams chat normal popup eligibility maintained');
}

// 3. Test 3: Teams voice call for 30 minutes with no mouse movement
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: true, webcam: false });
  const winInfo = {
    owner: { name: 'Microsoft Teams', path: 'C:\\Program Files\\WindowsApps\\MSTeams\\ms-teams.exe' },
    title: 'Raviteja Bollu | Microsoft Teams' // Notice: title looks like 1:1 chat, but mic is active!
  };

  const res = tracker.evaluate({
    isTeamsForeground: true,
    winInfo,
    osIdleTimeSeconds: 1800, // 30 minutes without keyboard/mouse
    now: new Date('2026-10-08T10:30:00Z')
  });

  assert(res.state === TEAMS_STATES.CALL_ACTIVE, '3. Teams voice call with 30m idle is detected as CALL_ACTIVE');
  assert(res.status === 'Active', '3. Teams voice call is forced Active despite 30m mouse idle');
  assert(res.suppressPopup === true, '3. Teams voice call suppresses 5-minute inactivity popup');
}

// 4. Test 4: Teams video meeting for 60 minutes with almost no keyboard/mouse activity
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: true, webcam: true });
  const winInfo = {
    owner: { name: 'Microsoft Teams', path: 'C:\\Program Files\\WindowsApps\\MSTeams\\ms-teams.exe' },
    title: 'Calendar | Project Planning | Microsoft Teams'
  };

  const res = tracker.evaluate({
    isTeamsForeground: true,
    winInfo,
    osIdleTimeSeconds: 3600, // 60 minutes without input
    now: new Date('2026-10-08T11:00:00Z')
  });

  assert(res.state === TEAMS_STATES.MEETING_ACTIVE, '4. Teams video meeting is detected as MEETING_ACTIVE');
  assert(res.status === 'Active', '4. Teams video meeting is forced Active despite 60m input idle');
  assert(res.suppressPopup === true, '4. Teams video meeting suppresses inactivity popup');
}

// 5. Test 5: Teams meeting ends and Teams remains open
{
  const tracker = new TeamsActivityTracker();
  const startTime = new Date('2026-10-08T10:00:00Z');
  const endTime = new Date('2026-10-08T10:30:00Z');

  // Step A: Active meeting
  tracker.setDeviceStatusOverride({ microphone: true, webcam: true });
  tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Meeting compact view | Team Sync' },
    osIdleTimeSeconds: 1200,
    now: startTime
  });

  // Step B: Meeting ends at 10:30:00
  tracker.setDeviceStatusOverride({ microphone: false, webcam: false });
  const endRes = tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Microsoft Teams' },
    osIdleTimeSeconds: 1800, // OS idle time from during the meeting
    now: endTime
  });

  assert(endRes.state === TEAMS_STATES.CHAT_ACTIVE, '5. Meeting ending transitions immediately to CHAT_ACTIVE');
  assert(endRes.status === 'Active', '5. Meeting ending does NOT immediately mark user idle');
  assert(endRes.effectiveIdleTime === 0, '5. Effective idle time restarts from 0 at call conclusion');

  // Step C: 2 minutes after meeting end, no input
  const twoMinLater = new Date('2026-10-08T10:32:00Z');
  const twoMinRes = tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Microsoft Teams' },
    osIdleTimeSeconds: 1920,
    now: twoMinLater
  });
  assert(twoMinRes.status === 'Active', '5. 2 minutes post-meeting is still Active (grace period)');
  assert(twoMinRes.effectiveIdleTime === 120, '5. Effective idle time is 120s (2 min since meeting end)');

  // Step D: 5 minutes after meeting end, still no input
  const fiveMinLater = new Date('2026-10-08T10:35:00Z');
  const fiveMinRes = tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Microsoft Teams' },
    osIdleTimeSeconds: 2100,
    now: fiveMinLater
  });
  assert(fiveMinRes.state === TEAMS_STATES.IDLE, '5. 5 minutes post-meeting with no input transitions to IDLE');
  assert(fiveMinRes.status === 'Inactive', '5. 5 minutes post-meeting sets status to Inactive');
}

// 6. Test 6: Teams call starts after Teams has already been idle
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: false, webcam: false });
  const idleTime = new Date('2026-10-08T10:05:00Z');

  // Currently idle in Teams
  tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Raviteja Bollu | Microsoft Teams' },
    osIdleTimeSeconds: 400,
    now: idleTime
  });
  assert(tracker.currentState === TEAMS_STATES.IDLE, '6. Pre-condition: Teams was IDLE');

  // Call incoming/started
  tracker.setDeviceStatusOverride({ microphone: true, webcam: false });
  const callRes = tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Raviteja Bollu | Microsoft Teams' },
    osIdleTimeSeconds: 402,
    now: new Date('2026-10-08T10:05:02Z')
  });

  assert(callRes.state === TEAMS_STATES.CALL_ACTIVE, '6. Call starting flips state from IDLE to CALL_ACTIVE');
  assert(callRes.status === 'Active', '6. Status immediately becomes Active upon call start');
  assert(callRes.suppressPopup === true, '6. Popup logic immediately suppressed during call');
}

// 7. Test 7: Teams call duration tracking
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: true, webcam: false });
  const tStart = new Date('2026-10-08T10:00:00Z');
  const tEnd = new Date('2026-10-08T10:45:00Z'); // 45 minutes

  tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Vishal Hake | Microsoft Teams' },
    osIdleTimeSeconds: 0,
    now: tStart
  });

  const durationSec = Math.floor((tEnd - tracker.callOrMeetingStartedAt) / 1000);
  assert(durationSec === 2700, '7. 45-minute call duration calculates exactly 2700 seconds');

  tracker.setDeviceStatusOverride({ microphone: false, webcam: false });
  const postCallRes = tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Vishal Hake | Microsoft Teams' },
    osIdleTimeSeconds: 2700,
    now: tEnd
  });

  assert(postCallRes.status === 'Active', '7. 45-minute call end preserves active time without interval loss');
}

// 8. Test 8: Switch from Teams call to Chrome
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: true, webcam: false });

  // In Teams call
  tracker.evaluate({
    isTeamsForeground: true,
    winInfo: { owner: { name: 'Microsoft Teams' }, title: 'Teams Call' },
    osIdleTimeSeconds: 0,
    now: new Date('2026-10-08T10:00:00Z')
  });

  // User switches to Chrome and types
  const chromeWinInfo = {
    owner: { name: 'Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\chrome.exe' },
    title: 'Google Docs - Document'
  };

  assert(!tracker.isTeamsWindow(chromeWinInfo), '8. Google Chrome is not detected as Teams window');
  // Tracker confirms background call is active, but isTeamsForeground is false
  const chromeEval = tracker.evaluate({
    isTeamsForeground: false,
    winInfo: chromeWinInfo,
    osIdleTimeSeconds: 5,
    now: new Date('2026-10-08T10:05:00Z')
  });
  assert(chromeEval.isCallActive === true, '8. Background Teams call still recognized');
}

// 9. Test 9: Teams meeting minimized/backgrounded while still active
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: true, webcam: true });

  // Teams meeting minimized (user is listening, idle for 10 minutes in background)
  const bgEval = tracker.evaluate({
    isTeamsForeground: false,
    winInfo: null,
    osIdleTimeSeconds: 600, // 10 min idle
    now: new Date('2026-10-08T10:10:00Z')
  });

  assert(bgEval.isMeetingActive === true, '9. Background meeting remains detected as active');
  assert(bgEval.suppressPopup === true, '9. Background meeting suppresses idle popup');
  assert(bgEval.status === 'Active', '9. Background meeting maintains Active status');
}

// 10. Test 10: Non-Teams apps (Chrome, Edge, VS Code, Outlook) remain unaffected
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: false, webcam: false });

  const chromeWin = { owner: { name: 'Google Chrome' }, title: 'WorkLens Dashboard' };
  const vsCodeWin = { owner: { name: 'Code' }, title: 'WorkLens - Visual Studio Code' };
  const outlookWin = { owner: { name: 'Outlook' }, title: 'Inbox - Outlook' };

  assert(!tracker.isTeamsWindow(chromeWin), '10. Chrome is not recognized as Teams');
  assert(!tracker.isTeamsWindow(vsCodeWin), '10. VS Code is not recognized as Teams');
  assert(!tracker.isTeamsWindow(outlookWin), '10. Outlook is not recognized as Teams');
}

// 11. Test 11: Empty window title bug fix
{
  const tracker = new TeamsActivityTracker();
  tracker.setDeviceStatusOverride({ microphone: false, webcam: false });
  const emptyTitleWin = {
    owner: { name: 'Microsoft Teams', path: 'C:\\Program Files\\WindowsApps\\MSTeams\\ms-teams.exe' },
    title: ''
  };

  const detection = tracker.detectTeamsCallOrMeeting(emptyTitleWin);
  assert(detection.isMeeting === false, '11. Empty Teams window title is NOT detected as meeting');
  assert(detection.isCall === false, '11. Empty Teams window title is NOT detected as call');
}

console.log('\n================ TEST SUMMARY ================');
console.log(`  Total: ${totalTests}`);
console.log(`  Passed: ${passedTests}`);
console.log(`  Failed: ${failedTests}`);
console.log('==============================================\n');

if (failedTests > 0) {
  process.exit(1);
}
