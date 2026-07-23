// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlacementWorker } from '../../../src/core/workers/PlacementWorker';
import { Node } from '../../../src/core/Node';

describe('PlacementWorker', () => {
  let worker;
  let nodeA;
  let nodeB;

  beforeEach(() => {
    worker = new PlacementWorker();
    nodeA = new Node({ type: 'div', placement: 'header' }, null, 0);
    nodeB = new Node({ type: 'span', targetPlacements: ['header'] }, null, 0);
    Node.clearPlacements();
  });

  it('cascades updates when a placement is removed', async () => {
    Node.placementArray = [nodeA];
    
    // nodeA changes its placement to null (optimistic update)
    nodeA.data.placement = null;
    
    // Mock referencing node receiveNextState
    nodeB.receiveNextState = vi.fn();
    Node.sourcePlacements = { 'header': [nodeB] };
    
    worker.push(nodeA, { placement: 'header' });
    await worker.processQueue();

    // Node placement array is updated immediately by worker side effects
    expect(Node.placementArray.includes(nodeA)).toBe(false);
    
    // Referencing node gets an update pushed
    expect(nodeB.receiveNextState).toHaveBeenCalled();
  });

  it('cascades updates when a placement is added', async () => {
    // nodeA changes its placement to 'footer'
    nodeA.data.placement = 'footer';
    
    const nodeC = new Node({ type: 'div', targetPlacements: ['footer'] }, null, 0);
    nodeC.receiveNextState = vi.fn();
    Node.sourcePlacements = { 'footer': [nodeC] };
    
    worker.push(nodeA, { placement: null });
    await worker.processQueue();

    expect(Node.placementArray.includes(nodeA)).toBe(true);
    expect(nodeC.receiveNextState).toHaveBeenCalled();
  });

  it('cascades updates and handles fallback placements when a primary placement is deleted', async () => {
    // nodeA provides 'header' placement. nodeB targets 'header', with a fallback of 'content'
    nodeA.data.placement = 'header';
    nodeB.data.targetPlacements = ['header', 'content'];
    
    Node.placementArray = [nodeA];
    Node.sourcePlacements = { 'header': [nodeB] };
    
    // Simulate header placement being removed from the tree
    nodeA.data.placement = null;
    nodeB.receiveNextState = vi.fn();
    
    worker.push(nodeA, { placement: 'header' });
    await worker.processQueue();
    
    // nodeB should receive a NextState update directing it to its fallback placement
    expect(nodeB.receiveNextState).toHaveBeenCalledWith(
      expect.objectContaining({ activePlacement: 'content' })
    );
  });
});
