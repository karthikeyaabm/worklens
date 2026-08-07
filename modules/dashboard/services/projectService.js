/**
 * modules/dashboard/services/projectService.js
 * 
 * Service managing group projects.
 * Supports retrieval of completion status, member list, and project logs.
 */

export class ProjectService {
  constructor() {
    this.projects = [
      {
        id: 1,
        name: 'WorkLens Desktop Client',
        completion: 82,
        members: ['Karthikeya', 'Srinivas', 'Pranathi'],
        pendingTasks: 4,
        recentUpdate: 'Commit: Optimized memory usage in hardware input polling.'
      },
      {
        id: 2,
        name: 'Redmine Sync Gateway',
        completion: 95,
        members: ['Karthikeya', 'Ananya'],
        pendingTasks: 1,
        recentUpdate: 'Version: Released v1.2.0 API gateway stable.'
      },
      {
        id: 3,
        name: 'Employee Analytics Portal',
        completion: 38,
        members: ['Pranathi', 'Venkatesh'],
        pendingTasks: 12,
        recentUpdate: 'Mockup: Finalized Figma user flow mockups.'
      }
    ];
  }

  async getProjects() {
    return [...this.projects];
  }
}
