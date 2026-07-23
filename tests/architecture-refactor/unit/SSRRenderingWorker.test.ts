import { describe, it, expect } from 'vitest';
import { Node } from '../../../src/core/Node.js';
// We expect SSRRenderingWorker to be built at this path
import { SSRRenderingWorker } from '../../../src/core/workers/SSRRenderingWorker.js';

describe('SSRRenderingWorker', () => {
  it('serializes a basic node with properties and CSS into a standard HTML string', () => {
    const node = new Node({
      type: 'div',
      props: { 'data-test': 'hello', role: 'button' },
      css: { id: 'container', classes: ['flex', 'bold'], style: { display: 'flex', color: 'red' } },
      content: 'Click Me'
    }, null, 0);

    const html = SSRRenderingWorker.renderToString(node);

    expect(html).toContain('<div');
    expect(html).toContain('data-test="hello"');
    expect(html).toContain('role="button"');
    expect(html).toContain('id="container"');
    expect(html).toContain('class="flex bold"');
    expect(html).toContain('style="display: flex; color: red"');
    expect(html).toContain('>Click Me</div>');
  });

  it('properly escapes quotes in attributes to prevent HTML injection', () => {
    const node = new Node({
      type: 'div',
      props: { 'data-malicious': 'this has "quotes" inside' }
    }, null, 0);

    const html = SSRRenderingWorker.renderToString(node);
    
    expect(html).toContain('data-malicious="this has &quot;quotes&quot; inside"');
  });

  it('safely escapes angle brackets in content', () => {
    const node = new Node({
      type: 'div',
      content: '<script>alert("hacked")</script>'
    }, null, 0);

    const html = SSRRenderingWorker.renderToString(node);
    
    // Content should be escaped for HTML output
    expect(html).toContain('&lt;script&gt;alert("hacked")&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('handles HTML5 void elements without generating closing tags', () => {
    const imgNode = new Node({ type: 'img', props: { src: 'test.png', alt: 'test image' } }, null, 0);
    const inputNode = new Node({ type: 'input', props: { type: 'text' } }, null, 0);

    const imgHtml = SSRRenderingWorker.renderToString(imgNode);
    const inputHtml = SSRRenderingWorker.renderToString(inputNode);

    expect(imgHtml).toMatch(/<img src="test.png" alt="test image" id="preempt-node-[a-z0-9]+">/); // Self closing
    expect(inputHtml).toMatch(/<input type="text" id="preempt-node-[a-z0-9]+">/);
    expect(imgHtml).not.toContain('</img>');
    expect(inputHtml).not.toContain('</input>');
  });

  it('recursively serializes deep trees', () => {
    const root = new Node({ type: 'main' }, null, 0);
    const child1 = new Node({ type: 'header', content: 'Header' }, root, 0);
    const child2 = new Node({ type: 'section' }, root, 0);
    const subChild = new Node({ type: 'p', content: 'Paragraph' }, child2, 0);
    
    root.children = [child1, child2];
    child2.children = [subChild];

    const html = SSRRenderingWorker.renderToString(root);

    expect(html).toMatch(/<main id="preempt-node-[a-z0-9]+"><header id="preempt-node-[a-z0-9]+">Header<\/header><section id="preempt-node-[a-z0-9]+"><p id="preempt-node-[a-z0-9]+">Paragraph<\/p><\/section><\/main>/);
  });
});
