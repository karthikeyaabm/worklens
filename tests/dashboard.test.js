// tests/dashboard.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Ensure test environment uses a dedicated scratch directory
const testDataDir = path.join(__dirname, 'scratch_test_data');
process.env.NODE_ENV = 'test';

// Setup test store environment
if (!fs.existsSync(testDataDir)) {
  fs.mkdirSync(testDataDir, { recursive: true });
}

// Override store file path in dashboardStore
const dashboardStore = require('../dashboardStore');
const dashboardService = require('../dashboardService');

// Create an in-memory or custom file path for testing
const testStoreFile = path.join(testDataDir, 'dashboards.json');
if (fs.existsSync(testStoreFile)) fs.unlinkSync(testStoreFile);
dashboardStore.setStoreFilePath(testStoreFile);

// Mock a lightweight local HTTP server for API testing
let mockServer = null;
let mockPort = 0;

describe('WorkLens Dynamic Dashboard System', () => {
  before(async () => {
    // Start mock HTTP server
    await new Promise((resolve) => {
      mockServer = http.createServer((req, res) => {
        const url = req.url;
        const authHeader = req.headers['authorization'];
        const apiKeyHeader = req.headers['x-api-key'];

        if (url === '/api/tickets') {
          // Simulate IT Desk Tickets
          if (authHeader !== 'Bearer test-token-123') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            totalTickets: 120,
            openTickets: 40,
            closedTickets: 80,
            tickets: [
              { id: 'IT-101', title: 'Printer Issue', status: 'Open', priority: 'High' },
              { id: 'IT-102', title: 'VPN Failure', status: 'Closed', priority: 'Medium' }
            ]
          }));
        } else if (url === '/api/admin') {
          // Simulate Admin Desk with API Key
          if (apiKeyHeader !== 'admin-key-xyz' && authHeader !== 'ApiKey admin-key-xyz') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Forbidden' }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestsCount: 15,
            pendingApprovals: 5,
            requests: [
              { id: 'ADM-1', title: 'Access Card Request', department: 'HR', status: 'Pending' }
            ]
          }));
        } else if (url === '/api/error-500') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        }
      });

      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });
  });

  after(() => {
    if (mockServer) mockServer.close();
    try {
      if (fs.existsSync(testStoreFile)) fs.unlinkSync(testStoreFile);
      if (fs.existsSync(testDataDir)) fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Dashboard Store (Persistence, Isolation & Validation)', () => {
    test('createDashboard creates record and masks credentials on return', () => {
      const created = dashboardStore.createDashboard({
        name: 'IT Desk',
        endpoint: `http://127.0.0.1:${mockPort}/api/tickets`,
        method: 'GET',
        authType: 'bearer',
        token: 'test-token-123',
        companyId: 'company-a',
        createdBy: 'Karthikeya',
        userRole: 'Admin'
      });

      assert.ok(created.id);
      assert.equal(created.name, 'IT Desk');
      assert.equal(created.company_id, 'company-a');
      assert.equal(created.status, 'connected');
      // Token must NOT be exposed in plain text in returned object!
      assert.equal(created.credentials.token, undefined);
      assert.equal(created.credentials.hasToken, true);
      assert.equal(created.credentials.maskedToken, '••••••••');
    });

    test('prevents duplicate dashboard names within same company/tenant', () => {
      assert.throws(() => {
        dashboardStore.createDashboard({
          name: 'IT Desk',
          endpoint: `http://127.0.0.1:${mockPort}/api/tickets`,
          companyId: 'company-a',
          userRole: 'Admin'
        });
      }, /already exists/);
    });

    test('allows same dashboard name in a DIFFERENT company/tenant (tenant isolation)', () => {
      const createdB = dashboardStore.createDashboard({
        name: 'IT Desk',
        endpoint: `http://127.0.0.1:${mockPort}/api/tickets`,
        companyId: 'company-b',
        userRole: 'Admin'
      });

      assert.ok(createdB.id);
      assert.equal(createdB.company_id, 'company-b');

      // Tenant A should only see 1 dashboard
      const listA = dashboardStore.listDashboards('company-a');
      assert.equal(listA.length, 1);
      assert.equal(listA[0].company_id, 'company-a');

      // Tenant B should only see 1 dashboard
      const listB = dashboardStore.listDashboards('company-b');
      assert.equal(listB.length, 1);
      assert.equal(listB[0].company_id, 'company-b');
    });

    test('validates dashboard name bounds (2-50 characters)', () => {
      assert.throws(() => {
        dashboardStore.createDashboard({
          name: 'A', // too short
          endpoint: 'http://example.com/api',
          userRole: 'Admin'
        });
      }, /between 2 and 50/);

      assert.throws(() => {
        dashboardStore.createDashboard({
          name: 'A'.repeat(51), // too long
          endpoint: 'http://example.com/api',
          userRole: 'Admin'
        });
      }, /between 2 and 50/);
    });

    test('role authorization: Employee cannot create, update, or delete dashboards', () => {
      assert.throws(() => {
        dashboardStore.createDashboard({
          name: 'Unauthorized Dash',
          endpoint: 'http://example.com/api',
          userRole: 'Employee'
        });
      }, /Unauthorized/);
    });

    test('updateDashboard updates fields and preserves masked credentials', () => {
      const listA = dashboardStore.listDashboards('company-a');
      const target = listA[0];

      const updated = dashboardStore.updateDashboard(
        target.id,
        { name: 'IT Help Desk Updated', endpoint: `http://127.0.0.1:${mockPort}/api/tickets` },
        'company-a',
        'Admin'
      );

      assert.equal(updated.name, 'IT Help Desk Updated');
      assert.equal(updated.credentials.hasToken, true);

      // Verify raw secrets can be retrieved by backend for proxying
      const withSecrets = dashboardStore.getDashboardWithSecrets(target.id, 'company-a');
      assert.equal(withSecrets.credentials.token, 'test-token-123');
    });

    test('deleteDashboard removes configuration', () => {
      const listB = dashboardStore.listDashboards('company-b');
      const idToDelete = listB[0].id;

      const res = dashboardStore.deleteDashboard(idToDelete, 'company-b', 'Admin');
      assert.equal(res.success, true);

      const afterListB = dashboardStore.listDashboards('company-b');
      assert.equal(afterListB.length, 0);
    });
  });

  describe('2. Dashboard Service & SSRF Protection', () => {
    test('blocks loopback / private IP addresses when SSRF protection is active', () => {
      // Temporarily disable test bypass to test SSRF enforcement
      const oldEnv = process.env.NODE_ENV;
      const oldAllow = process.env.ALLOW_LOCAL_DASHBOARD_APIS;
      delete process.env.NODE_ENV;
      delete process.env.ALLOW_LOCAL_DASHBOARD_APIS;

      try {
        assert.throws(() => {
          dashboardService.validateEndpointUrl('http://127.0.0.1:8080/admin');
        }, /Security Error/);

        assert.throws(() => {
          dashboardService.validateEndpointUrl('http://localhost:3000/keys');
        }, /Security Error/);

        assert.throws(() => {
          dashboardService.validateEndpointUrl('http://192.168.1.1/api');
        }, /Security Error/);

        assert.throws(() => {
          dashboardService.validateEndpointUrl('http://10.0.0.5/api');
        }, /Security Error/);
      } finally {
        process.env.NODE_ENV = oldEnv;
        process.env.ALLOW_LOCAL_DASHBOARD_APIS = oldAllow;
      }
    });

    test('validates supported protocols (rejects ftp, file, javascript)', () => {
      assert.throws(() => {
        dashboardService.validateEndpointUrl('ftp://example.com/data');
      }, /Only HTTP and HTTPS/);

      assert.throws(() => {
        dashboardService.validateEndpointUrl('javascript:alert(1)');
      }, /Only HTTP and HTTPS|Invalid URL/);
    });

    test('builds Bearer and API Key authentication headers correctly', () => {
      const bearerHeaders = dashboardService.buildAuthHeaders('bearer', { token: 'my-secret' });
      assert.equal(bearerHeaders['Authorization'], 'Bearer my-secret');

      const apiKeyHeaders = dashboardService.buildAuthHeaders('apikey', { token: 'api-123' });
      assert.equal(apiKeyHeaders['X-API-Key'], 'api-123');

      const basicHeaders = dashboardService.buildAuthHeaders('basic', { username: 'user', password: 'pwd' });
      assert.ok(basicHeaders['Authorization'].startsWith('Basic '));
    });

    test('testApiConnection succeeds against authorized endpoint', async () => {
      const res = await dashboardService.testApiConnection({
        endpoint: `http://127.0.0.1:${mockPort}/api/tickets`,
        method: 'GET',
        authType: 'bearer',
        token: 'test-token-123'
      });

      assert.equal(res.success, true);
      assert.equal(res.message, 'API connection successful');
      assert.equal(res.sample.totalTickets, 120);
    });

    test('testApiConnection fails with friendly message on 401 Unauthorized', async () => {
      const res = await dashboardService.testApiConnection({
        endpoint: `http://127.0.0.1:${mockPort}/api/tickets`,
        method: 'GET',
        authType: 'bearer',
        token: 'wrong-token'
      });

      assert.equal(res.success, false);
      assert.match(res.message, /authentication failed/i);
    });

    test('testApiConnection handles 500 server error gracefully', async () => {
      const res = await dashboardService.testApiConnection({
        endpoint: `http://127.0.0.1:${mockPort}/api/error-500`,
        method: 'GET',
        authType: 'none'
      });

      assert.equal(res.success, false);
      assert.match(res.message, /server error/i);
    });
  });

  describe('3. Generic Data Renderer Parser Logic', () => {
    // Replicate core parsing functions from dashboard.js to verify logic
    function extractKpiNumbers(obj, prefix = '') {
      const kpis = [];
      function recurse(data, p) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        Object.keys(data).forEach(k => {
          const v = data[k];
          if (typeof v === 'number') {
            kpis.push({ key: p ? `${p}_${k}` : k, value: v });
          } else if (v && typeof v === 'object' && !Array.isArray(v) && ['summary', 'stats', 'totals', 'counts', 'metrics'].includes(k.toLowerCase())) {
            recurse(v, k);
          }
        });
      }
      recurse(obj, prefix);
      return kpis;
    }

    function extractTableRecords(data) {
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object') {
        const candidateKeys = ['tickets', 'items', 'data', 'records', 'issues', 'tasks', 'users', 'entries', 'rows', 'list', 'events'];
        for (const key of candidateKeys) {
          if (Array.isArray(data[key])) return data[key];
        }
      }
      return null;
    }

    test('extracts top-level and nested numeric KPI counts from API response', () => {
      const payload = {
        totalTickets: 120,
        openTickets: 40,
        closedTickets: 80,
        appName: 'IT Desk',
        metrics: {
          slaBreached: 2,
          avgResponseTimeHours: 1.5
        }
      };

      const kpis = extractKpiNumbers(payload);
      assert.equal(kpis.length, 5);
      assert.deepEqual(kpis.map(k => k.key), ['totalTickets', 'openTickets', 'closedTickets', 'metrics_slaBreached', 'metrics_avgResponseTimeHours']);
      assert.deepEqual(kpis.map(k => k.value), [120, 40, 80, 2, 1.5]);
    });

    test('extracts table records from array root or candidate property', () => {
      // 1. Root array
      const rootArray = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
      assert.equal(extractTableRecords(rootArray).length, 2);

      // 2. Wrapped under tickets key
      const wrapped = {
        summary: { total: 2 },
        tickets: [
          { id: 101, title: 'Network Down' },
          { id: 102, title: 'Email issue' }
        ]
      };
      const extracted = extractTableRecords(wrapped);
      assert.equal(extracted.length, 2);
      assert.equal(extracted[0].title, 'Network Down');
    });
  });
});
