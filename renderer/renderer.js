// API Preparation: fetchTimelog
// Returns dummy data initially. Later, Mainnet API will be integrated.
async function fetchTimelog() {
  if (window.api && typeof window.api.fetchTimelog === 'function') {
    return await window.api.fetchTimelog();
  }
  return {
    totalTime: "07h 45m"
  };
}

// Function to update the date and day displays dynamically
function updateDateDisplay() {
  const dateElement = document.getElementById('date-display');
  const dayElement = document.getElementById('day-display');

  if (!dateElement || !dayElement) return;

  const now = new Date();

  // Format: "Month DD, YYYY" (e.g., "May 16, 2025")
  const dateOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const dateString = now.toLocaleDateString('en-US', dateOptions);

  // Format: "Weekday" (e.g., "Friday")
  const dayOptions = { weekday: 'long' };
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
  updateDateDisplay();
  loadTimelogData();

  // Refresh date occasionally (e.g., every minute) in case the widget runs overnight
  setInterval(updateDateDisplay, 60000);
});
