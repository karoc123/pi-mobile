export type ToastTone = 'info' | 'success' | 'error';

export interface ToastState {
  message: string;
  tone: ToastTone;
}

export class ToastStore {
  message = $state('');
  tone = $state<ToastTone>('info');
  private timeoutId: number | null = null;
  private listeners = new Set<(state: ToastState) => void>();

  subscribe(run: (value: ToastState) => void): () => void {
    run({ message: this.message, tone: this.tone });
    this.listeners.add(run);
    return () => {
      this.listeners.delete(run);
    };
  }

  show(message: string, tone: ToastTone = 'info', durationMs = 3500): void {
    this.message = message;
    this.tone = tone;
    this.notify();

    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
    }

    this.timeoutId = window.setTimeout(() => {
      this.clear();
    }, durationMs);
  }

  clear(): void {
    this.message = '';
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.notify();
  }

  private notify(): void {
    const state: ToastState = { message: this.message, tone: this.tone };
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export const toast = new ToastStore();
