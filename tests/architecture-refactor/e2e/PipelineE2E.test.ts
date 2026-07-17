// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Supervisor } from '../../../src/core/Supervisor';
import { Node } from '../../../src/core/Node';

import { SSRRenderingWorker } from '../../../src/core/workers/SSRRenderingWorker.js';

describe('E2E: Pipeline Stage Configurations (Atomic Architecture)', () => {
  beforeEach(() => {
    Supervisor.instance = null;
    Supervisor.currentStage = 'closed';
  });

  it('Scenario 4.1.1: Server-Side Assembly, Validation, and Rendering (SSR Output)', async () => {
    const serverConfig = {
      runInstantiation: true,
      runAssembly: true,
      runPreprocessing: true,
      runValidation: true,
      runRendering: true,
      runPostprocessing: true,
      runMonitoring: true
    };
    
    const templateData = { type: 'div', props: { id: 'ssr-root' } };
    
    await Supervisor.process(serverConfig, templateData, undefined);
    
    // Everything was run on the server. The node should be fully processed.
    expect(Supervisor.currentStage).toBe('monitoring');
    
    const rootNode = Supervisor.getRootNode();
    expect(rootNode).toBeDefined();
    
    const html = SSRRenderingWorker.renderToString(rootNode as Node);
    expect(html).toContain('id="ssr-root"');
    
    // In actual implementation, we would verify the generated clientConfig inside 
    // the `<script id="preempt-initial-data">` has runAssembly: false, etc.
  });

  it('Scenario 4.2.1: Client-Side Hydrated Assembly Pipeline', async () => {
    const clientConfig = {
      runInstantiation: true,
      runAssembly: true,
      runValidation: true,
      runRendering: true,
      runMonitoring: true
    };
    
    // The server only instantiated, now client is running the rest
    const rawExport = { type: 'div', props: { class: 'csr-only' } };
    
    // Simulate client side execution triggering the decentralized workers
    await Supervisor.process(clientConfig, rawExport, undefined);
    
    expect(Supervisor.currentStage).toBe('monitoring');
    expect(Supervisor.getRootNode()?.data.props.class).toBe('csr-only');
  });

  it('Scenario 3.2.2: Handlers Crashing Bubble Protection in Worker Context', async () => {
    // We attach a crashing lifecycle handler to the template
    const templateData = { 
      type: 'div',
      handlers: {
        afterAssembly: 'nonExistentVar.foo()' // Will crash
      }
    };
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // The ComponentAssemblyWorker (or equivalent) should execute handlers via the Node.
    // The Node should catch this script failure gracefully without halting the pipeline.
    await Supervisor.process({
      runInstantiation: true,
      runAssembly: true,
      runMonitoring: true
    }, templateData, undefined);
    
    expect(consoleSpy).toHaveBeenCalled();
    // The pipeline finishes successfully despite the handler crash
    expect(Supervisor.currentStage).toBe('monitoring');
    
    consoleSpy.mockRestore();
  });
});
