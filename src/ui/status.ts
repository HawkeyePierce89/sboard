import type { InteractionStatusEvent } from '../pixi/scene-builder';

export interface StatusReporter {
  report(event: InteractionStatusEvent): void;
  /**
   * Set the status to an arbitrary text string. Used by long-running
   * operations (e.g. PDF export) that need to surface progress text
   * outside of the {@link InteractionStatusEvent} pointer-event shape.
   */
  message(text: string): void;
}

export function createStatusReporter(target: HTMLElement): StatusReporter {
  return {
    report(event) {
      target.textContent = formatStatus(event);
    },
    message(text) {
      target.textContent = text;
    },
  };
}

export function formatStatus(event: InteractionStatusEvent): string {
  return `${event.objectName} ${event.eventKind}`;
}
