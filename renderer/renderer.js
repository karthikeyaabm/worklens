// API Preparation: fetchTimelog
async function fetchTimelog() {
  if (window.api && typeof window.api.fetchTimelog === 'function') {
    return await window.api.fetchTimelog();
  }

  return {
    totalTime: "07h 45m"
  };
}

// Get Windows Logged-in Username
async function loadUsername() {
  try {
    if (!window.api || typeof window.api.getUsername !== 'function') return;

    const username = await window.api.getUsername();

    const titleElement = document.getElementById('header-title');

    if (!titleElement) return;

    // karthikeya.kondavath -> Karthikeya
    let displayName = username
      .split('.')[0]
      .split('_')[0]
      .split('-')[0];

    displayName =
      displayName.charAt(0).toUpperCase() +
      displayName.slice(1).toLowerCase();

    titleElement.textContent = `${displayName} : Daily Timelog`;
  } catch (error) {
    console.error('Failed to load username:', error);
  }
}

// Function to update the date and day displays dynamically
function updateDateDisplay() {
  const dateElement = document.getElementById('date-display');
  const dayElement = document.getElementById('day-display');

  if (!dateElement || !dayElement) return;

  const now = new Date();

  const dateOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  };

  const dateString = now.toLocaleDateString('en-US', dateOptions);

  const dayOptions = {
    weekday: 'long'
  };

  const dayString = now.toLocaleDateString('en-US', dayOptions);

  dateElement.textContent = dateString;
  dayElement.textContent = dayString;
}

// Function to update the timelog hours badge
async function loadTimelogData() {
  const totalTimeElement = document.getElementById('total-time');

  if (!totalTimeElement) return;

  try {
    const data = await fetchTimelog();

    if (data && data.totalTime) {
      totalTimeElement.textContent = `Total: ${data.totalTime}`;
    }
  } catch (error) {
    console.error('Failed to load timelog data:', error);
  }
}

// Initialization on DOM load
document.addEventListener('DOMContentLoaded', () => {
  loadUsername();
  updateDateDisplay();
  loadTimelogData();

  setInterval(updateDateDisplay, 60000);
});