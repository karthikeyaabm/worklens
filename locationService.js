// locationService.js
// Dedicated PC location provider and cache manager for WorkLens
const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

let electronModule = null;
try {
  electronModule = require('electron');
} catch (_) {}

// Configuration: Default refresh interval between 15-30 minutes (default 20 min)
const DEFAULT_REFRESH_INTERVAL_MS = 20 * 60 * 1000;
const LOCATION_TIMEOUT_MS = 8000;

let refreshIntervalTimer = null;
let isRefreshing = null; // Promise for in-flight deduplication
let mockLocationOverride = null;
let hiddenGeoWindow = null;

// Current cached location state
let cachedLocation = {
  latitude: null,
  longitude: null,
  current_address: null,
  location: null,
  updatedAt: null
};

/**
 * Resolves path to persistent location cache file in %APPDATA%/WorkLens
 */
function getLocationCacheFilePath() {
  const appData = process.env.APPDATA || (process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming')
    : path.join(os.homedir(), '.config'));
  return path.join(appData, 'WorkLens', 'location_cache.json');
}

/**
 * Loads previously persisted location from disk for instant T=0 availability
 */
function loadStoredLocation() {
  try {
    const filePath = getLocationCacheFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.latitude && parsed.longitude) {
          return {
            latitude: formatCoordinate(parsed.latitude),
            longitude: formatCoordinate(parsed.longitude),
            current_address: parsed.current_address || null,
            location: parsed.location || parsed.current_address || null,
            updatedAt: parsed.updatedAt || null
          };
        }
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Persists location to disk cache
 */
function saveStoredLocation(loc) {
  if (!loc || !loc.latitude || !loc.longitude) return;
  try {
    const filePath = getLocationCacheFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(loc, null, 2), 'utf8');
  } catch (_) {}
}

// Load cached location synchronously on startup
const stored = loadStoredLocation();
if (stored) {
  cachedLocation = { ...stored };
}

/**
 * Parses numeric coordinate safely into a standardized 4-decimal precision string or null
 * e.g., 18.5204 -> "18.5204"
 */
function formatCoordinate(val) {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(num)) return null;
  return num.toFixed(4);
}

/**
 * Formats a clean human-readable address from reverse geocode components
 */
function formatAddressString(addr) {
  if (!addr) return null;
  if (typeof addr === 'string') {
    const trimmed = addr.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  // Handle Nominatim address dictionary
  const parts = [];
  const road = addr.road || addr.street || addr.pedestrian || addr.amenity;
  const neigh = addr.neighbourhood || addr.quarter;
  const sub = addr.suburb || addr.residential || addr.commercial;

  if (road) parts.push(road);
  if (neigh && !parts.includes(neigh)) parts.push(neigh);
  if (sub && !parts.includes(sub)) parts.push(sub);

  const city = addr.city || addr.town || addr.municipality || addr.village || addr.city_district || addr.county;
  if (city && !parts.includes(city)) parts.push(city);

  const state = addr.state || addr.region;
  if (state && !parts.includes(state)) parts.push(state);

  const postcode = addr.postcode || addr.postal_code;
  let line = parts.join(', ');
  if (postcode) {
    line = `${line} ${postcode}`.trim();
  }

  return line.length > 0 ? line : null;
}

/**
 * Reverse geocodes latitude and longitude to a human-readable address.
 * Primary: OpenStreetMap Nominatim.
 * Fallback: BigDataCloud reverse geocode client.
 */
async function reverseGeocode(latitude, longitude) {
  if (!latitude || !longitude) return null;

  // 1. Primary: Nominatim Reverse Geocoding
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOCATION_TIMEOUT_MS);
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;

    const res = await fetch(nominatimUrl, {
      headers: { 'User-Agent': 'WorkLens-Desktop/1.1 (employee-timelog)' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.address) {
        const formatted = formatAddressString(data.address);
        if (formatted) return formatted;
      }
      if (data && data.display_name) {
        return data.display_name;
      }
    }
  } catch (_) {
    // Fallback to secondary reverse geocoder
  }

  // 2. Secondary: BigDataCloud Free Reverse Geocode Client
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOCATION_TIMEOUT_MS);
    const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;

    const res = await fetch(bdcUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data) {
        const locality = data.locality || data.city || '';
        const state = data.principalSubdivision || '';
        const post = data.postcode || '';
        const parts = [locality, state].filter(Boolean);
        let str = parts.join(', ');
        if (post) str = `${str} ${post}`.trim();
        if (str.length > 0) return str;
      }
    }
  } catch (_) {
    // Both failed
  }

  console.warn('[Location] Reverse geocoding failed');
  return null;
}

/**
 * High-Accuracy Geolocation Provider:
 * Uses Chromium's native Wi-Fi access point triangulation via an offscreen background BrowserWindow.
 * Provides exact street-level accuracy (e.g. Bandra Linking Road) instead of coarse ISP gateway IP location.
 */
async function fetchHighAccuracyLocation() {
  if (!electronModule || !electronModule.app || !electronModule.BrowserWindow) {
    return null;
  }
  const { app, BrowserWindow } = electronModule;
  if (!app.isReady || !app.isReady()) {
    return null;
  }

  try {
    if (!hiddenGeoWindow || hiddenGeoWindow.isDestroyed()) {
      hiddenGeoWindow = new BrowserWindow({
        show: false,
        width: 10,
        height: 10,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      hiddenGeoWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'geolocation') {
          return callback(true);
        }
        callback(false);
      });

      await hiddenGeoWindow.loadURL('https://example.com');
    }

    const pos = await hiddenGeoWindow.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          return reject(new Error('No geolocation API'));
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          }),
          (err) => reject(new Error(err.message)),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      });
    `);

    if (pos && pos.lat && pos.lon && !isNaN(pos.lat) && !isNaN(pos.lon)) {
      return {
        latitude: formatCoordinate(pos.lat),
        longitude: formatCoordinate(pos.lon),
        accuracy: pos.accuracy
      };
    }
  } catch (_) {
    // Falls back to secondary providers
  }
  return null;
}

/**
 * Attempts to retrieve coordinates from Windows Native Location Service (PowerShell GeoCoordinateWatcher)
 */
function fetchWindowsNativeLocation() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve(null);
    }

    const psScript = `
      try {
        Add-Type -AssemblyName System.Device;
        $w = New-Object System.Device.Location.GeoCoordinateWatcher;
        $w.Start();
        $i = 0;
        while ($w.Status -ne 'Ready' -and $i -lt 10) {
          Start-Sleep -Milliseconds 100;
          $i++;
        }
        $pos = $w.Position.Location;
        $w.Stop();
        $w.Dispose();
        if (-not $pos.IsUnknown -and $pos.Latitude -ne [Double]::NaN) {
          [PSCustomObject]@{ Lat = $pos.Latitude; Lon = $pos.Longitude } | ConvertTo-Json -Compress
        } else {
          '{}'
        }
      } catch {
        '{}'
      }
    `.replace(/\r?\n\s*/g, ' ');

    exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${psScript}"`, { timeout: 2500 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        const data = JSON.parse(stdout.trim());
        if (data && data.Lat && data.Lon && !isNaN(data.Lat) && !isNaN(data.Lon)) {
          return resolve({
            latitude: formatCoordinate(data.Lat),
            longitude: formatCoordinate(data.Lon)
          });
        }
      } catch (_) {}
      resolve(null);
    });
  });
}

/**
 * Attempts to retrieve coordinates from Network/IP-based Geolocation providers (fallback)
 */
async function fetchNetworkLocation() {
  // 1. Primary: ip-api.com
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOCATION_TIMEOUT_MS);
    const res = await fetch('http://ip-api.com/json', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'success' && data.lat !== undefined && data.lon !== undefined) {
        const fallbackAddress = [data.city, data.regionName, data.country].filter(Boolean).join(', ') + (data.zip ? ` ${data.zip}` : '');
        return {
          latitude: formatCoordinate(data.lat),
          longitude: formatCoordinate(data.lon),
          suggestedAddress: fallbackAddress
        };
      }
    }
  } catch (_) {}

  // 2. Secondary: freeipapi.com
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOCATION_TIMEOUT_MS);
    const res = await fetch('https://freeipapi.com/api/json', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.latitude !== undefined && data.longitude !== undefined) {
        const fallbackAddress = [data.cityName, data.regionName, data.countryName].filter(Boolean).join(', ') + (data.zipCode ? ` ${data.zipCode}` : '');
        return {
          latitude: formatCoordinate(data.latitude),
          longitude: formatCoordinate(data.longitude),
          suggestedAddress: fallbackAddress
        };
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Resolves current PC location from High-Accuracy Wi-Fi Triangulation -> Windows Native -> Network Geolocation -> Reverse Geocoding
 */
async function resolveCurrentPcLocation() {
  // Check test override first
  if (mockLocationOverride !== null) {
    return { ...mockLocationOverride };
  }

  try {
    // 1. Priority 1: High-accuracy Wi-Fi access point triangulation (street-level precision)
    let rawCoords = await fetchHighAccuracyLocation();
    let suggestedAddress = null;

    // 2. Priority 2: Windows Native Location Service
    if (!rawCoords || !rawCoords.latitude || !rawCoords.longitude) {
      const winLoc = await fetchWindowsNativeLocation();
      if (winLoc && winLoc.latitude && winLoc.longitude) {
        rawCoords = winLoc;
      }
    }

    // 3. Priority 3: Fallback to Network/IP Geolocation (ISP gateway)
    if (!rawCoords || !rawCoords.latitude || !rawCoords.longitude) {
      const netLoc = await fetchNetworkLocation();
      if (netLoc && netLoc.latitude && netLoc.longitude) {
        rawCoords = {
          latitude: netLoc.latitude,
          longitude: netLoc.longitude
        };
        suggestedAddress = netLoc.suggestedAddress || null;
      }
    }

    if (!rawCoords || !rawCoords.latitude || !rawCoords.longitude) {
      console.warn('[Location] Location unavailable');
      return {
        latitude: null,
        longitude: null,
        current_address: null,
        location: null,
        updatedAt: new Date().toISOString()
      };
    }

    // Perform reverse geocoding to obtain human-readable address
    let address = await reverseGeocode(rawCoords.latitude, rawCoords.longitude);
    if (!address && suggestedAddress) {
      address = suggestedAddress;
    }

    const resolved = {
      latitude: rawCoords.latitude,
      longitude: rawCoords.longitude,
      current_address: address || null,
      location: address || null,
      updatedAt: new Date().toISOString()
    };

    saveStoredLocation(resolved);
    console.log('[Location] Location update successful');
    return resolved;
  } catch (err) {
    console.warn('[Location] Location unavailable');
    return {
      latitude: null,
      longitude: null,
      current_address: null,
      location: null,
      updatedAt: new Date().toISOString()
    };
  }
}

/**
 * Refreshes the cached location. In-flight refresh promises are deduplicated.
 */
async function refreshLocation(force = false) {
  if (mockLocationOverride !== null) {
    cachedLocation = { ...mockLocationOverride };
    return cachedLocation;
  }

  if (isRefreshing) {
    return isRefreshing;
  }

  isRefreshing = (async () => {
    try {
      const fresh = await resolveCurrentPcLocation();
      cachedLocation = fresh;
      return cachedLocation;
    } finally {
      isRefreshing = null;
    }
  })();

  return isRefreshing;
}

/**
 * Returns the currently cached PC location object synchronously
 */
function getCurrentLocation() {
  if (mockLocationOverride !== null) {
    return {
      latitude: mockLocationOverride.latitude,
      longitude: mockLocationOverride.longitude,
      current_address: mockLocationOverride.current_address,
      location: mockLocationOverride.location || mockLocationOverride.current_address
    };
  }

  return {
    latitude: cachedLocation.latitude,
    longitude: cachedLocation.longitude,
    current_address: cachedLocation.current_address,
    location: cachedLocation.location || cachedLocation.current_address
  };
}

/**
 * Waits for initial location resolution on application launch (with max timeout)
 */
function waitForInitialLocation(timeoutMs = 3500) {
  if (cachedLocation && cachedLocation.latitude && cachedLocation.longitude) {
    return Promise.resolve(cachedLocation);
  }
  if (!isRefreshing) {
    refreshLocation().catch(() => {});
  }
  return Promise.race([
    isRefreshing,
    new Promise(resolve => setTimeout(() => resolve(cachedLocation), timeoutMs))
  ]);
}

/**
 * Initializes the location service: triggers initial async fetch and starts refresh timer
 */
function initLocationService(options = {}) {
  const envMinutes = process.env.WORKLENS_LOCATION_REFRESH_MINUTES ? parseInt(process.env.WORKLENS_LOCATION_REFRESH_MINUTES, 10) : null;
  const intervalMs = options.refreshIntervalMs || (envMinutes && !isNaN(envMinutes) ? envMinutes * 60 * 1000 : DEFAULT_REFRESH_INTERVAL_MS);

  if (refreshIntervalTimer) {
    clearInterval(refreshIntervalTimer);
    refreshIntervalTimer = null;
  }

  console.log('[Location] Location service initialized');

  // Trigger initial fetch
  refreshLocation().catch(() => {});

  // Setup periodic refresh
  refreshIntervalTimer = setInterval(() => {
    refreshLocation().catch(() => {});
  }, intervalMs);

  if (refreshIntervalTimer.unref) {
    refreshIntervalTimer.unref();
  }
}

/**
 * Stops periodic location refresh timers and destroys offscreen geo helper window
 */
function stopLocationService() {
  if (refreshIntervalTimer) {
    clearInterval(refreshIntervalTimer);
    refreshIntervalTimer = null;
  }
  if (hiddenGeoWindow && !hiddenGeoWindow.isDestroyed()) {
    hiddenGeoWindow.destroy();
    hiddenGeoWindow = null;
  }
  isRefreshing = null;
}

/**
 * Test Helper: Override location for automated test verification
 */
function setLocationForTesting(loc) {
  if (loc === null) {
    mockLocationOverride = null;
    cachedLocation = {
      latitude: null,
      longitude: null,
      current_address: null,
      location: null,
      updatedAt: null
    };
    return;
  }
  mockLocationOverride = {
    latitude: loc.latitude !== undefined && loc.latitude !== null ? formatCoordinate(loc.latitude) : null,
    longitude: loc.longitude !== undefined && loc.longitude !== null ? formatCoordinate(loc.longitude) : null,
    current_address: loc.current_address || null,
    location: loc.location || loc.current_address || null,
    updatedAt: new Date().toISOString()
  };
  cachedLocation = { ...mockLocationOverride };
}

/**
 * Test Helper: Reset test location override
 */
function resetLocationForTesting() {
  mockLocationOverride = null;
  cachedLocation = {
    latitude: null,
    longitude: null,
    current_address: null,
    location: null,
    updatedAt: null
  };
}

module.exports = {
  initLocationService,
  stopLocationService,
  getCurrentLocation,
  waitForInitialLocation,
  refreshLocation,
  resolveCurrentPcLocation,
  reverseGeocode,
  formatCoordinate,
  formatAddressString,
  setLocationForTesting,
  resetLocationForTesting
};
