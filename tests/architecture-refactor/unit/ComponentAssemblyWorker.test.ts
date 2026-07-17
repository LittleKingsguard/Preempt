// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentAssemblyWorker } from '../../../src/core/workers/ComponentAssemblyWorker';
import { Node } from '../../../src/core/Node';

describe('ComponentAssemblyWorker', () => {
  let worker;
  let nodeA;
  let nodeB;

  beforeEach(() => {
    worker = new ComponentAssemblyWorker();
    nodeA = new Node({ type: 'div', props: { someProp: 'value' } });
    nodeB = new Node({ type: 'span' });
  });

  it('uses a Map for its queue and intercepts duplicates to preserve the original RollbackState', async () => {
    const originalRollbackState = { props: { id: 'old' } };
    const newRollbackState = { props: { id: 'intermediate' } };

    // First push
    worker.push(nodeA, originalRollbackState);
    expect(worker.queue.size).toBe(1);
    expect(worker.queue.get(nodeA)).toBe(originalRollbackState);

    // Second push for the same node
    worker.push(nodeA, newRollbackState);
    expect(worker.queue.size).toBe(1);
    // Should preserve the first rollback state
    expect(worker.queue.get(nodeA)).toBe(originalRollbackState);
  });

  it('cascades updates by calculating NextState for referencing nodes and pushing them to its queue', async () => {
    // nodeB references nodeA (e.g. nodeA is a component that nodeB uses)
    Node.typeComponentNodes = [nodeA, nodeB];
    nodeA.data.type = 'CustomComp';
    nodeA.data.props = { someProp: 'value' };
    nodeA.type = 'CustomComp';
    nodeB.data.type = 'CustomComp';
    nodeB.type = 'CustomComp';

    // Create a mock for receiveNextState on nodeB
    nodeB.receiveNextState = vi.fn();

    // Push nodeA to queue
    worker.push(nodeA, { type: 'CustomComp' });

    // Process queue
    await worker.processQueue();

    // Because nodeA changed, nodeB should receive a NextState update
    // But in ComponentAssemblyWorker, Node.typeComponentNodes is an array of Nodes.
    expect(nodeB.receiveNextState).toHaveBeenCalled();
  });

  it('rolls back the Node if Component Assembly processing fails structurally', async () => {
    const originalRollbackState = { type: 'ValidType' };
    nodeA.data.type = 'BrokenType'; // Optimistic bad update

    worker.push(nodeA, originalRollbackState);

    // Force worker processing to throw an error for nodeA
    vi.spyOn(worker, 'processNode').mockImplementation(() => {
      throw new Error("Structural Error");
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    await worker.processQueue();

    // Should catch the error and revert nodeA to the rollback state
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Worker error on node'), expect.objectContaining({ message: expect.stringContaining('Structural Error') }));
    expect(nodeA.data.type).toBe('ValidType');

    consoleSpy.mockRestore();
  });

  it('confirms feedback works correctly when a component is updated, propagating the change to all instances', async () => {
    // nodeA is the master component definition
    nodeA.data.type = 'MasterComponent';
    nodeA.data.props = { class: 'base-class' };

    // nodeB and nodeC are instances of the component
    const nodeC = new Node({ type: 'MasterComponent' });
    nodeA.data.type = 'MasterComponent';
    nodeA.type = 'MasterComponent';
    nodeB.data.type = 'MasterComponent';
    nodeB.type = 'MasterComponent';

    Node.typeComponentNodes = [nodeA, nodeB, nodeC];

    nodeB.receiveNextState = vi.fn();
    nodeC.receiveNextState = vi.fn();

    // Master component receives an update to add a new class
    const nextState = { props: { class: 'base-class new-modifier' } };
    nodeA.data.props = nextState.props; // optimistic update applied by Node

    worker.push(nodeA, { props: { class: 'base-class' } });
    await worker.processQueue();

    // Feedback confirmation: both instances should receive the calculated NextState containing the new modifier
    expect(nodeB.receiveNextState).toHaveBeenCalledWith(
      expect.objectContaining({ props: expect.objectContaining({ class: 'base-class new-modifier' }) })
    );
    expect(nodeC.receiveNextState).toHaveBeenCalledWith(
      expect.objectContaining({ props: expect.objectContaining({ class: 'base-class new-modifier' }) })
    );
  });

  it('rolls back the Node if Component Assembly processing fails structurally', async () => {
    const originalRollbackState = { type: 'ValidType' };
    nodeA.data.type = 'BrokenType'; // Optimistic bad update

    worker.push(nodeA, originalRollbackState);

    // Force worker processing to throw an error for nodeA
    vi.spyOn(worker, 'processNode').mockImplementation(() => {
      throw new Error("Structural Error");
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    await worker.processQueue();

    // Should catch the error and revert nodeA to the rollback state
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Worker error on node'), expect.objectContaining({ message: expect.stringContaining('Structural Error') }));
    expect(nodeA.data.type).toBe('ValidType');

    consoleSpy.mockRestore();
  });

});
