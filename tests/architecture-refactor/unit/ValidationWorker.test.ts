import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValidationWorker } from '../../../src/core/workers/ValidationWorker';
import { Node } from '../../../src/core/Node';
import { PhaseRegistry } from '../../../src/core/PhaseRegistry';

describe('ValidationWorker', () => {
  let worker: ValidationWorker;
  let node: Node;

  beforeEach(() => {
    worker = new ValidationWorker();
    node = new Node({ type: 'img', props: { src: 'test.png', alt: 'test' } }, null, 0, true);
  });

  it('emits event to next phase if validation passes and sets lastCompletedPhase to validation phase', async () => {
    worker.push(node);
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    await worker.processQueue();
    
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(node.lastCompletedPhase).toBe(PhaseRegistry.getPhaseNumber('validation'));
    consoleSpy.mockRestore();
  });

  it('handles validation failure when required property is missing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const invalidNode = new Node({ type: 'img', props: { src: 'test.png' } }, null, 0, true);
    worker.push(invalidNode);
    
    await worker.processQueue();

    expect(invalidNode.isValid).toBe(false);
    consoleSpy.mockRestore();
  });
});
