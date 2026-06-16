import type { CssDef } from "../types/NodeSchema.js";
import type { Node } from "./Node.js";

export class StyleNode {
  public static cssDefs: StyleNode[] = [];

  public data: CssDef;
  public parent: Node | null = null;
  public ruleIndex: number = -1;
  public sheet: CSSStyleSheet | null = null;
  public isComponentInjected: boolean = false;

  constructor(data: CssDef, parent: Node | null = null, isComponentInjected: boolean = false) {
    this.data = data;
    this.parent = parent;
    this.isComponentInjected = isComponentInjected;
    StyleNode.append(this);
  }

  public static append(node: StyleNode): void {
    StyleNode.cssDefs.push(node);
  }

  public static clear(): void {
    StyleNode.cssDefs = [];
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

  public renderToString(): string {
    const styles = Object.entries(this.data.styles)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v};`)
      .join(" ");
    return `${this.data.selector} { ${styles} }`;
  }

  public delete(): void {
    const deletedIndex = this.ruleIndex;
    const sheetRef = this.sheet;

    if (this.sheet && this.ruleIndex >= 0) {
      this.sheet.deleteRule(this.ruleIndex);
      this.sheet = null;
      this.ruleIndex = -1;
    }

    const index = StyleNode.cssDefs.indexOf(this);
    if (index > -1) {
      StyleNode.cssDefs.splice(index, 1);
    }

    if (sheetRef && deletedIndex >= 0) {
      for (const node of StyleNode.cssDefs) {
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
