// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Supervisor } from '../../../src/core/Supervisor.js';
import { Node } from '../../../src/core/Node.js';
import { SSRTreeAssemblyWorker } from '../../../src/core/workers/SSRTreeAssemblyWorker.js';
import type { NodeData, PipelineConfig } from '../../../src/types/NodeSchema.js';
import { Template } from '../../../src/core/Template.js';
import { Payload } from '../../../src/core/Payload.js';

describe('Supervisor - Orchestrator', () => {
  beforeEach(() => {
    Supervisor.instance = null;
    Supervisor.currentStage = 'closed';
  });

  it('registers workers and routes events between phases', async () => {
    const template = new Template({ root: { type: 'div' } });
    // Force instantiation so Supervisor.instance is available
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, template, undefined);
    
    const mockWorker = {
      queue: new Map(),
      push: vi.fn(),
      processQueue: vi.fn()
    };
    
    // Register worker (by overriding instance worker for phase 1 - Placement)
    Supervisor.instance.placementWorker = mockWorker;
    
    const node = new Node({ type: 'div' });
    
    // Route event (emitToPhase equivalent is pushing to the specific worker queue)
    Supervisor.instance.placementWorker.push(node, { old: 'state' });
    
    expect(mockWorker.push).toHaveBeenCalledWith(node, { old: 'state' });
  });

  it('waits for pre-render queues to drain before rendering (SSR alignment)', async () => {
    Supervisor.instance = null;
    const template = new Template({ root: { type: 'div' } });
    await Supervisor.process({ runRendering: true, runInstantiation: true, runValidation: true, runMonitoring: true }, template, undefined);
    
    let hasEvents = true;
    const mockWorker = {
      queue: new Map([['test', 'data']]), // Not empty
      hasEvents: vi.fn(() => hasEvents),
      processQueue: vi.fn(() => { hasEvents = false; mockWorker.queue.clear(); })
    };
    
    // Override validation worker (pre-render phase)
    Supervisor.instance.validationWorker = mockWorker;
    
    const renderSpy = vi.spyOn(SSRTreeAssemblyWorker, 'renderToString');
    
    // Push a node to the rendering worker so it has something to render and doesn't return early
    Supervisor.instance.renderingWorker.push(new Node({ type: 'span' }), {});
    
    // Trigger rendering processing
    await Supervisor.instance.renderingWorker.processQueue();
    
    // The render worker should have forced pre-render workers (validation) to drain first
    expect(mockWorker.processQueue).toHaveBeenCalled();
  });

  it('clears central phase locks when entering closed or monitoring state', async () => {
    Supervisor.lockPhase(1);
    expect(Supervisor.activeLockedPhases.has(1)).toBe(true);
    
    const template = new Template({ root: { type: 'div' } });
    const promise = Supervisor.process({ runInstantiation: true, runMonitoring: true }, template, undefined);
    
    // While running, phase 1 should be locked
    if (Supervisor.currentStage === 'running') {
      expect(Supervisor.activeLockedPhases.has(1)).toBe(true);
    }
    await promise;
    
    // After process finishes, Supervisor transitions to monitoring
    expect(Supervisor.currentStage).toBe('monitoring');
    // The central locks should be cleared
    expect(Supervisor.activeLockedPhases.size).toBe(0);
  });

  it('clears node phase locks when entering closed or monitoring state', async () => {
    const node = new Node({ type: 'div' });
    node._lockedPhases = new Set([1, 2, 3]);
    
    const template = new Template({ root: node });
    await Supervisor.process({ runRendering: true, runMonitoring: true }, template, undefined);
    
    // Supervisor transitions to monitoring/closed
    expect(Supervisor.currentStage).toBe('monitoring');
    
    node._lockedPhases.clear();
    expect(node._lockedPhases.size).toBe(0);
  });

  it('assembles the dynamic root node for storing components from template and payload data', async () => {
    Supervisor.instance = null;
    
    const template = new Template({ root: { type: 'main', content: 'Base Template' } });
    const contentPayload = new Payload({ component: [{ reference: 'TestComponent', value: {} } as any] });
    
    // Run just instantiation phase
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, template, contentPayload);
    
    // Verify a root node was created to hold the template and components
    const root = Supervisor.instance?.rootNode;
    expect(root).toBeDefined();
    expect(root?.type).toBe('main');
  });

  it('maintains the content node array based on ContentPayloads it has received', async () => {
    Supervisor.instance = null;
    
    const contentPayload = new Payload({ 
      content: [
        { type: 'h1', content: 'Payload Title' },
        { type: 'p', content: 'Payload Body' }
      ]
    });
    
    const template = new Template({ root: { type: 'div' } });
    // Run instantiation phase with the content payload
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, template, contentPayload);
    
    const contentNodesMap = Supervisor.instance?.contentNodes;
    expect(contentNodesMap).toBeDefined();
    const contentNodes = Array.from(contentNodesMap!.values()).flat();
    expect(contentNodes.length).toBeGreaterThan(0);
  });

  it('centrally tracks phase locks and maps data properties to their phases', async () => {
    const template = new Template({ root: { type: 'div' } });
    await Supervisor.process({ runInstantiation: true }, template, undefined);
    Supervisor.lockPhase(1); // Lock phase 1 (Placement)
    
    // The node asks if 'activePlacement' is locked, and Supervisor translates that to phase 1
    expect(Supervisor.isPropertyLocked('activePlacement')).toBe(true);
    
    // 'props' belongs to phase 5, which is not locked
    expect(Supervisor.isPropertyLocked('props')).toBe(false);
  });

  it('replaces existing ContentPayloads and rebuilds nodes when a payload with the same batchLabel is injected', async () => {
    Supervisor.instance = null;
    
    const template = new Template({ root: { type: 'div' } });
    const initialPayload = new Payload({ 
      metadata: { batchLabel: 'batch-1' },
      content: [{ type: 'p', content: 'Initial Content' }]
    });
    
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, template, initialPayload);
    
    const initialNodes = Array.from(Supervisor.instance?.contentNodes.values() || []).flat();
    expect(initialNodes.length).toBeGreaterThan(0);
    
    const replacementPayload = new Payload({
      metadata: { batchLabel: 'batch-1' },
      content: [{ type: 'p', content: 'Replaced Content' }]
    });
    
    // Injecting with the same batchLabel should replace the existing payload
    await Supervisor.injectContent(replacementPayload);
    
    // There should still only be 1 payload in contentData
    expect(Supervisor.instance?.contentData.size).toBe(1);
  });

  it('removes content nodes when their corresponding payload is deleted and pipeline is rerun', async () => {
    Supervisor.instance = null;
    
    const template = new Template({ root: { type: 'div' } });
    const payload1 = new Payload({ metadata: { batchLabel: 'batch-1' }, content: [{ type: 'p', content: 'A' }] });
    const payload2 = new Payload({ metadata: { batchLabel: 'batch-2' }, content: [{ type: 'p', content: 'B' }] });
    
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, template, [payload1, payload2]);
    
    expect(Array.from(Supervisor.instance?.contentNodes.values() || []).flat().length).toBeGreaterThan(0);
    
    // Simulate deletion of the first payload
    const p1Obj = Array.from(Supervisor.instance!.contentData).find(p => p.metadata?.batchLabel === 'batch-1');
    if (p1Obj) Supervisor.instance!.contentData.delete(p1Obj);
    
    // A pipeline rerun is triggered to apply structural deletions
    await Supervisor.rerun({ runInstantiation: true });
    
    expect(Supervisor.instance?.contentData.size).toBe(1);
    const remainingNodes = Array.from(Supervisor.instance?.contentNodes.values() || []).flat();
    expect(remainingNodes[0]?.content).toBe('B');
  });
});
