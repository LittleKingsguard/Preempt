import type { HandlerDef } from "../types/NodeSchema.js";

export class Handler implements HandlerDef {
  public name: string;
  public event?: string | undefined;
  public phase?: string | undefined;
  private _body: string = '';
  private _compiled?: Function | undefined;

  constructor(data: HandlerDef | string, defaultName?: string) {
    if (typeof data === 'string') {
      this.name = defaultName || 'anonymous_handler';
      this.body = data;
    } else {
      this.name = data.name;
      this.event = data.event;
      this.phase = data.phase;
      this.body = data.body;
    }
  }

  get body(): string { return this._body; }
  set body(value: string) { this._body = value; this._compiled = this.compile(); }

  get compiled(): Function | undefined { return this._compiled; }

  /** Compile the handler body into a Function */
  public compile(): Function | undefined {
    try {
      const trimmed = this._body.trim();
      if (!trimmed) {
        console.error('Handler body is empty for', this);
        return () => {
          console.error('Attempted to execute empty handler for', this.name);
        };
      }

      if (trimmed.startsWith('(') || trimmed.startsWith('async (')) {
        return new Function('return ' + trimmed)();
      } else {
        return new Function('event', 'context', trimmed);
      }
    } catch (err) {
      console.error(`Failed to compile handler ${this.name}`, err);
      return () => {
        console.error('Compilation error in handler', this.name, err);
      };
    }
  }

  /** Deprecated wrapper for backward compatibility */
  public static compileHandler(name: string, body: string): Function | undefined {
    const temp = new Handler({ name, body });
    return temp.compiled;
  }

  /** Safely execute the handler with centralized error handling */
  public execute(event?: any, context?: any): any {
    if (!this._compiled) {
      console.warn(`Attempted to execute uncompiled handler: ${this}`);
      return;
    }

    try {
      return this._compiled(event, context);
    } catch (err) {
      console.error(`[Handler Execution Error] Failed to execute handler '${this.name}':`, err);
      // We log the error but avoid crashing the main execution thread.
      // Rethrowing can be configured here later if strict handling is needed.
      return undefined;
    }
  }

  public delete(): void {
    this._compiled = undefined;
  }

  public clone(): Handler {
    return new Handler({
      name: this.name,
      event: this.event,
      phase: this.phase,
      body: this.body
    });
  }
}
