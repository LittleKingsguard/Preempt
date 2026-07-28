/**
 * Enriches global console methods (`log`, `warn`, `error`, `info`, `debug`) with ISO timestamp prefixes.
 *
 * @useCase Called automatically upon module import to ensure clean, timestamped logs in server/browser environments.
 * @processFlow Runs globally on initialization before any Supervisor pipeline execution.
 */
export function setupConsoleTimestamps(): void {
  const targetConsole = typeof window !== 'undefined' ? window.console : globalThis.console;
  if (!targetConsole) return;

  const getTimestamp = () => `[${new Date().toISOString()}]`;
  const methods: ('log' | 'warn' | 'error' | 'info' | 'debug')[] = ['log', 'warn', 'error', 'info', 'debug'];

  methods.forEach((method) => {
    const original = targetConsole[method];
    if (typeof original === 'function') {
      targetConsole[method] = (...args: any[]) => {
        original.call(targetConsole, getTimestamp(), ...args);
      };
    }
  });
}

setupConsoleTimestamps();

