/**
 * modules/dashboard/services/reportService.js
 * 
 * Service managing statistical activity reports.
 * Supplies aggregate charts data for daily, weekly and monthly views.
 */

export class ReportService {
  constructor() {}

  async getDailySummary() {
    return {
      hoursWorked: 5.5,
      focusPercentage: 85,
      idleMinutes: 40,
      tasksCompleted: 3
    };
  }

  async getWeeklyChartData() {
    return [
      { day: 'Mon', activeHours: 6.8, idleHours: 1.2 },
      { day: 'Tue', activeHours: 7.2, idleHours: 0.8 },
      { day: 'Wed', activeHours: 5.5, idleHours: 1.5 },
      { day: 'Thu', activeHours: 6.0, idleHours: 1.0 },
      { day: 'Fri', activeHours: 4.8, idleHours: 0.5 }
    ];
  }

  async getMonthlyChartData() {
    return [
      { week: 'Week 1', focusHours: 32, idleHours: 6 },
      { week: 'Week 2', focusHours: 34, idleHours: 4 },
      { week: 'Week 3', focusHours: 29, idleHours: 8 },
      { week: 'Week 4', focusHours: 35, idleHours: 3 }
    ];
  }
}
