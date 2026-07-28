// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Supervisor } from '../../../src/core/Supervisor';
import { Node } from '../../../src/core/Node';
import { clientAPI } from '../../../src/core/ClientAPI';

import { Template } from '../../../src/core/Template.js';
import { Payload } from '../../../src/core/Payload.js';
import { SSRTreeAssemblyWorker } from '../../../src/core/workers/SSRTreeAssemblyWorker.js';

describe('Integration: Atomic Rendering Pipeline', () => {
  beforeEach(() => {
    Supervisor.instance = null;
    Supervisor.currentStage = 'closed';
  });

  it('Scenario: SSR to string + JSON hydration seamlessly', async () => {
    const template = new Template({ root: { type: 'div', props: { id: 'app' }, placement: [{ placementName: 'root' }] } });
    const contentPayload = new Payload({ content: [{ type: 'span', props: { class: 'hydrated' } }] });
    
    // Simulate SSR Run
    await Supervisor.process({ 
      runInstantiation: true,
      runAssembly: true,
      runRendering: true,
      runMonitoring: true
    }, template, contentPayload);

    const rootNode = Supervisor.getRootNode();
    expect(rootNode).toBeDefined();
    expect(rootNode?.data.props.id).toBe('app');
    
    // Verify the separated SSR worker output
    const htmlString = SSRTreeAssemblyWorker.renderToString(rootNode as Node);
    expect(htmlString).toContain('id="app"');
    
    // Now simulate hydration by processing JSON again with render set to false
    // It should seamlessly merge without throwing away the root node
    const exportedJson = Supervisor.exportRootNode();
    const hydTemplate = new Template({ root: exportedJson as any });
    
    await Supervisor.process({ runValidation: true, runMonitoring: true }, hydTemplate, undefined);
    expect(Supervisor.getRootNode()?.data.props.id).toBe('app');
    expect(Supervisor.currentStage).toBe('monitoring');
  });

  it('Scenario: Content fetched after initial render (edit mode simulation)', async () => {
    // 1. Initial page load (SSR or Client) with layout template only
    const template = new Template({ 
      root: { 
        type: 'div', 
        children: [
          { type: 'main' }
        ] 
      }
    });
    
    await Supervisor.process({ 
      runInstantiation: true, 
      runAssembly: true,
      runRendering: true,
      runMonitoring: true
    }, template, undefined);
    
    const rootNode = Supervisor.getRootNode();
    expect(rootNode).toBeDefined();
    expect(rootNode?.type).toBe('div');

    // 2. Fetch editor payload (Edit Mode enabled)
    // ClientAPI constructs a NextState to apply to the tree rather than wiping it
    const editorPayload = new Payload({ 
      content: [{ type: 'EditorToolbar' }] // Adds a toolbar dynamically
    });
    
    await Supervisor.injectContent(editorPayload);
    
    // Wait for the decentralized event workers to settle
    await new Promise(resolve => setTimeout(resolve, 50));

    // The editor toolbar should be organically inserted without erasing 'main'
    // or dropping instantiated children.
    const allContentNodes = Supervisor.getContentNodes();
    const hasToolbar = allContentNodes.some((c: Node) => c.type === 'EditorToolbar');
    expect(hasToolbar).toBe(true);
    
    // Original content should still exist
    const updatedRootNode = Supervisor.getRootNode();
    expect(updatedRootNode?.type).toBe('div');
  });
});
