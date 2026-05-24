import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import {
  attachSpecInteractions,
  findDescendantByName,
  makeInteractive,
  type InteractionStatusEvent,
} from '../../src/pixi/scene-builder';
import { buildInitialScene } from '../../src/pixi/initial-scene';
import { createStatusReporter, formatStatus } from '../../src/ui/status';

function getNamedChild<T extends Container | Graphics>(root: Container, name: string): T {
  const found = findDescendantByName(root, name);
  if (!found) throw new Error(`expected node "${name}" in scene`);
  return found as unknown as T;
}

describe('attachSpecInteractions', () => {
  it('sets eventMode="static" on g1 and g2 (the interactive spec objects)', () => {
    const root = buildInitialScene();
    attachSpecInteractions(root);

    expect(getNamedChild(root, 'g1').eventMode).toBe('static');
    expect(getNamedChild(root, 'g2').eventMode).toBe('static');
  });

  it('leaves g3/g4 with their default eventMode (Task 11 only wires the spec pair)', () => {
    const root = buildInitialScene();
    const defaultG3 = getNamedChild(root, 'g3').eventMode;
    const defaultG4 = getNamedChild(root, 'g4').eventMode;

    attachSpecInteractions(root);

    expect(getNamedChild(root, 'g3').eventMode).toBe(defaultG3);
    expect(getNamedChild(root, 'g4').eventMode).toBe(defaultG4);
  });

  it('logs "g1 pointerdown!" verbatim when g1 emits pointerdown', () => {
    const root = buildInitialScene();
    const logger = vi.fn();
    attachSpecInteractions(root, { logger });

    getNamedChild<Graphics>(root, 'g1').emit('pointerdown', {} as never);

    expect(logger).toHaveBeenCalledWith('g1 pointerdown!');
  });

  it('logs "g2 pointerup!" verbatim when g2 emits pointerup', () => {
    const root = buildInitialScene();
    const logger = vi.fn();
    attachSpecInteractions(root, { logger });

    getNamedChild<Graphics>(root, 'g2').emit('pointerup', {} as never);

    expect(logger).toHaveBeenCalledWith('g2 pointerup!');
  });

  it('does NOT fire g2 handler on pointerdown (spec only binds g2 to pointerup)', () => {
    const root = buildInitialScene();
    const logger = vi.fn();
    attachSpecInteractions(root, { logger });

    getNamedChild<Graphics>(root, 'g2').emit('pointerdown', {} as never);

    expect(logger).not.toHaveBeenCalled();
  });

  it('does NOT fire g1 handler on pointerup (spec only binds g1 to pointerdown)', () => {
    const root = buildInitialScene();
    const logger = vi.fn();
    attachSpecInteractions(root, { logger });

    getNamedChild<Graphics>(root, 'g1').emit('pointerup', {} as never);

    expect(logger).not.toHaveBeenCalled();
  });

  it('invokes onEvent with the matched object name and event kind', () => {
    const root = buildInitialScene();
    const onEvent = vi.fn();
    attachSpecInteractions(root, { logger: () => {}, onEvent });

    getNamedChild<Graphics>(root, 'g1').emit('pointerdown', {} as never);
    getNamedChild<Graphics>(root, 'g2').emit('pointerup', {} as never);

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      objectName: 'g1',
      eventKind: 'pointerdown',
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      objectName: 'g2',
      eventKind: 'pointerup',
    });
  });

  it('updates the DOM status block when events fire (end-to-end through createStatusReporter)', () => {
    const root = buildInitialScene();
    const statusEl = document.createElement('pre');
    statusEl.textContent = 'ready';
    const reporter = createStatusReporter(statusEl);

    attachSpecInteractions(root, {
      logger: () => {},
      onEvent: (event) => reporter.report(event),
    });

    getNamedChild<Graphics>(root, 'g1').emit('pointerdown', {} as never);
    expect(statusEl.textContent).toBe('g1 pointerdown');

    getNamedChild<Graphics>(root, 'g2').emit('pointerup', {} as never);
    expect(statusEl.textContent).toBe('g2 pointerup');
  });

  it('skips bindings whose target is missing (does not throw)', () => {
    const orphan = new Container();
    expect(() => attachSpecInteractions(orphan, { logger: () => {} })).not.toThrow();
  });

  it('uses console.log by default when no logger override is supplied', () => {
    const root = buildInitialScene();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      attachSpecInteractions(root);
      getNamedChild<Graphics>(root, 'g1').emit('pointerdown', {} as never);
      expect(spy).toHaveBeenCalledWith('g1 pointerdown!');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('makeInteractive', () => {
  it('flips eventMode to "static" and fires the supplied handlers', () => {
    const g = new Graphics();
    g.name = 'custom';
    const logger = vi.fn();
    const onEvent = vi.fn();

    makeInteractive(g, ['pointerdown', 'pointerup'], { logger, onEvent });

    expect(g.eventMode).toBe('static');

    g.emit('pointerdown', {} as never);
    g.emit('pointerup', {} as never);

    expect(logger).toHaveBeenNthCalledWith(1, 'custom pointerdown!');
    expect(logger).toHaveBeenNthCalledWith(2, 'custom pointerup!');
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('falls back to "<unnamed>" when the target has no name set', () => {
    const g = new Graphics();
    const logger = vi.fn();
    const onEvent = vi.fn();
    makeInteractive(g, ['pointerdown'], { logger, onEvent });

    g.emit('pointerdown', {} as never);

    expect(logger).toHaveBeenCalledWith('<unnamed> pointerdown!');
    expect(onEvent).toHaveBeenCalledWith({
      objectName: '<unnamed>',
      eventKind: 'pointerdown',
    });
  });
});

describe('findDescendantByName', () => {
  it('finds direct children by name', () => {
    const root = new Container();
    const child = new Graphics();
    child.name = 'me';
    root.addChild(child);
    expect(findDescendantByName(root, 'me')).toBe(child);
  });

  it('finds descendants through nested containers', () => {
    const root = buildInitialScene();
    const g3 = findDescendantByName(root, 'g3');
    expect(g3).toBeDefined();
    expect(g3?.name).toBe('g3');
  });

  it('returns undefined when no descendant matches', () => {
    const root = buildInitialScene();
    expect(findDescendantByName(root, 'does-not-exist')).toBeUndefined();
  });
});

describe('createStatusReporter / formatStatus', () => {
  it('formatStatus joins object name and event kind with a space', () => {
    const event: InteractionStatusEvent = {
      objectName: 'g1',
      eventKind: 'pointerdown',
    };
    expect(formatStatus(event)).toBe('g1 pointerdown');
  });

  it('writes the formatted message to the target element', () => {
    const el = document.createElement('pre');
    const reporter = createStatusReporter(el);
    reporter.report({ objectName: 'g2', eventKind: 'pointerup' });
    expect(el.textContent).toBe('g2 pointerup');
  });

  it('reset() restores the "ready" label', () => {
    const el = document.createElement('pre');
    el.textContent = 'g1 pointerdown';
    const reporter = createStatusReporter(el);
    reporter.reset();
    expect(el.textContent).toBe('ready');
  });
});
