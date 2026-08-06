import { describe, it, expect, beforeEach } from 'vitest';
import { SlotAssemblyWorker } from '../../../src/core/workers/SlotAssemblyWorker.js';
import { Component } from '../../../src/core/Component.js';
import { Node } from '../../../src/core/Node.js';
import { WorkerMessage } from '../../../src/core/WorkerMessage.js';
import { Supervisor } from '../../../src/core/Supervisor.js';

describe('SlotAssemblyWorker Reset Behavior', () => {
  let worker: SlotAssemblyWorker;
  let testNode: Node;

  beforeEach(() => {
    worker = new SlotAssemblyWorker(Supervisor.instance!);
    testNode = new Node({
      type: 'div',
      props: { id: 'test-node', title: 'Original Title' },
      content: 'Original Content',
      css: { style: { color: 'red' } }
    }, null, 0);
  });

  it('resets props and content to node.data values when instructed slot binding fails to resolve', async () => {
    testNode.props.title = 'Stale Title';
    testNode.content = 'Stale Content';

    const failingBinding = new Component({ reference: 'MissingRef', target: 'props.title' }, testNode, 0);
    testNode.targetComponents.set('props.title', failingBinding);

    const msg = new WorkerMessage('TestActor', 'SlotAssemblyWorker');
    msg.addInstruction('createdNew', ['props.title']);
    testNode.addMessage(msg);

    worker.push(testNode, {});
    await worker.processQueue();

    expect(testNode.props.title).toBe('Original Title');
  });
});
