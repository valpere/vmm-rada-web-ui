// Tests for Stage3.jsx — the final-answer / error display. Renders null when
// there is nothing to show; otherwise shows the model name (short form) and
// content via Markdown, or an error banner when `error` is set.

import { render, screen } from '@testing-library/react';
import Stage3 from './Stage3';

describe('Stage3', () => {
  it('renders nothing when both finalResponse and error are falsy', () => {
    const { container } = render(<Stage3 finalResponse={null} error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the final answer content and the short model name', () => {
    render(
      <Stage3
        finalResponse={{ content: 'The **final** answer.', model: 'openai/gpt-4o-mini' }}
        error={null}
      />,
    );
    expect(screen.getByText(/Final Answer/i)).toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('final')).toBeInTheDocument();
  });

  it('falls back to the full model string when there is no slash-separated short form', () => {
    render(
      <Stage3
        finalResponse={{ content: 'answer text', model: 'localmodel' }}
        error={null}
      />,
    );
    expect(screen.getByText('localmodel')).toBeInTheDocument();
  });

  it('renders the error banner instead of content when error is set', () => {
    render(
      <Stage3
        finalResponse={null}
        error="council quorum not met"
      />,
    );
    expect(screen.getByText('council quorum not met')).toBeInTheDocument();
    expect(screen.getByText(/Final Answer/i)).toBeInTheDocument();
  });

  it('does not render a model badge when finalResponse is absent, even with an error', () => {
    const { container } = render(<Stage3 finalResponse={null} error="boom" />);
    expect(container.querySelector('.stage3-model')).toBeNull();
  });
});
