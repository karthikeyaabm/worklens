/**
 * modules/dashboard/components/TaskList.js
 * 
 * Widget displaying the user's tasks.
 * Includes search inputs, filter selectors, sorting hooks and a progress bar.
 */

import { Widget } from './Widget.js';

export class TaskList extends Widget {
  constructor(container, services) {
    super(container, services);
    this.searchQuery = '';
    this.statusFilter = 'All';
    this.priorityFilter = 'All';
    this.sortBy = 'dueDate';
    this.tasksList = [];
  }

  async init() {
    await this.fetchTasks();
  }

  async fetchTasks() {
    if (this.services.taskService) {
      this.tasksList = await this.services.taskService.getTasks({
        search: this.searchQuery,
        status: this.statusFilter,
        priority: this.priorityFilter,
        sortBy: this.sortBy
      });
    }
  }

  getPriorityClass(priority) {
    return `priority-${(priority || 'medium').toLowerCase()}`;
  }

  getStatusClass(status) {
    return `status-${(status || 'pending').toLowerCase().replace(' ', '-')}`;
  }

  render() {
    this.container.innerHTML = `
      <div class="task-list-widget">
        <div class="widget-header-title">
          <h3>📋 My Tasks</h3>
        </div>
        <div class="task-controls">
          <input type="text" id="task-search" placeholder="Search tasks..." value="${this.searchQuery}">
          <select id="task-filter-status">
            <option value="All" ${this.statusFilter === 'All' ? 'selected' : ''}>All Statuses</option>
            <option value="Pending" ${this.statusFilter === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="In Progress" ${this.statusFilter === 'In Progress' ? 'selected' : ''}>In Progress</option>
            <option value="Completed" ${this.statusFilter === 'Completed' ? 'selected' : ''}>Completed</option>
            <option value="Overdue" ${this.statusFilter === 'Overdue' ? 'selected' : ''}>Overdue</option>
          </select>
          <select id="task-filter-priority">
            <option value="All" ${this.priorityFilter === 'All' ? 'selected' : ''}>All Priorities</option>
            <option value="High" ${this.priorityFilter === 'High' ? 'selected' : ''}>High</option>
            <option value="Medium" ${this.priorityFilter === 'Medium' ? 'selected' : ''}>Medium</option>
            <option value="Low" ${this.priorityFilter === 'Low' ? 'selected' : ''}>Low</option>
          </select>
          <select id="task-sort">
            <option value="dueDate" ${this.sortBy === 'dueDate' ? 'selected' : ''}>Sort by Due Date</option>
            <option value="priority" ${this.sortBy === 'priority' ? 'selected' : ''}>Sort by Priority</option>
            <option value="progress" ${this.sortBy === 'progress' ? 'selected' : ''}>Sort by Progress</option>
          </select>
        </div>
        <div class="task-table-wrapper">
          <table class="task-table">
            <thead>
              <tr>
                <th style="width: 32%;">Task Title</th>
                <th style="width: 14%;">Priority</th>
                <th style="width: 14%;">Status</th>
                <th style="width: 13%;">Due Date</th>
                <th style="width: 15%;">Assigned By</th>
                <th style="width: 12%;">Progress</th>
              </tr>
            </thead>
            <tbody id="task-rows">
              ${this.renderRows()}
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderRows() {
    if (this.tasksList.length === 0) {
      return `<tr><td colspan="6" class="no-records">No tasks found matching criteria.</td></tr>`;
    }

    return this.tasksList.map(task => `
      <tr>
        <td class="task-title" title="${task.title}">${task.title}</td>
        <td>
          <span class="badge ${this.getPriorityClass(task.priority)}">${task.priority}</span>
        </td>
        <td>
          <span class="badge ${this.getStatusClass(task.status)}">${task.status}</span>
        </td>
        <td class="task-date">${task.dueDate}</td>
        <td class="task-assigner">${task.assignedBy}</td>
        <td>
          <div class="table-progress">
            <div class="progress-bar-container">
              <div class="table-progress-bar" style="width: ${task.progress}%"></div>
            </div>
            <span class="progress-pct">${task.progress}%</span>
          </div>
        </td>
      </tr>
    `).join('');
  }

  bindEvents() {
    const searchInput = this.container.querySelector('#task-search');
    const statusSelect = this.container.querySelector('#task-filter-status');
    const prioritySelect = this.container.querySelector('#task-filter-priority');
    const sortSelect = this.container.querySelector('#task-sort');

    const updateTasks = async () => {
      this.searchQuery = searchInput.value;
      this.statusFilter = statusSelect.value;
      this.priorityFilter = prioritySelect.value;
      this.sortBy = sortSelect.value;
      await this.fetchTasks();
      const rowsContainer = this.container.querySelector('#task-rows');
      if (rowsContainer) {
        rowsContainer.innerHTML = this.renderRows();
      }
    };

    searchInput.addEventListener('input', updateTasks);
    statusSelect.addEventListener('change', updateTasks);
    prioritySelect.addEventListener('change', updateTasks);
    sortSelect.addEventListener('change', updateTasks);
  }
}
