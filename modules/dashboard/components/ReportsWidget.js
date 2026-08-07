/**
 * modules/dashboard/components/ReportsWidget.js
 * 
 * Widget displaying productivity charts and summary aggregates.
 * Implements SVG-rendered charts and tab controllers.
 */

import { Widget } from './Widget.js';

export class ReportsWidget extends Widget {
  constructor(container, services) {
    super(container, services);
    this.activeTab = 'weekly'; // 'daily', 'weekly', 'monthly'
    this.dailyData = {};
    this.weeklyData = [];
    this.monthlyData = [];
  }

  async init() {
    if (this.services.reportService) {
      this.dailyData = await this.services.reportService.getDailySummary();
      this.weeklyData = await this.services.reportService.getWeeklyChartData();
      this.monthlyData = await this.services.reportService.getMonthlyChartData();
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="reports-widget">
        <div class="widget-header-title">
          <h3>📊 Productivity Reports</h3>
          <div class="report-tabs">
            <button class="tab-btn ${this.activeTab === 'daily' ? 'active' : ''}" data-tab="daily">Daily</button>
            <button class="tab-btn ${this.activeTab === 'weekly' ? 'active' : ''}" data-tab="weekly">Weekly</button>
            <button class="tab-btn ${this.activeTab === 'monthly' ? 'active' : ''}" data-tab="monthly">Monthly</button>
          </div>
        </div>
        
        <div class="report-view-content">
          ${this.renderActiveTabContent()}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderActiveTabContent() {
    if (this.activeTab === 'daily') {
      return `
        <div class="daily-summary-container">
          <div class="daily-metric">
            <span class="metric-num">${this.dailyData.hoursWorked} hrs</span>
            <span class="metric-lbl">Hours Tracked</span>
          </div>
          <div class="daily-metric">
            <span class="metric-num">${this.dailyData.focusPercentage}%</span>
            <span class="metric-lbl">Focus Time</span>
          </div>
          <div class="daily-metric">
            <span class="metric-num">${this.dailyData.idleMinutes} mins</span>
            <span class="metric-lbl">Idle Time</span>
          </div>
          <div class="daily-metric">
            <span class="metric-num">${this.dailyData.tasksCompleted}</span>
            <span class="metric-lbl">Tasks Done</span>
          </div>
        </div>
      `;
    }

    if (this.activeTab === 'weekly') {
      // Build SVG Bar Chart for Weekly Active Hours
      const maxVal = 8; // Max scale hours
      const chartWidth = 350;
      const chartHeight = 120;
      const barSpacing = 65;
      const startX = 35;
      
      const bars = this.weeklyData.map((d, index) => {
        const x = startX + (index * barSpacing);
        // Active bar
        const activeBarHeight = (d.activeHours / maxVal) * (chartHeight - 30);
        const activeY = chartHeight - 20 - activeBarHeight;
        // Idle bar
        const idleBarHeight = (d.idleHours / maxVal) * (chartHeight - 30);
        const idleY = chartHeight - 20 - idleBarHeight;

        return `
          <g>
            <!-- Active Hour Bar -->
            <rect x="${x}" y="${activeY}" width="18" height="${activeBarHeight}" rx="3" fill="#60a5fa" />
            <!-- Idle Hour Bar -->
            <rect x="${x + 22}" y="${idleY}" width="10" height="${idleBarHeight}" rx="2" fill="#ef4444" opacity="0.7" />
            <!-- Label -->
            <text x="${x + 16}" y="${chartHeight - 4}" fill="#9CA3AF" font-size="9" text-anchor="middle">${d.day}</text>
          </g>
        `;
      }).join('');

      return `
        <div class="chart-container">
          <svg viewBox="0 0 ${chartWidth} ${chartHeight}" width="100%" height="${chartHeight}">
            <!-- Y Axis Grids -->
            <line x1="25" y1="20" x2="${chartWidth}" y2="20" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2" />
            <line x1="25" y1="55" x2="${chartWidth}" y2="55" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2" />
            <line x1="25" y1="90" x2="${chartWidth}" y2="90" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2" />
            <!-- Y Axis Labels -->
            <text x="20" y="23" fill="#9CA3AF" font-size="8" text-anchor="end">8h</text>
            <text x="20" y="58" fill="#9CA3AF" font-size="8" text-anchor="end">4h</text>
            <text x="20" y="93" fill="#9CA3AF" font-size="8" text-anchor="end">0h</text>
            
            <line x1="25" y1="90" x2="${chartWidth}" y2="90" stroke="rgba(255,255,255,0.15)" />
            ${bars}
          </svg>
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-color active-color"></span> Active Hours</span>
            <span class="legend-item"><span class="legend-color idle-color"></span> Idle Hours</span>
          </div>
        </div>
      `;
    }

    if (this.activeTab === 'monthly') {
      // Build SVG Area or Bar Chart for Monthly Focus Hours
      const maxVal = 40;
      const chartWidth = 350;
      const chartHeight = 120;
      const barSpacing = 75;
      const startX = 40;

      const bars = this.monthlyData.map((d, index) => {
        const x = startX + (index * barSpacing);
        const focusBarHeight = (d.focusHours / maxVal) * (chartHeight - 30);
        const focusY = chartHeight - 20 - focusBarHeight;

        return `
          <g>
            <rect x="${x}" y="${focusY}" width="25" height="${focusBarHeight}" rx="4" fill="#3b82f6" />
            <text x="${x + 12}" y="${chartHeight - 4}" fill="#9CA3AF" font-size="9" text-anchor="middle">${d.week}</text>
          </g>
        `;
      }).join('');

      return `
        <div class="chart-container">
          <svg viewBox="0 0 ${chartWidth} ${chartHeight}" width="100%" height="${chartHeight}">
            <!-- Y Axis Grids -->
            <line x1="30" y1="20" x2="${chartWidth}" y2="20" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2" />
            <line x1="30" y1="55" x2="${chartWidth}" y2="55" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2" />
            <line x1="30" y1="90" x2="${chartWidth}" y2="90" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2" />
            
            <text x="25" y="23" fill="#9CA3AF" font-size="8" text-anchor="end">40h</text>
            <text x="25" y="58" fill="#9CA3AF" font-size="8" text-anchor="end">20h</text>
            <text x="25" y="93" fill="#9CA3AF" font-size="8" text-anchor="end">0h</text>
            
            <line x1="30" y1="90" x2="${chartWidth}" y2="90" stroke="rgba(255,255,255,0.15)" />
            ${bars}
          </svg>
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-color active-color"></span> Weekly Focus Hours</span>
          </div>
        </div>
      `;
    }
  }

  bindEvents() {
    const tabBtns = this.container.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.getAttribute('data-tab');
        this.render();
      });
    });
  }
}
