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
