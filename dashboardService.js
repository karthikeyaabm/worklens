// dashboardService.js
/**
 * WorkLens - Dashboard External API Service
 * Handles testing connection to third-party endpoints and fetching dashboard telemetry
 * with SSRF protection, timeout management, and friendly error formatting.
 */

const { URL } = require('url');

/**
 * Validate URL and protect against Server-Side Request Forgery (SSRF).
 * Blocks loopback addresses and private IP blocks unless explicitly enabled.
 */
function validateEndpointUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('API endpoint must be a valid URL string.');
  }

  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    throw new Error('Invalid URL format. Please provide a valid HTTP or HTTPS endpoint.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS protocols are supported.');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Allow local mock testing if environment variable is set
  const allowLocal = process.env.ALLOW_LOCAL_DASHBOARD_APIS === 'true' || process.env.NODE_ENV === 'test';

  if (!allowLocal) {
    // Check for loopback & private RFC 1918 IPs
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
    const isPrivateIpv4 =
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname);

    if (isLoopback || isPrivateIpv4) {
      throw new Error('Security Error: Access to internal or private network addresses is restricted.');
    }
  }

  return parsed.toString();
}

/**
 * Build request headers according to authentication type and credentials.
 */
function buildAuthHeaders(authType = 'none', credentials = {}) {
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'WorkLens-Dashboard/1.2.0'
  };

  const normalizedAuth = String(authType).toLowerCase();
  const token = credentials.token ? String(credentials.token).trim() : '';

  if (normalizedAuth === 'bearer' && token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (normalizedAuth === 'apikey' || normalizedAuth === 'api_key') {
    if (token) {
      // Support custom header or standard X-API-Key
      headers['X-API-Key'] = token;
      // Also provide Authorization fallback if requested
      if (!headers['Authorization']) {
        headers['Authorization'] = `ApiKey ${token}`;
      }
    }
  } else if (normalizedAuth === 'basic') {
    const user = credentials.username || '';
    const pass = credentials.password || '';
    if (user || pass) {
      const basicAuth = Buffer.from(`${user}:${pass}`).toString('base64');
      headers['Authorization'] = `Basic ${basicAuth}`;
    }
  }

  return headers;
}

/**
 * Execute an HTTP request to the external API with timeout and error handling.
 */
async function executeApiRequest({
  endpoint,
  method = 'GET',
  authType = 'none',
  credentials = {},
  timeoutMs = 10000
}) {
  const validUrl = validateEndpointUrl(endpoint);
  const headers = buildAuthHeaders(authType, credentials);
  const upperMethod = String(method).toUpperCase();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const fetchOptions = {
    method: upperMethod,
    headers,
    signal: controller.signal
  };

  try {
    const response = await fetch(validUrl, fetchOptions);
    clearTimeout(timeoutId);

    const status = response.status;
    const contentType = response.headers.get('content-type') || '';
    const rawBody = await response.text();

    if (!response.ok) {
      let friendlyError = `HTTP Error ${status}`;
      if (status === 401) {
        friendlyError = 'API authentication failed. Please verify your API key or token.';
      } else if (status === 403) {
        friendlyError = 'Access forbidden. Your credentials do not have permission for this resource.';
      } else if (status === 404) {
        friendlyError = 'API endpoint not found (404). Please verify the URL.';
      } else if (status === 429) {
        friendlyError = 'API rate limit exceeded (429). Please try again later.';
      } else if (status >= 500) {
        friendlyError = `External server error (${status}). Please check with the API provider.`;
      }

      return {
        success: false,
        status,
        error: friendlyError,
        raw: rawBody ? rawBody.slice(0, 500) : null
      };
    }

    let parsedData;
    if (contentType.includes('application/json')) {
      try {
        parsedData = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        return {
          success: false,
          status,
          error: 'Invalid JSON response received from API.'
        };
      }
    } else {
      // If server returned plain text or other format, attempt JSON parse, otherwise wrap as text
      try {
        parsedData = JSON.parse(rawBody);
      } catch {
        parsedData = { message: rawBody };
      }
    }

    return {
      success: true,
      status,
      data: parsedData
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return {
        success: false,
        status: 408,
        error: `Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Please verify the endpoint is reachable.`
      };
    }
    return {
      success: false,
      status: 0,
      error: `Unable to connect to API: ${err.message || 'Network error'}`
    };
  }
}

/**
 * Test an API configuration before saving a dashboard.
 */
async function testApiConnection({
  endpoint,
  method = 'GET',
  authType = 'none',
  token = '',
  username = '',
  password = ''
}) {
  const credentials = { token, username, password };
  const result = await executeApiRequest({
    endpoint,
    method,
    authType,
    credentials,
    timeoutMs: 8000
  });

  if (result.success) {
    return {
      success: true,
      message: 'API connection successful',
      sample: result.data
    };
  }

  return {
    success: false,
    message: result.error || 'Unable to connect to API. Please check the endpoint and authentication details.'
  };
}

module.exports = {
  validateEndpointUrl,
  buildAuthHeaders,
  executeApiRequest,
  testApiConnection
};
