// Tests for the App.jsx state machine.
//
// App.jsx owns all SSE event routing and the conversation-closure flag. These
// tests mock the `./api` module entirely, then drive a synthetic event stream
// through the `onEvent` callback and assert the resulting UI/prop state.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { ApiError } from './api';

// Hoisted mock factory — vi.mock is hoisted above imports, so the spies it
// references must be hoisted too. ApiError is re-exported as a real class so
// `instanceof ApiError` works inside App.jsx when the test rejects with one.
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    sendMessage: vi.fn(),
    sendMessageStream: vi.fn(),
  },
}));

vi.mock('./api', async () => {
  const actual = await vi.importActual('./api');
  return { api: mockApi, ApiError: actual.ApiError };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeConversation(overrides = {}) {
  return {
    id: 'conv-1',
    title: 'Test Conversation',
    created_at: '2026-05-02T12:00:00Z',
    closed: false,
    messages: [],
    ...overrides,
  };
}

// scriptedStream returns a sendMessageStream stub that synchronously fires the
// given events through the onEvent callback, then resolves.
function scriptedStream(events) {
  return async (_id, _body, onEvent) => {
    for (const [type, payload] of events) {
      onEvent(type, payload);
    }
  };
}

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  // localStorage is jsdom-backed; clear so theme reads fresh.
  localStorage.clear();
});

// ── rendering bootstrapping ────────────────────────────────────────────────

describe('App initial mount', () => {
  it('lists conversations on mount and renders the empty selector', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);

    render(<App />);

    await waitFor(() => expect(mockApi.listConversations).toHaveBeenCalled());
    // Empty-state copy shown until a conversation is selected.
    expect(
      await screen.findByText(/Select or create a conversation/i),
    ).toBeInTheDocument();
  });
});

// ── stage3_complete sets closed: true ──────────────────────────────────────

describe('SSE handler: stage3_complete', () => {
  it('marks the conversation as closed and disables ChatInterface input', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(makeConversation());
    mockApi.createConversation.mockResolvedValue({
      id: 'conv-2',
      title: 'New',
      created_at: '2026-05-02T12:00:00Z',
    });
    mockApi.sendMessageStream.mockImplementation(
      scriptedStream([
        ['stage1_complete', { type: 'stage1_complete', data: [{ label: 'A' }] }],
        [
          'stage2_complete',
          {
            type: 'stage2_complete',
            data: [],
            metadata: { label_to_model: {}, aggregate_rankings: [], consensus_w: 1 },
          },
        ],
        [
          'stage3_complete',
          {
            type: 'stage3_complete',
            data: { content: 'final answer', model: 'openai/gpt-4o-mini' },
          },
        ],
      ]),
    );

    const user = userEvent.setup();
    render(<App />);

    // Pick the existing conversation so a ChatInterface mounts.
    const sidebarItem = await screen.findByRole('button', { name: /One/ });
    await user.click(sidebarItem);

    // Wait for the input to be enabled before typing.
    const input = await screen.findByPlaceholderText(/Ask a question/i);
    await waitFor(() => expect(input).not.toBeDisabled());

    await user.type(input, 'hello');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    // After the scripted stage3_complete fires, the input should be disabled
    // because App sets currentConversation.closed = true.
    await waitFor(() => {
      const closedInput = screen.getByPlaceholderText(/conversation has ended/i);
      expect(closedInput).toBeDisabled();
    });
  });
});

// ── stage0_round_complete populates pendingClarification ───────────────────

describe('SSE handler: stage0_round_complete', () => {
  it('populates pendingClarification and clears stage0/stage1 loading flags', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(makeConversation());
    mockApi.sendMessageStream.mockImplementation(
      scriptedStream([
        [
          'stage0_round_complete',
          {
            type: 'stage0_round_complete',
            data: {
              round: 1,
              questions: [{ id: 'q1', text: 'Which framework?' }],
            },
          },
        ],
      ]),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /One/ }));

    const input = await screen.findByPlaceholderText(/Ask a question/i);
    await waitFor(() => expect(input).not.toBeDisabled());

    await user.type(input, 'help me');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    // Once stage0_round_complete is processed, ChatInterface swaps the input
    // placeholder to the "Answer the questions above…" copy.
    expect(
      await screen.findByPlaceholderText(/Answer the questions above/i),
    ).toBeInTheDocument();
    // The clarification question text appears in the assistant-message area.
    expect(await screen.findByText(/Which framework\?/)).toBeInTheDocument();
  });
});

// ── error handler clears loading and surfaces the message ──────────────────

describe('SSE handler: error', () => {
  it('renders the error message when the stream emits a typed error event', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(makeConversation());
    mockApi.sendMessageStream.mockImplementation(
      scriptedStream([['error', { type: 'error', message: 'council quorum not met' }]]),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /One/ }));

    const input = await screen.findByPlaceholderText(/Ask a question/i);
    await waitFor(() => expect(input).not.toBeDisabled());

    await user.type(input, 'hi');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    // The error text appears via the Stage3 error renderer.
    expect(await screen.findByText(/council quorum not met/i)).toBeInTheDocument();
    // Input must come back online (loading flags all cleared).
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Ask a question/i)).not.toBeDisabled(),
    );
  });
});

// ── isConversationClosed prop propagation on load ──────────────────────────

describe('loadConversation propagates closed flag', () => {
  it('disables the input when the loaded conversation has closed: true', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'Closed One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(
      makeConversation({ closed: true, messages: [] }),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Closed One/ }));

    // The closed-state placeholder should appear without any send action.
    const input = await screen.findByPlaceholderText(/conversation has ended/i);
    expect(input).toBeDisabled();
    // Send button is disabled too.
    const sendBtn = screen.getByRole('button', { name: /Send/i });
    expect(sendBtn).toBeDisabled();
  });

  it('keeps the input enabled when closed is false (default)', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'Open One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(
      makeConversation({ closed: false }),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Open One/ }));

    const input = await screen.findByPlaceholderText(/Ask a question/i);
    await waitFor(() => expect(input).not.toBeDisabled());
  });
});

// ── 409 ErrConversationClosed catch paths ─────────────────────────────────
// Per backend vmm-rada@0aa5178 (PR #310), submitting a message or clarification
// answers to a closed conversation returns 409 with
// `code: ErrConversationClosed`. App.jsx must surface this as a typed error on
// the assistant message and mark the conversation closed, instead of rolling
// back the optimistic user/assistant pair.

describe('409 ErrConversationClosed on handleSendMessage', () => {
  it('surfaces the typed error on the assistant message and marks closed', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(makeConversation());
    mockApi.sendMessageStream.mockRejectedValueOnce(
      new ApiError({ code: 'ErrConversationClosed', status: 409, message: 'conversation closed' }),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /One/ }));

    const input = await screen.findByPlaceholderText(/Ask a question/i);
    await waitFor(() => expect(input).not.toBeDisabled());

    await user.type(input, 'hello');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    // Friendly, actionable error rendered (not the generic "Failed to send").
    expect(
      await screen.findByText(/This conversation has been closed/i),
    ).toBeInTheDocument();
    // Conversation marked closed: input now disables with the closed-state copy.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/conversation has ended/i)).toBeDisabled(),
    );
  });

  it('rolls back the optimistic messages on a non-409 error', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(makeConversation());
    mockApi.sendMessageStream.mockRejectedValueOnce(
      new Error('network blip'),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /One/ }));

    const input = await screen.findByPlaceholderText(/Ask a question/i);
    await waitFor(() => expect(input).not.toBeDisabled());

    await user.type(input, 'hello');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    // On a non-409 failure, the optimistic user + assistant pair is rolled
    // back, so the "closed conversation" copy never appears.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Ask a question/i)).not.toBeDisabled(),
    );
    expect(
      screen.queryByText(/This conversation has been closed/i),
    ).not.toBeInTheDocument();
  });
});

describe('409 ErrConversationClosed on handleAnswerSubmit', () => {
  it('surfaces the typed error on the assistant message and marks closed', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(makeConversation());
    mockApi.sendMessageStream
      // First call: trigger a Stage 0 clarification round.
      .mockImplementationOnce(
        scriptedStream([
          [
            'stage0_round_complete',
            {
              type: 'stage0_round_complete',
              data: {
                round: 1,
                questions: [{ id: 'q1', text: 'Which framework?' }],
              },
            },
          ],
        ]),
      )
      // Second call: the user submits answers, conversation is now closed.
      .mockRejectedValueOnce(
        new ApiError({ code: 'ErrConversationClosed', status: 409, message: 'conversation closed' }),
      );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /One/ }));

    const input = await screen.findByPlaceholderText(/Ask a question/i);
    await waitFor(() => expect(input).not.toBeDisabled());

    // Send a question — this drives Stage 0 round 1.
    await user.type(input, 'help me choose');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    // Now Stage 0 has produced a pending clarification; Stage 0 renders its own
    // answer textarea and submit button (separate from ChatInterface's bottom
    // "Ask a question…" form, which is informational when a clarification is
    // pending).
    const answerTextarea = await screen.findByPlaceholderText(/Your answer/i);
    await user.type(answerTextarea, 'react');
    await user.click(screen.getByRole('button', { name: /Submit answers/i }));

    // 409 catch path: friendly error + conversation closed.
    expect(
      await screen.findByText(/This conversation has been closed/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/conversation has ended/i)).toBeDisabled(),
    );
  });
});

// ── deriveStage2Kind on replay (loadConversation) ───────────────────────────
// AssistantMessage doesn't persist `kind` itself (confirmed against backend
// source — see docs/api-contract.md). App.jsx must infer it from the
// persisted stage2/metadata shape. Regression coverage for gh#94: a prior
// implementation collapsed every non-default council_type to "peer_ranking"
// on replay, mis-rendering 6 of 7 strategies after a page reload.

describe('loadConversation derives stage2Kind from persisted shape', () => {
  it('renders RoleView (not PeerRankingView) for a replayed role_stub conversation', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(
      makeConversation({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            stage1: [
              { label: 'Creator', model: 'openai/gpt-4o', content: 'creator answer' },
              { label: 'Critic', model: 'anthropic/claude-sonnet-4-5', content: 'critic answer' },
            ],
            // role_stub: stage2 is always empty and metadata carries no
            // strategy-specific sub-object — the same shape a naive
            // council_type-name lookup can't distinguish from peer_ranking.
            stage2: [],
            stage3: { content: 'final', model: 'openai/gpt-4o' },
            metadata: { council_type: 'role-based', aggregate_rankings: [], consensus_w: 1.0 },
          },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /One/ }));

    expect(await screen.findByText(/Stage 2: Role Perspectives/i)).toBeInTheDocument();
    expect(screen.queryByText(/Stage 2: Peer Rankings/i)).not.toBeInTheDocument();
  });

  it('renders PeerRankingView for a replayed peer_ranking conversation (non-empty stage2)', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(
      makeConversation({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            stage1: [{ label: 'Response A', model: 'openai/gpt-4o', content: 'answer a' }],
            stage2: [{ reviewer_label: 'Response A', rankings: ['Response A'] }],
            stage3: { content: 'final', model: 'openai/gpt-4o' },
            metadata: {
              council_type: 'default',
              label_to_model: { 'Response A': 'openai/gpt-4o' },
              aggregate_rankings: [{ model: 'openai/gpt-4o', score: 1.0 }],
              consensus_w: 1.0,
            },
          },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /One/ }));

    expect(await screen.findByText(/Stage 2: Peer Rankings/i)).toBeInTheDocument();
  });

  it('renders VoteTallyView for a replayed custom-named Majority registration', async () => {
    // Regression guard for the specific gap gh#94 was filed about: a
    // council_type *name* lookup breaks on custom-named registrations
    // sharing a strategy (backend docs example: "factual-majority" /
    // "creative-majority" both Strategy: Majority). Shape inference doesn't
    // care what the name is.
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(
      makeConversation({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            stage1: [{ label: 'Response A', model: 'openai/gpt-4o', content: 'answer a' }],
            stage2: [],
            stage3: { content: 'final', model: 'openai/gpt-4o' },
            metadata: {
              council_type: 'factual-majority',
              aggregate_rankings: [],
              consensus_w: 0,
              vote_tally: {
                winner_label: 'Response A',
                clusters: [{ members: ['Response A'], representative: 'answer a', votes: 1 }],
              },
            },
          },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /One/ }));

    expect(await screen.findByText(/Stage 2: Vote Tally/i)).toBeInTheDocument();
  });

  it('renders DebateView for a replayed MultiAgentDebate conversation', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(
      makeConversation({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            stage1: [{ label: 'Response A', model: 'openai/gpt-4o', content: 'answer a' }],
            stage2: [],
            stage3: { content: 'final', model: 'openai/gpt-4o' },
            metadata: {
              council_type: 'debate',
              aggregate_rankings: [],
              consensus_w: 0,
              debate: {
                rounds: [{ round: 1, revisions: [{ label: 'Response A', content: 'revision 1' }] }],
                final_round: 1,
              },
            },
          },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /One/ }));

    expect(await screen.findByText(/Stage 2: Debate/i)).toBeInTheDocument();
  });

  it('falls back to peer_ranking when metadata is entirely absent (old-backend safety net)', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'conv-1', title: 'One', created_at: '2026-05-02T12:00:00Z' },
    ]);
    mockApi.getConversation.mockResolvedValue(
      makeConversation({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            stage1: [{ label: 'Response A', model: 'openai/gpt-4o', content: 'answer a' }],
            stage2: [{ reviewer_label: 'Response A', rankings: ['Response A'] }],
            stage3: { content: 'final', model: 'openai/gpt-4o' },
            metadata: null,
          },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /One/ }));

    expect(await screen.findByText(/Stage 2: Peer Rankings/i)).toBeInTheDocument();
  });
});
