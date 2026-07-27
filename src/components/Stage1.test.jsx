// Tests for Stage1.jsx — the individual-responses accordion. Follows the same
// dispatcher/accordion test pattern used in Stage2.test.jsx: render, expand
// the accordion, switch tabs, verify per-response content.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Stage1 from './Stage1';

describe('Stage1', () => {
  it('renders nothing when not loading and there are no responses', () => {
    const { container } = render(<Stage1 responses={[]} isLoading={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when responses is undefined and not loading', () => {
    const { container } = render(<Stage1 responses={undefined} isLoading={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading state while collecting responses', () => {
    render(<Stage1 responses={[]} isLoading={true} />);
    expect(screen.getByText(/Collecting individual responses/i)).toBeInTheDocument();
  });

  it('shows the collapsed accordion header with a model count once responses arrive', () => {
    const responses = [
      { model: 'openai/gpt-4o', content: 'answer one' },
      { model: 'anthropic/claude-sonnet-4-5', content: 'answer two' },
    ];
    render(<Stage1 responses={responses} isLoading={false} />);
    expect(screen.getByText(/Stage 1: Individual Responses \(2 models\)/i)).toBeInTheDocument();
    // Collapsed by default: tab content not shown yet.
    expect(screen.queryByText('answer one')).not.toBeInTheDocument();
  });

  it('uses singular "model" wording for exactly one response', () => {
    render(
      <Stage1
        responses={[{ model: 'openai/gpt-4o', content: 'solo answer' }]}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/Stage 1: Individual Responses \(1 model\)/i)).toBeInTheDocument();
  });

  it('expands on click to show tabs and the first response by default', async () => {
    const responses = [
      { model: 'openai/gpt-4o', content: 'answer one' },
      { model: 'anthropic/claude-sonnet-4-5', content: 'answer two' },
    ];
    const user = userEvent.setup();
    render(<Stage1 responses={responses} isLoading={false} />);

    const accordionButton = screen.getByRole('button', {
      name: /Stage 1: Individual Responses/i,
    });
    expect(accordionButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(accordionButton);

    expect(accordionButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('answer one')).toBeInTheDocument();
    expect(screen.getByText('openai/gpt-4o')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'gpt-4o' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'claude-sonnet-4-5' })).toBeInTheDocument();
  });

  it('switches tabs to show the selected model response, and can collapse again', async () => {
    const responses = [
      { model: 'openai/gpt-4o', content: 'answer one' },
      { model: 'anthropic/claude-sonnet-4-5', content: 'answer two' },
    ];
    const user = userEvent.setup();
    render(<Stage1 responses={responses} isLoading={false} />);

    await user.click(screen.getByRole('button', { name: /Stage 1: Individual Responses/i }));
    await user.click(screen.getByRole('button', { name: 'claude-sonnet-4-5' }));

    expect(screen.getByText('answer two')).toBeInTheDocument();
    expect(screen.queryByText('answer one')).not.toBeInTheDocument();
    expect(screen.getByText('anthropic/claude-sonnet-4-5')).toBeInTheDocument();

    // Collapse again — tab content should disappear.
    await user.click(screen.getByRole('button', { name: /Stage 1: Individual Responses/i }));
    expect(screen.queryByText('answer two')).not.toBeInTheDocument();
  });

  it('falls back to the full model string for a tab label when there is no slash', async () => {
    const user = userEvent.setup();
    render(
      <Stage1
        responses={[{ model: 'localmodel', content: 'local answer' }]}
        isLoading={false}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /Stage 1: Individual Responses/i }),
    );
    expect(screen.getByRole('button', { name: 'localmodel' })).toBeInTheDocument();
    expect(screen.getByText('local answer')).toBeInTheDocument();
  });
});
