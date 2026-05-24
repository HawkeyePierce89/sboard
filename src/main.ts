export const APP_NAME = 'sboard';

export function bootstrap(): void {
  if (typeof document !== 'undefined') {
    document.title = APP_NAME;
  }
}
