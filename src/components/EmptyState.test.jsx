// Tests for EmptyState.jsx — pure presentational component with 4 suggested
// prompt chips.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from './EmptyState';

const PROMPTS = [
  'Explain the trolley problem',
  'How does TCP differ from UDP?',
  'What is quantum entanglement?',
  'Compare merge sort and quicksort',
];

describe('EmptyState', () => {
  it('renders all 4 suggested-prompt buttons', () => {
    render(<EmptyState onSendMessage={vi.fn()} isLoading={false} />);
    for (const prompt of PROMPTS) {
      expect(screen.getByRole('button', { name: prompt })).toBeInTheDocument();
    }
  });

  it('calls onSendMessage with the prompt text when a chip is clicked', async () => {
    const onSendMessage = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState onSendMessage={onSendMessage} isLoading={false} />);

    await user.click(screen.getByRole('button', { name: PROMPTS[1] }));

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith(PROMPTS[1]);
  });

  it('disables all prompt chips while isLoading is true', () => {
    render(<EmptyState onSendMessage={vi.fn()} isLoading={true} />);
    for (const prompt of PROMPTS) {
      expect(screen.getByRole('button', { name: prompt })).toBeDisabled();
    }
  });

  it('enables all prompt chips when isLoading is false', () => {
    render(<EmptyState onSendMessage={vi.fn()} isLoading={false} />);
    for (const prompt of PROMPTS) {
      expect(screen.getByRole('button', { name: prompt })).not.toBeDisabled();
    }
  });
});
