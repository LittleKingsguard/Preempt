import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentRoutingWorker } from '../../../src/core/workers/ComponentRoutingWorker';
import { Component } from '../../../src/core/Component';
import { Node } from '../../../src/core/Node';
import { WorkerMessage } from '../../../src/core/WorkerMessage';
import { Supervisor } from '../../../src/core/Supervisor';
import { PhaseRegistry } from '../../../src/core/PhaseRegistry';

describe('ComponentRoutingWorker Indexing & Routing', () => {
  let worker: ComponentRoutingWorker;
  let hostNode: Node;

  beforeEach(() => {
    if (!Supervisor.instance) {
      (Supervisor as any).instance = { activeLockedPhases: new Set() };
    }
    worker = new ComponentRoutingWorker(Supervisor.instance!);
    hostNode = new Node({ type: 'div', props: { id: 'host' } }, null, 0);
  });

  it('routes target components (target="type") to ComponentAssemblyWorker (Phase 3) when indexed by target key', async () => {
    const typeComp = new Component({ reference: 'HeaderTemplate', target: 'type' }, hostNode, 0);
    hostNode.setComponents([typeComp], 0);

    // Verify targetComponents is indexed by target ('type')
    expect(hostNode.targetComponents.get('type')).toBe(typeComp);

    const msg = new WorkerMessage('Test', 'ComponentRoutingWorker');
    msg.addInstruction('createdNew', ['type']);
    hostNode.addMessage(msg);

    worker.push(hostNode, {});

    const emitSpy = vi.spyOn(Supervisor, 'emitToPhaseName').mockImplementation(() => {});
    await worker.processQueue();

    // Should emit to ComponentAssemblyWorker (Phase 3)
    const assemblyMsgs = hostNode.getMessages('ComponentAssemblyWorker');
    expect(assemblyMsgs.length).toBe(1);
    expect(assemblyMsgs[0]!.instructions.get('createdNew')).toContain('type');

    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      hostNode,
      expect.anything(),
      'componentAssembly'
    );

    emitSpy.mockRestore();
  });

  it('routes slot target components (target="content") to SlotAssemblyWorker (Phase 4)', async () => {
    const contentComp = new Component({ reference: 'BodyContent', target: 'content' }, hostNode, 0);
    hostNode.setComponents([contentComp], 0);

    expect(hostNode.targetComponents.get('content')).toBe(contentComp);

    const msg = new WorkerMessage('Test', 'ComponentRoutingWorker');
    msg.addInstruction('createdNew', ['content']);
    hostNode.addMessage(msg);

    worker.push(hostNode, {});

    const emitSpy = vi.spyOn(Supervisor, 'emitToPhaseName').mockImplementation(() => {});
    await worker.processQueue();

    // Should emit to SlotAssemblyWorker (Phase 4)
    const slotMsgs = hostNode.getMessages('SlotAssemblyWorker');
    expect(slotMsgs.length).toBe(1);
    expect(slotMsgs[0]!.instructions.get('createdNew')).toContain('content');

    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      hostNode,
      expect.anything(),
      'slotAssembly'
    );

    emitSpy.mockRestore();
  });
});
