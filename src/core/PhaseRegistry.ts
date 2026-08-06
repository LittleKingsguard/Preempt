import type { PipelineStage } from "../types/Pipeline.js";

/**
 * Central single source of truth for Supervisor pipeline stage names and phase numbers.
 *
 * @useCase Startup registration, phase number caching, and dynamic lookup for node emissions and phase locking.
 * @processFlow Workers register their phase number on startup or instantiation. Systems query `PhaseRegistry.getPhaseNumber(stageName)`.
 */
export class PhaseRegistry {
  private static nameToPhaseMap: Map<string, number> = new Map<string, number>([
    ['instantiation', 0],
    ['placement', 1],
    ['componentRouting', 2],
    ['componentAssembly', 3],
    ['slotAssembly', 4],
    ['preprocessing', 5],
    ['validation', 6],
    ['elementCreation', 7],
    ['treeAssembly', 8],
    ['postprocessing', 9]
  ]);

  private static phaseToNameMap: Map<number, string> = new Map<number, string>([
    [0, 'instantiation'],
    [1, 'placement'],
    [2, 'componentRouting'],
    [3, 'componentAssembly'],
    [4, 'slotAssembly'],
    [5, 'preprocessing'],
    [6, 'validation'],
    [7, 'elementCreation'],
    [8, 'treeAssembly'],
    [9, 'postprocessing']
  ]);

  /**
   * Registers or updates a stage name and phase number mapping.
   *
   * @param name Canonical stage name.
   * @param phaseId Phase ID number (0-9).
   */
  public static registerWorker(name: string, phaseId: number): void {
    PhaseRegistry.nameToPhaseMap.set(name, phaseId);
    PhaseRegistry.phaseToNameMap.set(phaseId, name);
  }

  /**
   * Retrieves the phase ID number for a given stage name.
   *
   * @param name Canonical stage name (e.g. 'validation', 'componentRouting').
   * @returns Phase ID number (0-9).
   * @throws Error if the stage name is not registered.
   */
  public static getPhaseNumber(name: PipelineStage | string): number {
    const phaseId = PhaseRegistry.nameToPhaseMap.get(name);
    if (phaseId === undefined) {
      throw new Error(`[PhaseRegistry] Unknown or unregistered pipeline stage name: '${name}'. Available stages: ${Array.from(PhaseRegistry.nameToPhaseMap.keys()).join(', ')}`);
    }
    return phaseId;
  }

  /**
   * Retrieves the stage name for a given phase ID number.
   *
   * @param phaseId Phase ID number (0-9).
   * @returns Canonical stage name.
   * @throws Error if the phase ID is not registered.
   */
  public static getPhaseName(phaseId: number): PipelineStage {
    const name = PhaseRegistry.phaseToNameMap.get(phaseId);
    if (!name) {
      throw new Error(`[PhaseRegistry] Unknown or unregistered phase ID: ${phaseId}. Registered phase IDs: ${Array.from(PhaseRegistry.phaseToNameMap.keys()).join(', ')}`);
    }
    return name as PipelineStage;
  }

  /**
   * Returns a copy of all registered stage names to phase numbers.
   */
  public static getAllMappings(): Record<string, number> {
    const obj: Record<string, number> = {};
    for (const [key, val] of PhaseRegistry.nameToPhaseMap.entries()) {
      obj[key] = val;
    }
    return obj;
  }
}
