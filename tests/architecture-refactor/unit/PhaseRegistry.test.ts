import { describe, it, expect, vi } from 'vitest';
import { PhaseRegistry } from '../../../src/core/PhaseRegistry.js';
import { Supervisor } from '../../../src/core/Supervisor.js';
import { Node } from '../../../src/core/Node.js';

describe('PhaseRegistry', () => {
  it('correctly maps canonical stage names to phase numbers 0 through 9', () => {
    expect(PhaseRegistry.getPhaseNumber('instantiation')).toBe(0);
    expect(PhaseRegistry.getPhaseNumber('placement')).toBe(1);
    expect(PhaseRegistry.getPhaseNumber('componentRouting')).toBe(2);
    expect(PhaseRegistry.getPhaseNumber('componentAssembly')).toBe(3);
    expect(PhaseRegistry.getPhaseNumber('slotAssembly')).toBe(4);
    expect(PhaseRegistry.getPhaseNumber('preprocessing')).toBe(5);
    expect(PhaseRegistry.getPhaseNumber('validation')).toBe(6);
    expect(PhaseRegistry.getPhaseNumber('elementCreation')).toBe(7);
    expect(PhaseRegistry.getPhaseNumber('treeAssembly')).toBe(8);
    expect(PhaseRegistry.getPhaseNumber('postprocessing')).toBe(9);
  });

  it('correctly maps phase numbers 0 through 9 back to canonical stage names', () => {
    expect(PhaseRegistry.getPhaseName(0)).toBe('instantiation');
    expect(PhaseRegistry.getPhaseName(1)).toBe('placement');
    expect(PhaseRegistry.getPhaseName(2)).toBe('componentRouting');
    expect(PhaseRegistry.getPhaseName(3)).toBe('componentAssembly');
    expect(PhaseRegistry.getPhaseName(4)).toBe('slotAssembly');
    expect(PhaseRegistry.getPhaseName(5)).toBe('preprocessing');
    expect(PhaseRegistry.getPhaseName(6)).toBe('validation');
    expect(PhaseRegistry.getPhaseName(7)).toBe('elementCreation');
    expect(PhaseRegistry.getPhaseName(8)).toBe('treeAssembly');
    expect(PhaseRegistry.getPhaseName(9)).toBe('postprocessing');
  });

  it('throws an explicit error when querying an unknown or unregistered stage name', () => {
    expect(() => PhaseRegistry.getPhaseNumber('nonExistentStage' as any)).toThrowError(/Unknown or unregistered pipeline stage name/);
  });

  it('throws an explicit error when querying an unknown phase ID', () => {
    expect(() => PhaseRegistry.getPhaseName(99)).toThrowError(/Unknown or unregistered phase ID/);
  });

  it('defers locking Phase 2 and Phase 3 until Phase 4 (SlotAssembly) locks', () => {
    Supervisor.clearLockedPhases();

    // Locking phase 2 or 3 should be ignored/deferred
    Supervisor.lockPhase(2);
    expect(Supervisor.isPhaseLocked(2)).toBe(false);

    Supervisor.lockPhase(3);
    expect(Supervisor.isPhaseLocked(3)).toBe(false);
    expect(Supervisor.isPhaseLocked(2)).toBe(false);

    // Locking phase 4 (SlotAssembly) locks 2, 3, and 4
    Supervisor.lockPhase(4);
    expect(Supervisor.isPhaseLocked(4)).toBe(true);
    expect(Supervisor.isPhaseLocked(3)).toBe(true);
    expect(Supervisor.isPhaseLocked(2)).toBe(true);

    Supervisor.clearLockedPhases();
  });

  it('emits in-tree nodes to Phase 6 (ValidationWorker) instead of Phase 5 during construction', () => {
    const emitSpy = vi.spyOn(Supervisor, 'emitToPhase').mockImplementation(() => {});
    const node = new Node({ type: 'div' }, null, 0, true);
    
    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      node,
      PhaseRegistry.getPhaseNumber('validation')
    );

    emitSpy.mockRestore();
  });
});
