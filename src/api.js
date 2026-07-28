/**
 * API client for the VMM Rada backend.
 *
 * Adapter pattern: this module is the sole point of contact between the React
 * frontend and the Go backend.  All network requests (`fetch` calls) and SSE
 * stream parsing live here.  Components and App.jsx never call `fetch` or
 * perform network requests directly — they only call methods on this `api`
 * object and receive plain JS values, or provide an `onEvent(eventType, event)`
 * callback that `sendMessageStream` calls.
 *
 * SSE boundary: `sendMessageStream` reads the raw ReadableStream and fires
 * `onEvent` once per parsed SSE data line.  App.jsx owns all state mutations
 * in response to those events; this module remains stateless.
 */

// In development the Vite dev server proxies /api → backend (see vite.config.js).
// VITE_API_BASE is only needed for production builds served from a different
// origin than the API (e.g. a CDN). Leave it unset for local development.
const API_BASE = (() => {
  const raw = import.meta.env.VITE_API_BASE;
  if (!raw || typeof raw !== 'string') {
    return ''; // relative URLs — Vite proxy in dev, same-origin in prod
  }
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed || '';
})();

// ApiError is the typed error thrown by the API adapter for non-2xx responses.
// `status` is the HTTP status code. `message` is the human-readable message
// from the backend when available, falling back to the original generic
// message. Per architectural rule 2 (adapter boundary), raw HTTP status codes
// do not leak past this module; App.jsx dispatches on `error.code` /
// `error instanceof ApiError` instead.
//
// `code` is derived entirely client-side from `message` via KNOWN_ERROR_CODES
// below — the backend has no `code` field on the wire (verified exhaustively
// against internal/api/handler.go's writeError, which only ever writes
// {"error": msg}; see docs/api-contract.md). A prior version of this class
// forwarded a nonexistent `body.code` and, when absent, treated *any* 409 as
// conversation-closed — that fallback misclassified the two other real 409
// causes ("no pending clarification round", "clarification round already
// answered") as conversation-closed too.
export class ApiError extends Error {
  constructor({ code, status, message }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// KNOWN_ERROR_CODES maps the backend's exact error message strings (the only
// thing it actually sends — no code field exists) to a stable client-side
// code, so callers don't have to match on message text themselves. Backend
// source: internal/api/handler.go, writeError call sites.
// A Map (not a plain object) — the lookup key comes from the backend
// response body, and a plain object's inherited properties (`__proto__`,
// `constructor`, etc.) would resolve to a truthy non-string value for those
// keys instead of the intended "unrecognised" case.
const KNOWN_ERROR_CODES = new Map([
  ['conversation is closed', 'conversation_closed'],
  ['no pending clarification round', 'no_pending_clarification_round'],
  ['clarification round already answered', 'clarification_round_already_answered'],
]);

// buildErrorForResponse reads the JSON body (if any) for a non-2xx response
// and returns a typed ApiError. writeError always writes a body
// ({"error": msg}, unconditionally, for every error path on the backend) —
// there is no real empty-body case to guard against, so unlike a prior
// version of this function, no status-based fallback is needed: an
// unrecognised message simply gets `code: null`, and callers that only
// handle specific codes correctly fall through to their generic path.
async function buildErrorForResponse(response, genericMessage) {
  let backendMessage;
  try {
    const body = await response.json();
    if (body && typeof body === 'object' && typeof body.error === 'string') {
      backendMessage = body.error;
    }
  } catch {
    // body was not JSON or unreadable — fall back to generic message
  }
  const message = backendMessage ?? genericMessage;
  return new ApiError({
    code: KNOWN_ERROR_CODES.get(message) ?? null,
    status: response.status,
    message,
  });
}

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw await buildErrorForResponse(response, 'Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw await buildErrorForResponse(response, 'Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw await buildErrorForResponse(response, 'Failed to get conversation');
    }
    return response.json();
  },

  async deleteConversation(conversationId) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw await buildErrorForResponse(response, 'Failed to delete conversation');
    }
  },

  async renameConversation(conversationId, title) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw await buildErrorForResponse(response, 'Failed to rename conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw await buildErrorForResponse(response, 'Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message or clarification answers and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {Object} body - `{content, council_type}` for a new message, or `{answers:[...]}` for a clarification round
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, body, onEvent) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw await buildErrorForResponse(response, 'Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      // On done, flush the decoder; otherwise decode with stream:true to
      // handle multi-byte characters split across chunk boundaries.
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // When not done, keep the last (potentially incomplete) line in the
      // buffer. When done, process everything (no more chunks will arrive).
      buffer = done ? '' : lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }

      if (done) break;
    }
  },
};
