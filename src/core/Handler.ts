import type { HandlerDef } from "../types/NodeSchema.js";
import type { Node } from "./Node.js";
import { Supervisor } from "./Supervisor.js";

const PHASE_NAME_MAP: Record<string, number> = {
  beforeInstantiate: 0, afterInstantiate: 0,
  beforePlacement: 1, afterPlacement: 1,
  beforeComponentAssembly: 2, afterComponentAssembly: 2,
  beforeSlotAssembly: 3, afterSlotAssembly: 3,
  beforeAssembly: 2, afterAssembly: 3,
  beforePreprocess: 4, afterPreprocess: 4,
  beforeValidate: 5, afterValidate: 5,
  beforeElementCreation: 6, afterElementCreation: 6,
  beforeRender: 6, afterRender: 6,
  beforeTreeAssembly: 7, afterTreeAssembly: 7,
  beforePostprocess: 8, afterPostprocess: 8
};

export class Handler implements HandlerDef {
  public name: string;
  public event?: string | undefined;
  public phase?: string | undefined;
  public parent: Node;
  private _body: string = '';
  private _compiled?: Function | undefined;

  constructor(data: HandlerDef | string, parent: Node, phase: number) {
    this.parent = parent;
    if (typeof data === 'string') {
      this.name = 'anonymous_handler';
      this.body = data;
    } else {
      this.name = data.name;
      this.event = data.event;
      this.phase = data.phase;
      this.body = data.body;
    }

    if (this.phase && this.parent && this.parent.isInTree && phase !== 99) {
      const handlerPhaseId = PHASE_NAME_MAP[this.phase];
      if (handlerPhaseId !== undefined && handlerPhaseId >= phase) {
        Supervisor.emitToPhase(this, this.parent, {}, handlerPhaseId);
      }
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
      return undefined;
    }
  }

  public delete(): void {
    this._compiled = undefined;
  }

  public static fromDef(def: HandlerDef | Handler | string, parent: Node, phase: number = 0, targetPath?: string): Handler {
    let hName = typeof def === 'object' && def !== null ? def.name : undefined;
    let hEvent = typeof def === 'object' && def !== null ? def.event : undefined;
    let hPhase = typeof def === 'object' && def !== null ? def.phase : undefined;
    let hBody = typeof def === 'object' && def !== null ? def.body : String(def);

    if (targetPath) {
      if (targetPath.startsWith("handlers.event.")) {
        hEvent = targetPath.substring("handlers.event.".length);
      } else if (targetPath.startsWith("handlers.phase.")) {
        hPhase = targetPath.substring("handlers.phase.".length);
      } else if (targetPath.startsWith("handlers.")) {
        const subPath = targetPath.substring("handlers.".length);
        const knownPhases = ["beforeAssembly", "afterAssembly", "beforeRender", "afterRender", "beforeInstantiate", "afterInstantiate", "beforePreprocessing", "afterPreprocessing", "beforeValidation", "afterValidation", "beforePostprocessing", "afterPostprocessing"];
        if (knownPhases.includes(subPath)) {
          hPhase = subPath;
        } else if (subPath.startsWith("on") || ["click", "submit", "change", "input", "mouseover", "keydown"].includes(subPath.toLowerCase())) {
          hEvent = subPath;
        } else {
          if (subPath) hName = subPath;
        }
      }
    }

    const handlerObj = def instanceof Handler
      ? def
      : new Handler({ name: hName || 'anonymous_handler', event: hEvent, phase: hPhase, body: hBody }, parent, phase);

    if (hEvent) handlerObj.event = hEvent;
    if (hPhase) handlerObj.phase = hPhase;
    if (hName) handlerObj.name = hName;

    return handlerObj;
  }

  public clone(newParent: Node, phase: number): Handler {
    const parentNode = newParent || this.parent;
    const targetPhase = phase;
    return new Handler({
      name: this.name,
      event: this.event,
      phase: this.phase,
      body: this.body
    }, parentNode, targetPhase);
  }
}
