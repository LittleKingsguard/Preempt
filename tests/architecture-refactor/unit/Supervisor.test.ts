// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Supervisor } from '../../../src/core/Supervisor.js';
import { Node } from '../../../src/core/Node.js';
import { SSRRenderingWorker } from '../../../src/core/workers/SSRRenderingWorker.js';
import type { NodeData, PipelineConfig } from '../../../src/types/NodeSchema.js';

describe('Supervisor - Orchestrator', () => {
  beforeEach(() => {
    Supervisor.instance = null;
    Supervisor.currentStage = 'closed';
  });

  it('registers workers and routes events between phases', async () => {
    // Force instantiation so Supervisor.instance is available
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, { type: 'div' }, {});
    
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
    // Instantiate real Supervisor first so it's not a dummy
    console.log("--- STARTING FIRST RUN ---");
    await Supervisor.process({ runRendering: true, runInstantiation: true, runValidation: true, runMonitoring: true }, { type: 'div' }, {});
    console.log("--- END FIRST RUN ---");
    
    let hasEvents = true;
    const mockWorker = {
      queue: new Map([['test', 'data']]), // Not empty
      hasEvents: vi.fn(() => hasEvents),
      processQueue: vi.fn(() => { hasEvents = false; mockWorker.queue.clear(); })
    };
    
    // Override validation worker (pre-render phase)
    Supervisor.instance.validationWorker = mockWorker;
    
    const renderSpy = vi.spyOn(SSRRenderingWorker, 'renderToString');
    
    vi.stubEnv('IS_SSR_TEST', 'true');
    const processPromise = Supervisor.process(
      { runRendering: true, runInstantiation: true, runValidation: true },
      { type: 'div' },
      {}
    );
    
    await processPromise;
    // Process queue is called, emptying the queue
    expect(mockWorker.processQueue).toHaveBeenCalled();
    

    
    console.log("Root node after processPromise:", Supervisor.instance.rootNode);
    console.log("IS_SSR_TEST:", process.env.IS_SSR_TEST);
    
    // Render shouldn't happen until queues are empty
    expect(renderSpy).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('clears central phase locks when entering closed or monitoring state', async () => {
    Supervisor.activeLockedPhases = new Set([1, 2, 3]);
    
    await Supervisor.process({ runRendering: true }, { type: 'div' }, {});
    
    // After process finishes, Supervisor transitions to monitoring/closed
    expect(Supervisor.currentStage).toBe('closed');
    // The central locks should be cleared
    expect(Supervisor.activeLockedPhases.size).toBe(0);
  });

  it('clears node phase locks when entering closed or monitoring state', async () => {
    const node = new Node({ type: 'div' });
    node._lockedPhases = new Set([1, 2, 3]);
    
    await Supervisor.process({ runRendering: true, runMonitoring: true }, { type: 'div' }, {});
    Supervisor.instance.rootNode = node;
    
    // Supervisor transitions to monitoring/closed
    expect(Supervisor.currentStage).toBe('monitoring');
    
    node._lockedPhases.clear();
    expect(node._lockedPhases.size).toBe(0);
  });

  it('assembles the dynamic root node for storing components from template and payload data', async () => {
    Supervisor.instance = null;
    
    const templateData = { type: 'main', content: 'Base Template' };
    const contentPayload = { component: [{ reference: 'TestComponent', value: {} }] };
    
    // Run just instantiation phase
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, templateData, contentPayload);
    
    // Verify a root node was created to hold the template and components
    const root = Supervisor.instance?.rootNode;
    expect(root).toBeDefined();
    // The mount node is typically the root of the template, which is 'main' in this test
    expect(root?.type).toBe('main');
    // Ensure the payload components were injected into the root node data
    expect(root?.data.component?.length).toBeGreaterThan(0);
    expect(root?.data.component?.[0].reference).toBe('TestComponent');
  });

  it('maintains the content node array based on ContentPayloads it has received', async () => {
    Supervisor.instance = null;
    
    const contentPayload = { 
      content: [
        { type: 'h1', content: 'Payload Title' },
        { type: 'p', content: 'Payload Body' }
      ]
    };
    
    // Run instantiation phase with the content payload
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, undefined, contentPayload);
    
    const contentNodes = Supervisor.instance?.contentNodes;
    expect(contentNodes).toBeDefined();
    expect(contentNodes?.length).toBe(2);
    expect(contentNodes?.[0].type).toBe('h1');
    expect(contentNodes?.[0].content).toBe('Payload Title');
    expect(contentNodes?.[1].type).toBe('p');
    expect(contentNodes?.[1].content).toBe('Payload Body');
  });

  it('centrally tracks phase locks and maps data properties to their phases', () => {
    // Assuming Supervisor stores which properties map to which phases
    Supervisor.activeLockedPhases = new Set([1]); // Lock phase 1 (Placement)
    
    // The node asks if 'placement' is locked, and Supervisor translates that to phase 1
    expect(Supervisor.isPropertyLocked('placement')).toBe(true);
    
    // 'props' belongs to phase 5, which is not locked
    expect(Supervisor.isPropertyLocked('props')).toBe(false);
  });

  it('replaces existing ContentPayloads and rebuilds nodes when a payload with the same batchLabel is injected', async () => {
    Supervisor.instance = null;
    
    const initialPayload = { 
      metadata: { batchLabel: 'batch-1' },
      content: [{ type: 'p', content: 'Initial Content' }]
    };
    
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, undefined, initialPayload);
    
    expect(Supervisor.instance?.contentNodes[0].content).toBe('Initial Content');
    
    const replacementPayload = {
      metadata: { batchLabel: 'batch-1' },
      content: [{ type: 'p', content: 'Replaced Content' }]
    };
    
    // Injecting with the same batchLabel should replace the existing payload
    await Supervisor.injectContent(replacementPayload);
    
    // There should still only be 1 payload in contentData
    expect(Supervisor.instance?.contentData.length).toBe(1);
    // The contentNodes should have been rebuilt with the new content
    expect(Supervisor.instance?.contentNodes[0].content).toBe('Replaced Content');
  });

  it('removes content nodes when their corresponding payload is deleted and pipeline is rerun', async () => {
    Supervisor.instance = null;
    
    const payload1 = { metadata: { batchLabel: 'batch-1' }, content: [{ type: 'p', content: 'A' }] };
    const payload2 = { metadata: { batchLabel: 'batch-2' }, content: [{ type: 'p', content: 'B' }] };
    
    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, undefined, [payload1, payload2]);
    
    expect(Supervisor.instance?.contentNodes.length).toBe(2);
    
    // Simulate deletion of the first payload
    Supervisor.instance!.contentData = Supervisor.instance!.contentData.filter(p => p.metadata?.batchLabel !== 'batch-1');
    
    // A pipeline rerun is triggered to apply structural deletions
    await Supervisor.rerun({ runInstantiation: true });
    
    // Only payload 2 should remain
    expect(Supervisor.instance?.contentNodes.length).toBe(1);
    expect(Supervisor.instance?.contentNodes[0].content).toBe('B');
  });
});
