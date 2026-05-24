import type { InteractionStatusEvent } from '../pixi/scene-builder';

export interface StatusReporter {
  report(event: InteractionStatusEvent): void;
  reset(): void;
}

export function createStatusReporter(target: HTMLElement): StatusReporter {
  return {
    report(event) {
      target.textContent = formatStatus(event);
    },
    reset() {
      target.textContent = 'ready';
    },
  };
}

export function formatStatus(event: InteractionStatusEvent): string {
  return `${event.objectName} ${event.eventKind}`;
}
