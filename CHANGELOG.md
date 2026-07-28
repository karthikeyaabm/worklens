# Changelog - WorkLens Desktop App

All notable changes to the WorkLens Desktop Timelog application are documented below, spanning from **v1.0.0** to **v1.1.0**.

---

## [1.1.0] - 2026-07-23
### Added
- **API Server Load Optimization**: Redesigned the sync behavior from active 15-second POST intervals to an offline-first batched sync mechanism.
- **SQLite Offline Queue**: Implemented local storage for activity records (`activityStore.js`) supporting background queue sync, auto-retry, and reconnect sync.
- **Session Consolidation**: Consolidates continuous window actions (e.g., 1 hour same window/app) into a single session row locally, posting to the server once closed rather than sending repetitive updates.
- **Passive Activity Detection**: Automatically flags windows indicating transfer progress (e.g., WinSCP transfers, download/upload/transfer windows with progress titles matching `\b\d{1,3}%\s+(downloading|uploading|transferring)\b` pattern) as `Inactive`.
- **Title Normalization**: Normalizes volatile percent-based progress titles (e.g., "82% transferring") to a static label (e.g., "Transferring in progress") to prevent database pollution.

### Changed
- Migrated activity POST tracking to batch-sync every 2 minutes.

---

## [1.0.9] - 2026-07-23
### Added
- **Inactivity Nudge**: Automatically shows a visual pop-up card (`inactivityPopup.html`) with motivational quotes (`quotes.js`) when the system is idle for 10 minutes.
- **Beep Audio Alert**: Plays a beep sound upon trigger of the Inactivity Nudge window.
- **Auto-Close Inactivity Card**: Automatically dismisses the nudge popup on user interaction (keyboard/mouse movement) or after a 5-minute timeout.
- **Active Idle API Control**: Suppresses API requests during inactive periods, resuming hits upon interaction.
- **Activity On Date**: Added the `activity_on` date parameter to logs.

### Changed
- Refactored login and API authentication to be **case-insensitive** for usernames.
- Excluded the Windows Lock Screen (`lockapp.exe`) from productive active time tracking.

---

## [1.0.8] - 2026-07-21
### Added
- **Activity Log Popup**: Designed and added a modern Windows 11 Fluent / glassmorphism-styled popup (`activity-popup.html`, `activity-popup.css`, `activity-popup.js`) showing a detailed log breakdown.
- **Log Management System**: Added comprehensive debug logging (`logger.js`) with automatic log rotation and cleanup.
- **App Icons Integration**: Added official Desktop shortcut and application taskbar icons.

---

## [1.0.7] - 2026-07-13
### Added
- **Single Instance Lock**: Used Electron's `app.requestSingleInstanceLock()` to prevent multiple instances from running. Focuses and restores the active window if a second launch is attempted.
- **Background Tray Service**: Configured background running in the Windows System Tray with context menus ("Open WorkLens", "Exit").
- **UI Size Optimization**: Shrunk the widget window height and width (185px × 68px) to reduce screen footprint and added the version tag label in the UI.

---

## [1.0.6] - 2026-07-09
### Changed
- Updated dependency package manifests (`package.json`) for production release stability.

---

## [1.0.5] - 2026-07-09
### Changed
- Release build configuration adjustments.

---

## [1.0.4] - 2026-07-09
### Changed
- Preloaded package updates.

---

## [1.0.3] - 2026-07-09
### Changed
- **Decimal Hour Format**: Converted tracked times in display interfaces to decimal format (e.g., `1.5 hours` instead of minutes/seconds breakdown).

---

## [1.0.2] - 2026-07-07
### Changed
- **Rebranding**: Rebranded the entire app structure and naming from "Daily Timelog" to **WorkLens**.
- **REST Client Refactoring**: Added `redmineClient.js` for centralized REST API access and environment configuration (.env integration).

---

## [1.0.1] - 2026-06-18
### Added
- **Initial Setup**: Implemented the first daily timelog tracker widget with a Windows 11 frameless styling.
- **User Mapping**: Configured startup user information retrievals.
