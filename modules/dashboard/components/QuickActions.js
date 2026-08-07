/**
 * modules/dashboard/components/QuickActions.js
 * 
 * Widget offering fast access keys for day-to-day employee actions.
 * Dispatches custom DOM events to trigger updates in adjacent widgets.
 */

import { Widget } from './Widget.js';

export class QuickActions extends Widget {
  render() {
    this.container.innerHTML = `
      <div class="quick-actions-widget">
        <div class="widget-header-title">
          <h3>⚡ Quick Actions</h3>
        </div>
        <div class="actions-buttons-grid">
          <button id="action-new-task" class="action-btn">
            <span class="btn-icon">➕</span>
            <span class="btn-text">New Task</span>
          </button>
          <button id="action-assign-task" class="action-btn">
            <span class="btn-icon">👤</span>
            <span class="btn-text">Assign Task</span>
          </button>
          <button id="action-upload-doc" class="action-btn">
            <span class="btn-icon">📤</span>
            <span class="btn-text">Upload Doc</span>
          </button>
          <button id="action-workspace" class="action-btn">
            <span class="btn-icon">💼</span>
            <span class="btn-text">Workspace</span>
          </button>
          <button id="action-reports" class="action-btn">
            <span class="btn-icon">📊</span>
            <span class="btn-text">View Reports</span>
          </button>
        </div>

        <!-- Hidden simple overlay dialog for task creation -->
        <div id="task-dialog" class="action-dialog hidden">
          <div class="dialog-content">
            <h4>Create New Task</h4>
            <div class="form-group">
              <label>Title</label>
              <input type="text" id="new-task-title" placeholder="Enter task title...">
            </div>
            <div class="form-group">
              <label>Priority</label>
              <select id="new-task-priority">
                <option value="High">High</option>
                <option value="Medium" selected>Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div class="dialog-actions">
              <button id="dialog-cancel" class="dialog-btn cancel">Cancel</button>
              <button id="dialog-submit" class="dialog-btn submit">Create</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const dialog = this.container.querySelector('#task-dialog');
    const titleInput = this.container.querySelector('#new-task-title');
    const prioritySelect = this.container.querySelector('#new-task-priority');

    this.container.querySelector('#action-new-task').addEventListener('click', () => {
      if (dialog) {
        dialog.classList.remove('hidden');
        titleInput.focus();
      }
    });

    this.container.querySelector('#dialog-cancel').addEventListener('click', () => {
      if (dialog) {
        dialog.classList.add('hidden');
        titleInput.value = '';
      }
    });

    this.container.querySelector('#dialog-submit').addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) return;

      if (this.services.taskService) {
        await this.services.taskService.createTask({
          title,
          priority: prioritySelect.value
        });
        
        // Hide dialog
        dialog.classList.add('hidden');
        titleInput.value = '';

        // Dispatch a global state-changed event so other widgets update automatically
        document.dispatchEvent(new CustomEvent('dashboard-data-changed'));
      }
    });

    this.container.querySelector('#action-assign-task').addEventListener('click', () => {
      const assignee = prompt('Enter employee name to assign a new task to:');
      if (assignee) {
        alert(`Assigned task successfully to: ${assignee}`);
        document.dispatchEvent(new CustomEvent('dashboard-data-changed'));
      }
    });

    this.container.querySelector('#action-upload-doc').addEventListener('click', () => {
      // Simulate file upload trigger by clicking the input in DocumentWidget if it exists
      const fileInput = document.querySelector('#quick-upload-input');
      if (fileInput) {
        fileInput.click();
      } else {
        alert('Upload document action triggered! Use the Document Workspace card to select a file.');
      }
    });

    this.container.querySelector('#action-workspace').addEventListener('click', () => {
      alert('Opening Personal Workspace... (In production, this opens the web portal)');
    });

    this.container.querySelector('#action-reports').addEventListener('click', () => {
      // Dispatches request-tab event to switch views or highlights the reports card
      const reportsWidget = document.querySelector('.reports-widget');
      if (reportsWidget) {
        reportsWidget.scrollIntoView({ behavior: 'smooth' });
        reportsWidget.style.outline = '2px solid rgba(96, 165, 250, 0.4)';
        setTimeout(() => reportsWidget.style.outline = 'none', 1500);
      }
    });
  }
}
