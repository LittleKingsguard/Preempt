import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Node } from '../../../src/core/Node.js';
import { Placement } from '../../../src/core/Placement.js';
import { Component } from '../../../src/core/Component.js';
import { TargetPlacementResolverWorker } from '../../../src/core/workers/TargetPlacementResolverWorker.js';
import { PlacementAssemblyWorker } from '../../../src/core/workers/PlacementAssemblyWorker.js';
import { ComponentAssemblyWorker } from '../../../src/core/workers/ComponentAssemblyWorker.js';
import { SlotAssemblyWorker } from '../../../src/core/workers/SlotAssemblyWorker.js';
import { Supervisor } from '../../../src/core/Supervisor.js';
import { Template } from '../../../src/core/Template.js';
import { PhaseRegistry } from '../../../src/core/PhaseRegistry.js';

describe('Loop Detection Test Suite', () => {
  beforeEach(() => {
    Placement.clearPlacements();
    Component.nodeCache.clear();
  });

  it('Scenario 1: Placement populating with a node that contains its own placement name', () => {
    const hostNode = new Node({ type: 'div', placement: [{ placementName: 'slot1' }] }, null, 0);
    const contentNode = new Node({
      type: 'article',
      placement: [{ targetPlacement: ['slot1'], placementName: 'slot1' }]
    }, null, 0);

    const hostPlacement = hostNode.placement![0];
    const placedChild = hostPlacement.placeInto(contentNode);

    // Placed child placementName should be cleared to undefined by loop safeguard
    expect(placedChild.placement![0].placementName).toBeUndefined();
  });

  it('Scenario 2: Placement populating with a node where a descendant contains its own placement name', () => {
    const hostNode = new Node({ type: 'div', placement: [{ placementName: 'slot1' }] }, null, 0);
    const contentNode = new Node({
      type: 'article',
      placement: [{ targetPlacement: ['slot1'] }],
      children: [
        {
          type: 'section',
          placement: [{ placementName: 'slot1' }]
        }
      ]
    }, null, 0);

    const hostPlacement = hostNode.placement![0];
    const placedChild = hostPlacement.placeInto(contentNode);
    const descendant = placedChild.children[0];

    // Descendant placementName should be cleared to undefined by loop safeguard
    expect(descendant.placement![0].placementName).toBeUndefined();
  });

  it('Scenario 3: Descendant is itself placed into a different placement name', () => {
    const hostRoot = new Node({
      type: 'main',
      placement: [{ placementName: 'slot1' }],
      children: [
        {
          type: 'aside',
          placement: [{ placementName: 'slot2' }]
        }
      ]
    }, null, 0);

    const hostSlot1 = hostRoot.placement![0];
    const hostSlot2 = hostRoot.nativeChildren[0].placement![0];

    const content1 = new Node({
      type: 'div',
      placement: [{ targetPlacement: ['slot1'] }]
    }, null, 0);

    const content2 = new Node({
      type: 'section',
      placement: [{ targetPlacement: ['slot2'] }],
      children: [
        {
          type: 'span',
          placement: [{ placementName: 'slot1' }]
        }
      ]
    }, null, 0);

    hostSlot1.placeInto(content1);
    const placedContent2 = hostSlot2.placeInto(content2);
    const descendantSpan = placedContent2.children[0];

    // Descendant span placementName matching root slot1 should be set to undefined
    expect(descendantSpan.placement![0].placementName).toBeUndefined();
  });

  it('Scenario 4: Component is injected with the repeat placement name', () => {
    const hostNode = new Node({ type: 'div', placement: [{ placementName: 'slot1' }] }, null, 0);
    const hostPlacement = hostNode.placement![0];

    const contentNode = new Node({
      type: 'article',
      placement: [{ targetPlacement: ['slot1'] }],
      component: [
        {
          reference: 'RepeatSlotComp',
          target: 'type',
          value: {
            type: 'div',
            placement: [{ placementName: 'slot1' }]
          }
        }
      ]
    }, null, 0);

    const placedChild = hostPlacement.placeInto(contentNode);
    const compBinding = placedChild.component![0];
    const instantiatedNode = compBinding.instantiatedNode;

    expect(instantiatedNode).toBeDefined();
    // Injected component node placementName should be set to undefined due to host ancestor having slot1
    expect(instantiatedNode!.placement![0].placementName).toBeUndefined();
  });

  it('Scenario 5: A component injects a descendant that injects a type or children component that resolves to the original', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Component CompA injects a child that references CompA again
    const compAData = {
      reference: 'CompA',
      target: 'type',
      value: {
        type: 'div',
        children: [
          {
            type: 'span',
            component: [{ reference: 'CompA', target: 'type' }]
          }
        ]
      }
    };

    const hostNode = new Node({
      type: 'section',
      component: [compAData]
    }, null, 0, true);

    const assemblyWorker = new ComponentAssemblyWorker(Supervisor.instance!);
    
    // Process hostNode (applies CompA)
    await assemblyWorker['processNode'](hostNode);
    expect(hostNode.type).toBe('div');

    // Child node generated from CompA template
    const childSpan = hostNode.children[0];
    expect(childSpan).toBeDefined();
    expect(childSpan.component).toBeDefined();

    // Process childSpan through assemblyWorker (should trigger loop safeguard and terminate)
    await assemblyWorker['processNode'](childSpan);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ComponentAssemblyWorker] Loop safeguard: Component \'CompA\' has already been applied by an ancestor node')
    );

    errorSpy.mockRestore();
  });

  it('Scenario 6: Component loop involving a placement allows resolution across placement boundary', async () => {
    const compData = {
      reference: 'SlotCompA',
      target: 'type',
      value: {
        type: 'div',
        placement: [{ placementName: 'slotX' }]
      }
    };

    // Template node has SlotCompA component
    const templateNode = new Node({
      type: 'section',
      component: [compData]
    }, null, 0, true);

    // Floating content node has targetPlacement slotX AND component SlotCompA
    const contentNode = new Node({
      type: 'p',
      placement: [{ targetPlacement: ['slotX'] }],
      component: [compData]
    }, null, 0, true);

    // 1. Component assembly on templateNode (creates slotX)
    const compWorker = new ComponentAssemblyWorker(Supervisor.instance!);
    await compWorker['processNode'](templateNode);

    // 2. Target placement resolution & assembly (places contentNode into templateNode's slotX)
    const resolverWorker = new TargetPlacementResolverWorker(Supervisor.instance!);
    await resolverWorker['processNode'](contentNode);

    const placementWorker = new PlacementAssemblyWorker(Supervisor.instance!);
    await placementWorker['processNode'](templateNode);

    // Verify contentNode is now placed inside templateNode via placement
    expect(templateNode.children.length).toBeGreaterThan(0);
    const placedContent = templateNode.children[0];

    // 3. Component assembly on placedContent resolves because it crossed a placement boundary (not native children)
    await compWorker['processNode'](placedContent);

    // Component resolves on placedContent
    expect(placedContent.type).toBe('div');
    // Placement's own loop safeguard clears placementName to undefined on the injected node to prevent duplicate placement loops
    expect(placedContent.placement![0].placementName).toBeUndefined();
  });
});
