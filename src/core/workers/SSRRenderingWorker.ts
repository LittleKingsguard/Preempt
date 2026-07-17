import { Node } from "../Node.js";

export class SSRRenderingWorker {
  public static renderToString(node: Node): string {
    if (!node.isValid) return "";

    const tag = node.type || "div";
    let attributes = "";

    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        const escapedValue = String(value).replace(/"/g, '&quot;');
        attributes += ` ${key}="${escapedValue}"`;
      }
    }

    if (node.handlers) {
      for (const [key, value] of Object.entries(node.handlers)) {
        const eventName = key.startsWith('on') ? key.toLowerCase() : `on${key.toLowerCase()}`;
        const handlerBody = typeof value === 'object' && value !== null && 'body' in value ? (value as any).body : String(value);
        const trimmedValue = String(handlerBody).trim();
        let jsCode = trimmedValue;
        if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
          jsCode = `(${trimmedValue})(event, { node: null, metadata: null, rootNode: null })`;
        }
        const escapedValue = jsCode.replace(/"/g, '&quot;');
        attributes += ` ${eventName}="${escapedValue}"`;
      }
    }

    if (node.css) {
      if (node.css.id) attributes += ` id="${node.css.id}"`;
      if (node.css.classes && node.css.classes.length > 0) {
        attributes += ` class="${node.css.classes.join(" ")}"`;
      }
      if (node.css.style) {
        const styleStr = Object.entries(node.css.style)
          .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v}`)
          .join("; ");
        if (styleStr) attributes += ` style="${styleStr}"`;
      }
    }

    let innerHTML = "";
    if (node.content !== undefined) {
      innerHTML += node.content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    for (const child of node.children) {
      innerHTML += SSRRenderingWorker.renderToString(child);
    }

    const voidElements = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];
    if (voidElements.includes(tag.toLowerCase())) {
      return `<${tag}${attributes}>`;
    }

    return `<${tag}${attributes}>${innerHTML}</${tag}>`;
  }

  public static renderStyleNodesToString(styleNodes: any[]): string {
    let cssString = "";
    for (const sNode of styleNodes) {
      if (sNode.data && sNode.data.styles && sNode.data.selector) {
        const styles = Object.entries(sNode.data.styles)
          .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v};`)
          .join(" ");
        cssString += `${sNode.data.selector} { ${styles} }`;
      }
    }
    return cssString;
  }
}
