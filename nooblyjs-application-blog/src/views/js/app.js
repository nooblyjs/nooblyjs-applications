'use strict';

(function () {
  const appRoot = document.getElementById('blog-app');
  if (!appRoot) return;

  const API_BASE = '/applications/blog/api';
  const BLOG_BASE_PATH = '/applications/blog';
  const POST_PATH_PREFIX = `${BLOG_BASE_PATH}/posts/`;
  const CLAPPED_STORAGE_KEY = 'folio:clapped';
  const { toast } = window.BlogUI;

  /** Bootstrap Icons glyph, e.g. icon('search'). */
  const icon = (name, className = '') => `<i class="bi bi-${name}${className ? ` ${className}` : ''}" aria-hidden="true"></i>`;

  const state = {
    feed: null,
    settings: null,
    posts: new Map(),
    currentPostId: null,
    searchTerm: ''
  };

  const elements = {
    homeView: document.getElementById('home-view'),
    readerView: document.getElementById('reader-view'),
    banner: document.getElementById('site-banner'),
    featured: document.getElementById('featured'),
    latestHeading: document.getElementById('latest-heading'),
    latestList: document.getElementById('latest-list'),
    clearSearchBtn: document.getElementById('clear-search-btn'),
    trendingList: document.getElementById('trending-list'),
    topicsList: document.getElementById('topics-list'),
    aboutPanel: document.getElementById('about-panel'),
    aboutHeading: document.getElementById('about-heading'),
    aboutTagline: document.getElementById('about-tagline'),
    aboutLinks: document.getElementById('about-links'),
    siteNav: document.getElementById('site-nav'),
    navCollapse: document.getElementById('site-nav-collapse'),
    searchForm: document.getElementById('post-search-form'),
    searchInput: document.getElementById('post-search-input'),
    readPostKicker: document.getElementById('read-post-kicker'),
    readPostTitle: document.getElementById('read-post-title'),
    readPostDek: document.getElementById('read-post-dek'),
    readPostMeta: document.getElementById('read-post-meta'),
    readPostCover: document.getElementById('read-post-cover'),
    readPostContent: document.getElementById('read-post-content'),
    readPostActions: document.getElementById('read-post-actions'),
    readPostCommentCount: document.getElementById('read-post-comment-count'),
    readPostComments: document.getElementById('read-post-comments'),
    commentForm: document.getElementById('comment-form'),
    commentAuthor: document.getElementById('comment-author'),
    commentBody: document.getElementById('comment-body'),
    commentBodyError: document.getElementById('comment-body-error'),
    moreSection: document.getElementById('more-section'),
    moreHeading: document.getElementById('more-heading'),
    moreList: document.getElementById('more-list'),
    footerTagline: document.getElementById('footer-tagline'),
    footerLinks: document.getElementById('footer-links'),
    footerYear: document.getElementById('footer-year')
  };

  async function request(path, options = {}) {
    const init = { ...options };
    init.headers = { Accept: 'application/json', ...(options.headers || {}) };

    // Authors signed in via the dashboard can create posts from here too.
    let token = null;
    try {
      token = localStorage.getItem('authToken');
    } catch (_) {
      token = null;
    }
    if (token) {
      init.headers.Authorization = `Bearer ${token}`;
    }

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, init);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const message =
          payload?.errors?.[0]?.message ||
          payload?.message ||
          payload?.error ||
          (response.status === 401 ? 'Please sign in as an author to do that.' : `Request failed (${response.status})`);
        throw new Error(message);
      }
      return {
        data: payload.data !== undefined ? payload.data : payload,
        meta: payload.meta || {}
      };
    } catch (error) {
      throw new Error(error.message || 'Network request failed');
    }
  }

  function escapeHtml(value = '') {
    return value
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildPostUrl(post) {
    const slug = encodeURIComponent((post && (post.slug || post.id)) || '');
    return `${POST_PATH_PREFIX}${slug}`;
  }

  function getPostIdFromPath(pathname = window.location.pathname) {
    if (!pathname.startsWith(POST_PATH_PREFIX)) {
      return null;
    }
    const remainder = pathname.slice(POST_PATH_PREFIX.length).replace(/\/+$/, '');
    return remainder ? decodeURIComponent(remainder) : null;
  }

  function postDate(post) {
    return post?.publishedAt || post?.updatedAt || post?.createdAt || null;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatReadTime(post) {
    const minutes = Number(post?.readTimeMinutes) || Math.max(1, Math.ceil((post?.content || '').split(/\s+/).length / 220));
    return `${minutes} min read`;
  }

  /** Meta line, always Author · Date · N min read. */
  function buildPostMeta(post, { readTime = true } = {}) {
    const parts = [post?.author?.name, formatDate(postDate(post))];
    if (readTime) parts.push(formatReadTime(post));
    return parts.filter(Boolean).join(' · ');
  }

  function siteTitle() {
    return state.settings?.title || 'NooblyJS Folio';
  }

  /** Sets the last word of the site title in the accent colour, matching the wordmark. */
  function wordmarkHtml(title) {
    const words = title.trim().split(/\s+/);
    if (words.length < 2) return escapeHtml(title);
    const last = words.pop();
    return `${escapeHtml(words.join(' '))} <em>${escapeHtml(last)}</em>`;
  }

  function stateMessage(message, { loading = false, error = false } = {}) {
    if (error) return `<div class="alert alert-danger mb-0">${escapeHtml(message)}</div>`;
    return `<p class="text-muted fst-italic py-3 mb-0${loading ? ' is-loading' : ''}">${escapeHtml(message)}</p>`;
  }

  function statsHtml(post) {
    const stats = post?.stats || {};
    const items = [
      ['eye', stats.views, 'views'],
      ['hand-thumbs-up', stats.claps, 'claps'],
      ['bookmark', stats.bookmarks, 'saves']
    ]
      .filter(([, value]) => Number(value) > 0)
      .map(
        ([name, value, label]) =>
          `<span>${icon(name)}${Number(value)}<span class="visually-hidden"> ${label}</span></span>`
      );
    return items.length ? `<div class="blog-stats">${items.join('')}</div>` : '';
  }

  function hydratePosts(collections = []) {
    collections.flat().forEach((post) => {
      if (post && post.id) {
        state.posts.set(post.id, post);
      }
    });
  }

  /* ---------- Home ---------- */

  async function loadFeed() {
    try {
      const { data } = await request('/feed/home');
      state.feed = data || {};
      hydratePosts([data?.featured || [], data?.latest || [], data?.trending || []]);
      renderFeed();
    } catch (error) {
      elements.featured.innerHTML = '';
      elements.latestList.innerHTML = stateMessage(`Unable to load stories: ${error.message}`, { error: true });
      elements.trendingList.innerHTML = '';
      elements.topicsList.innerHTML = '';
    }
  }

  function renderFeed() {
    renderFeatured(state.feed?.featured?.[0]);
    if (!state.searchTerm) {
      renderLatest(state.feed?.latest || []);
    }
    renderTrending(state.feed?.trending || []);
    renderTopics(state.feed?.tags || []);
    if (state.currentPostId) {
      renderMore(state.currentPostId);
    }
  }

  function renderFeatured(post) {
    if (!post) {
      elements.featured.innerHTML = stateMessage('Publish a story to see it featured here.');
      return;
    }

    const postUrl = escapeHtml(buildPostUrl(post));
    const kicker = ['Featured', post.tags?.[0]].filter(Boolean).map(escapeHtml).join(' · ');

    elements.featured.innerHTML = `
      <article class="card card-interactive">
        <div class="row g-4 align-items-center">
          ${
            post.coverImage
              ? `<div class="col-md-7"><div class="blog-hero-media"><img src="${escapeHtml(post.coverImage)}" alt="" loading="eager"></div></div>`
              : ''
          }
          <div class="${post.coverImage ? 'col-md-5' : 'col-12'} d-flex flex-column gap-3">
            <div><span class="badge bg-primary">${kicker}</span></div>
            <h2 class="display-3 mb-0">
              <a href="${postUrl}" class="stretched-link text-reset card-title-link" data-action="open-post" data-post-id="${escapeHtml(post.id)}">${escapeHtml(post.title)}</a>
            </h2>
            ${post.subtitle ? `<p class="lead mb-0">${escapeHtml(post.subtitle)}</p>` : ''}
            <p class="text-muted small mb-0">${escapeHtml(buildPostMeta(post))}</p>
            <span class="text-accent-link fw-semibold" aria-hidden="true">Read the story ${icon('arrow-right')}</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderLatest(posts, { emptyMessage = 'No stories published yet.' } = {}) {
    if (!posts.length) {
      elements.latestList.innerHTML = stateMessage(emptyMessage);
      return;
    }

    elements.latestList.innerHTML = posts
      .map((post) => {
        const postUrl = escapeHtml(buildPostUrl(post));
        const date = postDate(post) ? new Date(postDate(post)) : null;
        const tags = (post.tags || []).slice(0, 3);
        const tagButtons = tags
          .map(
            (tag) =>
              `<button type="button" class="chip position-relative z-2" data-action="filter-tag" data-tag="${escapeHtml(tag)}" aria-label="Show stories tagged ${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
          )
          .join('');
        return `
          <article class="card card-interactive">
            <div class="d-flex gap-4">
              <div class="blog-post-date d-none d-md-flex flex-column" aria-hidden="true">
                ${date ? `${escapeHtml(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}<span>${date.getFullYear()}</span>` : ''}
              </div>
              <div class="flex-grow-1 d-flex flex-column gap-2" style="min-width: 0">
                <h3 class="mb-0">
                  <a href="${postUrl}" class="stretched-link text-reset card-title-link" data-action="open-post" data-post-id="${escapeHtml(post.id)}">${escapeHtml(post.title)}</a>
                </h3>
                ${post.subtitle ? `<p class="text-ink-2 mb-0">${escapeHtml(post.subtitle)}</p>` : ''}
                <p class="small text-muted mb-0 d-md-none">${escapeHtml([formatDate(postDate(post)), formatReadTime(post)].filter(Boolean).join(' · '))}</p>
                ${post.excerpt ? `<p class="text-muted blog-clamp-2 mb-0">${escapeHtml(post.excerpt)}</p>` : ''}
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-1">
                  <div class="d-flex flex-wrap align-items-center gap-2">
                    ${post.author?.name ? `<span class="small fw-semibold me-1">${escapeHtml(post.author.name)}</span>` : ''}
                    ${tagButtons}
                  </div>
                  ${statsHtml(post)}
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderTrending(posts) {
    if (!posts.length) {
      elements.trendingList.innerHTML = `<li>${stateMessage('Trending stories appear once readers engage.')}</li>`;
      return;
    }

    elements.trendingList.innerHTML = posts
      .map(
        (post, index) => `
          <li class="position-relative d-flex gap-2 py-3 border-bottom">
            <span class="blog-trending-rank" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
            <div>
              <a href="${escapeHtml(buildPostUrl(post))}" class="fw-semibold text-reset stretched-link" data-action="open-post" data-post-id="${escapeHtml(post.id)}">${escapeHtml(post.title)}</a>
              <p class="small text-muted mb-0">${escapeHtml(buildPostMeta(post, { readTime: false }))}</p>
            </div>
          </li>
        `
      )
      .join('');
  }

  function renderTopics(tags) {
    if (!tags.length) {
      elements.topicsList.innerHTML = stateMessage('Topics appear once published stories have tags.');
      return;
    }

    elements.topicsList.innerHTML = tags
      .map(
        (entry) => `
          <button type="button" class="chip" data-action="filter-tag" data-tag="${escapeHtml(entry.tag)}">
            ${escapeHtml(entry.tag)}<span class="count" aria-label="${Number(entry.count)} stories">${Number(entry.count)}</span>
          </button>
        `
      )
      .join('');
  }

  /* ---------- Search ---------- */

  async function runSearch(term) {
    const query = term.trim();
    state.searchTerm = query;
    closeReader({ updateHistory: true });

    if (!query) {
      clearSearch();
      return;
    }

    elements.latestHeading.textContent = `Results for “${query}”`;
    elements.clearSearchBtn.hidden = false;
    elements.latestList.innerHTML = stateMessage('Searching stories…', { loading: true });
    document.getElementById('latest')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const { data } = await request(`/search?q=${encodeURIComponent(query)}`);
      const results = Array.isArray(data) ? data : [];
      hydratePosts([results]);
      renderLatest(results, { emptyMessage: `No stories matched “${query}”.` });
    } catch (error) {
      elements.latestList.innerHTML = stateMessage(`Search failed: ${error.message}`, { error: true });
    }
  }

  function clearSearch() {
    state.searchTerm = '';
    elements.searchInput.value = '';
    elements.latestHeading.textContent = 'Latest';
    elements.clearSearchBtn.hidden = true;
    renderLatest(state.feed?.latest || []);
  }

  /* ---------- Reader ---------- */

  /**
   * Minimal Markdown: paragraphs split on blank lines; "-" / "*" lines become a list.
   * Non-list lines inside a list block (e.g. "Key rituals he returns to:") render as a
   * lead-in paragraph instead of a bullet.
   */
  function markdownToHtml(content = '') {
    const blocks = escapeHtml(content)
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    return blocks
      .map((block) => {
        const html = [];
        let paragraph = [];
        let items = [];
        const flushParagraph = () => {
          if (paragraph.length) html.push(`<p>${paragraph.join('<br>')}</p>`);
          paragraph = [];
        };
        const flushList = () => {
          if (items.length) html.push(`<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`);
          items = [];
        };
        block.split('\n').forEach((line) => {
          const bullet = line.match(/^\s*[-*]\s+(.*)$/);
          if (bullet) {
            flushParagraph();
            items.push(bullet[1].trim());
          } else if (line.trim()) {
            flushList();
            paragraph.push(line.trim());
          }
        });
        flushParagraph();
        flushList();
        return html.join('');
      })
      .join('');
  }

  function readClapped() {
    try {
      return new Set(JSON.parse(localStorage.getItem(CLAPPED_STORAGE_KEY) || '[]'));
    } catch (_) {
      return new Set();
    }
  }

  function rememberClap(postId) {
    const clapped = readClapped();
    clapped.add(postId);
    try {
      localStorage.setItem(CLAPPED_STORAGE_KEY, JSON.stringify([...clapped]));
    } catch (_) {
      // Storage unavailable (private mode); the button still updates for this visit.
    }
  }

  function syncPost(post) {
    state.posts.set(post.id, post);
    if (!state.feed) return;
    ['featured', 'latest', 'trending'].forEach((key) => {
      if (!Array.isArray(state.feed[key])) return;
      state.feed[key] = state.feed[key].map((entry) => (entry.id === post.id ? { ...entry, ...post } : entry));
    });
  }

  function updateHistoryForPost(post, mode = 'push') {
    const statePayload = { postId: post.id };
    const url = buildPostUrl(post);
    if (mode === 'replace') {
      window.history.replaceState(statePayload, '', url);
    } else {
      window.history.pushState(statePayload, '', url);
    }
  }

  function resetHistoryToBase(mode = 'replace', hash = '') {
    const statePayload = { postId: null };
    const url = `${BLOG_BASE_PATH}${hash}`;
    if (mode === 'push') {
      window.history.pushState(statePayload, '', url);
    } else {
      window.history.replaceState(statePayload, '', url);
    }
  }

  async function openPost(postId, { historyMode = 'push' } = {}) {
    if (!postId) return;
    try {
      const { data: post } = await request(`/posts/${encodeURIComponent(postId)}`);
      state.currentPostId = post.id;
      syncPost(post);
      renderReader(post);
      showReader();
      if (historyMode !== 'none') {
        updateHistoryForPost(post, historyMode === 'replace' ? 'replace' : 'push');
      }
      await loadComments(post.id);
    } catch (error) {
      if (historyMode === 'replace') {
        resetHistoryToBase('replace');
        elements.homeView.hidden = false;
      }
      toast(`Unable to load story: ${error.message}`, 'error');
    }
  }

  function showReader() {
    elements.homeView.hidden = true;
    elements.readerView.hidden = false;
    setActiveNav(null);
    window.scrollTo({ top: 0 });
    elements.readPostTitle.setAttribute('tabindex', '-1');
    elements.readPostTitle.focus({ preventScroll: true });
  }

  function closeReader({ updateHistory = false, hash = '' } = {}) {
    if (!state.currentPostId) return;
    state.currentPostId = null;
    elements.readerView.hidden = true;
    elements.homeView.hidden = false;
    document.title = siteTitle();
    elements.commentForm.reset();
    setCommentError('');
    setActiveNav('latest');
    if (updateHistory) {
      resetHistoryToBase('push', hash);
    }
  }

  function renderReader(post) {
    document.title = `${post.title || 'Untitled story'} · ${siteTitle()}`;
    elements.readPostKicker.textContent = post.tags?.[0] || '';
    elements.readPostKicker.hidden = !post.tags?.length;
    elements.readPostTitle.textContent = post.title || 'Untitled story';
    elements.readPostDek.textContent = post.subtitle || '';
    elements.readPostDek.hidden = !post.subtitle;
    elements.readPostMeta.textContent = buildPostMeta(post);
    if (post.coverImage) {
      elements.readPostCover.innerHTML = `<img src="${escapeHtml(post.coverImage)}" alt="${escapeHtml(post.title || '')}">`;
      elements.readPostCover.hidden = false;
    } else {
      elements.readPostCover.innerHTML = '';
      elements.readPostCover.hidden = true;
    }
    elements.readPostContent.innerHTML = markdownToHtml(post.content || post.excerpt || '');
    renderActionButtons(post);
    renderMore(post.id);
  }

  function renderActionButtons(post) {
    const stats = post.stats || {};
    const clapped = readClapped().has(post.id);
    const id = escapeHtml(post.id);
    elements.readPostActions.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm" data-action="clap" data-post-id="${id}" aria-pressed="${clapped}">
        ${icon(clapped ? 'hand-thumbs-up-fill' : 'hand-thumbs-up')}<span>Clap</span><span class="badge rounded-pill text-bg-light">${Number(stats.claps || 0)}</span>
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="bookmark" data-post-id="${id}">
        ${icon('bookmark')}<span>Save</span><span class="badge rounded-pill text-bg-light">${Number(stats.bookmarks || 0)}</span>
      </button>
      <button type="button" class="btn btn-link ms-auto" data-action="share" data-post-id="${id}">
        ${icon('link-45deg')}<span>Copy link</span>
      </button>
    `;
  }

  function renderMore(currentId) {
    const others = (state.feed?.latest || []).filter((post) => post.id !== currentId).slice(0, 3);
    elements.moreHeading.textContent = `More from ${siteTitle()}`;
    elements.moreSection.hidden = !others.length;
    elements.moreList.innerHTML = others
      .map(
        (post) => `
          <div class="col">
            <article class="card card-interactive h-100">
              <h3 class="card-title"><a href="${escapeHtml(buildPostUrl(post))}" class="stretched-link text-reset card-title-link" data-action="open-post" data-post-id="${escapeHtml(post.id)}">${escapeHtml(post.title)}</a></h3>
              <p class="small text-muted mb-0">${escapeHtml(buildPostMeta(post))}</p>
            </article>
          </div>
        `
      )
      .join('');
  }

  async function loadComments(postId) {
    elements.readPostComments.innerHTML = stateMessage('Loading comments…', { loading: true });
    try {
      const { data: comments } = await request(`/posts/${encodeURIComponent(postId)}/comments`);
      if (state.currentPostId !== postId) return;
      renderComments(Array.isArray(comments) ? comments : []);
    } catch (error) {
      if (state.currentPostId !== postId) return;
      elements.readPostComments.innerHTML = stateMessage(`Unable to load comments: ${error.message}`, { error: true });
    }
  }

  function renderComments(comments) {
    elements.readPostCommentCount.textContent = String(comments.length);
    if (!comments.length) {
      elements.readPostComments.innerHTML = stateMessage('No comments yet. Be the first to respond.');
      return;
    }
    elements.readPostComments.innerHTML = comments
      .map(
        (comment) => `
          <div class="blog-comment">
            <div class="d-flex align-items-baseline gap-2 mb-1">
              <span class="fw-semibold">${escapeHtml(comment.author?.name || 'Reader')}</span>
              <span class="small text-muted">${escapeHtml(formatDate(comment.createdAt))}</span>
            </div>
            <p class="blog-comment-body mb-0">${escapeHtml(comment.body || '')}</p>
          </div>
        `
      )
      .join('');
  }

  function setCommentError(message) {
    elements.commentBodyError.textContent = message;
    elements.commentBody.classList.toggle('is-invalid', Boolean(message));
    if (message) {
      elements.commentBody.setAttribute('aria-invalid', 'true');
    } else {
      elements.commentBody.removeAttribute('aria-invalid');
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault();
    if (!state.currentPostId) return;
    const author = elements.commentAuthor.value.trim() || 'Reader';
    const body = elements.commentBody.value.trim();
    if (!body) {
      setCommentError('Write a comment before posting.');
      elements.commentBody.focus();
      return;
    }
    setCommentError('');

    const submitBtn = elements.commentForm.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      await request(`/posts/${encodeURIComponent(state.currentPostId)}/comments`, {
        method: 'POST',
        body: { body, author: { name: author } }
      });
      elements.commentForm.reset();
      toast('Comment posted');
      await loadComments(state.currentPostId);
    } catch (error) {
      toast(`Unable to post comment: ${error.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function handlePostAction(action, postId, button) {
    if (action === 'share') {
      const post = state.posts.get(postId);
      const url = `${window.location.origin}${buildPostUrl(post || { id: postId })}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch (_) {
        toast('Could not copy the link. Copy it from the address bar instead.', 'error');
      }
      return;
    }

    const endpoint = `/posts/${encodeURIComponent(postId)}/${action === 'clap' ? 'clap' : 'bookmark'}`;
    button.disabled = true;
    try {
      const { data: post } = await request(endpoint, { method: 'POST' });
      if (action === 'clap') rememberClap(post.id);
      syncPost(post);
      renderActionButtons(post);
      if (action === 'clap') {
        const clapBtn = elements.readPostActions.querySelector('[data-action="clap"]');
        clapBtn?.classList.add('is-pulsing');
        clapBtn?.focus();
      } else {
        elements.readPostActions.querySelector('[data-action="bookmark"]')?.focus();
        toast('Saved to your reading list');
      }
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'error');
    }
  }

  /* ---------- Settings (title, tagline, social links, banner) ---------- */

  function socialLinksHtml(links = {}) {
    const entries = [
      ['twitter-x', 'X / Twitter', links.twitter],
      ['instagram', 'Instagram', links.instagram],
      ['tiktok', 'TikTok', links.tiktok],
      ['link-45deg', links.custom?.name, links.custom?.url]
    ].filter(([, label, url]) => label && url);
    return entries
      .map(
        ([name, label, url]) =>
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${icon(name)}${escapeHtml(label)}</a>`
      )
      .join('');
  }

  function applySettings(settings) {
    state.settings = settings || {};
    const title = siteTitle();
    if (!state.currentPostId) document.title = title;
    document.querySelectorAll('#site-wordmark, #footer-wordmark').forEach((el) => {
      el.innerHTML = wordmarkHtml(title);
    });

    const tagline = (settings?.tagline || '').trim();
    elements.footerTagline.textContent = tagline;
    elements.footerTagline.hidden = !tagline;

    const linksHtml = socialLinksHtml(settings?.links);
    elements.footerLinks.innerHTML = linksHtml;

    elements.aboutPanel.hidden = !tagline;
    if (tagline) {
      elements.aboutHeading.textContent = `About ${title}`;
      elements.aboutTagline.textContent = tagline;
      elements.aboutLinks.innerHTML = linksHtml;
    }

    if (settings?.bannerImage) {
      elements.banner.innerHTML = `<img src="${escapeHtml(settings.bannerImage)}" alt="">`;
      elements.banner.hidden = false;
    } else {
      elements.banner.innerHTML = '';
      elements.banner.hidden = true;
    }

    if (state.currentPostId) renderMore(state.currentPostId);
  }

  async function loadAndApplySettings() {
    try {
      const { data } = await request('/settings');
      applySettings(data);
    } catch (_) {
      applySettings({});
    }
  }

  /* ---------- Header: nav, search, menu ---------- */

  function setActiveNav(name) {
    elements.siteNav.querySelectorAll('[data-nav]').forEach((link) => {
      const active = link.getAttribute('data-nav') === name;
      link.classList.toggle('active', active);
      if (active) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  /** Opens or closes the collapsed navbar (only has an effect below the lg breakpoint). */
  function setMenuOpen(open) {
    const collapse = bootstrap.Collapse.getOrCreateInstance(elements.navCollapse, { toggle: false });
    if (open) {
      collapse.show();
    } else if (elements.navCollapse.classList.contains('show')) {
      collapse.hide();
    }
  }

  function handleNavClick(link, event) {
    const name = link.getAttribute('data-nav');
    event.preventDefault();
    setMenuOpen(false);
    if (state.currentPostId) {
      closeReader({ updateHistory: true, hash: `#${name}` });
    } else {
      window.history.replaceState({ postId: null }, '', `${BLOG_BASE_PATH}#${name}`);
    }
    setActiveNav(name);
    document.getElementById(name)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleGlobalClick(event) {
    const navLink = event.target.closest('[data-nav]');
    if (navLink) {
      handleNavClick(navLink, event);
      return;
    }

    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const postId = target.getAttribute('data-post-id');
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button !== undefined && event.button !== 0);

    if (action === 'open-post') {
      if (modified) return;
      event.preventDefault();
      openPost(postId);
    } else if (action === 'close-reader' || action === 'go-home') {
      if (modified) return;
      event.preventDefault();
      if (state.currentPostId) {
        closeReader({ updateHistory: true });
      } else if (state.searchTerm) {
        clearSearch();
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'clap' || action === 'bookmark' || action === 'share') {
      event.preventDefault();
      handlePostAction(action, postId, target);
    } else if (action === 'filter-tag') {
      event.preventDefault();
      const tag = target.getAttribute('data-tag') || '';
      elements.searchInput.value = tag;
      runSearch(tag);
    }
  }

  function handleKeydown(event) {
    const typing = /^(input|textarea|select)$/i.test(event.target.tagName) || event.target.isContentEditable;
    if (event.key === '/' && !typing) {
      event.preventDefault();
      if (window.matchMedia('(max-width: 991.98px)').matches) setMenuOpen(true);
      elements.searchInput.focus();
    } else if (event.key === 'Escape') {
      setMenuOpen(false);
    }
  }

  function handlePopState() {
    const postId = getPostIdFromPath();
    if (postId) {
      openPost(postId, { historyMode: 'none' });
    } else if (state.currentPostId) {
      closeReader();
    }
  }

  function bootstrapFromLocation() {
    const initialPostId = getPostIdFromPath();
    if (initialPostId) {
      elements.homeView.hidden = true;
      openPost(initialPostId, { historyMode: 'replace' });
    } else {
      window.history.replaceState({ postId: null }, '', window.location.pathname + window.location.search + window.location.hash);
    }
  }

  function registerEvents() {
    elements.searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      setMenuOpen(false);
      runSearch(elements.searchInput.value);
    });
    elements.clearSearchBtn.addEventListener('click', clearSearch);
    elements.commentForm.addEventListener('submit', handleCommentSubmit);
    elements.commentBody.addEventListener('input', () => setCommentError(''));
    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('popstate', handlePopState);
  }

  elements.footerYear.textContent = String(new Date().getFullYear());
  registerEvents();
  loadAndApplySettings();
  bootstrapFromLocation();
  loadFeed();
})();
