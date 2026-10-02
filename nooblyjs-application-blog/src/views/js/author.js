'use strict';

const API_BASE = '/applications/blog/api';
const TOKEN_STORAGE_KEY = 'authToken';
const DEFAULT_ACCENT = '#C2471F';
const DEFAULT_BACKGROUND = '#F5F1EE';

const state = {
  posts: [],
  filtered: [],
  currentPostId: null,
  loading: false
};

const elements = {
  alert: document.getElementById('author-alert'),
  tableBody: document.querySelector('#author-post-table tbody'),
  filterInput: document.getElementById('post-filter-input'),
  form: document.getElementById('post-editor-form'),
  resetBtn: document.getElementById('reset-editor-btn'),
  newPostBtn: document.getElementById('create-new-post-btn'),
  editorHeading: document.getElementById('editor-heading'),
  editorStatusBadge: document.getElementById('editor-status-badge'),
  inputs: {
    id: document.getElementById('post-id'),
    title: document.getElementById('post-title'),
    subtitle: document.getElementById('post-subtitle'),
    author: document.getElementById('post-author'),
    tags: document.getElementById('post-tags'),
    status: document.getElementById('post-status'),
    cover: document.getElementById('post-cover'),
    content: document.getElementById('post-content'),
    scheduledFor: document.getElementById('post-scheduled')
  },
  settingsForm: document.getElementById('settings-form'),
  settingsResetBtn: document.getElementById('reset-settings-btn'),
  settingsPreviewBtn: document.getElementById('preview-settings-btn'),
  settings: {
    title: document.getElementById('site-title'),
    tagline: document.getElementById('site-tagline'),
    primaryColor: document.getElementById('primary-color'),
    primaryColorText: document.getElementById('primary-color-text'),
    backgroundColor: document.getElementById('background-color'),
    backgroundColorText: document.getElementById('background-color-text'),
    bannerImage: document.getElementById('banner-image'),
    twitter: document.getElementById('link-twitter'),
    instagram: document.getElementById('link-instagram'),
    tiktok: document.getElementById('link-tiktok'),
    customName: document.getElementById('link-custom-name'),
    customUrl: document.getElementById('link-custom-url')
  }
};

function getAuthToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('authToken');
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    params.delete('authToken');
    const search = params.toString();
    const newUrl = `${window.location.pathname}${search ? `?${search}` : ''}`;
    window.history.replaceState({}, document.title, newUrl);
    return token;
  }
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

const authToken = getAuthToken();

function escapeHtml(value = '') {
  return value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setAlert(message, variant = 'info') {
  if (!elements.alert) return;
  if (!message) {
    elements.alert.classList.add('d-none');
    elements.alert.textContent = '';
    return;
  }
  elements.alert.className = `alert alert-${variant} mb-4`;
  elements.alert.textContent = message;
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return value;
  }
}

function statusBadge(status) {
  if (status === 'published') return '<span class="badge bg-success-subtle text-success-emphasis">Published</span>';
  if (status === 'scheduled') return '<span class="badge bg-warning-subtle text-warning-emphasis">Scheduled</span>';
  return '<span class="badge bg-secondary-subtle text-secondary-emphasis">Draft</span>';
}

async function apiRequest(path, options = {}) {
  const init = { ...options };
  init.headers = { Accept: 'application/json', ...(options.headers || {}) };

  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }

  const token = authToken || localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    init.headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      payload?.errors?.[0]?.message ||
      payload?.message ||
      payload?.error ||
      (response.status === 401 ? 'Please sign in to continue.' : `Request failed (${response.status})`);
    throw new Error(message);
  }
  return payload;
}

function renderRows(posts) {
  if (!elements.tableBody) return;
  if (!posts.length) {
    elements.tableBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-5 text-muted">
          <i class="bi bi-inboxes display-6 d-block mb-2"></i>
          <div>No posts found. Create a new draft to get started.</div>
        </td>
      </tr>
    `;
    return;
  }

  elements.tableBody.innerHTML = posts
    .map((post) => {
      const updatedAt = post.updatedAt || post.publishedAt || post.createdAt;
      return `
        <tr data-post-id="${escapeHtml(post.id)}">
          <td>
            <div class="fw-semibold">${escapeHtml(post.title || 'Untitled')}</div>
            <div class="text-muted small">${escapeHtml(post.subtitle || post.excerpt || '')}</div>
          </td>
          <td>${statusBadge(post.status)}</td>
          <td class="text-nowrap">${escapeHtml(formatDate(updatedAt))}</td>
          <td class="text-end">
            <div class="btn-group btn-group-sm" role="group">
              <button class="btn btn-outline-primary" data-action="edit" title="Edit post" aria-label="Edit post">
                <i class="bi bi-pencil-square"></i>
              </button>
              ${
                post.status === 'published'
                  ? `<button class="btn btn-outline-warning" data-action="unpublish" title="Unpublish" aria-label="Unpublish"><i class="bi bi-eye-slash"></i></button>`
                  : `<button class="btn btn-outline-success" data-action="publish" title="Publish" aria-label="Publish"><i class="bi bi-upload"></i></button>`
              }
              <button class="btn btn-outline-danger" data-action="delete" title="Delete post" aria-label="Delete post">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function applyFilter() {
  if (!elements.filterInput) return state.posts;
  const term = elements.filterInput.value.trim().toLowerCase();
  if (!term) {
    state.filtered = [...state.posts];
  } else {
    state.filtered = state.posts.filter((post) => {
      const tags = post.tags || [];
      return (
        (post.title || '').toLowerCase().includes(term) ||
        (post.subtitle || '').toLowerCase().includes(term) ||
        (post.author?.name || '').toLowerCase().includes(term) ||
        tags.some((tag) => tag.toLowerCase().includes(term))
      );
    });
  }
  renderRows(state.filtered);
}

async function loadPosts() {
  try {
    state.loading = true;
    setAlert('');
    const { data } = await apiRequest('/posts');
    state.posts = Array.isArray(data) ? data : [];
    applyFilter();
  } catch (error) {
    setAlert(error.message || 'Unable to load posts.', 'danger');
    if (elements.tableBody) {
      elements.tableBody.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-5 text-danger">
            <i class="bi bi-exclamation-triangle display-6 d-block mb-2"></i>
            <div>${escapeHtml(error.message || 'Unable to load posts.')}</div>
          </td>
        </tr>
      `;
    }
  } finally {
    state.loading = false;
  }
}

function formatTagsInput(tags) {
  if (!Array.isArray(tags)) return '';
  return tags.join(', ');
}

function populateForm(post) {
  state.currentPostId = post?.id || null;
  elements.inputs.id.value = post?.id || '';
  elements.inputs.title.value = post?.title || '';
  elements.inputs.subtitle.value = post?.subtitle || '';
  elements.inputs.author.value = post?.author?.name || '';
  elements.inputs.tags.value = formatTagsInput(post?.tags || []);
  elements.inputs.status.value = post?.status || 'draft';
  elements.inputs.cover.value = post?.coverImage || '';
  elements.inputs.content.value = post?.content || '';
  elements.inputs.scheduledFor.value = post?.scheduledFor
    ? new Date(post.scheduledFor).toISOString().slice(0, 16)
    : '';

  const headingText = post?.id ? `Editing: ${post.title || 'Untitled story'}` : 'Create a new story';
  const statusText =
    post?.status === 'published'
      ? 'Published'
      : post?.status === 'scheduled'
        ? 'Scheduled'
        : 'Draft';

  elements.editorHeading.textContent = headingText;
  elements.editorStatusBadge.textContent = statusText;
  elements.editorStatusBadge.className = `badge ${
    post?.status === 'published'
      ? 'bg-success-subtle text-success-emphasis'
      : post?.status === 'scheduled'
        ? 'bg-warning-subtle text-warning-emphasis'
        : 'bg-secondary-subtle text-secondary-emphasis'
  }`;
}

function resetForm() {
  state.currentPostId = null;
  elements.form.classList.remove('was-validated');
  elements.form.reset();
  Object.values(elements.inputs).forEach((input) => {
    if (input && input.type !== 'hidden') {
      input.value = '';
    }
  });
  elements.inputs.status.value = 'draft';
  elements.inputs.id.value = '';
  elements.editorStatusBadge.textContent = 'Draft';
  elements.editorStatusBadge.className = 'badge bg-secondary-subtle text-secondary-emphasis';
  elements.editorHeading.textContent = 'Create a new story';
}

function parseTags(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function buildPayloadFromForm() {
  return {
    title: elements.inputs.title.value.trim(),
    subtitle: elements.inputs.subtitle.value.trim() || undefined,
    author: elements.inputs.author.value.trim() || undefined,
    tags: parseTags(elements.inputs.tags.value || ''),
    status: elements.inputs.status.value || 'draft',
    coverImage: elements.inputs.cover.value.trim() || undefined,
    content: elements.inputs.content.value.trim(),
    scheduledFor: elements.inputs.scheduledFor.value || undefined
  };
}

async function handleFormSubmit(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!elements.form.checkValidity()) {
    elements.form.classList.add('was-validated');
    return;
  }

  const payload = buildPayloadFromForm();
  if (!payload.title || !payload.content) {
    elements.form.classList.add('was-validated');
    return;
  }

  try {
    setAlert('');
    const postId = state.currentPostId;
    if (postId) {
      await apiRequest(`/posts/${encodeURIComponent(postId)}`, { method: 'PATCH', body: payload });
      setAlert('Post updated successfully.', 'success');
    } else {
      const body = { ...payload };
      if (body.status === 'published') {
        body.status = 'draft';
      }
      const { data } = await apiRequest('/posts', { method: 'POST', body });
      if (elements.inputs.status.value === 'published') {
        await apiRequest(`/posts/${encodeURIComponent(data.id)}/publish`, { method: 'POST' });
      }
      setAlert('Draft created successfully.', 'success');
    }
    await loadPosts();
    resetForm();
  } catch (error) {
    setAlert(error.message || 'Unable to save post.', 'danger');
  }
}

async function handleDelete(postId) {
  if (!postId) return;
  const confirmed = await window.BlogUI.confirm({
    title: 'Delete this post?',
    body: 'This action cannot be undone.',
    confirmLabel: 'Delete'
  });
  if (!confirmed) {
    return;
  }
  try {
    await apiRequest(`/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
    setAlert('Post deleted.', 'success');
    if (state.currentPostId === postId) {
      resetForm();
    }
    await loadPosts();
  } catch (error) {
    setAlert(error.message || 'Unable to delete post.', 'danger');
  }
}

async function handlePublish(postId) {
  if (!postId) return;
  try {
    await apiRequest(`/posts/${encodeURIComponent(postId)}/publish`, {
      method: 'POST'
    });
    setAlert('Post published.', 'success');
    if (state.currentPostId === postId) {
      elements.inputs.status.value = 'published';
    }
    await loadPosts();
  } catch (error) {
    setAlert(error.message || 'Unable to publish post.', 'danger');
  }
}

async function handleUnpublish(postId) {
  if (!postId) return;
  try {
    await apiRequest(`/posts/${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      body: { status: 'draft' }
    });
    setAlert('Post moved back to draft.', 'info');
    if (state.currentPostId === postId) {
      elements.inputs.status.value = 'draft';
    }
    await loadPosts();
  } catch (error) {
    setAlert(error.message || 'Unable to update post status.', 'danger');
  }
}

function handleTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr[data-post-id]');
  const postId = row?.getAttribute('data-post-id');
  const action = button.getAttribute('data-action');
  const post = state.posts.find((item) => item.id === postId);

  if (action === 'edit') {
    populateForm(post || null);
    window.scrollTo({ top: elements.form.offsetTop - 80, behavior: 'smooth' });
  } else if (action === 'publish') {
    handlePublish(postId);
  } else if (action === 'unpublish') {
    handleUnpublish(postId);
  } else if (action === 'delete') {
    handleDelete(postId);
  }
}

// Settings functionality
let currentSettings = null;

async function loadSettings() {
  try {
    const { data } = await apiRequest('/settings');
    currentSettings = data;
    populateSettingsForm(data);
  } catch (error) {
    setAlert(error.message || 'Unable to load settings.', 'danger');
  }
}

function populateSettingsForm(settings) {
  if (!settings) return;

  elements.settings.title.value = settings.title || '';
  elements.settings.tagline.value = settings.tagline || '';
  elements.settings.primaryColor.value = settings.primaryColor || DEFAULT_ACCENT;
  elements.settings.primaryColorText.value = settings.primaryColor || DEFAULT_ACCENT;
  elements.settings.backgroundColor.value = settings.backgroundColor || DEFAULT_BACKGROUND;
  elements.settings.backgroundColorText.value = settings.backgroundColor || DEFAULT_BACKGROUND;
  elements.settings.bannerImage.value = settings.bannerImage || '';
  elements.settings.twitter.value = settings.links?.twitter || '';
  elements.settings.instagram.value = settings.links?.instagram || '';
  elements.settings.tiktok.value = settings.links?.tiktok || '';
  elements.settings.customName.value = settings.links?.custom?.name || '';
  elements.settings.customUrl.value = settings.links?.custom?.url || '';
}

function syncColorPickerWithText(colorPicker, textInput) {
  colorPicker.addEventListener('input', () => {
    textInput.value = colorPicker.value;
  });
  textInput.addEventListener('input', () => {
    const value = textInput.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      colorPicker.value = value;
    }
  });
}

function applySettingsPreview() {
  applySettingsToPage({
    primaryColor: elements.settings.primaryColor.value,
    backgroundColor: elements.settings.backgroundColor.value
  });
  setAlert('Preview applied! Changes are not saved yet.', 'info');
}

function resetSettingsForm() {
  if (currentSettings) {
    populateSettingsForm(currentSettings);
    applySettingsToPage(currentSettings);
    setAlert('Settings reset to saved values.', 'info');
  }
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!elements.settingsForm.checkValidity()) {
    elements.settingsForm.classList.add('was-validated');
    return;
  }

  const payload = {
    title: elements.settings.title.value.trim(),
    tagline: elements.settings.tagline.value.trim(),
    primaryColor: elements.settings.primaryColor.value,
    backgroundColor: elements.settings.backgroundColor.value,
    bannerImage: elements.settings.bannerImage.value.trim() || '',
    links: {
      twitter: elements.settings.twitter.value.trim() || '',
      instagram: elements.settings.instagram.value.trim() || '',
      tiktok: elements.settings.tiktok.value.trim() || '',
      custom: {
        name: elements.settings.customName.value.trim() || '',
        url: elements.settings.customUrl.value.trim() || ''
      }
    }
  };

  try {
    setAlert('');
    const { data } = await apiRequest('/settings', { method: 'PATCH', body: payload });
    currentSettings = data;
    setAlert('Settings saved successfully!', 'success');

    // Update page title immediately
    document.title = `${payload.title} · Author Hub`;

    // Apply styles permanently
    applySettingsToPage(data);
  } catch (error) {
    setAlert(error.message || 'Unable to save settings.', 'danger');
  }
}

/** Mirrors the server-side theme injection (generateThemeCSS) so colours apply without a reload. */
function applySettingsToPage(settings) {
  if (!settings) return;
  const root = document.documentElement.style;
  const accent = settings.primaryColor || DEFAULT_ACCENT;
  const background = settings.backgroundColor || DEFAULT_BACKGROUND;
  const accentVars = ['--accent', '--accent-link', '--accent-soft', '--accent-tint'];
  if (accent.toLowerCase() === DEFAULT_ACCENT.toLowerCase()) {
    accentVars.forEach((name) => root.removeProperty(name));
  } else {
    root.setProperty('--accent', accent);
    root.setProperty('--accent-link', `color-mix(in srgb, ${accent} 85%, #000)`);
    root.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 20%, #FFF)`);
    root.setProperty('--accent-tint', `color-mix(in srgb, ${accent} 8%, #FFF)`);
  }
  if (background.toLowerCase() === DEFAULT_BACKGROUND.toLowerCase()) {
    root.removeProperty('--bg');
  } else {
    root.setProperty('--bg', background);
  }
}

function registerEvents() {
  elements.filterInput?.addEventListener('input', () => {
    applyFilter();
  });

  elements.tableBody?.addEventListener('click', handleTableClick);

  elements.form?.addEventListener('submit', handleFormSubmit);

  elements.resetBtn?.addEventListener('click', resetForm);

  elements.newPostBtn?.addEventListener('click', () => {
    resetForm();
    elements.inputs.title.focus();
  });

  // Settings events
  elements.settingsForm?.addEventListener('submit', handleSettingsSubmit);

  elements.settingsResetBtn?.addEventListener('click', resetSettingsForm);

  elements.settingsPreviewBtn?.addEventListener('click', applySettingsPreview);

  // Color picker sync
  syncColorPickerWithText(elements.settings.primaryColor, elements.settings.primaryColorText);
  syncColorPickerWithText(elements.settings.backgroundColor, elements.settings.backgroundColorText);

  // Load settings when Customise tab is clicked
  document.getElementById('customise-tab')?.addEventListener('shown.bs.tab', () => {
    if (!currentSettings) {
      loadSettings();
    }
  });
}

function init() {
  if (!authToken && !localStorage.getItem(TOKEN_STORAGE_KEY)) {
    setAlert('Authentication token missing. Please sign in again.', 'danger');
    return;
  }
  registerEvents();
  resetForm();
  loadPosts();
}

document.addEventListener('DOMContentLoaded', init);
