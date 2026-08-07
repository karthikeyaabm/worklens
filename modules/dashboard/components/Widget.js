/**
 * modules/dashboard/components/Widget.js
 * 
 * Abstract base class defining the component lifecycle for pluggable dashboard widgets.
 */

export class Widget {
  /**
   * @param {HTMLElement} container The DOM element where the widget will mount.
   * @param {Object} services Map of dependency-injected services.
   */
  constructor(container, services) {
    if (new.target === Widget) {
      throw new TypeError("Cannot construct Widget instances directly");
    }
    this.container = container;
    this.services = services;
  }

  /**
   * Lifecycle Hook: Initialize data, event listeners, or timers.
   */
  async init() {}

  /**
   * Lifecycle Hook: Render visual elements inside the container.
   */
  render() {}

  /**
   * Lifecycle Hook: Clean up event listeners, intervals, and memory logs.
   */
  destroy() {}
}
