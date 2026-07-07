// redmineClient.js
const path = require('path');
const { app } = require('electron');
const dotenv = require('dotenv');

// Load .env correctly in both development and packaged app
dotenv.config({
  path: app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(__dirname, '.env')
});

const BASE_URL = process.env.REDMINE_BASE_URL
  ? process.env.REDMINE_BASE_URL.replace(/\/$/, '')
  : '';

const API_KEY = process.env.REDMINE_API_KEY || '';

console.log('===== ENV CHECK =====');
console.log('Packaged :', app.isPackaged);
console.log('BASE_URL :', BASE_URL);
console.log('API_KEY  :', API_KEY ? 'Loaded' : 'Missing');
console.log('=====================');

function buildUrl(endpoint, params = {}) {
  const baseUrl = (process.env.REDMINE_BASE_URL || BASE_URL).replace(/\/$/, '');
  const apiKey = process.env.REDMINE_API_KEY || API_KEY;

  const cleanParams = {};
  Object.keys(params).forEach(k => {
    if (params[k] !== undefined && params[k] !== null) cleanParams[k] = params[k];
  });

  // CHANGED: appending key as a query param since the shared URLs (today_timesheet.json,
  // user_system_activity_logs*.json) look like they expect ?...&key=API_KEY.
  // Header X-Redmine-API-Key bhi neeche bhej rahe hain as a fallback — jo bhi plugin
  // actually read karta hai wahi use ho jayega. Logs check karke confirm kar lena.
  cleanParams.key = apiKey;

  const queryStr = '?' + new URLSearchParams(cleanParams).toString();
  return { url: `${baseUrl}${endpoint}${queryStr}`, apiKey };
}

async function request(endpoint, params = {}, options = {}) {
  const { url, apiKey } = buildUrl(endpoint, params);

  if (!apiKey) {
    throw new Error('Redmine configuration missing: REDMINE_API_KEY is not defined in environment variables.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  const fetchOptions = {
    ...options,
    headers: {
      'X-Redmine-API-Key': apiKey,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: controller.signal
  };

  try {
    console.log(`[RedmineClient] Request: ${options.method || 'GET'} ${url}`);
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    console.log("\n========== RESPONSE ==========");
    console.log("Status       :", response.status);
    console.log("Status Text  :", response.statusText);
    console.log("OK           :", response.ok);
    console.log("Content-Type :", response.headers.get('content-type'));
    console.log("==============================");

    const responseBody = await response.text();

    console.log("\n========== RESPONSE BODY ==========");
    console.log(responseBody);

    if (!response.ok) {
      throw new Error(
        `HTTP Error ${response.status}: ${response.statusText} - ${responseBody}`
      );
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return responseBody ? JSON.parse(responseBody) : {};
    }

    return responseBody ? { message: responseBody } : {};
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`[RedmineClient] Timeout requesting ${url}`);
      throw new Error(`Request timed out (10s): ${url}`);
    }
    console.error(`[RedmineClient] Error requesting ${url}:`, error.message || error);
    throw error;
  }
}

module.exports = {
  // CHANGED: get() now just forwards params to buildUrl (key auto-added there).
  get: (endpoint, params = {}) => request(endpoint, params, { method: 'GET' }),

  // CHANGED: post()/put() also accept optional query params, in case the API
  // wants ?key=... on write calls too (not just GET).
  post: (endpoint, body, params = {}) => request(endpoint, params, {
    method: 'POST',
    body: JSON.stringify(body)
  }),

  /*put: (endpoint, body, params = {}) => request(endpoint, params, {
    method: 'PUT',
    body: JSON.stringify(body)
  })*/
};