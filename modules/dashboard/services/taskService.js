/**
 * modules/dashboard/services/taskService.js
 * 
 * Service managing tasks (todos and issues).
 * Implements querying, search, sorting, filtering, and mutations,
 * prepared for future Redmine Issue Integration.
 */

export class TaskService {
  constructor() {
    this.tasks = [
      {
        id: 101,
        title: 'Fix memory leak in anti-AFK hook',
        priority: 'High',
        status: 'In Progress',
        dueDate: '2026-08-08',
        assignedBy: 'Karthikeya Kondavathri',
        progress: 45
      },
      {
        id: 102,
        title: 'Implement glassmorphism popup transitions',
        priority: 'High',
        status: 'Completed',
        dueDate: '2026-08-07',
        assignedBy: 'Karthikeya Kondavathri',
        progress: 100
      },
      {
        id: 103,
        title: 'Database connection retry optimization',
        priority: 'Medium',
        status: 'Pending',
        dueDate: '2026-08-10',
        assignedBy: 'Karthikeya Kondavathri',
        progress: 0
      },
      {
        id: 104,
        title: 'Draft weekly timesheet reports template',
        priority: 'Low',
        status: 'Overdue',
        dueDate: '2026-08-05',
        assignedBy: 'Admin',
        progress: 20
      },
      {
        id: 105,
        title: 'Configure automated NSIS production builder',
        priority: 'Medium',
        status: 'Pending',
        dueDate: '2026-08-12',
        assignedBy: 'Karthikeya Kondavathri',
        progress: 0
      }
    ];
  }

  async getTasks(options = {}) {
    let list = [...this.tasks];

    // Search
    if (options.search) {
      const q = options.search.toLowerCase();
      list = list.filter(t => t.title.toLowerCase().includes(q) || t.assignedBy.toLowerCase().includes(q));
    }

    // Filter by Status
    if (options.status && options.status !== 'All') {
      list = list.filter(t => t.status === options.status);
    }

    // Filter by Priority
    if (options.priority && options.priority !== 'All') {
      list = list.filter(t => t.priority === options.priority);
    }

    // Sort
    if (options.sortBy) {
      list.sort((a, b) => {
        if (options.sortBy === 'dueDate') {
          return new Date(a.dueDate) - new Date(b.dueDate);
        }
        if (options.sortBy === 'priority') {
          const priorityWeight = { High: 3, Medium: 2, Low: 1 };
          return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
        }
        if (options.sortBy === 'progress') {
          return b.progress - a.progress;
        }
        return 0;
      });
    }

    return list;
  }

  async getTaskSummary() {
    const todayStr = new Date().toISOString().split('T')[0];
    return {
      pending: this.tasks.filter(t => t.status === 'Pending' || t.status === 'In Progress').length,
      completedToday: this.tasks.filter(t => t.status === 'Completed').length, // For mock, all completed counted as today
      overdue: this.tasks.filter(t => t.status === 'Overdue' || (t.status !== 'Completed' && t.dueDate < todayStr)).length,
      upcomingDeadlines: this.tasks.filter(t => t.status !== 'Completed' && t.dueDate >= todayStr).length
    };
  }

  async createTask(taskData) {
    const newTask = {
      id: Date.now(),
      title: taskData.title || 'Untitled Task',
      priority: taskData.priority || 'Medium',
      status: 'Pending',
      dueDate: taskData.dueDate || new Date().toISOString().split('T')[0],
      assignedBy: 'Self',
      progress: 0
    };
    this.tasks.push(newTask);
    return newTask;
  }

  async assignTask(taskId, assignee) {
    const task = this.tasks.find(t => t.id === parseInt(taskId));
    if (task) {
      task.assignedBy = assignee;
      return task;
    }
    return null;
  }
}
