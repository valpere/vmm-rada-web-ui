// Tests for ChatInterface.jsx — the main chat panel. Treated as an
// integration-of-props component: Stage0-3 and EmptyState are real
// (already tested elsewhere), so we assert on their surface-level rendered
// output rather than mocking them. No api.js involvement — this component is
// purely prop-driven.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatInterface from './ChatInterface';

function baseProps(overrides = {}) {
  return {
    conversation: null,
    onSendMessage: vi.fn(),
    onAnswerSubmit: vi.fn(),
    isLoading: false,
    isConversationClosed: false,
    sidebarOpen: true,
    onToggleSidebar: vi.fn(),
    ...overrides,
  };
}

function makeConversation(overrides = {}) {
  return {
    id: 'conv-1',
    title: 'A Conversation',
    messages: [],
    ...overrides,
  };
}

describe('ChatInterface', () => {
  it('shows the "select or create" placeholder when conversation is null', () => {
    render(<ChatInterface {...baseProps({ conversation: null })} />);
    expect(
      screen.getByText(/Select or create a conversation to get started/i),
    ).toBeInTheDocument();
  });

  it('renders EmptyState when the conversation has no messages yet', () => {
    render(<ChatInterface {...baseProps({ conversation: makeConversation() })} />);
    expect(screen.getByText('Explain the trolley problem')).toBeInTheDocument();
  });

  it('renders a user message via Markdown and an assistant message dispatching to Stage3', () => {
    const conversation = makeConversation({
      messages: [
        { role: 'user', content: 'Hi there' },
        {
          role: 'assistant',
          stage1: null,
          stage2: null,
          stage3: { content: 'Final answer text', model: 'openai/gpt-4o' },
          metadata: null,
          loading: {},
          error: null,
          pendingClarification: null,
        },
      ],
    });
    render(<ChatInterface {...baseProps({ conversation })} />);

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('VMM Rada')).toBeInTheDocument();
    // Stage3 surface: header + content rendered through Markdown.
    expect(screen.getByText('Final Answer')).toBeInTheDocument();
    expect(screen.getByText('Final answer text')).toBeInTheDocument();
  });

  it('renders the Stage3 error banner when an assistant message carries an error', () => {
    const conversation = makeConversation({
      messages: [
        { role: 'user', content: 'Hi there' },
        {
          role: 'assistant',
          stage1: null,
          stage2: null,
          stage3: null,
          metadata: null,
          loading: {},
          error: 'council quorum not met',
          pendingClarification: null,
        },
      ],
    });
    render(<ChatInterface {...baseProps({ conversation })} />);
    expect(screen.getByText('council quorum not met')).toBeInTheDocument();
  });

  it('shows the conversation title, stripped of markdown, in the header', () => {
    const conversation = makeConversation({ title: '**Bold** Title', messages: [] });
    render(<ChatInterface {...baseProps({ conversation })} />);
    expect(screen.getByText('Bold Title')).toBeInTheDocument();
  });

  it('calls onSendMessage with the trimmed text when the form is submitted', async () => {
    const onSendMessage = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatInterface
        {...baseProps({ conversation: makeConversation(), onSendMessage })}
      />,
    );

    const input = screen.getByPlaceholderText(/Ask a question/i);
    await user.type(input, '  What is TCP?  ');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith('What is TCP?');
  });

  it('prefixes the message with Context when the context textarea has text', async () => {
    const onSendMessage = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatInterface
        {...baseProps({ conversation: makeConversation(), onSendMessage })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Context/i }));
    const contextTextarea = screen.getByPlaceholderText(/Background information/i);
    await user.type(contextTextarea, 'Some background');

    const input = screen.getByPlaceholderText(/Ask a question/i);
    await user.type(input, 'What is TCP?');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    expect(onSendMessage).toHaveBeenCalledWith(
      'Context:\nSome background\n\nQuestion:\nWhat is TCP?',
    );
  });

  it('does not call onSendMessage when the input is only whitespace', async () => {
    const onSendMessage = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatInterface
        {...baseProps({ conversation: makeConversation(), onSendMessage })}
      />,
    );

    const input = screen.getByPlaceholderText(/Ask a question/i);
    await user.type(input, '   ');
    // Send button should be disabled for whitespace-only input.
    expect(screen.getByRole('button', { name: /Send/i })).toBeDisabled();
  });

  it('disables the input and shows "conversation has ended" when isConversationClosed', () => {
    render(
      <ChatInterface
        {...baseProps({ conversation: makeConversation(), isConversationClosed: true })}
      />,
    );
    const input = screen.getByPlaceholderText(/This conversation has ended/i);
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send/i })).toBeDisabled();
  });

  it('disables the input while isLoading is true', () => {
    render(
      <ChatInterface
        {...baseProps({ conversation: makeConversation(), isLoading: true })}
      />,
    );
    const input = screen.getByPlaceholderText(/Ask a question/i);
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send/i })).toBeDisabled();
  });

  it('swaps the placeholder to prompt for clarification answers when the last message is pending', () => {
    const conversation = makeConversation({
      messages: [
        {
          role: 'assistant',
          stage1: null,
          stage2: null,
          stage3: null,
          metadata: null,
          loading: {},
          error: null,
          pendingClarification: { round: 1, questions: [{ id: 'q1', text: 'Which framework?' }] },
        },
      ],
    });
    render(<ChatInterface {...baseProps({ conversation })} />);
    expect(
      screen.getByPlaceholderText(/Answer the questions above to continue/i),
    ).toBeInTheDocument();
    // Stage0 itself renders the question text and its own submit/skip controls.
    expect(screen.getByText('Which framework?')).toBeInTheDocument();
  });

  it('shows the sidebar-open button only when the sidebar is closed', () => {
    const { rerender } = render(
      <ChatInterface {...baseProps({ conversation: makeConversation(), sidebarOpen: true })} />,
    );
    expect(screen.queryByRole('button', { name: /Open sidebar/i })).not.toBeInTheDocument();

    rerender(
      <ChatInterface {...baseProps({ conversation: makeConversation(), sidebarOpen: false })} />,
    );
    expect(screen.getByRole('button', { name: /Open sidebar/i })).toBeInTheDocument();
  });
});
