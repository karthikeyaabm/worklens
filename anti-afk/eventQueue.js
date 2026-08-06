/**
 * anti-afk/eventQueue.js
 *
 * In-memory rolling event buffer.
 * It stores keyboard, mouse, window, and system events, automatically
 * removing events that exceed the rolling window duration.
 */

class EventQueue {
  /**
   * @param {number} windowSeconds - Size of the rolling window in seconds.
   */
  constructor(windowSeconds = 60) {
    this.windowMs = windowSeconds * 1000;
    this.keyboard = [];
    this.mouse = [];
    this.window = [];
    this.system = [];
  }

  /**
   * Push a keyboard event and clean the queue.
   */
  pushKeyboard(event) {
    this.keyboard.push(event);
    this.clean();
  }

  /**
   * Push a mouse event and clean the queue.
   */
  pushMouse(event) {
    this.mouse.push(event);
    this.clean();
  }

  /**
   * Push a window focus event and clean the queue.
   */
  pushWindow(event) {
    this.window.push(event);
    this.clean();
  }

  /**
   * Push a system status event and clean the queue.
   */
  pushSystem(event) {
    this.system.push(event);
    this.clean();
  }

  /**
   * Removes events older than the rolling window threshold from all sub-queues.
   */
  clean() {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    while (this.keyboard.length > 0 && this.keyboard[0].timestamp < cutoff) {
      this.keyboard.shift();
    }
    while (this.mouse.length > 0 && this.mouse[0].timestamp < cutoff) {
      this.mouse.shift();
    }
    while (this.window.length > 0 && this.window[0].timestamp < cutoff) {
      this.window.shift();
    }
    while (this.system.length > 0 && this.system[0].timestamp < cutoff) {
      this.system.shift();
    }
  }

  /**
   * Returns copy arrays of active events in the rolling window.
   */
  getEvents() {
    this.clean();
    return {
      keyboard: [...this.keyboard],
      mouse: [...this.mouse],
      window: [...this.window],
      system: [...this.system]
    };
  }

  /**
   * Clears all events in the queues.
   */
  clear() {
    this.keyboard = [];
    this.mouse = [];
    this.window = [];
    this.system = [];
  }
}

module.exports = EventQueue;
