/**
 * Lightweight client-side logger utility for Preempt pipeline execution.
 * Suppresses verbose debug messages in production mode unless debug flags are active.
 */
export class Logger {
  public static isDebugEnabled(): boolean {
    if (typeof window !== 'undefined' && (window as any).__PREEMPT_DEBUG__ === true) {
      return true;
    }
    const proc = (globalThis as any).process;
    if (proc && proc.env?.NODE_ENV === 'development') {
      return true;
    }
    return false;
  }

  public static debug(...args: any[]): void {
    if (Logger.isDebugEnabled()) {
      console.log(...args);
    }
  }

  public static info(...args: any[]): void {
    console.log(...args);
  }

  public static warn(...args: any[]): void {
    console.warn(...args);
  }

  public static error(...args: any[]): void {
    console.error(...args);
  }
}
