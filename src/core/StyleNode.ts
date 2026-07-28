import type { CssDef } from "../types/NodeSchema.js";
import { Node } from "./Node.js";

/**
 * Represents a CSS rule selector and declaration block (`CssDef`) dynamically inserted into browser CSSStyleSheets.
 *
 * @useCase Dynamic theme rule creation, scoped class styling, and runtime CSS modification without re-rendering HTML elements.
 * @processFlow Instantiated in Phase 6 (`ClientElementCreationWorker`), inserting rules into browser dynamic stylesheet objects.
 */
export class StyleNode {
  /** Global map of active selector string keys to StyleNode instances. */
  public static cssDefs: Map<string, StyleNode> = new Map();

  public data: CssDef;
  public parent: Node | null = null;
  public ruleIndex: number = -1;
  public sheet: CSSStyleSheet | null = null;

  /**
   * Constructs a new StyleNode.
   *
   * @param data CssDef rule payload.
   * @param parent Host Node instance.
   */
  constructor(data: CssDef, parent: Node | null = null) {
    this.data = data;
    this.parent = parent;
    StyleNode.append(this);
  }

  /**
   * Clones this StyleNode.
   *
   * @param parent Host Node instance.
   * @returns Cloned StyleNode instance.
   */
  public clone(parent: Node | null = null): StyleNode {
    return new StyleNode(this.data, parent);
  }

  /**
   * Registers a StyleNode into global cssDefs map.
   *
   * @param node Target StyleNode instance.
   */
  public static append(node: StyleNode): void {
    const existing = StyleNode.cssDefs.get(node.data.selector);
    if (existing) {
      if (Node.generateObjectHash(existing.data) !== Node.generateObjectHash(node.data)) {
        console.warn(`StyleNode overwrite alert: Definition for selector ${node.data.selector} is being overwritten with different data.`);
      }
    }
    StyleNode.cssDefs.set(node.data.selector, node);
  }

  /** Clears all static cssDefs tracking entries. */
  public static clear(): void {
    StyleNode.cssDefs.clear();
  }

  /**
   * Inserts this CSS rule into a browser `CSSStyleSheet` object.
   *
   * @param sheet Target browser CSSStyleSheet instance.
   */
  public render(sheet: CSSStyleSheet): void {
    this.sheet = sheet;
    const styles = Object.entries(this.data.styles)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v};`)
      .join(" ");
    const rule = `${this.data.selector} { ${styles} }`;
    
    // Insert rule and save its index
    this.ruleIndex = sheet.insertRule(rule, sheet.cssRules.length);
  }

  /**
   * Removes this CSS rule from the browser stylesheet and unregisters selector key.
   */
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

  /**
   * Updates CSS rule styles and re-renders stylesheet rule.
   *
   * @param newData Partial CssDef payload overrides.
   */
  public modify(newData: Partial<CssDef>): void {
    this.data = { ...this.data, ...newData };
    if (this.sheet && this.ruleIndex >= 0) {
      const activeSheet = this.sheet;
      this.delete();
      this.render(activeSheet);
    }
  }

  /**
   * Validates selector and styles properties.
   *
   * @returns `true` if valid, `false` otherwise.
   */
  public validate(): boolean {
    if (!this.data.selector || typeof this.data.selector !== "string") return false;
    if (!this.data.styles || typeof this.data.styles !== "object") return false;
    return true;
  }

  /**
   * Exports clean CssDef JSON structure.
   *
   * @returns Clean CssDef object.
   */
  public exportToJson(): CssDef {
    const exported: any = { ...this.data };
    delete exported.parent;
    return exported as CssDef;
  }
}

