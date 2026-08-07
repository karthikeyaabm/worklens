/**
 * modules/dashboard/components/ProjectWidget.js
 * 
 * Widget displaying group projects and their statuses.
 */

import { Widget } from './Widget.js';

export class ProjectWidget extends Widget {
  async init() {
    this.projects = [];
    if (this.services.projectService) {
      this.projects = await this.services.projectService.getProjects();
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="project-widget">
        <div class="widget-header-title">
          <h3>👥 Team Projects</h3>
        </div>
        <div class="project-list">
          ${this.renderProjects()}
        </div>
      </div>
    `;
  }

  renderProjects() {
    if (this.projects.length === 0) {
      return `<div class="no-records">No projects loaded.</div>`;
    }

    return this.projects.map(proj => `
      <div class="project-item">
        <div class="project-meta">
          <span class="project-name" title="${proj.name}">${proj.name}</span>
          <span class="project-tasks-badge">${proj.pendingTasks} tasks left</span>
        </div>
        <div class="project-completion">
          <div class="table-progress">
            <div class="progress-bar-container">
              <div class="table-progress-bar accent-bar" style="width: ${proj.completion}%"></div>
            </div>
            <span class="progress-pct">${proj.completion}%</span>
          </div>
        </div>
        <div class="project-details">
          <span class="project-members">👥 ${proj.members.join(', ')}</span>
        </div>
        <div class="project-update" title="${proj.recentUpdate}">
          <strong>Recent:</strong> ${proj.recentUpdate}
        </div>
      </div>
    `).join('');
  }
}
