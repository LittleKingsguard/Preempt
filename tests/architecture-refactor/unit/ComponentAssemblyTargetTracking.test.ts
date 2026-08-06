import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentAssemblyWorker } from '../../../src/core/workers/ComponentAssemblyWorker';
import { Component } from '../../../src/core/Component';
import { Node } from '../../../src/core/Node';
import { Supervisor } from '../../../src/core/Supervisor';

describe('ComponentAssemblyWorker Target Component Tracking', () => {
  let worker: ComponentAssemblyWorker;
  let targetNode: Node;

  beforeEach(() => {
    if (!Supervisor.instance) {
      (Supervisor as any).instance = { activeLockedPhases: new Set() };
    }
    worker = new ComponentAssemblyWorker(Supervisor.instance!);
    targetNode = new Node({ type: 'div', props: { id: 'targetNode' } }, null, 0);
  });

  it('tracks added/replaced target components from structural componentRootNode and emits createdNew instruction to ComponentRoutingWorker', async () => {
    // Master structural component root node
    const componentRoot = new Node({
      type: 'header',
      component: [{ reference: 'NestedSlotComp', target: 'content', value: 'Slot Content' }]
    }, null, 99);

    const typeBinding = new Component({ reference: 'HeaderTemplate', target: 'type' }, targetNode, 0);
    typeBinding._instantiatedNodes = [componentRoot];
    targetNode.setComponents([typeBinding], 0);

    const emitSpy = vi.spyOn(Supervisor, 'emitToPhaseName').mockImplementation(() => {});

    worker.push(targetNode, {});
    await worker.processQueue();

    // Verify targetNode now has 'content' target component from componentRoot
    expect(targetNode.targetComponents.has('content')).toBe(true);

    // Verify routing message createdNew contains 'content'
    const routingMsgs = targetNode.getMessages('ComponentRoutingWorker');
    expect(routingMsgs.length).toBeGreaterThan(0);
    expect(routingMsgs[0]!.instructions.get('createdNew')).toContain('content');

    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      targetNode,
      expect.anything(),
      'componentRouting'
    );

    emitSpy.mockRestore();
  });
});
