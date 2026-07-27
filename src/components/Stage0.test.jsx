// Tests for Stage0.jsx — the clarification-round UI. Renders null when there
// is nothing to show, a loading spinner while questions are being generated,
// and per-question textareas with Submit/Skip actions once questions arrive.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Stage0 from './Stage0';

describe('Stage0', () => {
  it('renders nothing when there is no pending clarification and not loading', () => {
    const { container } = render(
      <Stage0 pendingClarification={null} isLoading={false} onSubmit={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading indicator while identifying clarification questions', () => {
    render(<Stage0 pendingClarification={null} isLoading={true} onSubmit={vi.fn()} />);
    expect(screen.getByText(/Identifying clarification questions/i)).toBeInTheDocument();
  });

  it('renders one question per entry with the round number and answer textareas', () => {
    const pendingClarification = {
      round: 2,
      questions: [
        { id: 'q1', text: 'Which framework?' },
        { id: 'q2', text: 'What is the deadline?' },
      ],
    };
    render(
      <Stage0
        pendingClarification={pendingClarification}
        isLoading={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/round 2/i)).toBeInTheDocument();
    expect(screen.getByText('Which framework?')).toBeInTheDocument();
    expect(screen.getByText('What is the deadline?')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText(/Your answer/i)).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Submit answers/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip/i })).toBeInTheDocument();
  });

  it('calls onSubmit with typed answers when Submit answers is clicked', async () => {
    const onSubmit = vi.fn();
    const pendingClarification = {
      round: 1,
      questions: [
        { id: 'q1', text: 'Which framework?' },
        { id: 'q2', text: 'What is the deadline?' },
      ],
    };
    const user = userEvent.setup();
    render(
      <Stage0
        pendingClarification={pendingClarification}
        isLoading={false}
        onSubmit={onSubmit}
      />,
    );

    const textareas = screen.getAllByPlaceholderText(/Your answer/i);
    await user.type(textareas[0], 'React');
    await user.type(textareas[1], 'Next week');
    await user.click(screen.getByRole('button', { name: /Submit answers/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([
      { id: 'q1', text: 'React' },
      { id: 'q2', text: 'Next week' },
    ]);
  });

  it('calls onSubmit with empty-text answers when Skip is clicked, even if text was drafted', async () => {
    const onSubmit = vi.fn();
    const pendingClarification = {
      round: 1,
      questions: [{ id: 'q1', text: 'Which framework?' }],
    };
    const user = userEvent.setup();
    render(
      <Stage0
        pendingClarification={pendingClarification}
        isLoading={false}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Your answer/i);
    await user.type(textarea, 'React');
    await user.click(screen.getByRole('button', { name: /Skip/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([{ id: 'q1', text: '' }]);
  });

  it('renders both the loading indicator and pending questions when both are provided', () => {
    render(
      <Stage0
        pendingClarification={{ round: 1, questions: [{ id: 'q1', text: 'Which framework?' }] }}
        isLoading={true}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/Identifying clarification questions/i)).toBeInTheDocument();
    expect(screen.getByText('Which framework?')).toBeInTheDocument();
  });
});
