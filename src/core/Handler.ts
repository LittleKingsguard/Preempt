import type { HandlerDef } from "../types/NodeSchema.js";
import type { Node } from "./Node.js";
import { Supervisor } from "./Supervisor.js";
import { PhaseRegistry } from "./PhaseRegistry.js";

const PHASE_NAME_MAP: Record<string, number> = {
  beforeInstantiate: PhaseRegistry.getPhaseNumber('instantiation'), afterInstantiate: PhaseRegistry.getPhaseNumber('instantiation'),
  beforePlacement: PhaseRegistry.getPhaseNumber('placement'), afterPlacement: PhaseRegistry.getPhaseNumber('placement'),
  beforeComponentRouting: PhaseRegistry.getPhaseNumber('componentRouting'), afterComponentRouting: PhaseRegistry.getPhaseNumber('componentRouting'),
  beforeComponentAssembly: PhaseRegistry.getPhaseNumber('componentAssembly'), afterComponentAssembly: PhaseRegistry.getPhaseNumber('componentAssembly'),
  beforeSlotAssembly: PhaseRegistry.getPhaseNumber('slotAssembly'), afterSlotAssembly: PhaseRegistry.getPhaseNumber('slotAssembly'),
  beforeAssembly: PhaseRegistry.getPhaseNumber('componentAssembly'), afterAssembly: PhaseRegistry.getPhaseNumber('slotAssembly'),
  beforePreprocess: PhaseRegistry.getPhaseNumber('preprocessing'), afterPreprocess: PhaseRegistry.getPhaseNumber('preprocessing'),
  beforeValidate: PhaseRegistry.getPhaseNumber('validation'), afterValidate: PhaseRegistry.getPhaseNumber('validation'),
  beforeElementCreation: PhaseRegistry.getPhaseNumber('elementCreation'), afterElementCreation: PhaseRegistry.getPhaseNumber('elementCreation'),
  beforeRender: PhaseRegistry.getPhaseNumber('elementCreation'), afterRender: PhaseRegistry.getPhaseNumber('elementCreation'),
  beforeTreeAssembly: PhaseRegistry.getPhaseNumber('treeAssembly'), afterTreeAssembly: PhaseRegistry.getPhaseNumber('treeAssembly'),
  beforePostprocess: PhaseRegistry.getPhaseNumber('postprocessing'), afterPostprocess: PhaseRegistry.getPhaseNumber('postprocessing')
};

/**
 * OOP representation of an Event Handler or Pipeline Lifecycle Hook in Preempt.
 *
 * @useCase Handles DOM event listener callbacks (e.g. click, submit) or Supervisor lifecycle hooks (e.g. beforeAssembly, afterRender).
 * @processFlow Bound to browser DOM elements in Phase 6 (`ClientElementCreationWorker`) or triggered by `node.executeHandlers()`.
 */
export class Handler implements HandlerDef {
  public name: string;
  public event?: string | undefined;
  public phase?: string | undefined;
  public parent: Node;
  private _body: string = '';
  private _compiled?: Function | undefined;

  /**
   * Constructs a new Handler instance and automatically emits the host node to matching pipeline phases.
   *
   * @param data HandlerDef schema payload or raw JS body string.
   * @param parent Host Node instance.
   * @param phase Execution phase ID.
   */
  constructor(data: HandlerDef | string, parent: Node, phase: number) {
    this.parent = parent;
    if (typeof data === 'string') {
      this.name = 'anonymous_handler';
      this.body = data;
    } else {
      this.name = data.name || (data as any).reference || 'anonymous_handler';
      this.event = data.event || (data as any).target;
      this.phase = data.phase;
      this.body = data.body || '';
    }

    if (this.phase && this.parent && this.parent.isInTree && phase !== 99) {
      const handlerPhaseId = PHASE_NAME_MAP[this.phase];
      if (handlerPhaseId !== undefined && handlerPhaseId >= phase) {
        Supervisor.emitToPhase(this, this.parent, {}, handlerPhaseId);
      }
    }
  }

  /**
   * Merges incoming handler definitions into a target Node.
   *
   * @param targetNode Target Node instance.
   * @param incomingHandlers Array or dictionary of handler definitions.
   * @returns Earliest phase ID associated with the handlers.
   */
  public static mergeHandlers(targetNode: Node, incomingHandlers: HandlerDef[] | Handler[] | Record<string, any>): number | undefined {
    if (Supervisor.isPropertyLocked('handlers')) {
      console.error(`[Handler] Lock violation: Property 'handlers' is currently locked for node ${targetNode.css?.id || 'unknown'}`);
      return undefined;
    }

    if (targetNode.handlers && Array.isArray(targetNode.handlers)) {
      for (const oldH of targetNode.handlers) {
        if (oldH && typeof oldH.delete === 'function') {
          oldH.delete();
        }
      }
    }

    const newHandlersList: Handler[] = [];
    let minPhase = PhaseRegistry.getPhaseNumber('validation');

    const processHandler = (hDef: HandlerDef | Handler | string, keyName?: string) => {
      const handlerInstance = Handler.fromDef(hDef, targetNode, 0, keyName);
      newHandlersList.push(handlerInstance);

      if (handlerInstance.phase) {
        const pId = PHASE_NAME_MAP[handlerInstance.phase];
        if (pId !== undefined && pId < minPhase) {
          minPhase = pId;
        }
      }
    };

    if (Array.isArray(incomingHandlers)) {
      incomingHandlers.forEach(h => processHandler(h));
    } else if (incomingHandlers && typeof incomingHandlers === 'object') {
      for (const [key, val] of Object.entries(incomingHandlers)) {
        if (val instanceof Handler || (val && typeof val === 'object')) {
          processHandler(val as HandlerDef, key);
        } else if (typeof val === 'string') {
          processHandler({ name: key, body: val }, key);
        }
      }
    }

    targetNode.handlers = newHandlersList;
    return minPhase;
  }

  /**
   * Resolves the numeric phase ID for a handler phase name string.
   *
   * @param phaseName Lifecycle hook or event phase name (e.g. 'beforePreprocess', 'afterValidate').
   * @returns Numeric phase ID or undefined if unmapped.
   */
  public static getPhaseId(phaseName: string): number | undefined {
    return PHASE_NAME_MAP[phaseName];
  }

  /**
   * Resolves the canonical pipeline stage name for a handler phase name string.
   *
   * @param phaseName Lifecycle hook or event phase name (e.g. 'beforePreprocess', 'afterValidate').
   * @returns Canonical stage name string (e.g. 'preprocessing', 'validation') or undefined.
   */
  public static getStageName(phaseName: string): string | undefined {
    const pId = PHASE_NAME_MAP[phaseName];
    if (pId !== undefined) {
      return PhaseRegistry.getPhaseName(pId);
    }
    return undefined;
  }

  get body(): string { return this._body; }
  set body(value: string) { 
    this._body = value || ''; 
    this._compiled = this.compile(); 
  }

  get compiled(): Function | undefined { return this._compiled; }

  /**
   * Compiles the JavaScript body string into an executable Function object.
   *
   * @returns Compiled Function object.
   */
  public compile(): Function | undefined {
    try {
      const trimmed = (this._body || '').trim();
      if (!trimmed) {
        return () => {
          console.warn(`Attempted to execute uncompiled/empty handler ${this.name}`);
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

  /**
   * Safely executes the compiled handler with centralized error handling.
   *
   * @param event DOM Event object or null.
   * @param context Preempt execution context dictionary.
   * @returns Handler return value.
   */
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

  /** Destroys the compiled function reference. */
  public delete(): void {
    this._compiled = undefined;
  }

  /**
   * Factory method creating a Handler from a schema definition, instance, or raw JS string.
   *
   * @param def Raw HandlerDef payload, string body, or Handler object.
   * @param parent Host Node instance.
   * @param phase Execution phase ID.
   * @param targetPath Target binding path string.
   * @returns Instantiated Handler object.
   */
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
      } else {
        const knownPhases = ["beforeAssembly", "afterAssembly", "beforeRender", "afterRender", "beforeInstantiate", "afterInstantiate", "beforePreprocessing", "afterPreprocessing", "beforeValidation", "afterValidation", "beforePostprocessing", "afterPostprocessing"];
        if (knownPhases.includes(targetPath)) {
          hPhase = targetPath;
        } else if (targetPath.startsWith("on") || ["click", "submit", "change", "input", "mouseover", "keydown"].includes(targetPath.toLowerCase())) {
          hEvent = targetPath;
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

  /**
   * Clones this Handler instance.
   *
   * @param newParent Host Node instance.
   * @param phase Execution phase ID.
   * @returns Cloned Handler instance.
   */
  public clone(newParent: Node, phase: number, _actor: string = 'Handler'): Handler {
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

