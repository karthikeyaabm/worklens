// dashboardStore.js
/**
 * WorkLens - Dashboard Persistence Store
 * Manages custom dashboard configurations with tenant isolation, role validation,
 * and secure credential storage on the local filesystem.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let storeFilePath = null;

function setStoreFilePath(customPath) {
  storeFilePath = customPath;
}

function getStoreFilePath() {
  if (process.env.DASHBOARD_STORE_FILE) {
    return process.env.DASHBOARD_STORE_FILE;
  }
  if (!storeFilePath) {
    // If running in packaged or dev Electron
    const userDataDir = (app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : path.join(process.cwd(), '.worklens-data');
    
    if (!fs.existsSync(userDataDir)) {
      try {
        fs.mkdirSync(userDataDir, { recursive: true });
      } catch (e) {
        console.error('[DashboardStore] Error creating data directory:', e);
      }
    }
    storeFilePath = path.join(userDataDir, 'dashboards.json');
  }
  return storeFilePath;
}

function readAllDashboards() {
  const filePath = getStoreFilePath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[DashboardStore] Error reading dashboards store:', err);
    return [];
  }
}

function saveAllDashboards(dashboards) {
  const filePath = getStoreFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(dashboards, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[DashboardStore] Error saving dashboards store:', err);
    throw new Error('Failed to save dashboard configuration to disk.');
  }
}

/**
 * Mask sensitive credentials before passing dashboard record to renderer or public API.
 */
function maskDashboard(d) {
  if (!d) return null;
  const clone = { ...d };
  if (clone.credentials) {
    clone.credentials = {
      hasToken: Boolean(clone.credentials.token),
      hasUsername: Boolean(clone.credentials.username),
      maskedToken: clone.credentials.token ? '••••••••' : null,
      username: clone.credentials.username || null
    };
  }
  return clone;
}

/**
 * Check if the user role is authorized to perform mutation actions (Create / Edit / Delete).
 */
function isRoleAuthorized(role) {
  if (!role) return true; // Default fallback to allow if roles are disabled
  const normalized = String(role).trim().toLowerCase();
  // Admin and Manager can mutate, Employee can read
  return normalized === 'admin' || normalized === 'manager';
}

/**
 * List dashboards for a specific tenant / company.
 */
function listDashboards(companyId = 'default-company', role = null) {
  const all = readAllDashboards();
  const filtered = all.filter(d => (d.company_id || 'default-company') === companyId);
  return filtered.map(maskDashboard);
}

/**
 * Get a single dashboard (credentials masked).
 */
function getDashboard(id, companyId = 'default-company') {
  const all = readAllDashboards();
  const found = all.find(d => d.id === id && (d.company_id || 'default-company') === companyId);
  return maskDashboard(found);
}

/**
 * Get dashboard with raw credentials for internal API request execution only.
 * NEVER return this directly to renderer processes.
 */
function getDashboardWithSecrets(id, companyId = 'default-company') {
  const all = readAllDashboards();
  return all.find(d => d.id === id && (d.company_id || 'default-company') === companyId) || null;
}

/**
 * Create a new dashboard.
 */
function createDashboard({
  name,
  endpoint,
  method = 'GET',
  authType = 'none',
  token = '',
  username = '',
  password = '',
  companyId = 'default-company',
  createdBy = 'System',
  userRole = 'Admin'
}) {
  if (!isRoleAuthorized(userRole)) {
    throw new Error('Unauthorized: Only Admin or Manager users can create dashboards.');
  }

  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length < 2 || cleanName.length > 50) {
    throw new Error('Dashboard name must be between 2 and 50 characters.');
  }

  const cleanEndpoint = String(endpoint || '').trim();
  if (!cleanEndpoint) {
    throw new Error('API Endpoint is required.');
  }

  // Prevent duplicate names within the same tenant
  const all = readAllDashboards();
  const nameExists = all.some(
    d => (d.company_id || 'default-company') === companyId &&
         d.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (nameExists) {
    throw new Error(`A dashboard with the name "${cleanName}" already exists.`);
  }

  const newDashboard = {
    id: 'dash_' + crypto.randomUUID().slice(0, 8),
    company_id: companyId,
    name: cleanName,
    endpoint: cleanEndpoint,
    method: ['GET', 'POST'].includes(String(method).toUpperCase()) ? String(method).toUpperCase() : 'GET',
    auth_type: authType || 'none',
    credentials: {
      token: token ? String(token).trim() : '',
      username: username ? String(username).trim() : '',
      password: password ? String(password).trim() : ''
    },
    status: 'connected',
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  all.push(newDashboard);
  saveAllDashboards(all);

  return maskDashboard(newDashboard);
}

/**
 * Update an existing dashboard.
 */
function updateDashboard(id, updates, companyId = 'default-company', userRole = 'Admin') {
  if (!isRoleAuthorized(userRole)) {
    throw new Error('Unauthorized: Only Admin or Manager users can update dashboards.');
  }

  const all = readAllDashboards();
  const index = all.findIndex(d => d.id === id && (d.company_id || 'default-company') === companyId);
  if (index === -1) {
    throw new Error('Dashboard not found.');
  }

  const existing = all[index];

  // If renaming, check for collision
  if (updates.name && updates.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
    const cleanName = updates.name.trim();
    if (cleanName.length < 2 || cleanName.length > 50) {
      throw new Error('Dashboard name must be between 2 and 50 characters.');
    }
    const nameExists = all.some(
      (d, i) => i !== index &&
                (d.company_id || 'default-company') === companyId &&
                d.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (nameExists) {
      throw new Error(`A dashboard with the name "${cleanName}" already exists.`);
    }
    existing.name = cleanName;
  }

  if (updates.endpoint) {
    existing.endpoint = updates.endpoint.trim();
  }

  if (updates.method) {
    existing.method = String(updates.method).toUpperCase();
  }

  if (updates.authType !== undefined) {
    existing.auth_type = updates.authType;
  }

  if (updates.status) {
    existing.status = updates.status;
  }

  // Update credentials if provided, otherwise preserve existing
  if (updates.token !== undefined && updates.token !== null && updates.token !== '') {
    existing.credentials.token = String(updates.token).trim();
  }
  if (updates.username !== undefined) {
    existing.credentials.username = String(updates.username).trim();
  }
  if (updates.password !== undefined && updates.password !== '') {
    existing.credentials.password = String(updates.password).trim();
  }

  existing.updated_at = new Date().toISOString();
  all[index] = existing;
  saveAllDashboards(all);

  return maskDashboard(existing);
}

/**
 * Delete a dashboard.
 */
function deleteDashboard(id, companyId = 'default-company', userRole = 'Admin') {
  if (!isRoleAuthorized(userRole)) {
    throw new Error('Unauthorized: Only Admin or Manager users can delete dashboards.');
  }

  const all = readAllDashboards();
  const index = all.findIndex(d => d.id === id && (d.company_id || 'default-company') === companyId);
  if (index === -1) {
    throw new Error('Dashboard not found.');
  }

  const deleted = all.splice(index, 1)[0];
  saveAllDashboards(all);

  return { success: true, id: deleted.id, name: deleted.name };
}

module.exports = {
  getStoreFilePath,
  setStoreFilePath,
  listDashboards,
  getDashboard,
  getDashboardWithSecrets,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  maskDashboard,
  isRoleAuthorized
};
