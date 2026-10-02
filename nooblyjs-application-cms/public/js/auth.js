/**
 * Authentication helper for managing session tokens and API requests
 */

// Configure axios to automatically include session token in all requests
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('sessionToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses globally
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('sessionToken');
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
  return !!localStorage.getItem('sessionToken');
}

/**
 * Logout user
 */
async function logoutUser() {
  try {
    const token = localStorage.getItem('sessionToken');
    if (token) {
      await axios.post('/auth/logout', { token });
    }
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    localStorage.removeItem('sessionToken');
    window.location.href = '/auth/login';
  }
}

/**
 * Redirect to login if not authenticated
 */
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/auth/login';
    return false;
  }
  return true;
}

/**
 * Get the current session token
 */
function getSessionToken() {
  return localStorage.getItem('sessionToken');
}
