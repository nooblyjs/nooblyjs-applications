/**
 * Background Service Worker for NooblyJS Wiki Extension
 * Handles session persistence and extension lifecycle
 */

// Open the side panel when the toolbar icon is clicked. Set on every service
// worker start (not just install) because the worker can be torn down and
// restarted at any time.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.warn('Could not set side panel behavior:', error));
}

// Listen for extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('NooblyJS Wiki Extension installed');
    // Load the default server URL from config.json (single source of truth)
    try {
      const response = await fetch(chrome.runtime.getURL('config.json'));
      const config = await response.json();
      chrome.storage.local.set({
        serverUrl: config.defaultServerUrl
      });
    } catch (error) {
      console.warn('Could not load config.json on install:', error);
    }
  } else if (details.reason === 'update') {
    console.log('NooblyJS Wiki Extension updated');
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSession') {
    chrome.storage.local.get(['sessionId', 'serverUrl'], (result) => {
      sendResponse(result);
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'setSession') {
    chrome.storage.local.set({
      sessionId: request.sessionId,
      serverUrl: request.serverUrl
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'clearSession') {
    chrome.storage.local.remove(['sessionId', 'currentSpace', 'currentPath'], () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
  console.log('Extension connected');
});
