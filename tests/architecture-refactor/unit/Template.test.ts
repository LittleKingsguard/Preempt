import { describe, it, expect, beforeEach } from 'vitest';
import { Template } from '../../../src/core/Template.js';
import { Supervisor } from '../../../src/core/Supervisor.js';
import { Node } from '../../../src/core/Node.js';

describe('Template Class & Supervisor Integration', () => {
  beforeEach(() => {
    Supervisor.instance = null;
    Supervisor.currentStage = 'closed';
  });

  it('instantiates Template with root and children arrays', () => {
    const templateData = {
      root: { type: 'main', props: { id: 'main-root' } },
      children: [
        { type: 'div', placement: [{ targetPlacement: ['slot-1'] }], content: 'Unplaced Child 1' },
        { type: 'div', placement: [{ targetPlacement: ['slot-2'] }], content: 'Unplaced Child 2' }
      ]
    };

    const template = new Template(templateData);

    expect(template.root).toBeInstanceOf(Node);
    expect(template.root.type).toBe('main');
    expect(template.root.isInTree).toBe(true);

    expect(template.children.length).toBe(2);
    expect(template.children[0]).toBeInstanceOf(Node);
    expect(template.children[0].content).toBe('Unplaced Child 1');
    expect(template.children[0].isInTree).toBe(false);
    expect(template.children[1].content).toBe('Unplaced Child 2');
    expect(template.children[1].isInTree).toBe(false);
  });

  it('instantiates Template from raw NodeData, separating top-level children', () => {
    const nodeData = {
      type: 'section',
      props: { id: 'section-root' },
      children: [
        { type: 'header', content: 'Header' },
        { type: 'footer', content: 'Footer' }
      ]
    };

    const template = new Template(nodeData);

    expect(template.root.type).toBe('section');
    expect(template.root.isInTree).toBe(true);
    expect(template.children.length).toBe(2);
    expect(template.children[0].type).toBe('header');
    expect(template.children[0].isInTree).toBe(false);
    expect(template.children[1].type).toBe('footer');
    expect(template.children[1].isInTree).toBe(false);
  });

  it('forces templateData to exist as Template on Supervisor instance and registers unplaced children in contentNodes', async () => {
    const rawTemplateData = {
      type: 'div',
      props: { id: 'app' },
      children: [
        { type: 'aside', content: 'Sidebar Content', placement: [{ targetPlacement: ['sidebar-slot'] }] }
      ]
    };

    await Supervisor.process({ runInstantiation: true, runMonitoring: true }, rawTemplateData);

    expect(Supervisor.instance).not.toBeNull();
    expect(Supervisor.instance!.templateData).toBeInstanceOf(Template);
    expect(Supervisor.instance!.rootNode).toBe(Supervisor.instance!.templateData.root);
    expect(Supervisor.instance!.rootNode?.type).toBe('div');

    const contentNodes = Supervisor.getContentNodes();
    expect(contentNodes.length).toBeGreaterThanOrEqual(1);
    const sidebarChild = contentNodes.find(n => n.type === 'aside');
    expect(sidebarChild).toBeDefined();
    expect(sidebarChild?.content).toBe('Sidebar Content');
  });

  it('appends template components to the root node during construction', () => {
    const templateData = {
      root: { type: 'main', props: { id: 'main-root' } },
      children: [{ type: 'span', content: 'Child' }],
      component: [
        { reference: 'navBarComponent', target: 'content' }
      ]
    };

    const template = new Template(templateData);

    expect(template.component.length).toBe(1);
    expect(template.component[0].reference).toBe('navBarComponent');
    expect(template.root.component).toBeDefined();
    expect(template.root.component?.some(c => c.reference === 'navBarComponent')).toBe(true);

    const json = template.exportToJson();
    expect(json.component).toBeDefined();
    expect(json.component?.[0].reference).toBe('navBarComponent');
  });
});
