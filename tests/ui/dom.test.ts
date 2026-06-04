import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCanvasById,
  getButtonById,
  getElementById,
  DomLookupError,
} from '../../src/ui/dom';

describe('ui/dom helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('getElementById', () => {
    it('returns the matching element when it exists and is the expected tag', () => {
      const div = document.createElement('div');
      div.id = 'thing';
      document.body.appendChild(div);

      const el = getElementById('thing', HTMLDivElement);
      expect(el).toBe(div);
    });

    it('throws a DomLookupError when no element with that id exists', () => {
      expect(() => getElementById('missing', HTMLDivElement)).toThrow(DomLookupError);
      expect(() => getElementById('missing', HTMLDivElement)).toThrow(/missing/);
    });

    it('throws a DomLookupError when the element exists but is the wrong tag', () => {
      const span = document.createElement('span');
      span.id = 'wrong';
      document.body.appendChild(span);

      expect(() => getElementById('wrong', HTMLCanvasElement)).toThrow(DomLookupError);
    });
  });

  describe('getCanvasById', () => {
    it('returns an HTMLCanvasElement when present', () => {
      const c = document.createElement('canvas');
      c.id = 'pixi-canvas';
      document.body.appendChild(c);

      const found = getCanvasById('pixi-canvas');
      expect(found).toBe(c);
      expect(found).toBeInstanceOf(HTMLCanvasElement);
    });

    it('throws when the id resolves to a non-canvas element', () => {
      const div = document.createElement('div');
      div.id = 'not-a-canvas';
      document.body.appendChild(div);

      expect(() => getCanvasById('not-a-canvas')).toThrow(DomLookupError);
    });

    it('throws when no element with the id exists', () => {
      expect(() => getCanvasById('nope')).toThrow(DomLookupError);
    });
  });

  describe('getButtonById', () => {
    it('returns an HTMLButtonElement when present', () => {
      const b = document.createElement('button');
      b.id = 'go';
      document.body.appendChild(b);

      const found = getButtonById('go');
      expect(found).toBe(b);
      expect(found).toBeInstanceOf(HTMLButtonElement);
    });

    it('throws when the id resolves to a non-button element', () => {
      const div = document.createElement('div');
      div.id = 'pretend-button';
      document.body.appendChild(div);

      expect(() => getButtonById('pretend-button')).toThrow(DomLookupError);
    });

    it('throws when no element with the id exists', () => {
      expect(() => getButtonById('missing-button')).toThrow(DomLookupError);
    });
  });

  describe('DomLookupError', () => {
    it('is an Error subclass with a name set', () => {
      const err = new DomLookupError('boom');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('DomLookupError');
      expect(err.message).toBe('boom');
    });
  });
});
