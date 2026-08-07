/**
 * modules/dashboard/services/activityService.js
 * 
 * Business Logic Service for Employee Activity tracking.
 * Consolidates real-time active/focus/idle durations, hardware telemetry,
 * application usage distribution, and the chronological activity timeline.
 */

export class ActivityService {
  constructor() {
    this.cachedMetrics = null;
    this.cachedLogs = null;
    this.lastFetched = 0;
    this.cacheDuration = 5000; // 5s cache
  }

  /**
   * Fetches today's active, focus, and idle durations, plus input hook counts.
   */
  async getActivityMetrics() {
    if (window.api && typeof window.api.getDashboardActivityMetrics === 'function') {
      const data = await window.api.getDashboardActivityMetrics();
      this.cachedMetrics = data;
      return data;
    }
    // Fallback Mock data for testing in standalone browser
    return {
      activeSeconds: 14400,
      focusSeconds: 12000,
      idleSeconds: 2400,
      keystrokes: 1250,
      mouseMoves: 4500,
      mouseClicks: 320,
      mouseScrolls: 85
    };
  }

  /**
   * Fetches today's sorted application/website usage list.
   */
  async getApplicationUsage() {
    if (window.api && typeof window.api.fetchActivityLogs === 'function') {
      const rawData = await window.api.fetchActivityLogs();
      let logs = Array.isArray(rawData) ? rawData : (rawData?.logs || rawData?.entries || []);
      
      const appMap = {};
      logs.forEach(entry => {
        if (entry.duration > 0) {
          const appName = entry.app_name || 'System';
          const status = (entry.status || 'active').toLowerCase();
          if (status === 'active' || status === 'offline') {
            appMap[appName] = (appMap[appName] || 0) + entry.duration;
          }
        }
      });

      return Object.keys(appMap)
        .map(name => ({ name, duration: appMap[name] }))
        .sort((a, b) => b.duration - a.duration);
    }
    // Standalone Mock fallback
    return [
      { name: 'Visual Studio Code', duration: 7200 },
      { name: 'Google Chrome', duration: 3600 },
      { name: 'Slack', duration: 1200 },
      { name: 'Microsoft Teams', duration: 800 }
    ];
  }

  /**
   * Generates a chronological recent timeline list of today's application sessions.
   */
  async getTimeline() {
    if (window.api && typeof window.api.fetchActivityLogs === 'function') {
      const rawData = await window.api.fetchActivityLogs();
      let logs = Array.isArray(rawData) ? rawData : (rawData?.logs || rawData?.entries || []);
      
      // Sort logs descending by start time
      return logs
        .filter(l => l.duration > 0)
        .map(l => {
          const time = l.start_time ? new Date(l.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '00:00';
          return {
            time,
            appName: l.app_name || 'System',
            title: l.window_title || 'Active Session',
            duration: l.duration,
            status: l.status || 'active'
          };
        })
        .slice(0, 10); // Show last 10 entries
    }
    
    // Standalone Mock fallback
    return [
      { time: '17:42', appName: 'Visual Studio Code', title: 'main.js - WorkLens', duration: 320, status: 'active' },
      { time: '17:35', appName: 'Slack', title: '#general-channel', duration: 180, status: 'active' },
      { time: '17:10', appName: 'Google Chrome', title: 'Redmine Issue #41203', duration: 900, status: 'active' },
      { time: '17:00', appName: 'System', title: 'Away / Inactive', duration: 300, status: 'inactive' }
    ];
  }
}
