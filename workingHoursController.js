// workingHoursController.js
// Centralized Working Hours Controller for WorkLens Desktop App
// Implements API-driven schedule restriction: Full-Time (24/7) vs Restricted Tracking (API weekdays & hours)

const fs = require('fs');
const path = require('path');
let electronApp = null;
try {
  const electron = require('electron');
  electronApp = electron.app;
} catch (_) {}

const VALID_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatTimePart(timeObj) {
  if (!timeObj) return '';
  const h = String(timeObj.hours).padStart(2, '0');
  const m = String(timeObj.minutes).padStart(2, '0');
  return `${h}:${m}`;
}

function formatCurrentTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function parseFullTime(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim().toLowerCase();
  if (str === '1' || str === 'true') return true;
  if (str === '0' || str === 'false') return false;
  return null;
}

function parseDays(val) {
  if (!val || typeof val !== 'string') return new Set();
  const rawList = val.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  const set = new Set();
  for (const day of rawList) {
    if (VALID_WEEKDAYS.includes(day)) {
      set.add(day);
    }
  }
  return set;
}

function parseTimePart(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
}

function parseWorkingHours(val) {
  if (!val || typeof val !== 'string') return null;
  const parts = val.split(',');
  if (parts.length !== 2) return null;
  const start = parseTimePart(parts[0]);
  const end = parseTimePart(parts[1]);
  if (!start || !end) return null;
  const startMinutes = start.hours * 60 + start.minutes;
  const endMinutes = end.hours * 60 + end.minutes;
  if (startMinutes === endMinutes) return null; // zero duration is invalid
  const isOvernight = startMinutes > endMinutes;
  return {
    start,
    end,
    startMinutes,
    endMinutes,
    isOvernight,
    formatted: `${formatTimePart(start)}, ${formatTimePart(end)}`
  };
}

class WorkingHoursController {
  constructor(options = {}) {
    this.storagePath = options.storagePath || null;
    this.activeConfig = {
      isFullTime: true,
      hasFullTimeField: true,
      allowedDays: new Set(VALID_WEEKDAYS),
      workingHours: null,
      isValid: true,
      raw: {
        work_lens_full_time: '1',
        work_lens_day: null,
        work_lens_time: null
      }
    };
    this.isTracking = false;
    this.boundaryTimer = null;
    this.heartbeatTimer = null;
    this.onStartTrackingHandler = options.onStartTracking || null;
    this.onStopTrackingHandler = options.onStopTracking || null;
    this.onStatusChangedHandler = options.onStatusChanged || null;
    this.lastEvaluatedStatus = null;
  }

  getStorageFilePath() {
    if (this.storagePath) return this.storagePath;
    let baseDir = null;
    if (electronApp && typeof electronApp.getPath === 'function') {
      try {
        baseDir = electronApp.getPath('userData');
      } catch (_) {}
    }
    if (!baseDir) {
      baseDir = process.env.WORKLENS_DATA_DIR || path.join(process.cwd(), 'scratch');
    }
    return path.join(baseDir, 'working_hours_config.json');
  }

  setStoragePath(customPath) {
    this.storagePath = customPath;
  }

  init(options = {}) {
    if (options.onStartTracking) this.onStartTrackingHandler = options.onStartTracking;
    if (options.onStopTracking) this.onStopTrackingHandler = options.onStopTracking;
    if (options.onStatusChanged) this.onStatusChangedHandler = options.onStatusChanged;
    if (options.storagePath) this.storagePath = options.storagePath;

    // 1. Load last-known-good configuration from disk
    this.loadConfiguration();

    // 2. Start monitoring timer loop & evaluate initial state
    this.startMonitoring();

    return this.evaluateSchedule(new Date());
  }

  resetForTesting() {
    this.destroy();
    this.activeConfig = null;
    this.isTracking = false;
    this.lastEvaluatedStatus = null;
  }

  parseConfiguration(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        isValid: false,
        isFullTime: false,
        hasFullTimeField: false,
        allowedDays: new Set(),
        workingHours: null,
        error: 'Configuration payload must be an object',
        raw: null
      };
    }

    const isFullTime = parseFullTime(raw.work_lens_full_time);
    const allowedDays = parseDays(raw.work_lens_day);
    const workingHours = parseWorkingHours(raw.work_lens_time);

    const parsed = {
      isFullTime: isFullTime === true,
      hasFullTimeField: isFullTime !== null,
      allowedDays,
      workingHours,
      raw: {
        work_lens_full_time: raw.work_lens_full_time !== undefined && raw.work_lens_full_time !== null ? String(raw.work_lens_full_time) : null,
        work_lens_day: raw.work_lens_day !== undefined && raw.work_lens_day !== null ? String(raw.work_lens_day) : null,
        work_lens_time: raw.work_lens_time !== undefined && raw.work_lens_time !== null ? String(raw.work_lens_time) : null
      }
    };

    const validation = this.validateConfiguration(parsed);
    parsed.isValid = validation.isValid;
    parsed.error = validation.error;
    return parsed;
  }

  validateConfiguration(config) {
    if (!config || typeof config !== 'object') {
      return { isValid: false, error: 'Configuration is null or not an object' };
    }

    if (config.isFullTime === true) {
      return { isValid: true, error: null };
    }

    if (!config.hasFullTimeField) {
      return { isValid: false, error: 'Missing or invalid work_lens_full_time field' };
    }

    // Restricted Mode validations
    if (!config.allowedDays || config.allowedDays.size === 0) {
      return { isValid: false, error: 'Restricted mode requires at least one valid allowed weekday in work_lens_day' };
    }

    if (!config.workingHours) {
      return { isValid: false, error: 'Restricted mode requires valid working hours in work_lens_time (format: "HH:MM, HH:MM")' };
    }

    return { isValid: true, error: null };
  }

  loadConfiguration() {
    const filePath = this.getStorageFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
      console.log('[WorkingHours] No cached configuration file found.');
      return null;
    }

    try {
      const rawContent = fs.readFileSync(filePath, 'utf8');
      if (!rawContent.trim()) return null;
      const json = JSON.parse(rawContent);
      const parsed = this.parseConfiguration(json);
      if (parsed.isValid) {
        this.activeConfig = parsed;
        console.log('[WorkingHours] Loaded last-known-good configuration from cache:', {
          isFullTime: parsed.isFullTime,
          allowedDays: Array.from(parsed.allowedDays),
          workingHours: parsed.workingHours ? parsed.workingHours.formatted : null
        });
        return parsed;
      } else {
        console.warn('[WorkingHours] Cached configuration was invalid:', parsed.error);
        return null;
      }
    } catch (err) {
      console.error('[WorkingHours] Failed to read cached configuration:', err.message);
      return null;
    }
  }

  saveConfiguration(config) {
    const filePath = this.getStorageFilePath();
    if (!filePath || !config || !config.isValid) return false;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const dataToStore = {
        work_lens_full_time: config.raw.work_lens_full_time,
        work_lens_day: config.raw.work_lens_day,
        work_lens_time: config.raw.work_lens_time,
        saved_at: new Date().toISOString()
      };
      fs.writeFileSync(filePath, JSON.stringify(dataToStore, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[WorkingHours] Failed to save configuration to cache:', err.message);
      return false;
    }
  }

  updateConfiguration(rawApiData) {
    if (!rawApiData || typeof rawApiData !== 'object') {
      console.warn('[WorkingHours] Received non-object configuration payload; ignoring.');
      return { success: false, error: 'Payload must be an object' };
    }

    // Only process if at least one work_lens field is present
    if (
      rawApiData.work_lens_full_time === undefined &&
      rawApiData.work_lens_time === undefined &&
      rawApiData.work_lens_day === undefined
    ) {
      return { success: false, error: 'Payload does not contain work_lens configuration fields' };
    }

    const parsed = this.parseConfiguration(rawApiData);

    if (!parsed.isValid) {
      console.warn(`[WorkingHours] Received invalid working hours configuration (${parsed.error}); retaining last-known-good configuration.`);
      return { success: false, error: parsed.error, retained: this.activeConfig };
    }

    // Check if configuration actually changed to avoid redundant restarts
    const hasChanged = !this.activeConfig ||
      this.activeConfig.isFullTime !== parsed.isFullTime ||
      this.activeConfig.raw.work_lens_day !== parsed.raw.work_lens_day ||
      this.activeConfig.raw.work_lens_time !== parsed.raw.work_lens_time;

    this.activeConfig = parsed;
    this.saveConfiguration(parsed);

    if (hasChanged) {
      console.log('[WorkingHours] Dynamic configuration updated from API:', {
        isFullTime: parsed.isFullTime,
        allowedDays: Array.from(parsed.allowedDays),
        workingHours: parsed.workingHours ? parsed.workingHours.formatted : null
      });
      this.evaluateAndApply(new Date());
    }

    return {
      success: true,
      config: parsed,
      permitted: this.canTrackNow(new Date())
    };
  }

  canTrackNow(date = new Date()) {
    const status = this.evaluateSchedule(date);
    return status.permitted;
  }

  evaluateSchedule(date = new Date()) {
    if (!this.activeConfig || !this.activeConfig.isValid) {
      return {
        permitted: false,
        reason: 'CONFIG_INVALID',
        displayStatus: 'Outside Working Hours',
        detail: this.activeConfig ? this.activeConfig.error : 'No valid working hours configuration available',
        nextAllowedStart: null,
        nextAllowedEnd: null
      };
    }

    if (this.activeConfig.isFullTime) {
      return {
        permitted: true,
        reason: 'FULL_TIME',
        displayStatus: 'Active',
        detail: 'Full-time 24/7 tracking enabled',
        nextAllowedStart: date,
        nextAllowedEnd: null
      };
    }

    const { allowedDays, workingHours } = this.activeConfig;
    const now = date;
    const dayIndex = now.getDay(); // 0 = Sunday, 1 = Monday, ...
    const prevDayIndex = (dayIndex + 6) % 7;
    const currentWeekday = VALID_WEEKDAYS[dayIndex];
    const previousWeekday = VALID_WEEKDAYS[prevDayIndex];

    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const startSeconds = workingHours.startMinutes * 60;
    const endSeconds = workingHours.endMinutes * 60;

    let permitted = false;
    let reason = '';
    let displayStatus = '';
    let detail = '';

    if (!workingHours.isOvernight) {
      // Standard daytime schedule: start < end
      const isWithinHours = currentSeconds >= startSeconds && currentSeconds < endSeconds;
      const isDayAllowed = allowedDays.has(currentWeekday);

      if (isDayAllowed && isWithinHours) {
        permitted = true;
        reason = 'WITHIN_HOURS';
        displayStatus = 'Active';
        detail = `Inside working hours (${formatTimePart(workingHours.start)} - ${formatTimePart(workingHours.end)}) on ${capitalize(currentWeekday)}`;
      } else if (!isDayAllowed) {
        permitted = false;
        reason = 'NON_WORKING_DAY';
        displayStatus = 'Non-Working Day';
        detail = `${capitalize(currentWeekday)} is not an allowed working day`;
      } else {
        permitted = false;
        reason = 'OUTSIDE_HOURS';
        displayStatus = 'Outside Working Hours';
        detail = `Current time (${formatCurrentTime(now)}) is outside working hours (${formatTimePart(workingHours.start)} - ${formatTimePart(workingHours.end)})`;
      }
    } else {
      // Overnight schedule: start > end (e.g. 21:00 to 06:00)
      if (currentSeconds >= startSeconds) {
        // Evening portion of schedule originating today
        const isDayAllowed = allowedDays.has(currentWeekday);
        if (isDayAllowed) {
          permitted = true;
          reason = 'WITHIN_HOURS';
          displayStatus = 'Active';
          detail = `Inside overnight working hours starting on ${capitalize(currentWeekday)}`;
        } else {
          permitted = false;
          reason = 'NON_WORKING_DAY';
          displayStatus = 'Non-Working Day';
          detail = `${capitalize(currentWeekday)} is not an allowed working day`;
        }
      } else if (currentSeconds < endSeconds) {
        // Early morning portion originating yesterday evening
        const wasPrevDayAllowed = allowedDays.has(previousWeekday);
        if (wasPrevDayAllowed) {
          permitted = true;
          reason = 'WITHIN_HOURS';
          displayStatus = 'Active';
          detail = `Inside overnight working hours continued from ${capitalize(previousWeekday)}`;
        } else {
          permitted = false;
          reason = 'OUTSIDE_HOURS';
          displayStatus = 'Outside Working Hours';
          detail = `Previous day (${capitalize(previousWeekday)}) was not an allowed working day`;
        }
      } else {
        // Daytime between endSeconds and startSeconds
        const isTodayAllowed = allowedDays.has(currentWeekday);
        if (!isTodayAllowed) {
          permitted = false;
          reason = 'NON_WORKING_DAY';
          displayStatus = 'Non-Working Day';
          detail = `${capitalize(currentWeekday)} is not an allowed working day`;
        } else {
          permitted = false;
          reason = 'OUTSIDE_HOURS';
          displayStatus = 'Outside Working Hours';
          detail = `Current time is between overnight shifts (${formatTimePart(workingHours.end)} - ${formatTimePart(workingHours.start)})`;
        }
      }
    }

    const nextStart = permitted ? null : this.getNextAllowedStart(now);
    const nextEnd = permitted ? this.computeWindowEnd(now) : null;

    return {
      permitted,
      reason,
      displayStatus,
      detail,
      nextAllowedStart: nextStart,
      nextAllowedEnd: nextEnd
    };
  }

  getNextAllowedStart(date = new Date()) {
    if (!this.activeConfig || !this.activeConfig.isValid) return null;
    if (this.activeConfig.isFullTime) return date;

    const { allowedDays, workingHours } = this.activeConfig;
    if (!allowedDays || allowedDays.size === 0 || !workingHours) return null;

    const now = date;

    for (let d = 0; d <= 7; d++) {
      const candidateDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 0, 0, 0, 0);
      const dayOfWeek = candidateDay.getDay();
      const dayName = VALID_WEEKDAYS[dayOfWeek];

      if (!allowedDays.has(dayName)) continue;

      const candidateStart = new Date(
        candidateDay.getFullYear(),
        candidateDay.getMonth(),
        candidateDay.getDate(),
        workingHours.start.hours,
        workingHours.start.minutes,
        0,
        0
      );

      if (candidateStart.getTime() > now.getTime()) {
        return candidateStart;
      }
    }

    return null;
  }

  computeWindowEnd(date = new Date()) {
    if (!this.activeConfig || !this.activeConfig.isValid || this.activeConfig.isFullTime) return null;
    const { workingHours } = this.activeConfig;
    if (!workingHours) return null;
    const now = date;
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const startSeconds = workingHours.startMinutes * 60;

    if (!workingHours.isOvernight) {
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        workingHours.end.hours,
        workingHours.end.minutes,
        0,
        0
      );
    } else {
      if (currentSeconds >= startSeconds) {
        return new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1,
          workingHours.end.hours,
          workingHours.end.minutes,
          0,
          0
        );
      } else {
        return new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          workingHours.end.hours,
          workingHours.end.minutes,
          0,
          0
        );
      }
    }
  }

  getNextAllowedEnd(date = new Date()) {
    if (!this.activeConfig || !this.activeConfig.isValid) return null;
    if (this.activeConfig.isFullTime) return null;
    const status = this.evaluateSchedule(date);
    if (!status.permitted) return null;
    return this.computeWindowEnd(date);
  }

  getTrackingStatus(date = new Date()) {
    return this.evaluateSchedule(date);
  }

  getActiveConfiguration() {
    if (!this.activeConfig) return null;
    return {
      isValid: this.activeConfig.isValid,
      isFullTime: this.activeConfig.isFullTime,
      allowedDays: Array.from(this.activeConfig.allowedDays),
      workingHours: this.activeConfig.workingHours ? {
        start: this.activeConfig.workingHours.start,
        end: this.activeConfig.workingHours.end,
        isOvernight: this.activeConfig.workingHours.isOvernight,
        formatted: this.activeConfig.workingHours.formatted
      } : null,
      raw: this.activeConfig.raw
    };
  }

  evaluateAndApply(date = new Date()) {
    const evalResult = this.evaluateSchedule(date);
    const wasPermitted = this.isTracking;

    if (evalResult.permitted && !wasPermitted) {
      console.log(`[WorkingHours] Tracking window STARTED: ${evalResult.detail}`);
      this.isTracking = true;
      if (typeof this.onStartTrackingHandler === 'function') {
        try {
          this.onStartTrackingHandler();
        } catch (err) {
          console.error('[WorkingHours] Error in onStartTrackingHandler:', err);
        }
      }
    } else if (!evalResult.permitted && wasPermitted) {
      console.log(`[WorkingHours] Tracking window STOPPED: ${evalResult.detail}`);
      this.isTracking = false;
      if (typeof this.onStopTrackingHandler === 'function') {
        try {
          this.onStopTrackingHandler(evalResult.reason);
        } catch (err) {
          console.error('[WorkingHours] Error in onStopTrackingHandler:', err);
        }
      }
    }

    if (typeof this.onStatusChangedHandler === 'function') {
      try {
        this.onStatusChangedHandler(evalResult);
      } catch (err) {
        console.error('[WorkingHours] Error in onStatusChangedHandler:', err);
      }
    }

    this.lastEvaluatedStatus = evalResult;
    this.scheduleNextBoundaryCheck(date);
    return evalResult;
  }

  scheduleNextBoundaryCheck(now = new Date()) {
    if (this.boundaryTimer) {
      clearTimeout(this.boundaryTimer);
      this.boundaryTimer = null;
    }

    if (!this.activeConfig || !this.activeConfig.isValid) return;
    if (this.activeConfig.isFullTime) return;

    const currentEval = this.evaluateSchedule(now);
    const targetTime = currentEval.permitted ? this.getNextAllowedEnd(now) : this.getNextAllowedStart(now);

    if (!targetTime) return;

    const diffMs = targetTime.getTime() - now.getTime();
    if (diffMs <= 0) {
      setImmediate(() => this.evaluateAndApply(new Date()));
      return;
    }

    // Safety buffer of 300ms to guarantee we land inside the next minute/second
    const delayMs = Math.min(diffMs + 300, 3600000); // Capped to max 1 hour
    this.boundaryTimer = setTimeout(() => {
      this.evaluateAndApply(new Date());
    }, delayMs);

    if (this.boundaryTimer.unref) {
      this.boundaryTimer.unref();
    }
  }

  startTracking() {
    this.isTracking = true;
    if (typeof this.onStartTrackingHandler === 'function') {
      try {
        this.onStartTrackingHandler();
      } catch (err) {
        console.error('[WorkingHours] Error starting tracking:', err);
      }
    }
  }

  stopTracking(reason = 'MANUAL') {
    this.isTracking = false;
    if (typeof this.onStopTrackingHandler === 'function') {
      try {
        this.onStopTrackingHandler(reason);
      } catch (err) {
        console.error('[WorkingHours] Error stopping tracking:', err);
      }
    }
  }

  startMonitoring() {
    if (!this.heartbeatTimer) {
      // Periodic heartbeat re-evaluation to handle sleep resume, system clock adjustments, etc.
      this.heartbeatTimer = setInterval(() => {
        this.evaluateAndApply(new Date());
      }, 30000);

      if (this.heartbeatTimer.unref) {
        this.heartbeatTimer.unref();
      }
    }
    this.evaluateAndApply(new Date());
  }

  stopMonitoring() {
    if (this.boundaryTimer) {
      clearTimeout(this.boundaryTimer);
      this.boundaryTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  destroy() {
    this.stopMonitoring();
    this.isTracking = false;
  }
}

// Export singleton instance as well as the class
const defaultController = new WorkingHoursController();

module.exports = defaultController;
module.exports.WorkingHoursController = WorkingHoursController;
