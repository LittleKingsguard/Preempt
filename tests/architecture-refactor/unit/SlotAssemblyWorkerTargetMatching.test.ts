import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SlotAssemblyWorker } from '../../../src/core/workers/SlotAssemblyWorker';
import { Component } from '../../../src/core/Component';
import { Node } from '../../../src/core/Node';
import { WorkerMessage } from '../../../src/core/WorkerMessage';
import { Supervisor } from '../../../src/core/Supervisor';

describe('SlotAssemblyWorker Target Data Matching', () => {
  let worker: SlotAssemblyWorker;
  let node: Node;

  beforeEach(() => {
    if (!Supervisor.instance) {
      (Supervisor as any).instance = { activeLockedPhases: new Set() };
    }
    worker = new SlotAssemblyWorker(Supervisor.instance!);
    node = new Node({ type: 'div', props: { id: 'testNode' } }, null, 0);
  });

  it('processes non-type target components when createdNew instruction passes target key ("content")', async () => {
    const comp = new Component({ reference: 'HeaderComp', target: 'content', value: 'Hello World' }, node, 0);
    node.setComponents([comp], 0);

    const msg = new WorkerMessage('ComponentRoutingWorker', 'SlotAssemblyWorker');
    msg.addInstruction('createdNew', ['content']); // Target data passed by routing worker
    node.addMessage(msg);

    worker.push(node, {});
    await worker.processQueue();

    expect(node.content).toBe('Hello World');
  });

  it('processes non-type target components when updatedSource instruction passes reference key ("HeaderComp")', async () => {
    const comp = new Component({ reference: 'HeaderComp', target: 'content', value: 'Updated Value' }, node, 0);
    node.setComponents([comp], 0);

    const msg = new WorkerMessage('ComponentRoutingWorker', 'SlotAssemblyWorker');
    msg.addInstruction('updatedSource', ['HeaderComp']); // Reference data passed by source update
    node.addMessage(msg);

    worker.push(node, {});
    await worker.processQueue();

    expect(node.content).toBe('Updated Value');
  });
});
