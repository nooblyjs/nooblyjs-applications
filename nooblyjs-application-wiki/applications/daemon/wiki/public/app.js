/* Wiki Sync Daemon — dashboard client.
 *
 * Two jobs in one file, because they share a transport and a status model:
 *   1. The LIVE VIEW — subscribes to /api/stream (SSE) for updates, falling
 *      back to polling /api/status if the stream is unavailable.
 *   2. SETUP + CONFIGURATION — the first-run screen that collects a server URL
 *      and token, and the sheet that manages which folders are synced.
 *
 * No build step, no dependencies. */
(function () {
  'use strict';

  let $ = function (id) { return document.getElementById(id); };
  let feedEl = $('feed');
  let MAX_FEED_ROWS = 250;
  let activeFilter = 'all';
  let lastConn = {};        // last connection block, for the poll countdown
  let seenEmptyFeed = true;
  let lastStatus = null;

  // ---- formatting helpers -------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    let u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    let d = Math.floor(sec / 86400); sec -= d * 86400;
    let h = Math.floor(sec / 3600); sec -= h * 3600;
    let m = Math.floor(sec / 60); let s = sec - m * 60;
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }
  function clockTime(iso) {
    let dt = iso ? new Date(iso) : null;
    if (!dt || isNaN(dt)) return '—';
    return dt.toLocaleTimeString([], { hour12: false });
  }
  function timeAgo(iso) {
    if (!iso) return '—';
    let diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(diff)) return '—';
    if (diff < 5) return 'just now';
    if (diff < 60) return Math.floor(diff) + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }
  function setNum(id, val) {
    let el = $(id);
    if (!el) return;
    let next = String(val);
    if (el.textContent !== next) {
      el.textContent = next;
      el.classList.remove('bump');
      void el.offsetWidth;       // restart animation
      el.classList.add('bump');
    }
  }
  /** A folder path for display; the space root has no path of its own. */
  function folderLabel(remotePath) {
    return remotePath ? remotePath : '(entire space)';
  }

  // ---- tiny fetch wrapper -------------------------------------------------
  // Every config endpoint answers { success, error? }, so failures arrive as a
  // sentence the operator can act on rather than a status code.
  function api(url, options) {
    return fetch(url, Object.assign({ cache: 'no-store' }, options || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok || body.success === false) {
            var e = new Error(body.error || ('Request failed (' + r.status + ')'));
            // Structured extras the caller may act on (e.g. an untrusted
            // certificate the operator can choose to pin).
            if (body.certificate) e.certificate = body.certificate;
            throw e;
          }
          return body;
        });
      });
  }
  function postJson(url, payload) {
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  }
  function showAlert(el, message) {
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = message;
    el.hidden = false;
  }

  // ==========================================================================
  // Live view rendering
  // ==========================================================================
  function renderStats(snap) {
    let t = snap.totals || {};
    setNum('s-folders', (snap.folders || []).length);
    setNum('s-uploads', t.uploads || 0);
    setNum('s-downloads', t.downloads || 0);
    setNum('s-deletes', t.deletes || 0);
    setNum('s-changes', t.changesApplied || 0);
    setNum('s-polls', t.polls || 0);
    setNum('s-errors', t.errors || 0);
  }

  function renderHeader(snap) {
    let conn = snap.connection || {};
    lastConn = conn;

    let dot = $('liveDot');
    let statusLine = $('statusLine');
    let status = snap.status;

    dot.className = 'dot ' + (
      status === 'error' ? 'bad' : status === 'running' ? 'live' : 'warn'
    );

    if (status === 'error') {
      statusLine.textContent = 'Error — ' + (snap.error || 'see activity log');
    } else if (status === 'running') {
      statusLine.textContent = 'Running · syncing ' + (snap.folders || []).length + ' folder(s)';
    } else if (status === 'needs-setup') {
      statusLine.textContent = 'Setup required';
    } else if (status === 'idle') {
      statusLine.textContent = 'Connected · no folders selected';
    } else {
      statusLine.textContent = 'Starting…';
    }

    $('serverUrl').textContent = conn.serverUrl || '—';
    $('uptime').textContent = fmtDuration(snap.uptimeSec);

    let eb = $('errorBanner');
    if (status === 'error' && snap.error) {
      eb.textContent = '⚠ ' + snap.error;
      eb.hidden = false;
    } else {
      eb.hidden = true;
    }

    // "Connected but nothing selected" is a state with an obvious next action,
    // so say what it is instead of showing an empty dashboard.
    $('emptyBanner').hidden = !(status === 'idle');

    applyStatusView(status, snap);
  }

  /**
   * Show the setup screen instead of the dashboard while the daemon has no
   * usable configuration. Driven by the daemon's own status rather than by
   * anything the page remembers, so a config change made in another tab (or a
   * daemon restart) moves this one too.
   */
  function applyStatusView(status, snap) {
    let needsSetup = status === 'needs-setup';
    $('setupView').hidden = !needsSetup;
    $('dashView').hidden = needsSetup;
    $('configBtn').hidden = needsSetup;

    if (needsSetup && lastStatus !== 'needs-setup') primeSetupForm();

    // Arriving at "connected, nothing chosen" for the first time — open the
    // picker rather than leaving the operator on an empty dashboard wondering
    // what to do next.
    if (status === 'idle' && lastStatus && lastStatus !== 'idle' && !isOpen($('configOverlay'))) {
      openConfig();
    }
    lastStatus = status;
    if (snap && snap.config && snap.config.defaultServerUrl) {
      defaultServerUrl = snap.config.defaultServerUrl;
    }
  }

  function renderConnection(snap) {
    let c = snap.connection || {};
    let t = snap.totals || {};

    $('c-status').innerHTML = '<span class="pill ' + escapeHtml(snap.status || '') + '">'
      + escapeHtml(snap.status || '—') + '</span>';

    $('c-auth').innerHTML = c.authenticated
      ? '<span class="badge-ok">yes</span> · ' + escapeHtml(c.authMethod || '')
      : '<span class="badge-bad">no</span>';
    $('c-watch').textContent = c.watchFolder || '—';
    $('c-interval').textContent = c.syncInterval ? c.syncInterval + ' ms' : '—';
    $('c-lastpoll').innerHTML = c.lastPollAt
      ? clockTime(c.lastPollAt) + (c.lastPollOk === false ? ' <span class="badge-bad">(failed)</span>' : '')
      : '—';
    $('c-cursor').textContent = c.cursor || '—';
    $('c-bytes').textContent = '↑ ' + fmtBytes(t.bytesUp) + ' · ↓ ' + fmtBytes(t.bytesDown);
  }

  function renderFolders(snap) {
    let folders = snap.folders || [];
    $('folderCount').textContent = folders.length;
    let body = $('foldersBody');

    if (!folders.length) {
      body.innerHTML = '<tr class="empty"><td colspan="7">No folders selected.</td></tr>';
      return;
    }
    body.innerHTML = folders.map(function (f) {
      return '<tr>' +
        '<td class="space-name">' + escapeHtml(f.spaceName || ('space ' + f.spaceId)) + '</td>' +
        '<td class="space-folder" title="' + escapeHtml(f.watchFolder || '') + '">'
          + escapeHtml(folderLabel(f.remotePath)) + '</td>' +
        '<td class="num">' + (f.trackedFiles != null ? f.trackedFiles : '—') + '</td>' +
        '<td class="num">' + (f.uploads || 0) + '</td>' +
        '<td class="num">' + (f.downloads || 0) + '</td>' +
        '<td class="num">' + (f.deletes || 0) + '</td>' +
        '<td class="space-when">' + timeAgo(f.lastActivity) + '</td>' +
      '</tr>';
    }).join('');
  }

  function rowMatchesFilter(scope, level) {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'error') return level === 'error';
    return String(scope || '').toLowerCase().indexOf(activeFilter) === 0;
  }

  function buildRow(e, fresh) {
    let scope = (e.scope || 'daemon').toLowerCase();
    let div = document.createElement('div');
    div.className = 'feed-row lvl-' + (e.level || 'info') + (fresh ? ' fresh' : '');
    div.dataset.scope = scope;
    div.dataset.level = e.level || 'info';
    if (!rowMatchesFilter(scope, e.level)) div.style.display = 'none';
    div.innerHTML =
      '<span class="time">' + clockTime(e.ts) + '</span>' +
      '<span class="scope scope-' + escapeHtml(scope) + '">' + escapeHtml(scope) + '</span>' +
      '<span class="msg">' + escapeHtml(e.message) + '</span>';
    return div;
  }

  function backfillFeed(events) {
    feedEl.innerHTML = '';
    if (!events || !events.length) {
      feedEl.innerHTML = '<div class="empty">No activity yet.</div>';
      seenEmptyFeed = true;
      return;
    }
    seenEmptyFeed = false;
    for (let i = events.length - 1; i >= 0; i--) {   // newest first
      feedEl.appendChild(buildRow(events[i], false));
    }
  }

  function pushFeed(e) {
    if (seenEmptyFeed) { feedEl.innerHTML = ''; seenEmptyFeed = false; }
    feedEl.insertBefore(buildRow(e, true), feedEl.firstChild);
    while (feedEl.childElementCount > MAX_FEED_ROWS) {
      feedEl.removeChild(feedEl.lastChild);
    }
  }

  function applyFilter() {
    let rows = feedEl.querySelectorAll('.feed-row');
    for (let i = 0; i < rows.length; i++) {
      let r = rows[i];
      r.style.display = rowMatchesFilter(r.dataset.scope, r.dataset.level) ? '' : 'none';
    }
  }

  function renderAll(snap) {
    renderHeader(snap);
    renderStats(snap);
    renderConnection(snap);
    renderFolders(snap);
  }

  // ---- next-poll countdown (ticks locally between updates) ----------------
  setInterval(function () {
    let el = $('nextPoll');
    if (!lastConn.lastPollAt || !lastConn.syncInterval) { el.textContent = '—'; return; }
    let due = new Date(lastConn.lastPollAt).getTime() + lastConn.syncInterval;
    let left = Math.round((due - Date.now()) / 1000);
    el.textContent = left <= 0 ? 'now' : 'in ' + left + 's';
  }, 500);

  // ---- filter buttons -----------------------------------------------------
  $('filters').addEventListener('click', function (ev) {
    let btn = ev.target.closest('.filter');
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    Array.prototype.forEach.call(this.querySelectorAll('.filter'), function (b) {
      b.classList.toggle('active', b === btn);
    });
    applyFilter();
  });

  // ==========================================================================
  // Setup screen
  // ==========================================================================
  let defaultServerUrl = 'https://localhost:9101/';
  let defaultBaseFolder = '';
  let currentConfig = null;
  let setupPrimed = false;

  /**
   * Fill the setup form once. Every field is pre-filled with whatever the daemon
   * already knows — a saved value, a value seeded from .env, or the shipped
   * default (for the folder, a "NooblyJS Wiki" directory in the user's
   * Documents) — so the common case is "paste a token and press Connect".
   */
  function primeSetupForm() {
    if (setupPrimed) return;
    setupPrimed = true;
    api('/api/config').then(function (body) {
      currentConfig = body.config;
      $('setupUrl').value = body.config.serverUrl || body.config.defaultServerUrl || defaultServerUrl;
      defaultServerUrl = body.config.defaultServerUrl || defaultServerUrl;
      defaultBaseFolder = body.config.defaultBaseFolder || '';
      $('setupFolder').value = body.config.baseFolder || defaultBaseFolder;
      $('setupToken').focus();
    }).catch(function () {
      $('setupUrl').value = defaultServerUrl;
    });
  }

  $('setupFolderReset').addEventListener('click', function () {
    if (defaultBaseFolder) $('setupFolder').value = defaultBaseFolder;
  });

  $('setupForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    let btn = $('setupSubmit');
    showAlert($('setupError'), '');
    btn.disabled = true;
    btn.textContent = 'Connecting…';

    hideCertOffer();
    postJson('/api/config/connection', {
      serverUrl: $('setupUrl').value,
      token: $('setupToken').value,
      baseFolder: $('setupFolder').value,
    }).then(function (body) {
      currentConfig = body.config;
      $('setupToken').value = '';
      setupPrimed = false;
      // Connected with nothing to sync yet — go straight to choosing folders.
      if (!body.config.folders.length) openConfig();
    }).catch(function (err) {
      showAlert($('setupError'), err.message);
      // The daemon attaches the certificate it was offered when the failure
      // was "untrusted issuer", which turns a dead end into a decision.
      if (err.certificate) showCertOffer(err.certificate);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Connect';
    });
  });

  // ---- untrusted certificate ----------------------------------------------
  //
  // A self-signed development server is the normal case here, and the error
  // Node produces points the reader at --use-system-ca, which cannot fix it.
  // So the certificate is shown instead, and pinning it is one click. Pinning
  // keeps verification ON — the certificate is added to the trust store, so
  // the chain, hostname and expiry are all still enforced.
  let pendingCert = null;

  function showCertOffer(cert) {
    pendingCert = cert;
    $('certLead').textContent = cert.selfSigned
      ? 'It is signed by itself, so no certificate authority vouches for it. '
        + 'This is normal for a local development server.'
      : 'It was issued by an authority this machine does not trust.';
    $('certSubject').textContent = cert.subject || '—';
    $('certIssuer').textContent = cert.issuer || '—';
    $('certValidTo').textContent = cert.validTo || '—';
    $('certFingerprint').textContent = cert.fingerprint || '—';
    $('certOffer').hidden = false;
  }

  function hideCertOffer() {
    pendingCert = null;
    $('certOffer').hidden = true;
  }

  $('certTrust').addEventListener('click', function () {
    if (!pendingCert) return;
    var btn = $('certTrust');
    btn.disabled = true;
    btn.textContent = 'Trusting…';
    showAlert($('setupError'), '');

    postJson('/api/config/trust-certificate', {
      serverUrl: pendingCert.serverUrl,
      token: $('setupToken').value,
      fingerprint: pendingCert.fingerprint,
      // The setup form is still on screen, so its folder has not been saved
      // yet — carry it through the retry or trusting a certificate would
      // silently discard the location the operator just chose.
      baseFolder: $('setupFolder').value,
    }).then(function (body) {
      hideCertOffer();
      currentConfig = body.config;
      $('setupToken').value = '';
      setupPrimed = false;
      if (body.config && !body.config.folders.length) openConfig();
    }).catch(function (err) {
      showAlert($('setupError'), err.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Trust this certificate and connect';
    });
  });

  /** Pinned certificates, listed in the config sheet so they stay visible. */
  function renderPinnedCerts(config) {
    var certs = (config && config.trustedCertificates) || [];
    var box = $('cfgCerts');
    box.hidden = !certs.length;
    if (!certs.length) return;
    $('cfgCertList').innerHTML = certs.map(function (c) {
      return '<li class="kd-pin">'
        + '<div class="kd-pin-text">'
          + '<span class="kd-pin-subject">' + escapeHtml(c.subject || '(unknown)') + '</span>'
          + '<span class="kd-pin-fp">' + escapeHtml(c.fingerprint || '') + '</span>'
        + '</div>'
        + '<button class="kd-icon-btn" type="button" data-untrust="' + escapeHtml(c.fingerprint) + '" '
          + 'title="Stop trusting this certificate" aria-label="Remove">✕</button>'
        + '</li>';
    }).join('');
  }

  $('cfgCertList').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-untrust]');
    if (!btn) return;
    if (!window.confirm('Stop trusting this certificate?\n\nConnections to that server will fail verification again until you trust it once more.')) return;
    postJson('/api/config/untrust-certificate', { fingerprint: btn.getAttribute('data-untrust') })
      .then(function (body) { currentConfig = body.config; renderPinnedCerts(body.config); })
      .catch(function (err) { showAlert($('configError'), err.message); });
  });

  // ==========================================================================
  // Configuration sheet
  // ==========================================================================
  let chosen = [];        // working selection: [{spaceId, spaceName, remotePath}]
  let savedChosen = [];   // what the daemon currently has, for the removal diff
  let spaces = [];

  function isOpen(el) { return el && !el.hidden; }
  function keyOf(f) { return String(f.spaceId) + '::' + (f.remotePath || ''); }

  function openOverlay(el) {
    el.hidden = false;
    document.body.classList.add('kd-locked');
  }
  function closeOverlay(el) {
    el.hidden = true;
    if (!isOpen($('configOverlay')) && !isOpen($('credsOverlay')) && !isOpen($('folderOverlay'))) {
      document.body.classList.remove('kd-locked');
    }
  }

  function openConfig() {
    showAlert($('configError'), '');
    openOverlay($('configOverlay'));
    api('/api/config').then(function (body) {
      currentConfig = body.config;
      defaultServerUrl = body.config.defaultServerUrl || defaultServerUrl;
      savedChosen = body.config.folders.map(function (f) {
        return { spaceId: String(f.spaceId), spaceName: f.spaceName, remotePath: f.remotePath || '' };
      });
      chosen = savedChosen.slice();
      defaultBaseFolder = body.config.defaultBaseFolder || defaultBaseFolder;
      $('cfgServer').textContent = body.config.serverUrl || '—';
      $('cfgToken').textContent = body.config.hasToken ? (body.config.tokenHint || 'set') : 'not set';
      $('cfgFolder').textContent = body.config.baseFolder || '—';
      renderPinnedCerts(body.config);
      renderChosen();
      return loadSpaces();
    }).catch(function (err) {
      showAlert($('configError'), err.message);
    });
  }

  function closeConfig() { closeOverlay($('configOverlay')); }

  $('configBtn').addEventListener('click', openConfig);
  $('configClose').addEventListener('click', closeConfig);
  $('configCancel').addEventListener('click', closeConfig);
  document.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-open-config]')) openConfig();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (isOpen($('credsOverlay'))) closeOverlay($('credsOverlay'));
    else if (isOpen($('folderOverlay'))) closeOverlay($('folderOverlay'));
    else if (isOpen($('configOverlay'))) closeConfig();
  });

  // ---- chosen list --------------------------------------------------------
  function renderChosen() {
    let list = $('chosenList');
    $('chosenCount').textContent = chosen.length;

    if (!chosen.length) {
      list.innerHTML = '<li class="kd-muted kd-pad">Nothing selected yet. '
        + 'Browse or search on the left, then click a space or folder to add it.</li>';
    } else {
      // GROUPED BY SPACE, because a selection is a (space, folder) pair and the
      // folder half alone is ambiguous: the same path exists in several spaces,
      // and spaces sharing a content root make that the normal case rather than
      // an edge one. The space heading is the thing that makes the list
      // readable back to the operator.
      let groups = [];
      let byId = {};
      chosen.forEach(function (f) {
        let id = String(f.spaceId);
        if (!byId[id]) {
          byId[id] = { spaceId: id, spaceName: f.spaceName, items: [] };
          groups.push(byId[id]);
        }
        byId[id].items.push(f);
      });

      list.innerHTML = groups.map(function (g) {
        // A whole-space selection subsumes every folder under it, so say so
        // rather than listing them as if they were separate mirrors.
        let wholeSpace = g.items.some(function (f) { return !f.remotePath; });

        return '<li class="kd-chosen-group">'
          + '<div class="kd-chosen-space">' + escapeHtml(g.spaceName)
            + '<span class="kd-chosen-tally">' + (wholeSpace ? 'entire space' : g.items.length + ' folder' + (g.items.length === 1 ? '' : 's')) + '</span>'
          + '</div>'
          + '<ul class="kd-chosen-sub">'
          + g.items.map(function (f) {
              return '<li class="kd-chosen-item" data-key="' + escapeHtml(keyOf(f)) + '">'
                + '<span class="kd-chosen-path' + (f.remotePath ? '' : ' is-root') + '">'
                  + escapeHtml(folderLabel(f.remotePath)) + '</span>'
                + '<button class="kd-icon-btn" type="button" data-remove="' + escapeHtml(keyOf(f)) + '" '
                  + 'title="Stop syncing and delete the local folder" aria-label="Remove">✕</button>'
                + '</li>';
            }).join('')
          + '</ul></li>';
      }).join('');
    }

    // Spell out the destructive part of Save BEFORE it is pressed. Removing a
    // folder deletes its local copy, and that is not recoverable from here.
    let savedKeys = {};
    savedChosen.forEach(function (f) { savedKeys[keyOf(f)] = f; });
    let chosenKeys = {};
    chosen.forEach(function (f) { chosenKeys[keyOf(f)] = true; });
    let removing = savedChosen.filter(function (f) { return !chosenKeys[keyOf(f)]; });

    let warn = $('deleteWarning');
    if (removing.length) {
      warn.innerHTML = '⚠ Saving will stop syncing ' + removing.length + ' folder(s) and '
        + '<strong>delete their local copies</strong>:<br>'
        + removing.map(function (f) {
            return '<code>' + escapeHtml(f.spaceName + '/' + folderLabel(f.remotePath)) + '</code>';
          }).join(', ');
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }

    $('configSave').textContent = removing.length
      ? 'Save (delete ' + removing.length + ' local folder' + (removing.length === 1 ? '' : 's') + ')'
      : 'Save changes';

    refreshTreeSelectionMarks();
  }

  $('chosenList').addEventListener('click', function (ev) {
    let btn = ev.target.closest('[data-remove]');
    if (!btn) return;
    let key = btn.getAttribute('data-remove');
    chosen = chosen.filter(function (f) { return keyOf(f) !== key; });
    renderChosen();
  });

  function toggleFolder(spaceId, spaceName, remotePath) {
    let entry = { spaceId: String(spaceId), spaceName: spaceName, remotePath: remotePath || '' };
    let key = keyOf(entry);
    let existing = chosen.filter(function (f) { return keyOf(f) === key; });
    if (existing.length) {
      chosen = chosen.filter(function (f) { return keyOf(f) !== key; });
    } else {
      chosen = chosen.concat([entry]);
    }
    renderChosen();
  }

  function isChosen(spaceId, remotePath) {
    let key = String(spaceId) + '::' + (remotePath || '');
    return chosen.some(function (f) { return keyOf(f) === key; });
  }

  // ---- spaces + lazy folder tree ------------------------------------------
  //
  // THE SPACE IS A ROW IN THE TREE, NOT A FILTER ABOVE IT. A selection is a
  // (space, folder) pair — the same folder path means different things in two
  // spaces, and several spaces are different curated lenses over ONE content
  // directory — so the space has to be visible at the point of choosing, and
  // selectable in its own right. The dropdown narrows what is listed; it is not
  // what binds a chosen folder to a space.
  //
  // The tree below each space is LAZY and its nodes carry no `path` — the
  // server strips it because nesting implies it. So paths are rebuilt here as
  // the tree is walked, and a node flagged `truncated` is one that was NOT
  // listed yet: it is drawn with a chevron and fetched on expand. Drawing it as
  // a leaf would hide whole subtrees of the wiki from the picker.

  let scopeSpaceId = '';                        // '' = show every space
  let treesBySpace = Object.create(null);       // spaceId -> { roots, loaded, loading, error }
  let expanded = Object.create(null);           // 'spaceId::path' -> true
  let loadingNode = Object.create(null);        // 'spaceId::path' -> true

  function nodeKey(spaceId, nodePath) { return String(spaceId) + '::' + (nodePath || ''); }

  function spaceNameFor(spaceId) {
    let match = spaces.filter(function (s) { return String(s.id) === String(spaceId); })[0];
    return match ? match.name : ('Space ' + spaceId);
  }

  function visibleSpaces() {
    if (!scopeSpaceId) return spaces;
    return spaces.filter(function (s) { return String(s.id) === scopeSpaceId; });
  }

  function loadSpaces() {
    return api('/api/browse/spaces').then(function (body) {
      spaces = body.spaces || [];
      let sel = $('pickSpace');
      sel.innerHTML = '<option value="">All spaces</option>'
        + spaces.map(function (s) {
            return '<option value="' + escapeHtml(String(s.id)) + '">' + escapeHtml(s.name) + '</option>';
          }).join('');

      // Keep the scope the operator was last using, if it still exists.
      if (scopeSpaceId && !spaces.some(function (s) { return String(s.id) === scopeSpaceId; })) {
        scopeSpaceId = '';
      }
      sel.value = scopeSpaceId;

      // A single space needs no choosing — open it straight away.
      if (spaces.length === 1) {
        scopeSpaceId = String(spaces[0].id);
        sel.value = scopeSpaceId;
        expanded[nodeKey(scopeSpaceId, '')] = true;
        ensureSpaceTree(scopeSpaceId);
      }
      renderTree();
    });
  }

  $('pickSpace').addEventListener('change', function () {
    scopeSpaceId = String(this.value || '');
    clearSearch();
    if (scopeSpaceId) {
      expanded[nodeKey(scopeSpaceId, '')] = true;
      ensureSpaceTree(scopeSpaceId);
    }
    renderTree();
  });

  function normaliseNodes(raw, parentPath) {
    return (raw || []).filter(function (n) { return n && n.type === 'folder'; }).map(function (n) {
      let nodePath = parentPath ? parentPath + '/' + n.name : n.name;
      return {
        name: n.name,
        path: nodePath,
        truncated: !!n.truncated,
        children: n.truncated ? null : normaliseNodes(n.children, nodePath),
      };
    });
  }

  /** Fetch a space's top level once, on first expand. */
  function ensureSpaceTree(spaceId) {
    let id = String(spaceId);
    let entry = treesBySpace[id];
    if (entry && (entry.loaded || entry.loading)) return;

    treesBySpace[id] = { roots: [], loaded: false, loading: true, error: null };
    renderTree();

    api('/api/browse/tree?spaceId=' + encodeURIComponent(id))
      .then(function (body) {
        treesBySpace[id] = { roots: normaliseNodes(body.tree, ''), loaded: true, loading: false, error: null };
      })
      .catch(function (err) {
        treesBySpace[id] = { roots: [], loaded: true, loading: false, error: err.message };
      })
      .then(renderTree);
  }

  function findNode(nodes, targetPath) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].path === targetPath) return nodes[i];
      if (nodes[i].children) {
        let hit = findNode(nodes[i].children, targetPath);
        if (hit) return hit;
      }
    }
    return null;
  }

  function expandNode(spaceId, nodePath) {
    let entry = treesBySpace[String(spaceId)];
    if (!entry) return;
    let node = findNode(entry.roots, nodePath);
    if (!node) return;

    let key = nodeKey(spaceId, nodePath);
    expanded[key] = true;
    if (node.children !== null) { renderTree(); return; }

    loadingNode[key] = true;
    renderTree();
    api('/api/browse/tree?spaceId=' + encodeURIComponent(spaceId)
        + '&path=' + encodeURIComponent(nodePath))
      .then(function (body) {
        node.children = normaliseNodes(body.tree, nodePath);
        node.truncated = false;
      })
      .catch(function (err) {
        node.children = [];
        showAlert($('configError'), err.message);
      })
      .then(function () {
        delete loadingNode[key];
        renderTree();
      });
  }

  function renderTree() {
    let host = $('pickTree');
    let list = visibleSpaces();

    if (!spaces.length) {
      host.innerHTML = '<div class="kd-muted kd-pad">This account cannot see any spaces.</div>';
      return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="kd-muted kd-pad">That space is no longer available.</div>';
      return;
    }

    host.innerHTML = list.map(function (space) {
      let id = String(space.id);
      let open = !!expanded[nodeKey(id, '')];
      let entry = treesBySpace[id];
      let html = spaceRowHtml(space, open);

      if (open) {
        if (!entry || entry.loading) {
          html += '<div class="kd-tree-loading" style="padding-left:28px">Loading…</div>';
        } else if (entry.error) {
          html += '<div class="kd-tree-error" style="padding-left:28px">' + escapeHtml(entry.error) + '</div>';
        } else if (!entry.roots.length) {
          html += '<div class="kd-tree-empty" style="padding-left:28px">no folders</div>';
        } else {
          html += entry.roots.map(function (n) { return subtreeHtml(id, n, 1); }).join('');
        }
      }
      return html;
    }).join('');
  }

  /** The space itself — selectable, meaning "mirror the whole space". */
  function spaceRowHtml(space, open) {
    let id = String(space.id);
    let selected = isChosen(id, '');
    return '<div class="kd-tree-row kd-space-row' + (selected ? ' is-selected' : '') + '"'
      + ' data-space="' + escapeHtml(id) + '" data-path="">'
      + '<button class="kd-twisty' + (open ? ' open' : '') + '" type="button"'
      + ' data-toggle-space="' + escapeHtml(id) + '" aria-label="Expand space">▸</button>'
      + '<button class="kd-tree-name" type="button"'
      + ' data-pick="" data-pick-space="' + escapeHtml(id) + '"'
      + ' title="Sync this entire space">'
      + '<span class="kd-space-icon">◆</span>'
      + escapeHtml(space.name)
      + '</button>'
      + '<span class="kd-tree-mark">' + (selected ? 'whole space' : '') + '</span>'
      + '</div>';
  }

  function subtreeHtml(spaceId, node, level) {
    let key = nodeKey(spaceId, node.path);
    let html = rowHtml(spaceId, node, level);
    if (expanded[key]) {
      let pad = 12 + level * 16;
      if (loadingNode[key]) {
        html += '<div class="kd-tree-loading" style="padding-left:' + pad + 'px">Loading…</div>';
      } else if (node.children && node.children.length) {
        html += node.children.map(function (c) { return subtreeHtml(spaceId, c, level + 1); }).join('');
      } else if (node.children) {
        html += '<div class="kd-tree-empty" style="padding-left:' + pad + 'px">empty</div>';
      }
    }
    return html;
  }

  function rowHtml(spaceId, node, level) {
    // `truncated` means "not listed yet", so a truncated folder MUST still get
    // a chevron even though its children array is empty.
    let hasKids = node.truncated || (node.children && node.children.length);
    let open = !!expanded[nodeKey(spaceId, node.path)];
    let selected = isChosen(spaceId, node.path);

    return '<div class="kd-tree-row' + (selected ? ' is-selected' : '') + '"'
      + ' style="padding-left:' + (8 + level * 16) + 'px"'
      + ' data-space="' + escapeHtml(String(spaceId)) + '"'
      + ' data-path="' + escapeHtml(node.path) + '">'
      + (hasKids
          ? '<button class="kd-twisty' + (open ? ' open' : '') + '" type="button"'
            + ' data-toggle="' + escapeHtml(node.path) + '"'
            + ' data-toggle-in="' + escapeHtml(String(spaceId)) + '" aria-label="Expand">▸</button>'
          : '<span class="kd-twisty-spacer"></span>')
      + '<button class="kd-tree-name" type="button"'
      + ' data-pick="' + escapeHtml(node.path) + '"'
      + ' data-pick-space="' + escapeHtml(String(spaceId)) + '">'
      + '<span class="kd-tree-icon">▸</span>'
      + escapeHtml(node.name)
      + '</button>'
      + '<span class="kd-tree-mark">' + (selected ? 'syncing' : '') + '</span>'
      + '</div>';
  }

  /** Repaint selection marks without refetching or collapsing anything. */
  function refreshTreeSelectionMarks() {
    let rows = $('pickTree').querySelectorAll('.kd-tree-row');
    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];
      let selected = isChosen(row.getAttribute('data-space'), row.getAttribute('data-path'));
      row.classList.toggle('is-selected', selected);
      let mark = row.querySelector('.kd-tree-mark');
      if (mark) {
        mark.textContent = selected
          ? (row.classList.contains('kd-space-row') ? 'whole space' : 'syncing')
          : '';
      }
    }
    let hits = $('pickTree').querySelectorAll('.kd-hit');
    for (let j = 0; j < hits.length; j++) {
      let sel = isChosen(hits[j].getAttribute('data-space'), hits[j].getAttribute('data-path'));
      hits[j].classList.toggle('is-selected', sel);
    }
  }

  $('pickTree').addEventListener('click', function (ev) {
    let spaceToggle = ev.target.closest('[data-toggle-space]');
    if (spaceToggle) {
      let id = spaceToggle.getAttribute('data-toggle-space');
      let key = nodeKey(id, '');
      if (expanded[key]) { delete expanded[key]; renderTree(); }
      else { expanded[key] = true; ensureSpaceTree(id); renderTree(); }
      return;
    }

    let toggle = ev.target.closest('[data-toggle]');
    if (toggle) {
      let id = toggle.getAttribute('data-toggle-in');
      let p = toggle.getAttribute('data-toggle');
      let key = nodeKey(id, p);
      if (expanded[key]) { delete expanded[key]; renderTree(); }
      else expandNode(id, p);
      return;
    }

    let pick = ev.target.closest('[data-pick-space]');
    if (pick) {
      let id = pick.getAttribute('data-pick-space');
      toggleFolder(id, spaceNameFor(id), pick.getAttribute('data-pick'));
      return;
    }

    let hit = ev.target.closest('.kd-hit');
    if (hit) {
      toggleFolder(hit.getAttribute('data-space'), hit.getAttribute('data-space-name'), hit.getAttribute('data-path'));
    }
  });

  // ---- search -------------------------------------------------------------
  //
  // The platform indexes DOCUMENTS, not folders — there is no folder search to
  // call — so the daemon searches document content and collapses the hits onto
  // their parent folders. That is what makes a folder findable by what is in it
  // rather than only by where it sits.
  //
  // With no space chosen this searches EVERY space and each result names the
  // space it belongs to, because that space is half of what gets selected.
  let searchTimer = null;

  function clearSearch() {
    $('pickSearch').value = '';
    $('pickMode').hidden = true;
  }

  $('pickClearSearch').addEventListener('click', function () {
    clearSearch();
    renderTree();
  });

  $('pickSearch').addEventListener('input', function () {
    let term = this.value.trim();
    clearTimeout(searchTimer);
    if (!term) { $('pickMode').hidden = true; renderTree(); return; }
    searchTimer = setTimeout(function () { runSearch(term); }, 300);
  });

  function runSearch(term) {
    let scopeLabel = scopeSpaceId ? spaceNameFor(scopeSpaceId) : 'all spaces';
    $('pickTree').innerHTML = '<div class="kd-muted kd-pad">Searching ' + escapeHtml(scopeLabel) + '…</div>';
    api('/api/browse/search?q=' + encodeURIComponent(term)
        + '&spaceId=' + encodeURIComponent(scopeSpaceId))
      .then(function (body) {
        let folders = body.folders || [];
        $('pickMode').hidden = false;
        $('pickModeLabel').textContent = folders.length
          ? folders.length + ' folder(s) in ' + scopeLabel + ' containing “' + term + '”'
          : 'No documents in ' + scopeLabel + ' matched “' + term + '”';

        if (!folders.length) {
          $('pickTree').innerHTML = '<div class="kd-muted kd-pad">'
            + 'Nothing found. Folders are matched through the documents inside them, '
            + 'so a folder with no indexed content will not appear here — browse for it instead.</div>';
          return;
        }

        $('pickTree').innerHTML = folders.map(function (f) {
          let name = f.spaceName || spaceNameFor(f.spaceId);
          return '<button class="kd-hit' + (isChosen(f.spaceId, f.remotePath) ? ' is-selected' : '') + '" type="button"'
            + ' data-space="' + escapeHtml(String(f.spaceId)) + '"'
            + ' data-space-name="' + escapeHtml(name) + '"'
            + ' data-path="' + escapeHtml(f.remotePath) + '">'
            + '<span class="kd-hit-space">' + escapeHtml(name) + '</span>'
            + '<span class="kd-hit-path">' + escapeHtml(folderLabel(f.remotePath)) + '</span>'
            + '<span class="kd-hit-meta">' + f.matches + ' match'
            + (f.matches === 1 ? '' : 'es') + '</span>'
            + '<span class="kd-hit-samples">' + escapeHtml((f.samples || []).join(' · ')) + '</span>'
            + '</button>';
        }).join('');
      })
      .catch(function (err) {
        $('pickTree').innerHTML = '<div class="kd-alert kd-pad">' + escapeHtml(err.message) + '</div>';
      });
  }

  // ---- save ---------------------------------------------------------------
  $('configSave').addEventListener('click', function () {
    let chosenKeys = {};
    chosen.forEach(function (f) { chosenKeys[keyOf(f)] = true; });
    let removing = savedChosen.filter(function (f) { return !chosenKeys[keyOf(f)]; });

    if (removing.length) {
      let names = removing.map(function (f) {
        return '  • ' + f.spaceName + '/' + folderLabel(f.remotePath);
      }).join('\n');
      if (!window.confirm(
        'Stop syncing ' + removing.length + ' folder(s) and DELETE their local copies?\n\n'
        + names + '\n\nThe documents stay in the wiki. The local files are removed.'
      )) return;
    }

    let btn = $('configSave');
    let label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    showAlert($('configError'), '');

    postJson('/api/config/folders', { folders: chosen }).then(function () {
      closeConfig();
    }).catch(function (err) {
      showAlert($('configError'), err.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  });

  // ---- change the local folder --------------------------------------------
  //
  // This one MOVES FILES, so the dialog says what will happen before it runs
  // and the result says what did: a folder that could not be renamed (a
  // different drive, a file held open) is downloaded again at the new location
  // and its old copy left behind, which the operator has to know about to clean
  // up. Reporting "saved" for that would be a lie by omission.
  $('cfgChangeFolder').addEventListener('click', function () {
    showAlert($('folderError'), '');
    $('folderPath').value = (currentConfig && currentConfig.baseFolder) || defaultBaseFolder || '';
    var count = ((currentConfig && currentConfig.folders) || []).length;
    var note = $('folderMoveNote');
    if (count) {
      note.textContent = count + ' synced folder(s) will be moved to the new location. '
        + 'Nothing is re-downloaded unless a folder cannot be moved.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
    openOverlay($('folderOverlay'));
    $('folderPath').focus();
    $('folderPath').select();
  });
  $('folderClose').addEventListener('click', function () { closeOverlay($('folderOverlay')); });
  $('folderCancel').addEventListener('click', function () { closeOverlay($('folderOverlay')); });
  $('folderReset').addEventListener('click', function () {
    if (defaultBaseFolder) $('folderPath').value = defaultBaseFolder;
  });

  $('folderForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('folderSubmit');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Moving…';
    showAlert($('folderError'), '');

    postJson('/api/config/base-folder', { baseFolder: $('folderPath').value }).then(function (body) {
      currentConfig = body.config;
      closeOverlay($('folderOverlay'));
      $('cfgFolder').textContent = body.config.baseFolder || '—';
      if (body.remirrored) {
        window.alert(body.remirrored + ' folder(s) could not be moved and are being downloaded again at '
          + body.config.baseFolder + '.\n\nTheir previous copies were left where they were — '
          + 'check the activity feed, then remove them yourself once you are happy.');
      }
    }).catch(function (err) {
      showAlert($('folderError'), err.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  });

  // ---- change credentials / disconnect ------------------------------------
  $('cfgChangeServer').addEventListener('click', function () {
    showAlert($('credsError'), '');
    $('credsUrl').value = (currentConfig && currentConfig.serverUrl) || defaultServerUrl;
    $('credsToken').value = '';
    openOverlay($('credsOverlay'));
    $('credsToken').focus();
  });
  $('credsClose').addEventListener('click', function () { closeOverlay($('credsOverlay')); });
  $('credsCancel').addEventListener('click', function () { closeOverlay($('credsOverlay')); });

  $('credsForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    let btn = $('credsSubmit');
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    showAlert($('credsError'), '');

    postJson('/api/config/connection', {
      serverUrl: $('credsUrl').value,
      token: $('credsToken').value,
    }).then(function (body) {
      currentConfig = body.config;
      closeOverlay($('credsOverlay'));
      $('cfgServer').textContent = body.config.serverUrl || '—';
      $('cfgToken').textContent = body.config.tokenHint || 'set';
      $('cfgFolder').textContent = body.config.baseFolder || '—';
      return loadSpaces();
    }).catch(function (err) {
      showAlert($('credsError'), err.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Verify and save';
    });
  });

  $('cfgDisconnect').addEventListener('click', function () {
    if (!window.confirm(
      'Disconnect from the server?\n\n'
      + 'Syncing stops and the token is forgotten. Your folder selection and all '
      + 'local files are kept — entering a token again resumes where it left off.'
    )) return;

    postJson('/api/config/disconnect', {}).then(function () {
      closeConfig();
      setupPrimed = false;
    }).catch(function (err) {
      showAlert($('configError'), err.message);
    });
  });

  // ==========================================================================
  // Transport: SSE with polling fallback
  // ==========================================================================
  let dropBanner = $('dropBanner');
  let pollTimer = null;

  function startPolling() {
    if (pollTimer) return;
    function tick() {
      fetch('/api/status', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (snap) { renderAll(snap); backfillFeed(snap.events); })
        .catch(function () {});
    }
    tick();
    pollTimer = setInterval(tick, 2000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function connect() {
    if (!window.EventSource) { startPolling(); return; }
    let es = new EventSource('/api/stream');

    es.addEventListener('snapshot', function (m) {
      dropBanner.hidden = true; stopPolling();
      let snap = JSON.parse(m.data);
      renderAll(snap);
      backfillFeed(snap.events);
    });
    es.addEventListener('stats', function (m) {
      renderAll(JSON.parse(m.data));
    });
    es.addEventListener('activity', function (m) {
      pushFeed(JSON.parse(m.data));
    });

    es.onerror = function () {
      // EventSource auto-reconnects; show a banner and poll meanwhile.
      dropBanner.hidden = false;
      startPolling();
    };
  }

  connect();
})();
