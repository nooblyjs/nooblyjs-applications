/**
 * Settings management for NooblyJS Wiki Extension
 */

const Settings = {
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async getAll() {
    return await chrome.storage.local.get(null);
  },

  async clear() {
    await chrome.storage.local.clear();
  },

  // Specific getters/setters
  async getServerUrl() {
    return await this.get('serverUrl') || null;
  },

  async setServerUrl(url) {
    await this.set('serverUrl', url);
  },

  async getSessionId() {
    return await this.get('sessionId');
  },

  async setSessionId(sessionId) {
    await this.set('sessionId', sessionId);
  },

  async getCurrentSpace() {
    return await this.get('currentSpace');
  },

  async setCurrentSpace(space) {
    await this.set('currentSpace', space);
  }
};

window.Settings = Settings;
