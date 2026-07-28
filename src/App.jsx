import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api, ApiError } from './api';
import './App.css';

// isConversationClosedError reports whether an error thrown from the API
// adapter indicates the conversation was closed before this request finished.
// `error.code` is derived client-side in src/api.js from the backend's exact
// message string ("conversation is closed") — the backend has no wire-level
// code field. A prior version of this check accepted any 409 as
// conversation-closed, which misclassified the two other real 409 causes
// (no pending clarification round; round already answered) as closure too.
function isConversationClosedError(err) {
  if (!(err instanceof ApiError)) return false;
  return err.status === 409 && err.code === 'conversation_closed';
}

// Derives the Stage2 dispatcher's `kind` value from a replayed message's
// persisted shape. The backend does not persist `kind` itself, but
// Metadata's strategy-specific sub-object presence (vote_tally, rank_refine,
// debate, moa_aggregator, delphi — each `omitempty` on the backend,
// internal/council/types.go) unambiguously identifies 5 of 7 kinds
// regardless of what council_type *name* was used to register the strategy.
// A name lookup (e.g. "majority" -> "vote_tally") is not robust: the backend
// supports multiple custom-named registrations sharing one Strategy (its own
// docs give "factual-majority" and "creative-majority", both
// Strategy: Majority) — shape inference sidesteps that entirely.
//
// `peer_ranking` and `role_stub` are the two kinds with no distinguishing
// metadata sub-object — the tiebreaker is stage2 array emptiness: PeerReview
// always produces a non-empty StageTwoResult[] (every model's response gets
// peer-reviewed), RoleBased's stage2 is always `[]` (Stage 2 is skipped
// entirely for that strategy).
function deriveStage2Kind(stage2, metadata) {
  if (!metadata) return 'peer_ranking';
  if (metadata.vote_tally) return 'vote_tally';
  if (metadata.rank_refine) return 'rank_refine';
  if (metadata.debate) return 'debate_round';
  if (metadata.moa_aggregator) return 'moa_aggregator';
  if (metadata.delphi) return 'delphi_round';
  const hasRankings = Array.isArray(stage2) && stage2.length > 0;
  return hasRankings ? 'peer_ranking' : 'role_stub';
}

// normaliseStage2Kind treats null/undefined/empty/whitespace as missing and
// falls back to "peer_ranking". A non-empty value is returned as-is so the
// dispatcher routes to UnknownKindView when the backend emits a kind the
// frontend genuinely doesn't recognise.
function normaliseStage2Kind(raw) {
  const trimmed = (raw ?? '').trim();
  return trimmed || 'peer_ranking';
}

// mergeRoundIntoMessage appends a per-round event's transcript subset into the
// message's canonical metadata pointer for that strategy. Single source of
// truth: msg.metadata.<ptr>.rounds — the terminal stage2_complete overwrites
// with the canonical state, so this just keeps the live view in sync during
// streaming.
//
// Kind → metadata pointer name:
//   debate_round → metadata.debate
//   delphi_round → metadata.delphi
//
// A new pointer is created if missing; an unknown kind defaults to "debate"
// for backward compatibility (the only multi-round kind before this helper
// existed).
function mergeRoundIntoMessage(msg, event) {
  if (!msg.metadata) {
    msg.metadata = event.metadata ? { ...event.metadata } : {};
  }
  const ptrKey = event.kind === 'delphi_round' ? 'delphi' : 'debate';
  if (!msg.metadata[ptrKey]) {
    msg.metadata[ptrKey] = { rounds: [], final_round: 0 };
  }
  const incoming = event.metadata?.[ptrKey]?.rounds ?? [];
  msg.metadata[ptrKey].rounds.push(...incoming);
  msg.metadata[ptrKey].final_round = event.round ?? msg.metadata[ptrKey].rounds.length;
  // Surface the kind so the dispatcher renders the right view during streaming
  // (otherwise the view stays at peer_ranking until the terminal event).
  msg.stage2Kind = normaliseStage2Kind(event.kind);
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const toggleSidebar = () => setSidebarOpen((o) => !o);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      let pendingClarification = null;

      const messages = (conv.messages ?? [])
        .filter((msg) => {
          if (msg.role !== 'clarification') return true;
          const isPending =
            !msg.answers || msg.answers.length === 0 ||
            msg.answers.every((a) => !a.text);
          if (isPending) pendingClarification = { round: msg.round, questions: msg.questions };
          return false;
        })
        .map((msg) => {
          if (msg.role !== 'assistant') return msg;
          // AssistantMessage doesn't persist `kind` itself, so derive
          // stage2Kind from the persisted stage2/metadata shape for replay.
          return {
            loading: { stage0: false, stage1: false, stage2: false, stage3: false },
            error: null,
            pendingClarification: null,
            stage2Kind: deriveStage2Kind(msg.stage2, msg.metadata),
            ...msg,
          };
        });

      if (pendingClarification) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'assistant') {
          lastMsg.pendingClarification = pendingClarification;
        } else {
          messages.push({
            role: 'assistant',
            stage1: null, stage2: null, stage2Kind: null, stage3: null, metadata: null,
            loading: { stage0: false, stage1: false, stage2: false, stage3: false },
            error: null,
            pendingClarification,
          });
        }
      }

      setCurrentConversation({ ...conv, messages, closed: conv.closed ?? false });
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Sync currentConversation title from conversations list (updated after title_complete)
  useEffect(() => {
    if (!currentConversationId || !conversations.length) return;
    const conv = conversations.find((c) => c.id === currentConversationId);
    if (!conv?.title) return;
    setCurrentConversation((prev) => {
      if (!prev || prev.title === conv.title) return prev;
      return { ...prev, title: conv.title };
    });
  }, [conversations, currentConversationId]);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const handleNewConversation = async () => {
    const existing = conversations.find((c) => c.message_count === 0);
    if (existing) {
      setCurrentConversationId(existing.id);
      return;
    }
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      if (currentConversationId === id) {
        setCurrentConversationId(remaining.length > 0 ? remaining[0].id : null);
        if (remaining.length === 0) setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleRenameConversation = async (id, title) => {
    try {
      const result = await api.renameConversation(id, title);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: result.title } : c))
      );
      if (currentConversationId === id) {
        setCurrentConversation((prev) => prev ? { ...prev, title: result.title } : prev);
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  };

  // Returns the SSE event handlers for an active stream, sharing updateLast.
  const makeStreamHandlers = (updateLast) => ({
    stage0_round_complete: (event) => {
      updateLast((msg) => {
        msg.pendingClarification = { round: event.data.round, questions: event.data.questions };
        msg.loading.stage0 = false;
        msg.loading.stage1 = false;
      });
      setIsLoading(false);
    },
    stage1_complete: (event) => updateLast((msg) => {
      msg.stage1 = event.data;
      msg.loading.stage1 = false;
      // The backend never emits a stage2_start event — Stage 2 begins
      // immediately once Stage 1 completes (verified against handler.go's
      // sendMessageStream). Flip the spinner here instead of waiting for an
      // event that doesn't exist. stage2_complete always fires eventually,
      // even for strategies that skip real Stage 2 work (RoleBased emits an
      // immediate stub event), so this can't get stuck true.
      msg.loading.stage2 = true;
    }),
    // Per-round events from multi-round strategies (MultiAgentDebate, Delphi).
    // Single source of truth per strategy: msg.metadata.<kind-pointer>.rounds.
    // Each event APPENDS its round's transcript subset to the running list;
    // the terminal stage2_complete overwrites with the canonical state. No
    // separate `debateRounds` field — dual state is a drift hazard.
    stage2_round_complete: (event) => updateLast((msg) => mergeRoundIntoMessage(msg, event)),
    stage2_complete: (event) => updateLast((msg) => {
      msg.stage2 = event.data;
      // Treat null / undefined / empty / whitespace-only as missing and
      // fall back to "peer_ranking". Without this, an older backend or a
      // malformed event would route the dispatcher to UnknownKindView.
      msg.stage2Kind = normaliseStage2Kind(event.kind);
      // Terminal event is authoritative — overwrite metadata wholesale, which
      // includes the canonical debate transcript (with dropouts) for replay.
      msg.metadata = event.metadata;
      msg.loading.stage2 = false;
      // Same reasoning as stage1_complete above — no stage3_start event
      // exists; Stage 3 (Chairman synthesis) begins immediately.
      msg.loading.stage3 = true;
    }),
    stage3_complete: (event) => {
      updateLast((msg) => {
        msg.stage3 = event.data;
        msg.loading.stage3 = false;
      });
      setCurrentConversation((prev) => prev ? { ...prev, closed: true } : prev);
      loadConversations();
    },
    title_complete: () => loadConversations(),
    complete: () => { loadConversations(); setIsLoading(false); },
    error: (event) => {
      updateLast((msg) => {
        msg.error = event.message;
        msg.loading = { stage0: false, stage1: false, stage2: false, stage3: false };
      });
      setIsLoading(false);
    },
  });

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    try {
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      const assistantMessage = {
        role: 'assistant',
        stage1: null, stage2: null, stage2Kind: null, stage3: null, metadata: null,
        loading: { stage0: false, stage1: true, stage2: false, stage3: false },
        error: null,
        pendingClarification: null,
      };

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      const updateLast = (updater) =>
        setCurrentConversation((prev) => {
          const messages = [...prev.messages];
          updater(messages[messages.length - 1]);
          return { ...prev, messages };
        });

      const handlers = makeStreamHandlers(updateLast);
      await api.sendMessageStream(
        currentConversationId,
        { content, council_type: 'default' },
        (eventType, event) => handlers[eventType]?.(event)
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      if (isConversationClosedError(error)) {
        // 409 ErrConversationClosed: keep the messages in place, surface the
        // error on the assistant message, and mark the conversation closed so
        // the input disables. Don't roll back the optimistic user/assistant
        // pair — the user needs to see *why* their message didn't go through.
        setCurrentConversation((prev) => {
          if (!prev) return prev;
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant') {
            last.error = 'This conversation has been closed and can no longer accept messages.';
            last.loading = { stage0: false, stage1: false, stage2: false, stage3: false };
          }
          return { ...prev, messages, closed: true };
        });
      } else {
        // Any other failure: roll back the optimistic user/assistant pair.
        setCurrentConversation((prev) => ({
          ...prev,
          messages: prev.messages.slice(0, -2),
        }));
      }
      setIsLoading(false);
    }
  };

  const handleAnswerSubmit = async (answers) => {
    if (!currentConversationId) return;

    setIsLoading(true);

    // Capture the current pendingClarification before the optimistic clear
    // below, so a non-closed failure catch path can restore it — without this,
    // a network blip or round-conflict 409 during answer submission would
    // silently disappear the clarification UI with no error and no way to
    // retry (the prior code claimed to restore it but never actually did,
    // see gh#100).
    let submittedClarification = null;
    {
      const last = currentConversation?.messages?.at(-1);
      if (last?.role === 'assistant') {
        submittedClarification = last.pendingClarification ?? null;
      }
    }

    const updateLast = (updater) =>
      setCurrentConversation((prev) => {
        const messages = [...prev.messages];
        updater(messages[messages.length - 1]);
        return { ...prev, messages };
      });

    updateLast((msg) => {
      msg.pendingClarification = null;
      msg.loading.stage1 = true;
    });

    try {
      const handlers = makeStreamHandlers(updateLast);
      await api.sendMessageStream(
        currentConversationId,
        { answers },
        (eventType, event) => handlers[eventType]?.(event)
      );
    } catch (error) {
      console.error('Failed to submit answers:', error);
      if (isConversationClosedError(error)) {
        // 409 ErrConversationClosed: keep the pendingClarification cleared,
        // surface the error on the assistant message, and mark the conversation
        // closed. The user kept their answers; they need to see why the server
        // refused them.
        setCurrentConversation((prev) => {
          if (!prev) return prev;
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant') {
            last.error = 'This conversation has been closed and can no longer accept answers.';
            last.loading = { stage0: false, stage1: false, stage2: false, stage3: false };
          }
          return { ...prev, messages, closed: true };
        });
      } else {
        // Any other failure: actually restore the captured pendingClarification
        // so the user can retry through the same UI (Stage 0's question text +
        // answer textareas render again). The optimistic clearing we did above
        // is reverted, AND the user's typed answers are preserved in the
        // answer textareas (since they're already in the DOM, controlled by
        // Stage0's internal draftAnswers state — the captured
        // pendingClarification just makes Stage0 render again).
        setCurrentConversation((prev) => {
          if (!prev) return prev;
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant') {
            last.pendingClarification = submittedClarification;
            last.loading = { ...last.loading, stage0: false, stage1: false, stage2: false, stage3: false };
          }
          return { ...prev, messages };
        });
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        onAnswerSubmit={handleAnswerSubmit}
        isConversationClosed={!!currentConversation?.closed}
        isLoading={isLoading}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
    </div>
  );
}

export default App;
