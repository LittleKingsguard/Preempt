import { describe, it, expect, beforeEach } from 'vitest';
import { Supervisor } from '../../../src/core/Supervisor.js';
import { Node } from '../../../src/core/Node.js';

describe('Content Pipeline Integration', () => {
  beforeEach(() => {
    Supervisor.instance = null;
    Node.placementArray = [];
    Node.sourcePlacements = {};
  });

  it('cascades payload updates through the pipeline and replaces referencing nodes cleanly', async () => {
    // 1. Setup a template node that acts as a target placement
    const template = {
      type: 'main',
      children: [
        { type: 'div', placement: [{ placementName: 'content-slot' }] }
      ]
    };
    
    // Start supervisor with initial empty template
    await Supervisor.process({ runInstantiation: true, runPlacement: true, runMonitoring: true }, template);
    
    // 2. Fetch/inject initial content payload targeting the placement
    const payload1 = {
      metadata: { batchLabel: 'post-1' },
      content: [
        { type: 'article', content: 'Version 1', placement: [{ targetPlacement: ['content-slot'] }] }
      ]
    };
    
    await Supervisor.injectContent(payload1);
    
    // Verify node exists with initial content
    const articleNodes = Supervisor.getContentNodes().filter(n => n.type === 'article');
    expect(articleNodes.length).toBe(1);
    expect(articleNodes[0].content).toBe('Version 1');
    const oldNode = articleNodes[0];
    
    // 3. Simulate an edit/save modifying the same batch payload
    const payload2 = {
      metadata: { batchLabel: 'post-1' },
      content: [
        { type: 'article', content: 'Version 2', placement: [{ targetPlacement: ['content-slot'] }] }
      ]
    };
    
    // The Supervisor should replace the batch and rebuild the content node
    await Supervisor.injectContent(payload2);
    
    // 4. Verify cascade replacing behavior
    const updatedNodes = Supervisor.getContentNodes();
    expect(updatedNodes.length).toBe(1);
    expect(updatedNodes[0].content).toBe('Version 2'); // Updated content is present
    
    // The new node instance must be detached/different from the old one, verifying replacement
    expect(updatedNodes[0]).not.toBe(oldNode);
  });
});
