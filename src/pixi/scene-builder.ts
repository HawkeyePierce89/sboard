import type { Container, DisplayObject } from 'pixi.js';

export type InteractionEventKind = 'pointerdown' | 'pointerup';

export interface InteractionStatusEvent {
  objectName: string;
  eventKind: InteractionEventKind;
}

export interface AttachSpecInteractionsOptions {
  onEvent?: (event: InteractionStatusEvent) => void;
  logger?: (message: string) => void;
}

interface InteractiveBinding {
  name: string;
  events: InteractionEventKind[];
}

const SPEC_BINDINGS: readonly InteractiveBinding[] = [
  { name: 'g1', events: ['pointerdown'] },
  { name: 'g2', events: ['pointerup'] },
];

export function attachSpecInteractions(
  root: Container,
  options: AttachSpecInteractionsOptions = {},
): void {
  const logger = options.logger ?? defaultLogger;
  for (const binding of SPEC_BINDINGS) {
    const target = findDescendantByName(root, binding.name);
    if (!target) continue;
    makeInteractive(target, binding.events, {
      logger,
      onEvent: options.onEvent,
    });
  }
}

export function makeInteractive(
  target: DisplayObject,
  events: InteractionEventKind[],
  options: AttachSpecInteractionsOptions = {},
): void {
  const logger = options.logger ?? defaultLogger;
  target.eventMode = 'static';
  for (const eventKind of events) {
    target.on(eventKind, () => {
      const objectName = target.name ?? '<unnamed>';
      logger(`${objectName} ${eventKind}!`);
      options.onEvent?.({ objectName, eventKind });
    });
  }
}

export function findDescendantByName(
  container: Container,
  name: string,
): DisplayObject | undefined {
  return container.getChildByName(name, true) ?? undefined;
}

function defaultLogger(message: string): void {
  console.log(message);
}
