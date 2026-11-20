/**
 * Client-frame parsing for the chat transport — in particular the image
 * attachments, which are the one place a client frame carries bulk untrusted
 * payload straight into the agent's stdin.
 */
import { describe, expect, it } from 'vitest';

import {
  parseChatClientMessage,
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BASE64_CHARS,
} from './chat-protocol.js';

const frame = (v: unknown): string => JSON.stringify(v);
const img = (over: Record<string, unknown> = {}) => ({ mediaType: 'image/png', data: 'aGk=', ...over });

describe('parseChatClientMessage', () => {
  it('parses a plain user message', () => {
    expect(parseChatClientMessage(frame({ type: 'user', text: 'hi' }))).toEqual({
      type: 'user',
      text: 'hi',
    });
  });

  it('parses an interrupt frame', () => {
    expect(parseChatClientMessage(frame({ type: 'interrupt' }))).toEqual({ type: 'interrupt' });
  });

  it('rejects junk and unknown types', () => {
    expect(parseChatClientMessage('not json')).toBeNull();
    expect(parseChatClientMessage(frame({ type: 'user' }))).toBeNull(); // no text
    expect(parseChatClientMessage(frame({ type: 'nope' }))).toBeNull();
  });

  it('parses attached images', () => {
    const msg = parseChatClientMessage(frame({ type: 'user', text: 'lihat ini', images: [img()] }));
    expect(msg).toEqual({ type: 'user', text: 'lihat ini', images: [{ mediaType: 'image/png', data: 'aGk=' }] });
  });

  it('omits `images` entirely when none survive, rather than sending an empty array', () => {
    const msg = parseChatClientMessage(frame({ type: 'user', text: 'hi', images: [] }));
    expect(msg).toEqual({ type: 'user', text: 'hi' });
    expect(msg && 'images' in msg).toBe(false);
  });

  // The text is what the user actually typed — a bad attachment must never cost
  // them their sentence, so bad entries drop and the message survives.
  it('drops unsupported media types but keeps the message', () => {
    const msg = parseChatClientMessage(
      frame({ type: 'user', text: 'hi', images: [img({ mediaType: 'image/svg+xml' }), img()] }),
    );
    expect(msg).toEqual({ type: 'user', text: 'hi', images: [{ mediaType: 'image/png', data: 'aGk=' }] });
  });

  it('drops oversized images but keeps the message', () => {
    const huge = img({ data: 'a'.repeat(MAX_IMAGE_BASE64_CHARS + 1) });
    const msg = parseChatClientMessage(frame({ type: 'user', text: 'hi', images: [huge] }));
    expect(msg).toEqual({ type: 'user', text: 'hi' });
  });

  it('drops malformed entries (missing data, wrong type, null)', () => {
    const msg = parseChatClientMessage(
      frame({
        type: 'user',
        text: 'hi',
        images: [null, 'nope', { mediaType: 'image/png' }, img({ data: '' }), img({ data: 42 })],
      }),
    );
    expect(msg).toEqual({ type: 'user', text: 'hi' });
  });

  it('caps the image count', () => {
    const many = Array.from({ length: MAX_IMAGES_PER_MESSAGE + 5 }, () => img());
    const msg = parseChatClientMessage(frame({ type: 'user', text: 'hi', images: many }));
    expect(msg && 'images' in msg && msg.images?.length).toBe(MAX_IMAGES_PER_MESSAGE);
  });

  it('ignores a non-array `images`', () => {
    const msg = parseChatClientMessage(frame({ type: 'user', text: 'hi', images: 'png' }));
    expect(msg).toEqual({ type: 'user', text: 'hi' });
  });
});
