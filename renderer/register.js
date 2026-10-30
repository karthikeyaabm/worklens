// renderer/register.js
// Controls First-Launch Username Verification Screen

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('registration-form');
  const usernameInput = document.getElementById('username-input');
  const submitBtn = document.getElementById('submit-btn');
  const errorContainer = document.getElementById('error-container');
  const errorText = document.getElementById('error-text');
  const loadingContainer = document.getElementById('loading-container');
  const closeBtn = document.getElementById('reg-close-btn');

  // Check URL query parameters for initial error (e.g. session revoked)
  const urlParams = new URLSearchParams(window.location.search);
  const initialError = urlParams.get('error');
  if (initialError) {
    showError(initialError);
  }

  function showError(msg) {
    loadingContainer.classList.add('hidden');
    errorText.textContent = msg || 'Invalid username. Please enter the username provided by your administrator.';
    errorContainer.classList.remove('hidden');
  }

  function hideError() {
    errorContainer.classList.add('hidden');
  }

  function setLoading(loading) {
    if (loading) {
      hideError();
      loadingContainer.classList.remove('hidden');
      submitBtn.disabled = true;
      usernameInput.disabled = true;
    } else {
      loadingContainer.classList.add('hidden');
      submitBtn.disabled = false;
      usernameInput.disabled = false;
    }
  }

  // Handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const username = (usernameInput.value || '').trim();

    if (!username) {
      showError('Invalid username. Please enter the username provided by your administrator.');
      usernameInput.focus();
      return;
    }

    setLoading(true);

    try {
      if (!window.api || !window.api.verifyUsername) {
        throw new Error('API verification bridge not initialized.');
      }

      const result = await window.api.verifyUsername(username);

      if (result && result.success) {
        // Verification succeeded!
        // The main process will close this registration window and start WorkLens.
        loadingContainer.classList.remove('hidden');
        loadingContainer.querySelector('.banner-text').textContent = 'Verification successful! Starting WorkLens...';
      } else {
        setLoading(false);
        const msg = (result && result.message)
          ? result.message
          : 'Invalid username. Please enter the username provided by your administrator.';
        showError(msg);
        usernameInput.focus();
        usernameInput.select();
      }
    } catch (err) {
      setLoading(false);
      showError('Invalid username. Please enter the username provided by your administrator.');
      usernameInput.focus();
      usernameInput.select();
    }
  });

  // Clear error when user types
  usernameInput.addEventListener('input', () => {
    if (!errorContainer.classList.contains('hidden')) {
      hideError();
    }
  });

  // Close window button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (window.api && window.api.closeRegistrationWindow) {
        window.api.closeRegistrationWindow();
      } else {
        window.close();
      }
    });
  }

  // Listen for pushed registration errors from main process
  if (window.api && window.api.onRegistrationError) {
    window.api.onRegistrationError((msg) => {
      showError(msg);
    });
  }

  // Focus input field on mount
  setTimeout(() => {
    usernameInput.focus();
  }, 100);
});

