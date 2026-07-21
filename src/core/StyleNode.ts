import type { CssDef } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { CloneUtils } from "./utils/CloneUtils.js";

export class StyleNode {
  public static cssDefs: Map<string, StyleNode> = new Map();

  public data: CssDef;
  public parent: Node | null = null;
  public ruleIndex: number = -1;
  public sheet: CSSStyleSheet | null = null;
  constructor(data: CssDef, parent: Node | null = null) {
    this.data = data;
    this.parent = parent;
    StyleNode.append(this);
  }

  public clone(parent: Node | null = null): StyleNode {
    return new StyleNode(CloneUtils.deepClone(this.data), parent);
  }

  public static append(node: StyleNode): void {
    const existing = StyleNode.cssDefs.get(node.data.selector);
    if (existing) {
      if (Node.generateObjectHash(existing.data) !== Node.generateObjectHash(node.data)) {
        console.warn(`StyleNode overwrite alert: Definition for selector ${node.data.selector} is being overwritten with different data.`);
      }
    }
    StyleNode.cssDefs.set(node.data.selector, node);
  }

  public static clear(): void {
    StyleNode.cssDefs.clear();
  }

  public render(sheet: CSSStyleSheet): void {
    this.sheet = sheet;
    const styles = Object.entries(this.data.styles)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v};`)
      .join(" ");
    const rule = `${this.data.selector} { ${styles} }`;
    
    // Insert rule and save its index
    this.ruleIndex = sheet.insertRule(rule, sheet.cssRules.length);
  }

  public delete(): void {
    const deletedIndex = this.ruleIndex;
    const sheetRef = this.sheet;

    if (this.sheet && this.ruleIndex >= 0) {
      this.sheet.deleteRule(this.ruleIndex);
      this.sheet = null;
      this.ruleIndex = -1;
    }

    if (StyleNode.cssDefs.get(this.data.selector) === this) {
      StyleNode.cssDefs.delete(this.data.selector);
    }

    if (sheetRef && deletedIndex >= 0) {
      for (const node of StyleNode.cssDefs.values()) {
        if (node.sheet === sheetRef && node.ruleIndex > deletedIndex) {
          node.ruleIndex--;
        }
      }
    }
  }

  public modify(newData: Partial<CssDef>): void {
    this.data = { ...this.data, ...newData };
    if (this.sheet && this.ruleIndex >= 0) {
      const activeSheet = this.sheet;
      this.delete();
      this.render(activeSheet);
    }
  }

  public validate(): boolean {
    if (!this.data.selector || typeof this.data.selector !== "string") return false;
    if (!this.data.styles || typeof this.data.styles !== "object") return false;
    return true;
  }

  public exportToJson(): CssDef {
    const exported: any = { ...this.data };
    delete exported.parent;
    return exported as CssDef;
  }
}
