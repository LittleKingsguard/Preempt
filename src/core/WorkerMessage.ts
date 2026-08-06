/**
 * Represents a structured message/event log for tracking execution history,
 * property changes, and targeted worker instructions on a Node.
 */
export class WorkerMessage {
  public actor: string;
  public changelog: Record<string, { oldValue: any; newValue: any }>;
  public targetWorker?: string | undefined;
  public instructions: Map<string, string[]>;
  public complete: boolean;

  /**
   * Constructs a new WorkerMessage instance.
   *
   * @param actor Name of the triggering worker, API function, or context (e.g. 'ComponentAssemblyWorker', 'nextState', 'Snapshot').
   * @param targetWorker Optional target worker class name or phase identifier.
   * @param changelog Optional mapping of changed property keys to old and new values.
   * @param instructions Optional Map or Record of instruction actions to reference name arrays.
   */
  constructor(
    actor: string,
    targetWorker?: string,
    changelog?: Record<string, { oldValue: any; newValue: any }>,
    instructions?: Map<string, string[]> | Record<string, string[]>
  ) {
    this.actor = actor;
    this.targetWorker = targetWorker;
    this.changelog = changelog || {};
    this.complete = false;
    this.instructions = new Map<string, string[]>();

    if (instructions) {
      if (instructions instanceof Map) {
        for (const [k, v] of instructions) {
          this.instructions.set(k, [...v]);
        }
      } else if (typeof instructions === 'object') {
        for (const [k, v] of Object.entries(instructions)) {
          if (Array.isArray(v)) {
            this.instructions.set(k, [...v]);
          }
        }
      }
    }
  }

  /**
   * Appends component reference names to a specified instruction action.
   *
   * @param action Action name (e.g. 'createdNew', 'updatedSource').
   * @param values Array of component reference name strings.
   */
  public addInstruction(action: string, values: string[]): void {
    if (!values || values.length === 0) return;
    const existing = this.instructions.get(action) || [];
    const merged = Array.from(new Set([...existing, ...values]));
    this.instructions.set(action, merged);
  }

  /**
   * Marks this message/instruction as complete.
   */
  public markComplete(): void {
    this.complete = true;
  }

  /**
   * Clones this WorkerMessage.
   *
   * @param actor Actor string for the clone context.
   * @returns Deep-cloned WorkerMessage instance.
   */
  public clone(actor: string): WorkerMessage {
    const clonedInstructions = new Map<string, string[]>();
    for (const [k, v] of this.instructions) {
      clonedInstructions.set(k, [...v]);
    }

    const clonedChangelog: Record<string, { oldValue: any; newValue: any }> = {};
    for (const [k, v] of Object.entries(this.changelog)) {
      clonedChangelog[k] = {
        oldValue: v.oldValue,
        newValue: v.newValue
      };
    }

    const cloned = new WorkerMessage(actor, this.targetWorker, clonedChangelog, clonedInstructions);
    cloned.complete = this.complete;
    return cloned;
  }

  /**
   * Cleans up references and clears instructions.
   */
  public delete(): void {
    this.instructions.clear();
    this.changelog = {};
  }
}
