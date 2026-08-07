/**
 * modules/dashboard/components/SummaryCards.js
 * 
 * Widget displaying top performance cards in a grid.
 */

import { Widget } from './Widget.js';

export class SummaryCards extends Widget {
  async init() {
    this.taskSummary = { pending: 0, completedToday: 0, overdue: 0, upcomingDeadlines: 0 };
    this.metrics = { activeSeconds: 0, focusSeconds: 0, idleSeconds: 0 };

    if (this.services.taskService) {
      this.taskSummary = await this.services.taskService.getTaskSummary();
    }

    if (this.services.activityService) {
      this.metrics = await this.services.activityService.getActivityMetrics();
    }
  }

  formatHours(seconds) {
    const hours = seconds / 3600;
    if (hours === 0) return '0h';
    if (Number.isInteger(hours)) return `${hours}h`;
    return `${hours.toFixed(1)}h`;
  }

  render() {
    const totalSeconds = this.metrics.focusSeconds + this.metrics.idleSeconds;
    const productivityScore = totalSeconds > 0 
      ? Math.round((this.metrics.focusSeconds / totalSeconds) * 100) 
      : 100;

    this.container.innerHTML = `
      <div class="summary-cards-grid">
        <div class="summary-card pending">
          <div class="card-icon">📋</div>
          <div class="card-info">
            <span class="card-label">Pending Tasks</span>
            <span class="card-val">${this.taskSummary.pending}</span>
          </div>
        </div>
        <div class="summary-card completed">
          <div class="card-icon">✅</div>
          <div class="card-info">
            <span class="card-label">Completed Today</span>
            <span class="card-val">${this.taskSummary.completedToday}</span>
          </div>
        </div>
        <div class="summary-card overdue">
          <div class="card-icon">⚠️</div>
          <div class="card-info">
            <span class="card-label">Overdue Tasks</span>
            <span class="card-val">${this.taskSummary.overdue}</span>
          </div>
        </div>
        <div class="summary-card upcoming">
          <div class="card-icon">⏳</div>
          <div class="card-info">
            <span class="card-label">Deadlines</span>
            <span class="card-val">${this.taskSummary.upcomingDeadlines}</span>
          </div>
        </div>
        <div class="summary-card active-time">
          <div class="card-icon">⏱️</div>
          <div class="card-info">
            <span class="card-label">Active Time</span>
            <span class="card-val">${this.formatHours(this.metrics.activeSeconds)}</span>
          </div>
        </div>
        <div class="summary-card score">
          <div class="card-icon">📈</div>
          <div class="card-info">
            <span class="card-label">Productivity</span>
            <span class="card-val">${productivityScore}%</span>
          </div>
        </div>
      </div>
    `;
  }
}
