// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Supervisor } from '../../../src/core/Supervisor';
import { Node } from '../../../src/core/Node';
import { clientAPI } from '../../../src/core/ClientAPI';

import { SSRRenderingWorker } from '../../../src/core/workers/SSRRenderingWorker.js';

describe('Integration: Atomic Rendering Pipeline', () => {
  beforeEach(() => {
    Supervisor.instance = null;
    Supervisor.currentStage = 'closed';
  });

  it('Scenario: SSR to string + JSON hydration seamlessly', async () => {
    const templateData = { type: 'div', props: { id: 'app' }, placement: 'root' };
    const contentPayload = { props: { class: 'hydrated' } };
    
    // Simulate SSR Run
    await Supervisor.process({ 
      runInstantiation: true,
      runAssembly: true,
      runRendering: true,
      runMonitoring: true
    }, templateData, contentPayload);

    const rootNode = Supervisor.getRootNode();
    expect(rootNode).toBeDefined();
    expect(rootNode?.data.props.id).toBe('app');
    
    // Verify the separated SSR worker output
    const htmlString = SSRRenderingWorker.renderToString(rootNode as Node);
    expect(htmlString).toContain('id="app"');
    
    // Now simulate hydration by processing JSON again with render set to false
    // It should seamlessly merge without throwing away the root node
    const exportedJson = Supervisor.exportRootNode();
    
    await Supervisor.process({ runValidation: true, runMonitoring: true }, exportedJson, undefined);
    expect(Supervisor.getRootNode()?.data.props.id).toBe('app');
    expect(Supervisor.currentStage).toBe('monitoring');
  });

  it('Scenario: Content fetched after initial render (edit mode simulation)', async () => {
    // 1. Initial Page Load
    const templateData = { 
      type: 'div', 
      props: { id: 'layout' }, 
      content: [{ type: 'main', targetPlacements: ['content'] }] 
    };
    
    await Supervisor.process({ 
      runInstantiation: true, 
      runAssembly: true,
      runRendering: true,
      runMonitoring: true
    }, templateData, undefined);
    
    const rootNode = Supervisor.getRootNode();
    const mainNode = rootNode?.children[0];
    expect(mainNode?.data.type).toBe('main');

    // 2. Fetch editor payload (Edit Mode enabled)
    // ClientAPI constructs a NextState to apply to the tree rather than wiping it
    const editorNextState = { 
      content: [{ type: 'EditorToolbar' }] // Adds a toolbar dynamically
    };
    
    // Mock the network fetch
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => editorNextState
    });

    await clientAPI.fetchContent({ url: '/api/editor-payload', query: { format: 'content' }, batchLabel: 'test', placements: [] });
    
    // Wait for the decentralized event workers to settle
    await new Promise(resolve => setTimeout(resolve, 50));

    // The editor toolbar should be organically inserted without erasing 'main'
    // or dropping instantiated children.
    const updatedRootNode = Supervisor.getRootNode();
    const hasToolbar = updatedRootNode?.children.some((c: Node) => c.data.type === 'EditorToolbar');
    expect(hasToolbar).toBe(true);
    
    // Original content should still exist
    const hasMain = updatedRootNode?.children.some((c: Node) => c.data.type === 'main');
    expect(hasMain).toBe(true);
  });
});
