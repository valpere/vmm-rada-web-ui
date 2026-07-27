// Tests for utils.js — pure functions, no React involved.

import { stripMarkdown } from './utils';

describe('stripMarkdown', () => {
  it('strips **bold** markers', () => {
    expect(stripMarkdown('This is **bold** text.')).toBe('This is bold text.');
  });

  it('strips *italic* markers', () => {
    expect(stripMarkdown('This is *italic* text.')).toBe('This is italic text.');
  });

  it('strips __bold__ markers', () => {
    expect(stripMarkdown('This is __bold__ text.')).toBe('This is bold text.');
  });

  it('strips _italic_ markers', () => {
    expect(stripMarkdown('This is _italic_ text.')).toBe('This is italic text.');
  });

  it('strips `code` markers', () => {
    expect(stripMarkdown('Run `npm test` now.')).toBe('Run npm test now.');
  });

  it('strips leading # heading markers', () => {
    expect(stripMarkdown('# Heading One')).toBe('Heading One');
    expect(stripMarkdown('### Heading Three')).toBe('Heading Three');
  });

  it('strips heading markers on multiple lines', () => {
    expect(stripMarkdown('# Title\n## Subtitle\nBody text')).toBe(
      'Title\nSubtitle\nBody text',
    );
  });

  it('strips a combination of markdown patterns in a single string', () => {
    expect(stripMarkdown('# Title\n**bold** and _italic_ and `code`')).toBe(
      'Title\nbold and italic and code',
    );
  });

  it('returns plain text unchanged when there is no markdown', () => {
    expect(stripMarkdown('Just plain text.')).toBe('Just plain text.');
  });

  it('returns an empty string unchanged', () => {
    expect(stripMarkdown('')).toBe('');
  });
});
