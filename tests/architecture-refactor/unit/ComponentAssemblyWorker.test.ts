import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentAssemblyWorker } from '../../../src/core/workers/ComponentAssemblyWorker';
import { Component } from '../../../src/core/Component';
import { Node } from '../../../src/core/Node';
import { NodeLayer } from '../../../src/core/NodeLayer';
import { WorkerMessage } from '../../../src/core/WorkerMessage';
import { Supervisor } from '../../../src/core/Supervisor';

describe('ComponentAssemblyWorker', () => {
  let worker: ComponentAssemblyWorker;
  let nodeA: Node;
  let nodeB: Node;

  beforeEach(() => {
    worker = new ComponentAssemblyWorker();
    nodeA = new Node({ type: 'div', props: { id: 'nodeA', someProp: 'value' } }, null, 0);
    nodeB = new Node({ type: 'span', props: { id: 'nodeB' } }, null, 0);
  });

  it('uses a Set for its queue and prevents duplicate pushes', async () => {
    // First push
    worker.push(nodeA);
    expect((worker as any).queue.size).toBe(1);
    expect((worker as any).queue.has(nodeA)).toBe(true);

    // Second push for the same node
    worker.push(nodeA);
    expect((worker as any).queue.size).toBe(1);
  });

  it('cascades updates by applying calculated NextState directly to referencing nodes and emitting to placement stage', async () => {
    // nodeB references nodeA (e.g. nodeA is a component that nodeB uses)
    const comp = new Component({ reference: 'CustomComp', target: 'type' }, nodeA, 0);
    comp._referencingNodes = new Set([nodeB]);
    nodeA.sourceComponents.set('CustomComp', comp);

    (nodeA as any)._data = { type: 'CustomComp', props: { someProp: 'value' } };
    nodeA.invalidateCompileCache();
    (nodeB as any)._data = { type: 'CustomComp' };
    nodeB.invalidateCompileCache();

    const emitSpy = vi.spyOn(Supervisor, 'emitToPhaseName');

    // Push nodeA to queue
    worker.push(nodeA);

    // Process queue
    await worker.processQueue();

    // Because nodeA changed, nodeB should be emitted to placement phase
    expect(emitSpy).toHaveBeenCalledWith(expect.any(ComponentAssemblyWorker), nodeB, 'placement');
    emitSpy.mockRestore();
  });

  it('emits updatedSource instructions to ComponentRoutingWorker when new source components are added from structural root node', async () => {
    const sourceComp = new Component({ reference: 'CustomComp', target: 'type', value: { type: 'header' } }, nodeA, 0);
    nodeA.sourceComponents.set('CustomComp', sourceComp);

    const typeComp = new Component({ reference: 'CustomComp', target: 'type' }, nodeA, 0);
    nodeA.targetComponents.set('type', typeComp);

    if (sourceComp._instantiatedNodes && sourceComp._instantiatedNodes[0]) {
      const nestedSource = new Component({ reference: 'NestedComp', value: 'NestedVal' }, sourceComp._instantiatedNodes[0], 0);
      sourceComp._instantiatedNodes[0].sourceComponents.set('NestedComp', nestedSource);
    }

    // Push nodeA to queue
    worker.push(nodeA);
    await worker.processQueue();

    // nodeA should have a routing message logged for ComponentRoutingWorker
    const routingMsgs = nodeA.getMessages('ComponentRoutingWorker');
    expect(routingMsgs.length).toBeGreaterThan(0);
    expect(routingMsgs[0]!.instructions.get('updatedSource')).toContain('NestedComp');
  });

  it('handles errors in worker queue processing', async () => {
    worker.push(nodeA);

    // Force worker processing to throw an error for nodeA
    vi.spyOn(worker as any, 'processNode').mockImplementation(() => {
      throw new Error("Structural Error");
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    await worker.processQueue();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Worker error on node'), expect.objectContaining({ message: expect.stringContaining('Structural Error') }));

    consoleSpy.mockRestore();
  });

  it('confirms feedback works correctly when a component is updated, propagating the change to all instances', async () => {
    // nodeA is the master component definition
    (nodeA as any)._data = { type: 'MasterComponent', props: { class: 'base-class' } };
    nodeA.invalidateCompileCache();

    // nodeB and nodeC are instances of the component
    const nodeC = new Node({ type: 'MasterComponent' }, null, 0);
    (nodeB as any)._data = { type: 'MasterComponent' };
    nodeB.invalidateCompileCache();

    const comp2 = new Component({ reference: 'MasterComponent', target: 'props' }, nodeA, 0);
    comp2._referencingNodes = new Set([nodeB, nodeC]);
    nodeA.sourceComponents.set('MasterComponent', comp2);

    // Master component receives an update to add a new class
    const nextState = { props: { class: 'base-class new-modifier' } };
    (nodeA as any)._data.props = nextState.props;
    nodeA.invalidateCompileCache();

    worker.push(nodeA);
    await worker.processQueue();

    // Feedback confirmation: both instances should receive the calculated NextState containing the new modifier
    expect(nodeB.props).toEqual(expect.objectContaining({ class: 'base-class new-modifier' }));
    expect(nodeC.props).toEqual(expect.objectContaining({ class: 'base-class new-modifier' }));
  });

  it('filters component resolution based on WorkerMessage instructions', async () => {
    const typeComp = new Component({ reference: 'MasterComponent', target: 'type', value: { type: 'header' } }, nodeA, 0);
    nodeA.targetComponents.set('type', typeComp);

    const msg = new WorkerMessage('TestActor', 'ComponentAssemblyWorker');
    msg.addInstruction('createdNew', ['MasterComponent']);
    nodeA.addMessage(msg);

    worker.push(nodeA);
    await worker.processQueue();

    expect(nodeA.type).toBe('header');
    expect(msg.complete).toBe(true);
  });

  it('resets node to node.data originals when an instructed type component resolution fails', async () => {
    (nodeA as any)._data = { type: 'div', content: 'Original Content' };
    nodeA.addLayer(new NodeLayer('type', 'test', 'replace', 'modified-type', 0));
    nodeA.addLayer(new NodeLayer('content', 'test', 'replace', 'Modified Content', 0));

    const failingTypeComp = new Component({ reference: 'NonExistentComponent', target: 'type' }, nodeA, 0);
    nodeA.targetComponents.set('type', failingTypeComp);

    const msg = new WorkerMessage('TestActor', 'ComponentAssemblyWorker');
    msg.addInstruction('createdNew', ['NonExistentComponent']);
    nodeA.addMessage(msg);

    worker.push(nodeA);
    await worker.processQueue();

    // Node should be reset back to node.data originals
    expect(nodeA.type).toBe('div');
    expect(nodeA.content).toBe('Original Content');
    expect(nodeA.targetComponents.has('type')).toBe(false);
  });
});
