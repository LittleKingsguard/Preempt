import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValidationWorker } from '../../../src/core/workers/ValidationWorker';
import { Node } from '../../../src/core/Node';
import { Props } from '../../../src/core/Props';
import { PhaseRegistry } from '../../../src/core/PhaseRegistry';

describe('ValidationWorker', () => {
  let worker: ValidationWorker;
  let node: Node;

  beforeEach(() => {
    worker = new ValidationWorker();
    node = new Node({ type: 'img', props: { src: 'test.png', alt: 'test' } }, null, 0, true);
  });

  it('emits event to next phase if validation passes and sets lastCompletedPhase to validation phase', async () => {
    worker.push(node, { props: { src: 'old.png' } } as any);
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    await worker.processQueue();
    
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(node.lastCompletedPhase).toBe(PhaseRegistry.getPhaseNumber('validation'));
    consoleSpy.mockRestore();
  });

  it('rolls back Node state if validation fails', async () => {
    const originalRollbackState = { props: { src: 'old.png', alt: 'old' } };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Optimistic bad update missing alt tag
    (node as any)._data = { ...node.data, props: { src: 'test.png' } };
    node.props = new Props({ src: 'test.png' }, node); // Needed since we bypass receiveNextState in tests
    
    worker.push(node, originalRollbackState);
    
    await worker.processQueue();

    expect(node.props.alt).toBe('old');
    consoleSpy.mockRestore();
  });
});
