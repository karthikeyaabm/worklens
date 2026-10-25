# Changelog - WorkLens Desktop App

All notable changes to the WorkLens Desktop Timelog application are documented below.

---

## [1.2.8] - 2026-10-25
### Added
- **Future-Date Anomaly Rejection & Cascade Prevention**: In `main.js`, quarantined any session whose start time is ahead of local system time (`recordStartDate > now`) with `quarantineSession()` (`duration = 0`, `quarantined = true`, `closed = true`) and safely reset `currentRecord`, completely stopping artificial future-day splitting cascades.
- **Boundary-Safe Midnight Session Splitting**: Added strict calendar day boundary verification (`actualNow = new Date()`, `sDate <= actualNow`, `nextDayStart <= actualNow`) and a +500ms safety buffer in `scheduleMidnightBoundaryCheck()`, guaranteeing that timer callbacks never trigger prematurely on the previous day.
- **Future-Date Redmine Sync Quarantine**: Excluded forward-dated and corrupt timestamp records from Redmine upload in `getEligibleClosedSessions()` and `flushPendingClosedSessions()` while safely retaining them in local JSONL logs for auditing. Verified with Suite 20 (`test_future_date_midnight_recovery_suite.js`).
- **History Dashboard Dual Totals (System vs Redmine)**: Separated Last 7 Days and Last 30 Days footer totals into dedicated cyan/blue (`#38bdf8`) System tracking and neon green (`#00E676`) Redmine time entry indicators, strictly excluding Redmine special hours (Leave, Holiday, Big Late, Early Out, ABM Function) from workstation active time.
- **Dynamic Weekend Toggle Sync**: Unchecking "Show Weekends (Sat & Sun)" immediately recalculates footer totals strictly across visible weekdays, subtracting any weekend hours.
- **Window Lifecycle & System Tray Resilience**: Defensive protection against Chromium `TypeError: Object has been destroyed` exceptions when re-opening or focusing windows from the Windows System Tray menu or double-click via `showAndFocusWindow()`.

### Changed
- Bumped application release version to `1.2.8` across `package.json` and `package-lock.json`.

---

## [1.3.4] - 2026-10-08
### Added
- **Storage Health & Local Persistence Supervisor**: Created `storageHealth.js` to monitor local activity persistence health and distinguish local storage breakdown (such as C: drive 100% full) from expected offline/network operations.
- **Atomic Write & ENOSPC Truncation Protection**: Enhanced `activityStore.js` with atomic `.tmp` write pattern and rename, preventing queue file truncation on `ENOSPC`.
- **In-Memory Unpersisted Buffer**: Temporarily buffers sessions in memory during full-disk events and flushes them to disk upon storage recovery, guaranteeing zero lost time.
- **Consecutive Failure Protection & Cooldown**: Requires 3 consecutive persistence failures before triggering `WORKLENS_NOT_WORKING`, with a 30-minute cooldown to prevent notification spam.
- **Native Windows Storage Alerts**: Emits non-technical, employee-friendly alerts for storage full or permission errors, plus automatic recovery notification (`"WorkLens is working normally again."`).
- **Storage Health IPC Channel**: Exposed `get-storage-health` across IPC and preload bridge.

---

## [1.3.3] - 2026-10-06
### Added
- **WorkLens Watchdog & Auto-Recovery**: Implemented decoupled background supervisor mechanism (`watchdog/worklens-watchdog.ps1`, `watchdog/worklens-watchdog.vbs`, `watchdog/watchdog.js`) to continuously monitor and recover the WorkLens process.
- **Crash & Task Manager "End Task" Auto-Restart**: Watchdog detects process termination and automatically relaunches WorkLens within a 5-second grace period.
- **Restart-Loop Protection**: Limits automatic restarts to a maximum of 3 attempts within 5 minutes, displaying an alert notification if consecutive failures occur.
- **Controlled Shutdown State Coordination**: Uses `%APPDATA%/WorkLens/watchdog-state.json` to distinguish abnormal terminations from intentional logoffs, OS reboots, or auto-updater restarts.
- **Windows Startup Alignment**: Automatically configures the watchdog to start with Windows (`HKCU\...\Run\WorkLensWatchdog`), launching WorkLens immediately on user login.
- **Auto-Recovery Notification**: Passes `--recovered` flag upon restart to notify the user via a native Windows notification.

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
