/**
 * modules/dashboard/components/DashboardHeader.js
 * 
 * Header component displaying title, welcome greeting, date, and close button.
 */

import { Widget } from './Widget.js';

export class DashboardHeader extends Widget {
  async init() {
    this.profile = { displayName: 'Employee' };
    if (window.api && typeof window.api.getEmployeeProfile === 'function') {
      try {
        this.profile = await window.api.getEmployeeProfile();
      } catch (err) {
        console.error('Failed to load profile in header:', err);
      }
    }
  }

  render() {
    const hour = new Date().getHours();
    let greeting = "Good Morning";
    if (hour >= 12 && hour < 17) greeting = "Good Afternoon";
    else if (hour >= 17) greeting = "Good Evening";

    const name = this.profile.displayName || this.profile.username || 'Employee';
    const now = new Date();
    const dateOptions = { weekday: 'long', month: 'short', day: 'numeric' };
    const dateString = now.toLocaleDateString('en-US', dateOptions);

    this.container.innerHTML = `
      <div class="header-main">
        <div class="header-left">
          <span class="hub-logo">⚡</span>
          <div class="header-titles">
            <h1>WorkLens Productivity Hub</h1>
            <div class="hub-subtitle">👋 ${greeting}, <span class="highlight-name">${name}</span></div>
          </div>
        </div>
        <div class="header-right">
          <span class="hub-date">${dateString}</span>
          <button id="close-btn" class="close-button" title="Close popup">&times;</button>
        </div>
      </div>
    `;

    // Hook up close button
    const closeBtn = this.container.querySelector('#close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        // Dispatch custom event to trigger orchestrator close
        this.container.dispatchEvent(new CustomEvent('request-close-animation', { bubbles: true }));
      });
    }
  }
}
