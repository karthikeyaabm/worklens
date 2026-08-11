/**
 * anti-afk/eventCollector.js
 *
 * Formats and forwards raw hardware/OS events to the rolling EventQueue.
 * Handles modifier key mappings, hold durations, mouse movement distance, and window changes.
 */

const EventQueue = require('./eventQueue');
const config = require('./config');

// uIOhook modifier keycodes (PC Scan Codes)
const MODIFIERS = new Set([
  29,   // Left Ctrl
  3613, // Right Ctrl
  42,   // Left Shift
  54,   // Right Shift
  56,   // Left Alt
  3640, // Right Alt
  3675, // Left Win / Cmd
  3676  // Right Win / Cmd
]);

class EventCollector {
  constructor() {
    this.queue = new EventQueue(config.rollingWindowSeconds);
    this.heldKeys = new Map(); // Map of keycode -> downTimestamp
    this.lastMouseX = null;
    this.lastMouseY = null;
    this.lastMouseMoveTime = Date.now();
    this.lastMouseClickTime = Date.now();
    this.lastWindowFocus = null; // { appName, windowTitle, timestamp }
  }

  /**
   * Record a key down event.
   * @param {number} keycode
   */
  recordKeyDown(keycode) {
    const now = Date.now();

    // Prevent keyboard auto-repeat from triggering multiple holds
    if (!this.heldKeys.has(keycode)) {
      this.heldKeys.set(keycode, now);
    }

    const isModifier = MODIFIERS.has(keycode);
    this.queue.pushKeyboard({
      type: 'keydown',
      keyCode: keycode,
      isModifier,
      timestamp: now
    });
  }

  /**
   * Record a key up event.
   * @param {number} keycode
   */
  recordKeyUp(keycode) {
    const now = Date.now();
    let holdDuration = 0;

    if (this.heldKeys.has(keycode)) {
      holdDuration = now - this.heldKeys.get(keycode);
      this.heldKeys.delete(keycode);
    }

    const isModifier = MODIFIERS.has(keycode);
    this.queue.pushKeyboard({
      type: 'keyup',
      keyCode: keycode,
      isModifier,
      holdDuration,
      timestamp: now
    });
  }

  /**
   * Record a mouse movement.
   * @param {number} x
   * @param {number} y
   */
  recordMouseMove(x, y) {
    const now = Date.now();
    let distance = 0;

    if (this.lastMouseX !== null && this.lastMouseY !== null) {
      distance = Math.sqrt(Math.pow(x - this.lastMouseX, 2) + Math.pow(y - this.lastMouseY, 2));
    }

    this.lastMouseX = x;
    this.lastMouseY = y;
    this.lastMouseMoveTime = now;

    this.queue.pushMouse({
      type: 'mousemove',
      x,
      y,
      distance,
      timestamp: now
    });
  }

  /**
   * Record a mouse click.
   * @param {number} button
   * @param {number} x
   * @param {number} y
   */
  recordMouseClick(button, x, y) {
    const now = Date.now();
    let distance = 0;

    if (this.lastMouseX !== null && this.lastMouseY !== null) {
      distance = Math.sqrt(Math.pow(x - this.lastMouseX, 2) + Math.pow(y - this.lastMouseY, 2));
    }

    // Inferred double-click detection (interval < 500ms and small movement distance)
    const isDoubleClick = (now - this.lastMouseClickTime < 500) && (distance < 5);

    this.lastMouseX = x;
    this.lastMouseY = y;
    this.lastMouseClickTime = now;

    this.queue.pushMouse({
      type: 'click',
      button,
      x,
      y,
      distance,
      isDoubleClick,
      timestamp: now
    });
  }

  /**
   * Record a mouse scroll/wheel event.
   * @param {boolean} horizontal
   * @param {number} rotation
   */
  recordMouseWheel(horizontal, rotation) {
    const now = Date.now();
    this.queue.pushMouse({
      type: 'wheel',
      horizontal: !!horizontal,
      rotation: rotation || 0,
      timestamp: now
    });
  }

  /**
   * Record an active window transition.
   * @param {string} appName
   * @param {string} windowTitle
   */
  recordWindowChange(appName, windowTitle) {
    const now = Date.now();
    let focusedDuration = 0;

    if (this.lastWindowFocus &&
        this.lastWindowFocus.appName === appName &&
        this.lastWindowFocus.windowTitle === windowTitle) {
      return;
    }

    if (this.lastWindowFocus) {
      focusedDuration = now - this.lastWindowFocus.timestamp;
      this.queue.pushWindow({
        type: 'windowFocusChanged',
        applicationName: this.lastWindowFocus.appName,
        windowTitle: this.lastWindowFocus.windowTitle,
        timestamp: this.lastWindowFocus.timestamp,
        focusedDuration
      });
    }

    this.lastWindowFocus = { appName, windowTitle, timestamp: now };
  }

  /**
   * Record system events (sleep, resume, lock, unlock).
   * @param {string} type
   * @param {any} data
   */
  recordSystemEvent(type, data = null) {
    const now = Date.now();
    this.queue.pushSystem({
      type,
      data,
      timestamp: now
    });
  }

  /**
   * Record system idle time polling.
   * @param {number} idleTime - Idle time in seconds.
   */
  recordIdleTime(idleTime) {
    const now = Date.now();
    this.queue.pushSystem({
      type: 'idleTime',
      idleTime,
      timestamp: now
    });
  }

  /**
   * Returns copy arrays of active events in the rolling window.
   */
  getEvents() {
    return this.queue.getEvents();
  }

  /**
   * Clears the collector state and event queues.
   */
  clear() {
    this.queue.clear();
    this.heldKeys.clear();
    this.lastMouseX = null;
    this.lastMouseY = null;
    this.lastMouseMoveTime = Date.now();
    this.lastMouseClickTime = Date.now();
    this.lastWindowFocus = null;
  }
}

module.exports = new EventCollector();
