// teamsActivityTracker.js
// Intelligent activity tracking and state machine for Microsoft Teams in WorkLens.

const { execSync } = require('child_process');

const TEAMS_STATES = {
  CHAT_ACTIVE: 'CHAT_ACTIVE',
  IDLE: 'IDLE',
  CALL_ACTIVE: 'CALL_ACTIVE',
  MEETING_ACTIVE: 'MEETING_ACTIVE',
  CALL_OR_MEETING_ENDED: 'CALL_OR_MEETING_ENDED'
};

const TEAMS_MEETING_TITLE_PATTERNS = [
  /\bmeeting\b/i,
  /\bconference\b/i,
  /\bpresenting\b/i,
  /\bscreen sharing\b/i,
  /\bteams meeting\b/i,
  /\bcompact view\b/i,
  /\bsharing control bar\b/i,
  /\bmeeting compact view\b/i,
  /\bhuddle\b/i
];

const TEAMS_CALL_TITLE_PATTERNS = [
  /\bcall\b/i,
  /\bvoice call\b/i,
  /\bvideo call\b/i
];

const INACTIVITY_THRESHOLD_SECONDS = 300; // 5 minutes

class TeamsActivityTracker {
  constructor() {
    this.currentState = TEAMS_STATES.CHAT_ACTIVE;
    this.callEndedAt = null; // Timestamp (ms) when last call/meeting ended
    this.callOrMeetingStartedAt = null; // Timestamp (ms) when current call/meeting started
    this.lastLoggedState = null;
    this.lastLoggedSuppression = null;

    // Cache for device usage
    this.deviceCache = {
      microphone: { active: false, checkedAt: 0 },
      webcam: { active: false, checkedAt: 0 }
    };
    this.cacheTtlMs = 1500; // 1.5s cache for registry queries

    // Mock/injection hook for tests
    this.deviceStatusOverride = null;
  }

  reset() {
    this.currentState = TEAMS_STATES.CHAT_ACTIVE;
    this.callEndedAt = null;
    this.callOrMeetingStartedAt = null;
    this.lastLoggedState = null;
    this.lastLoggedSuppression = null;
    this.deviceCache.microphone = { active: false, checkedAt: 0 };
    this.deviceCache.webcam = { active: false, checkedAt: 0 };
    this.deviceStatusOverride = null;
  }

  setDeviceStatusOverride(override) {
    this.deviceStatusOverride = override;
  }

  isTeamsWindow(winInfo) {
    if (!winInfo) return false;
    const appName = (winInfo.owner?.name || '').toLowerCase();
    const appPath = (winInfo.owner?.path || '').toLowerCase();
    return appName.includes('teams') || appPath.includes('teams.exe') || appPath.includes('ms-teams.exe');
  }

  isTeamsChatWindow(winInfo) {
    if (!this.isTeamsWindow(winInfo)) return false;
    const title = (winInfo.title || '').trim();
    if (!title) return false;
    return /\bchat\b/i.test(title) || /\bconversation\b/i.test(title) || title.toLowerCase().startsWith('chat');
  }

  isTeamsMeetingWindowTitle(title) {
    if (!title) return false;
    const trimmed = title.trim();
    if (!trimmed) return false;
    return TEAMS_MEETING_TITLE_PATTERNS.some(pattern => pattern.test(trimmed));
  }

  isTeamsCallWindowTitle(title) {
    if (!title) return false;
    const trimmed = title.trim();
    if (!trimmed) return false;
    return TEAMS_CALL_TITLE_PATTERNS.some(pattern => pattern.test(trimmed));
  }

  queryDeviceUsage(capability) {
    if (this.deviceStatusOverride && typeof this.deviceStatusOverride[capability] === 'boolean') {
      return this.deviceStatusOverride[capability];
    }

    if (process.platform !== 'win32') {
      return false;
    }

    const now = Date.now();
    if (now - this.deviceCache[capability].checkedAt < this.cacheTtlMs) {
      return this.deviceCache[capability].active;
    }

    let isActive = false;
    try {
      const raw = execSync(
        `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\${capability}" /s`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1000 }
      );

      const lines = raw.split(/\r?\n/);
      let currentKey = '';
      let startVal = null;
      let stopVal = null;
      const entries = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('HKEY_CURRENT_USER')) {
          if (currentKey && (startVal !== null || stopVal !== null)) {
            entries.push({ key: currentKey, start: startVal, stop: stopVal });
          }
          currentKey = trimmed;
          startVal = null;
          stopVal = null;
        } else if (trimmed.startsWith('LastUsedTimeStart')) {
          const parts = trimmed.split(/\s+/);
          startVal = parts[2] ? BigInt(parts[2]) : null;
        } else if (trimmed.startsWith('LastUsedTimeStop')) {
          const parts = trimmed.split(/\s+/);
          stopVal = parts[2] ? BigInt(parts[2]) : null;
        }
      }
      if (currentKey && (startVal !== null || stopVal !== null)) {
        entries.push({ key: currentKey, start: startVal, stop: stopVal });
      }

      const teamsEntries = entries.filter(e => e.key.toLowerCase().includes('teams'));
      isActive = teamsEntries.some(e => {
        if (e.start === null) return false;
        if (e.stop === null || e.stop === 0n) return true;
        return e.start > e.stop;
      });
    } catch (_) {
      isActive = false;
    }

    this.deviceCache[capability] = { active: isActive, checkedAt: now };
    return isActive;
  }

  isMicrophoneInUse() {
    return this.queryDeviceUsage('microphone');
  }

  isWebcamInUse() {
    return this.queryDeviceUsage('webcam');
  }

  detectTeamsCallOrMeeting(winInfo) {
    const micActive = this.isMicrophoneInUse();
    const webcamActive = this.isWebcamInUse();
    const title = winInfo ? (winInfo.title || '').trim() : '';

    const isMeetingTitle = this.isTeamsMeetingWindowTitle(title);
    const isCallTitle = this.isTeamsCallWindowTitle(title);

    // 1. Meeting signals:
    // - Webcam active (video call/meeting)
    // - Explicit meeting title pattern (e.g., "Meeting compact view", "Sharing control bar", "\bmeeting\b")
    // - Microphone active while on a calendar/meeting window
    const isMeeting = webcamActive || isMeetingTitle || (micActive && /\bcalendar\b/i.test(title));

    // 2. Call signals:
    // - Microphone active (voice call) and not classified as video meeting
    // - Explicit call title pattern ("\bcall\b")
    const isCall = !isMeeting && (micActive || isCallTitle);

    return {
      isCall,
      isMeeting,
      isAnyActive: isCall || isMeeting,
      micActive,
      webcamActive,
      isMeetingTitle,
      isCallTitle
    };
  }

  getEffectiveIdleTime(osIdleTimeSeconds, nowMs = Date.now()) {
    if (this.callEndedAt !== null) {
      const elapsedSinceCallEnd = Math.max(0, Math.floor((nowMs - this.callEndedAt) / 1000));
      // If user performed fresh input after call ended, osIdleTime will be less than elapsedSinceCallEnd
      if (osIdleTimeSeconds < elapsedSinceCallEnd) {
        this.callEndedAt = null; // Baseline cleared by fresh user activity
        return osIdleTimeSeconds;
      }
      // User has not touched input since call ended: effective idle time counts from call end
      return Math.min(osIdleTimeSeconds, elapsedSinceCallEnd);
    }
    return osIdleTimeSeconds;
  }

  transitionTo(newState, nowMs = Date.now()) {
    if (this.currentState !== newState) {
      this.currentState = newState;
      console.log(`[Teams] State: ${newState}`);
    }
  }

  evaluate({
    isTeamsForeground = false,
    winInfo = null,
    osIdleTimeSeconds = 0,
    inactivityThresholdSeconds = INACTIVITY_THRESHOLD_SECONDS,
    now = new Date()
  }) {
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    const detection = this.detectTeamsCallOrMeeting(winInfo);

    let status = 'Active';
    let suppressPopup = false;
    let effectiveIdleTime = this.getEffectiveIdleTime(osIdleTimeSeconds, nowMs);

    if (detection.isMeeting) {
      // Teams Video Meeting / Meeting Active
      if (this.currentState !== TEAMS_STATES.MEETING_ACTIVE) {
        this.callOrMeetingStartedAt = nowMs;
        this.transitionTo(TEAMS_STATES.MEETING_ACTIVE, nowMs);
      }
      this.callEndedAt = null;
      status = 'Active';
      suppressPopup = true;

      if (this.lastLoggedSuppression !== 'meeting') {
        console.log('[Teams] Idle timer suppressed - meeting active');
        this.lastLoggedSuppression = 'meeting';
      }
    } else if (detection.isCall) {
      // Teams Voice Call Active
      if (this.currentState !== TEAMS_STATES.CALL_ACTIVE) {
        this.callOrMeetingStartedAt = nowMs;
        this.transitionTo(TEAMS_STATES.CALL_ACTIVE, nowMs);
      }
      this.callEndedAt = null;
      status = 'Active';
      suppressPopup = true;

      if (this.lastLoggedSuppression !== 'call') {
        console.log('[Teams] Idle timer suppressed - call active');
        this.lastLoggedSuppression = 'call';
      }
    } else {
      // Neither Call nor Meeting is currently active
      if (this.currentState === TEAMS_STATES.CALL_ACTIVE || this.currentState === TEAMS_STATES.MEETING_ACTIVE) {
        const endedState = this.currentState === TEAMS_STATES.CALL_ACTIVE ? 'CALL_ENDED' : 'MEETING_ENDED';
        console.log(`[Teams] State: ${endedState}`);

        if (this.callOrMeetingStartedAt) {
          const durationSec = Math.max(0, Math.floor((nowMs - this.callOrMeetingStartedAt) / 1000));
          console.log(`[Teams] Active session duration: ${durationSec} seconds`);
          this.callOrMeetingStartedAt = null;
        }

        // Establish the call end timestamp so 5-min idle countdown starts from call conclusion
        this.callEndedAt = nowMs;
        this.lastLoggedSuppression = null;

        // Transition back to CHAT_ACTIVE
        this.transitionTo(TEAMS_STATES.CHAT_ACTIVE, nowMs);
        console.log('[Teams] Idle timer started');
      }

      // Re-evaluate effective idle time after potential call end
      effectiveIdleTime = this.getEffectiveIdleTime(osIdleTimeSeconds, nowMs);

      if (isTeamsForeground) {
        if (effectiveIdleTime >= inactivityThresholdSeconds) {
          if (this.currentState !== TEAMS_STATES.IDLE) {
            this.transitionTo(TEAMS_STATES.IDLE, nowMs);
            console.log('[Teams] Idle popup triggered');
          }
          status = 'Inactive';
          suppressPopup = false;
        } else {
          if (this.currentState === TEAMS_STATES.IDLE) {
            // User resumed activity
            this.transitionTo(TEAMS_STATES.CHAT_ACTIVE, nowMs);
          }
          status = 'Active';
          suppressPopup = false;
        }
      }
    }

    return {
      state: this.currentState,
      status,
      suppressPopup,
      effectiveIdleTime,
      isCallActive: detection.isCall,
      isMeetingActive: detection.isMeeting,
      isAnyActive: detection.isAnyActive
    };
  }
}

const teamsTrackerInstance = new TeamsActivityTracker();

module.exports = {
  TEAMS_STATES,
  TEAMS_MEETING_TITLE_PATTERNS,
  TEAMS_CALL_TITLE_PATTERNS,
  INACTIVITY_THRESHOLD_SECONDS,
  TeamsActivityTracker,
  teamsTracker: teamsTrackerInstance
};
