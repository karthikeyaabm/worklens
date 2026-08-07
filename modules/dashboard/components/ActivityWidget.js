/**
 * modules/dashboard/components/ActivityWidget.js
 * 
 * Widget displaying detailed WorkLens hardware telemetry and app timeline.
 */

import { Widget } from './Widget.js';

export class ActivityWidget extends Widget {
  constructor(container, services) {
    super(container, services);
    this.metrics = {};
    this.apps = [];
    this.timeline = [];
  }

  async init() {
    if (this.services.activityService) {
      this.metrics = await this.services.activityService.getActivityMetrics();
      this.apps = await this.services.activityService.getApplicationUsage();
      this.timeline = await this.services.activityService.getTimeline();
    }
  }

  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  render() {
    const maxDuration = this.apps.length > 0 ? this.apps[0].duration : 1;

    this.container.innerHTML = `
      <div class="activity-widget">
        <div class="widget-header-title">
          <h3>⚡ WorkLens Activity</h3>
        </div>
        
        <div class="telemetry-stats">
          <div class="stat-item">
            <span class="stat-icon">⌨️</span>
            <div class="stat-details">
              <span class="stat-label">Keystrokes</span>
              <span class="stat-val" id="keystroke-count">${this.metrics.keystrokes || 0}</span>
            </div>
          </div>
          <div class="stat-item">
            <span class="stat-icon">🖱️</span>
            <div class="stat-details">
              <span class="stat-label">Mouse Actions</span>
              <span class="stat-val" id="mouse-count">${(this.metrics.mouseMoves || 0) + (this.metrics.mouseClicks || 0)}</span>
            </div>
          </div>
          <div class="stat-item">
            <span class="stat-icon">🕒</span>
            <div class="stat-details">
              <span class="stat-label">Idle Time</span>
              <span class="stat-val">${this.formatDuration(this.metrics.idleSeconds || 0)}</span>
            </div>
          </div>
        </div>

        <div class="widget-sub-section">
          <h4>Top Applications</h4>
          <div class="app-usage-list">
            ${this.apps.slice(0, 3).map(app => {
              const pct = Math.round((app.duration / maxDuration) * 100);
              return `
                <div class="app-usage-item">
                  <div class="app-usage-meta">
                    <span class="app-name">${app.name}</span>
                    <span class="app-time">${this.formatDuration(app.duration)}</span>
                  </div>
                  <div class="table-progress">
                    <div class="progress-bar-container">
                      <div class="table-progress-bar accent-bar" style="width: ${pct}%"></div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="widget-sub-section">
          <h4>Activity Timeline</h4>
          <div class="timeline-container">
            ${this.timeline.slice(0, 3).map(event => `
              <div class="timeline-item">
                <span class="timeline-time">${event.time}</span>
                <span class="timeline-dot status-${event.status}"></span>
                <div class="timeline-details">
                  <span class="timeline-app">${event.appName}</span>
                  <span class="timeline-title" title="${event.title}">${event.title}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }
}
