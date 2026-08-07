// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Node } from '../../../src/core/Node';
import { NodeLayer } from '../../../src/core/NodeLayer';

describe('Node - Atomic Architecture', () => {
  let node;
  let mockWorker;

  beforeEach(() => {
    // Reset global arrays and create a fresh node
    Node.clearPlacements();
    node = new Node({ type: 'div', props: { id: 'test-node' } }, null, 0);

    // Mock worker for routing
    mockWorker = {
      queue: new Map(),
      push: vi.fn((n, rollbackState) => mockWorker.queue.set(n, rollbackState))
    };

    // Mock the supervisor's worker registry
    global.Supervisor = {
      getWorkerForPhase: vi.fn(() => mockWorker)
    };
  });

  it('immediately applies NextState optimistically', () => {
    const nextState = { props: { id: 'updated-node', class: 'active' } };

    // Mock Supervisor to allow all properties and phases
    global.Supervisor.isPropertyLocked = vi.fn(() => false);
    global.Supervisor.isPhaseLocked = vi.fn(() => false);

    node.receiveNextState(nextState); // No phaseId

    expect(node.data.props.id).toBe('updated-node');
    expect(node.data.props.class).toBe('active');
  });

  it('denies changes when an explicitly passed phaseId is centrally locked', () => {
    // Explicitly configure phase locks to test the lock mechanism
    Supervisor.activeLockedPhases = new Set([2]); // Phase 2 is locked
    global.Supervisor.isPhaseLocked = vi.fn((phase) => Supervisor.activeLockedPhases.has(phase));
    
    global.Supervisor.isPropertyLocked = vi.fn(() => false); // Should not be called
    
    const nextState = { props: { id: 'test' }, css: { class: 'new-class' } }; 
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Explicitly passing locked phase 2
    node.receiveNextState(nextState, 2); 
    
    expect(global.Supervisor.isPropertyLocked).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Lock violation'));
    
    // Neither change should have applied
    expect(node.data.props.id).not.toBe('test');
    expect(node.data.css?.class).not.toBe('new-class');
    
    consoleSpy.mockRestore();
  });

  it('diffs incoming state and queries Supervisor to deny changes to locked properties', () => {
    const nextState = { placement: 'header' };

    // Attempting to modify placement should be denied via receiveNextState
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    node.receiveNextState(nextState);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('receiveNextState rejected'));
    expect(node.placement).toEqual([]); // Should not have applied

    consoleSpy.mockRestore();
  });

  it('stores a rollback copy without deep cloning child nodes', () => {
    const originalId = node.data.props.id;
    const childNode = new Node({ type: 'span' }, null, 0);
    node.children = [childNode];

    // Mock Supervisor to allow all properties
    global.Supervisor.isPropertyLocked = vi.fn(() => false);

    const nextState = { props: { id: 'updated-node' } };
    node.receiveNextState(nextState);

    // The rollback state should retain the old ID
    expect(node._lastValidState.props.id).toBe(originalId);

    // But the child nodes should be referentially identical (no deep clone)
    expect(node._lastValidState.children[0]).toBe(childNode);
  });

  it('pushes the node and rollback state to the correct Worker queue based on diffed properties', () => {
    // Mock Supervisor to allow all properties
    global.Supervisor.isPropertyLocked = vi.fn(() => false);

    const nextState = { props: { id: 'updated-node' } };
    node.receiveNextState(nextState);

    expect(global.Supervisor.getWorkerForPhase).toHaveBeenCalled();
    expect(mockWorker.push).toHaveBeenCalledWith(node, expect.anything());
    expect(mockWorker.queue.has(node)).toBe(true);
  });

  it('cleans up global stale data on delete', async () => {
    Node.placementArray = [node];
    Node.sourcePlacements = { 'test-node': [node] };

    node.delete();

    expect(Node.placementArray.includes(node)).toBe(false);
    expect(Node.sourcePlacements['test-node']).toBeUndefined();
  });

  it('caches compiled state across multiple property checks and invalidates when layer stack is modified', () => {
    const freshNode = new Node({ type: 'div', content: 'hello' }, null, 0);

    // Initial compile
    const state1 = freshNode.compiledState;
    expect(state1.type).toBe('div');
    expect(state1.content).toBe('hello');

    // Repeated getter check should return identical cached compiledState instance
    const state2 = freshNode.compiledState;
    expect(state2).toBe(state1);

    // Modifying layer stack invalidates cache
    freshNode.addLayer(new NodeLayer('type', 'customComponent', 'replace', 'section', 1));

    // Next getter check re-compiles and returns updated compiled state
    const state3 = freshNode.compiledState;
    expect(state3).not.toBe(state1);
    expect(state3.type).toBe('section');

    // Subsequent getter check reuses new cached state instance
    expect(freshNode.compiledState).toBe(state3);

    // Removing layer invalidates cache again
    freshNode.removeLayer('type', 'customComponent');
    const state4 = freshNode.compiledState;
    expect(state4).not.toBe(state3);
    expect(state4.type).toBe('div');
  });
});
