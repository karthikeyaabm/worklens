/**
 * modules/dashboard/components/NotificationPanel.js
 * 
 * Widget displaying recent activities, reminders, and team announcements.
 */

import { Widget } from './Widget.js';

export class NotificationPanel extends Widget {
  async init() {
    this.notifications = [];
    if (this.services.notificationService) {
      this.notifications = await this.services.notificationService.getNotifications();
    }
  }

  getIconForType(type) {
    switch (type) {
      case 'Task Assigned': return '📥';
      case 'Task Updated': return '🔄';
      case 'Deadline Reminder': return '🔔';
      case 'Document Shared': return '📄';
      case 'Team Announcement': return '📢';
      default: return '💬';
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="notification-widget">
        <div class="widget-header-title">
          <h3>🔔 Recent Notifications</h3>
        </div>
        <div class="notification-list">
          ${this.renderNotifications()}
        </div>
      </div>
    `;
  }

  renderNotifications() {
    if (this.notifications.length === 0) {
      return `<div class="no-records">No notifications.</div>`;
    }

    return this.notifications.map(n => `
      <div class="notification-item ${n.unread ? 'unread' : ''}">
        <span class="notification-icon">${this.getIconForType(n.type)}</span>
        <div class="notification-body">
          <div class="notification-message">${n.message}</div>
          <div class="notification-meta">
            <span class="notification-type">${n.type}</span>
            <span class="notification-time">• ${n.timestamp}</span>
          </div>
        </div>
      </div>
    `).join('');
  }
}
