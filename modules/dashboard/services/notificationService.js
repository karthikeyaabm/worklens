/**
 * modules/dashboard/services/notificationService.js
 * 
 * Service managing notifications, updates, announcements and alerts.
 */

export class NotificationService {
  constructor() {
    this.notifications = [
      {
        id: 1,
        type: 'Task Assigned',
        message: 'New task assigned: "Configure automated NSIS production builder" by Karthikeya.',
        timestamp: '10 mins ago',
        unread: true
      },
      {
        id: 2,
        type: 'Task Updated',
        message: 'Progress updated on task "Fix memory leak in anti-AFK hook" to 45%.',
        timestamp: '1 hour ago',
        unread: true
      },
      {
        id: 3,
        type: 'Deadline Reminder',
        message: 'Task "Draft weekly timesheet reports template" is overdue.',
        timestamp: '3 hours ago',
        unread: false
      },
      {
        id: 4,
        type: 'Document Shared',
        message: 'Pranathi uploaded and shared: "WorkLens_Architecture_v3.pdf" in group folder.',
        timestamp: 'Yesterday',
        unread: false
      },
      {
        id: 5,
        type: 'Team Announcement',
        message: 'System upgrade: Redmine API server will be offline for maintenance on Saturday from 2 AM to 4 AM.',
        timestamp: '2 days ago',
        unread: false
      }
    ];
  }

  async getNotifications() {
    return [...this.notifications];
  }

  async markAllAsRead() {
    this.notifications.forEach(n => n.unread = false);
    return true;
  }
}
