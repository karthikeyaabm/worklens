const fs = require('fs');

// 1. Update CHANGELOG.md
let changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

const newEntry = `## [1.3.0] - 2026-10-29
### Added
- **Single-Source Today Total Time Synchronization across Historical Dashboards**: Unified Today's active duration across the Today tab, Last 7 Days, and Last 30 Days views. Extracted centralized \`getAuthoritativeTodayActivity(userId, currentOsUser)\` in \`main.js\` to ensure the live in-progress session and merged records are accurately reflected in Today's row and footer totals across all dashboard periods.
- **Dynamic Today Synchronization on Tab Switching**: Enhanced \`renderHistoryView\` in \`renderer/activity-popup.js\` to dynamically synchronize Today's row with \`clientViewCache.today\`, ensuring identical progress bar width, duration text, session timestamps, and dual footer totals.
- **Dashboard Live Refresh Cache Busting (\`forceRefresh\`)**: Extended \`preload.js\` and \`main.js\` (\`fetch-activity-logs\`, \`fetch-activity-history\`) to accept an options object with \`forceRefresh: true\`, invalidating in-memory caches (\`todayResolvedCache\`, \`precomputedHistoricalCache\`) upon explicit user refresh clicks.
- **Drag-Safe Header Actions & Non-Blocking Sync**: Added \`pointer-events: none\` on header SVG icons and enforced \`-webkit-app-region: no-drag\` across all \`.header-actions *\` elements, preventing clicks from being captured as window drags on Windows frameless headers. Decoupled \`window.api.triggerSync()\` to run non-blockingly during refresh.
- **Dashboard Maximize & Restore Window Controls**: Integrated \`#max-btn\` with smooth maximize/restore toggling, title-bar double-click support, and \`body.is-maximized\` full-viewport styling.

### Changed
- Bumped application release version to \`1.3.0\` across \`package.json\` and \`package-lock.json\`.

---

`;

if (!changelog.includes('## [1.3.0] - 2026-10-29')) {
  changelog = changelog.replace('## [1.2.9] - 2026-10-27', newEntry + '## [1.2.9] - 2026-10-27');
  fs.writeFileSync('CHANGELOG.md', changelog, 'utf8');
  console.log('Updated CHANGELOG.md');
}

// 2. Update BRAIN.md
let brain = fs.readFileSync('BRAIN.md', 'utf8');

const brainEntry = `*   **v1.3.0 - Release Version Alignment & Dashboard Feature Finalization:**
    *   **Version Bump:** Bumped application release version to \`1.3.0\` across \`package.json\`, \`package-lock.json\`, \`CHANGELOG.md\`, and dynamic IPC \`get-app-version\`.
    *   **Single-Source Today Time Alignment:** Centralized \`getAuthoritativeTodayActivity\` in \`main.js\` and unified Today's total active duration across Today, Last 7 Days, and Last 30 Days views.
    *   **Dashboard Live Refresh & Cache Busting:** Added drag-safe header pointer event rules, non-blocking sync, and \`forceRefresh: true\` IPC cache busting for instantaneous data refresh.
    *   **Window Management & Reportees:** Finalized maximize/restore controls (\`#max-btn\`) and multi-level reportees hierarchy dashboard.
`;

const targetBrain = `*   **v1.2.9 - Release Version Alignment & Active Time Data Consistency:**`;

if (!brain.includes('v1.3.0 - Release Version Alignment')) {
  brain = brain.replace(targetBrain, brainEntry + targetBrain);
  fs.writeFileSync('BRAIN.md', brain, 'utf8');
  console.log('Updated BRAIN.md');
}

