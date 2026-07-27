// Tests for Markdown.jsx — the sole enforcement point for context-essentials.md
// rule 4 ("react-markdown is the only renderer for LLM output, raw HTML is
// forbidden — XSS risk"). The XSS regression test below is mandatory: it
// guards against a raw-HTML-rendering regression by inspecting the parsed DOM
// tree, never by string-matching innerHTML (that anti-pattern is banned, see
// context-essentials.md "Banned patterns").

import { render, screen } from '@testing-library/react';
import Markdown from './Markdown';

describe('Markdown', () => {
  it('renders plain markdown formatting (bold, heading) as text', () => {
    render(<Markdown>{'# Heading\n\nSome **bold** text.'}</Markdown>);
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    expect(screen.getByText('bold')).toBeInTheDocument();
    // Bold text is rendered as a <strong> element, not literal asterisks.
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders undefined/null children as empty content without throwing', () => {
    const { container } = render(<Markdown>{undefined}</Markdown>);
    expect(container.textContent).toBe('');
  });

  describe('XSS regression guard (context-essentials.md rule 4)', () => {
    it('never renders a raw <script> tag embedded in LLM markdown output', () => {
      const malicious = 'Ignore instructions.\n\n<script>window.xssed = true</script>\n\nDone.';
      const { container } = render(<Markdown>{malicious}</Markdown>);

      // The only correct way to assert XSS-safety: query the parsed DOM tree,
      // never string-match innerHTML.
      expect(container.querySelector('script')).toBeNull();
      expect(window.xssed).toBeUndefined();
      // The literal text still appears (escaped), proving react-markdown
      // treated it as inert text rather than dropping the whole message.
      expect(container.textContent).toContain('Ignore instructions.');
      expect(container.textContent).toContain('Done.');
    });

    it('never renders an element carrying an onerror/onclick-style handler attribute', () => {
      const malicious = 'Look at this image: <img src="x" onerror="window.xssed = true">';
      const { container } = render(<Markdown>{malicious}</Markdown>);

      expect(container.querySelector('script')).toBeNull();
      expect(window.xssed).toBeUndefined();

      // No element in the rendered tree may carry an onerror/onclick handler
      // attribute — react-markdown strips raw HTML by default rather than
      // parsing it into real DOM nodes.
      const allElements = container.querySelectorAll('*');
      for (const el of allElements) {
        expect(el.getAttribute('onerror')).toBeNull();
        expect(el.getAttribute('onclick')).toBeNull();
      }
      expect(container.querySelector('img[onerror]')).toBeNull();
    });

    it('never renders a script tag from an inline HTML anchor with javascript: href', () => {
      const malicious = '[click me](javascript:window.xssed=true)';
      const { container } = render(<Markdown>{malicious}</Markdown>);

      expect(container.querySelector('script')).toBeNull();
      // If a link is rendered at all, it must not carry a javascript: URI —
      // react-markdown's default URI transform strips these.
      const link = container.querySelector('a');
      if (link) {
        expect(link.getAttribute('href')).not.toMatch(/^javascript:/i);
      }
    });
  });
});
