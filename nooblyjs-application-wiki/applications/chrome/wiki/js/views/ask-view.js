/**
 * Ask View Module
 * AI-powered chat with grounded sources
 */

import { updateState, AppState } from '../state.js';

/**
 * Render the Ask tab view
 * @param {Object} state - Current app state
 * @returns {string} HTML to render
 */
export function render(state) {
  if (state.messages.length === 0) {
    return renderEmptyState(state);
  }

  return renderConversation(state);
}

/**
 * Empty state: grounding strip + icon + prompt cards
 */
function renderEmptyState(state) {
  return `
    <div class="grounding-strip">
      <i class="bi bi-stars" style="color: var(--teal-500);"></i>
      Grounded on <strong>${escapeHtml(state.currentSpace?.name || 'Loading...')}</strong>
    </div>
    <div class="ask-empty">
      <div class="empty-icon"><i class="bi bi-stars" style="color: var(--teal-500);"></i></div>
      <h2>Ask the repository</h2>
      <p>Answers drawn from your spaces — with sources.</p>
      <div class="suggested-prompts">
        <div class="eyebrow">TRY ASKING</div>
        <button class="prompt-card" data-text="What is Akamai used for in our stack?">
          <i class="bi bi-search" style="color: var(--teal-500);"></i>What is Akamai used for in our stack?
        </button>
        <button class="prompt-card" data-text="Summarise the CRUD classifications">
          <i class="bi bi-folder" style="color: var(--teal-500);"></i>Summarise the CRUD classifications
        </button>
        <button class="prompt-card" data-text="Where are the POS replacement docs?">
          <i class="bi bi-geo-alt" style="color: var(--teal-500);"></i>Where are the POS replacement docs?
        </button>
      </div>
    </div>
  `;
}

/**
 * Conversation view: messages + typing indicator
 */
function renderConversation(state) {
  return `
    <div class="grounding-strip">
      <i class="bi bi-stars" style="color: var(--teal-500);"></i>
      Grounded on <strong>${escapeHtml(state.currentSpace?.name)}</strong>
    </div>
    <div class="conversation">
      ${state.messages.map((msg) => renderMessage(msg)).join('')}
      ${state.isTyping ? `
        <div class="message assistant-message">
          <div class="avatar"><i class="bi bi-stars" style="color: var(--teal-500);"></i></div>
          <div class="assistant-bubble">
            <div class="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      ` : ''}
    </div>
    ${state.messages.length > 0 && state.messages[state.messages.length - 1].role === 'assistant' && !state.isTyping ? renderFollowUpChips(state) : ''}
  `;
}

/**
 * Render a single message (user or assistant)
 */
function renderMessage(msg) {
  if (msg.role === 'user') {
    return `
      <div class="bubble user-bubble">
        ${escapeHtml(msg.text)}
      </div>
    `;
  }

  // Assistant message with sources
  return `
    <div class="message assistant-message">
      <div class="avatar"><i class="bi bi-stars" style="color: var(--teal-500);"></i></div>
      <div class="assistant-bubble">
        ${renderMarkdown(msg.text)}
        ${msg.citations && msg.citations.length > 0 ? `
          <div class="sources">
            <div class="eyebrow">${msg.citations.length} SOURCES</div>
            ${msg.citations
              .map(
                (citation, i) => `
              <div class="source-row" data-path="${escapeAttr(citation.path)}" data-space="${escapeAttr(citation.spaceName)}" data-title="${escapeAttr(citation.title)}" role="button" tabindex="0">
                <span class="source-num">${i + 1}</span>
                <span class="source-chip md">md</span>
                <span class="source-name">${escapeHtml(citation.title || citation.path)}</span>
                <span class="chevron">›</span>
              </div>
            `
              )
              .join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Render follow-up suggestion chips
 */
function renderFollowUpChips(state) {
  const lastMsg = state.messages[state.messages.length - 1];
  if (!lastMsg.followUps || lastMsg.followUps.length === 0) {
    return '';
  }

  return `
    <div class="follow-up-chips">
      ${lastMsg.followUps
        .map(
          (text) => `
        <button class="chip" data-text="${escapeAttr(text)}">
          ${escapeHtml(text)}
        </button>
      `
        )
        .join('')}
    </div>
  `;
}

/**
 * Setup event listeners for the Ask view
 * @param {HTMLElement} container - Container element
 * @param {Object} state - Current state
 */
export function setup(container, state) {
  // Prompt card clicks (empty state)
  container.querySelectorAll('.prompt-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const text = e.currentTarget.dataset.text;
      if (text) {
        handleAskMessage(text);
      }
    });
  });

  // Source row clicks
  container.querySelectorAll('.source-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      const path = row.dataset.path;
      const spaceName = row.dataset.space;
      const title = row.dataset.title;
      if (path && spaceName) {
        handleOpenDocument(path, spaceName, title);
      }
    });

    // Keyboard support for source rows
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        row.click();
      }
    });
  });

  // Follow-up chip clicks
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      const text = e.currentTarget.dataset.text;
      if (text) {
        handleAskMessage(text);
      }
    });
  });

  // Setup input bar (in main panel, not in content)
  const askInput = document.getElementById('ask-input');
  const sendBtn = document.getElementById('send-btn');

  if (askInput && sendBtn) {
    // Clear any previous listeners by replacing the elements
    // (This is a simple approach; could be improved with proper event delegation)

    // Handle send button click
    sendBtn.onclick = () => {
      const text = askInput.value.trim();
      if (text) {
        handleAskMessage(text);
        askInput.value = '';
        askInput.focus();
      }
    };

    // Handle Enter key in input
    askInput.onkeypress = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = askInput.value.trim();
        if (text) {
          handleAskMessage(text);
          askInput.value = '';
        }
      }
    };

    askInput.focus();
  }

  // Scroll to bottom on new message
  setTimeout(() => {
    const content = document.getElementById('content');
    if (content) {
      content.scrollTop = content.scrollHeight;
    }
  }, 100);
}

/**
 * Handle sending a message to AI
 */
async function handleAskMessage(text) {
  if (!AppState.api || !text.trim()) {
    console.warn('[Ask] No API or empty text');
    return;
  }

  const trimmedText = text.trim();

  // Add user message to state
  updateState({
    messages: [
      ...AppState.messages,
      { role: 'user', text: trimmedText },
    ],
    isTyping: true,
  });

  // Clear input bar
  const askInput = document.getElementById('ask-input');
  if (askInput) {
    askInput.value = '';
    askInput.focus();
  }

  try {
    console.log('[Ask] Calling /ai/chat/search with:', trimmedText.substring(0, 100));

    // Call the AI chat search endpoint
    const response = await AppState.api.request('/ai/chat/search', {
      method: 'POST',
      body: JSON.stringify({ message: trimmedText }),
    });

    console.log('[Ask] Response received:', {
      success: response.success,
      hasResponse: !!response.response,
      sourceCount: response.sources?.length || 0,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to get response');
    }

    // Parse the response text to extract citations and generate follow-ups
    const { textWithoutCitations, citations } = extractCitations(response.response);
    const followUps = generateFollowUpSuggestions(trimmedText, textWithoutCitations);

    // Map sources to citations
    const citationObjects = response.sources
      ? response.sources.map((source) => ({
          path: source.path,
          title: source.title || source.path,
          spaceName: source.spaceName,
        }))
      : [];

    // Add assistant message to state
    updateState({
      messages: [
        ...AppState.messages,
        {
          role: 'assistant',
          text: response.response,
          citations: citationObjects,
          followUps: followUps,
        },
      ],
      isTyping: false,
    });
  } catch (error) {
    console.error('[Ask] Error:', error.message);

    // Handle specific error types
    let errorMessage = error.message;

    if (error.message.includes('Rate limit')) {
      errorMessage = 'Rate limit exceeded. Please try again in a moment.';
    } else if (error.message.includes('not configured')) {
      errorMessage = 'AI service not configured. Please check the backend settings.';
    } else if (error.message.includes('HTTP 401')) {
      errorMessage = 'Authentication failed. Please log in again.';
    } else if (error.message.includes('HTTP 429')) {
      errorMessage = 'Too many requests. Please wait before asking again.';
    }

    // Add error message to conversation
    updateState({
      messages: [
        ...AppState.messages,
        {
          role: 'assistant',
          text: `**Error:** ${errorMessage}`,
        },
      ],
      isTyping: false,
    });
  }
}

/**
 * Handle opening a document from a source citation
 */
function handleOpenDocument(path, spaceName, title) {
  console.log('[Ask] Opening document:', { path, spaceName, title });

  // For now, just log it. Phase 6 will implement the full read view
  // Update state to show the read view
  updateState({
    view: 'doc',
    backTo: 'ask',
    openDoc: {
      path,
      spaceName,
      title: title || path,
      content: null,
      size: null,
      modifiedAt: null,
    },
  });

  // TODO: Phase 6 - Load actual document content via API
}

/**
 * Extract citations from AI response text
 * Looks for inline citations like [1], [2], etc.
 * Returns the text with citations and a list of citation numbers
 */
function extractCitations(text) {
  const citationRegex = /\[(\d+)\]/g;
  const citations = [];
  let match;

  while ((match = citationRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    if (!citations.includes(num)) {
      citations.push(num);
    }
  }

  return {
    textWithoutCitations: text,
    citations: citations,
  };
}

/**
 * Generate follow-up suggestions based on the conversation
 * For Phase 2, these are hardcoded placeholders
 * Phase 2.5 could make the API return these instead
 */
function generateFollowUpSuggestions(originalQuestion, responseText) {
  // Placeholder follow-ups based on common patterns
  const suggestions = [
    'How is this implemented?',
    'What are the benefits?',
    'Where can I learn more?',
  ];

  return suggestions;
}

/**
 * Render markdown content (basic rendering)
 * For now, just escape HTML and convert **bold** to <strong>
 * Phase 3+ could use a full markdown renderer
 */
function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Convert **text** to <strong>text</strong>
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Convert *text* to <em>text</em>
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Convert line breaks to <br>
  html = html.replace(/\n/g, '<br>');

  // Convert bullet lists: "- item" to <li>item</li>
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> tags in <ul>
  html = html.replace(/(<li>.+?<\/li>\n?)+/g, '<ul>$&</ul>');

  return html;
}

/**
 * Utility: Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Utility: Escape attribute values
 */
function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
