// Tests for Sidebar.jsx — the conversation list. Uses the real stripMarkdown
// from ../utils (pure function, no need to mock).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from './Sidebar';

function baseProps(overrides = {}) {
  return {
    conversations: [],
    currentConversationId: null,
    onSelectConversation: vi.fn(),
    onNewConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
    onRenameConversation: vi.fn(),
    isOpen: true,
    onToggle: vi.fn(),
    theme: 'dark',
    onToggleTheme: vi.fn(),
    ...overrides,
  };
}

describe('Sidebar', () => {
  it('shows the empty-state message when there are no conversations', () => {
    render(<Sidebar {...baseProps()} />);
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('renders one item per conversation, with markdown stripped from the title', () => {
    const conversations = [
      { id: 'c1', title: '**Bold** Title', created_at: '2026-05-02T12:00:00Z' },
      { id: 'c2', title: 'Plain Title', created_at: '2026-05-03T12:00:00Z' },
    ];
    render(<Sidebar {...baseProps({ conversations })} />);
    expect(screen.getByText('Bold Title')).toBeInTheDocument();
    expect(screen.getByText('Plain Title')).toBeInTheDocument();
    expect(screen.queryByText('**Bold** Title')).not.toBeInTheDocument();
  });

  it('falls back to "New Conversation" when title is empty', () => {
    const conversations = [{ id: 'c1', title: '', created_at: '2026-05-02T12:00:00Z' }];
    render(<Sidebar {...baseProps({ conversations })} />);
    expect(screen.getByText('New Conversation')).toBeInTheDocument();
  });

  it('calls onSelectConversation when a conversation item is clicked', async () => {
    const onSelectConversation = vi.fn();
    const conversations = [{ id: 'c1', title: 'One', created_at: '2026-05-02T12:00:00Z' }];
    const user = userEvent.setup();
    render(<Sidebar {...baseProps({ conversations, onSelectConversation })} />);

    await user.click(screen.getByText('One'));

    expect(onSelectConversation).toHaveBeenCalledWith('c1');
  });

  it('calls onNewConversation when "+ New Conversation" is clicked', async () => {
    const onNewConversation = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar {...baseProps({ onNewConversation })} />);

    await user.click(screen.getByRole('button', { name: /New Conversation/i }));

    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleTheme when the theme toggle button is clicked', async () => {
    const onToggleTheme = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar {...baseProps({ onToggleTheme })} />);

    await user.click(screen.getByRole('button', { name: /Switch to light theme/i }));

    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('opens the actions dropdown to reveal Rename/Delete, and Delete calls onDeleteConversation', async () => {
    const onDeleteConversation = vi.fn();
    const conversations = [{ id: 'c1', title: 'One', created_at: '2026-05-02T12:00:00Z' }];
    const user = userEvent.setup();
    render(<Sidebar {...baseProps({ conversations, onDeleteConversation })} />);

    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Conversation actions'));

    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDeleteConversation).toHaveBeenCalledWith('c1');
  });

  it('marks the current conversation as active and applies the collapsed class when isOpen is false', () => {
    const conversations = [{ id: 'c1', title: 'One', created_at: '2026-05-02T12:00:00Z' }];
    const { container } = render(
      <Sidebar {...baseProps({ conversations, currentConversationId: 'c1', isOpen: false })} />,
    );
    expect(container.querySelector('.sidebar.collapsed')).not.toBeNull();
    expect(container.querySelector('.conversation-item.active')).not.toBeNull();
  });
});
