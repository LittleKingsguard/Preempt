// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstantiationWorker } from '../../../src/core/workers/InstantiationWorker';
import { Node } from '../../../src/core/Node';

describe('InstantiationWorker', () => {
  let worker;
  let node;

  beforeEach(() => {
    worker = new InstantiationWorker();
    node = new Node({ type: 'div' });
    global.Supervisor = { emitToPhase: vi.fn() };
  });

  it('compiles template and content data without clearing arrays globally', async () => {
    // Optimistic state simulates the raw data coming in
    const nextState = { props: { id: 'compiled' } };
    node.receiveNextState(nextState, 0); // Instantiation phase

    worker.push(node, { props: { id: 'old' } });
    await worker.processQueue();

    // The data shouldn't be erased or corrupted
    expect(node.data.props.id).toBe('compiled');
    
    // Placement arrays are locked via Supervisor, tested there
  });

  it('accepts a raw NodeData object and constructs a new Node instance dynamically', async () => {
    const rawData = { type: 'section', props: { class: 'dynamic-content' } };
    
    // Simulate pushing raw data directly to worker
    worker.pushRaw(rawData);
    await worker.processQueue();
    
    // Verify a new node was created and emitted to the next phase (Placement)
    expect(global.Supervisor.emitToPhase).toHaveBeenCalled();
    const emittedNode = global.Supervisor.emitToPhase.mock.calls[0][0];
    
    expect(emittedNode).toBeInstanceOf(Node);
    expect(emittedNode.data.type).toBe('section');
    expect(emittedNode.data.props.class).toBe('dynamic-content');
  });
});
