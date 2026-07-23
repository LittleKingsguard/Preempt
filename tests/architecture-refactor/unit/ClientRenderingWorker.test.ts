// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Node } from '../../../src/core/Node.js';
// We expect ClientRenderingWorker to be built at this path
import { ClientRenderingWorker } from '../../../src/core/workers/ClientRenderingWorker.js';

describe('ClientRenderingWorker', () => {
  let worker: ClientRenderingWorker;

  beforeEach(() => {
    worker = new ClientRenderingWorker(null as any);
  });

  it('bypasses rendering if document is undefined', () => {
    // Save original document
    vi.stubGlobal('document', undefined);

    const node = new Node({ type: 'div', props: { id: 'test' } }, null, 0);
    
    // Simulate what happens in a NodeJS environment
    // Assuming the static render method is exposed for testing
    const el = ClientRenderingWorker.render(node);

    expect(el).toBeNull();
    expect(node.element).toBeNull();

    // Restore document
    vi.unstubAllGlobals();
  });

  it('creates an HTMLElement based on node properties and css', () => {
    const node = new Node({ 
      type: 'span', 
      props: { 'data-test': 'value' },
      css: { id: 'my-span', classes: ['foo', 'bar'], style: { color: 'red' } },
      content: 'Hello World'
    }, null, 0);

    const el = ClientRenderingWorker.render(node);

    expect(el).toBeInstanceOf(window.HTMLElement);
    expect(el?.tagName.toLowerCase()).toBe('span');
    expect(el?.id).toBe('my-span');
    expect(el?.classList.contains('foo')).toBe(true);
    expect(el?.classList.contains('bar')).toBe(true);
    expect(el?.getAttribute('data-test')).toBe('value');
    expect(el?.style.color).toBe('red');
    expect(el?.textContent).toBe('Hello World');
    
    // Node retains reference to element
    expect(node.element).toBe(el);
  });

  it('constructs a DOM tree that mirrors the Node children tree', () => {
    const rootNode = new Node({ type: 'div' }, null, 0);
    const childNode1 = new Node({ type: 'p', content: 'Child 1' }, rootNode, 0);
    const childNode2 = new Node({ type: 'span', content: 'Child 2' }, rootNode, 0);
    rootNode.children = [childNode1, childNode2];

    const rootEl = ClientRenderingWorker.render(rootNode);

    expect(rootEl?.children.length).toBe(2);
    expect(rootEl?.children[0].tagName.toLowerCase()).toBe('p');
    expect(rootEl?.children[0].textContent).toBe('Child 1');
    expect(rootEl?.children[1].tagName.toLowerCase()).toBe('span');
    expect(rootEl?.children[1].textContent).toBe('Child 2');
  });

  it('cleans up old unneeded child elements when nodes are removed', () => {
    const rootNode = new Node({ type: 'div' }, null, 0);
    const childNode1 = new Node({ type: 'p', content: 'Child 1' }, rootNode, 0);
    rootNode.children = [childNode1];

    const rootEl = ClientRenderingWorker.render(rootNode);
    expect(rootEl?.children.length).toBe(1);

    // Remove child from node structure and re-render
    rootNode.children = [];
    rootNode.hasChangedSinceRender = true;
    ClientRenderingWorker.render(rootNode);

    // The physical DOM should now have 0 children
    expect(rootEl?.children.length).toBe(0);
  });
  
  it('updates an existing element rather than recreating it if the tag matches', () => {
    const node = new Node({ type: 'div', props: { class: 'old' } }, null, 0);
    const el1 = ClientRenderingWorker.render(node);
    
    // Modify node
    node.data.props!.class = 'new';
    if (node.props) node.props.class = 'new';
    node.hasChangedSinceRender = true;
    
    const el2 = ClientRenderingWorker.render(node);
    
    // Should be the exact same DOM instance
    expect(el1).toBe(el2);
    expect(el2?.getAttribute('class')).toBe('new');
  });
});
