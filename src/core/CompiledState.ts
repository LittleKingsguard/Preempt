import type { CompiledNodeState } from "../types/NodeSchema.js";
import type { Node } from "./Node.js";
import type { Props } from "./Props.js";
import type { Css } from "./Css.js";
import type { Handler } from "./Handler.js";
import type { Placement } from "./Placement.js";
import type { Component } from "./Component.js";

/**
 * Class representing the evaluated compiled state of a Node instance.
 * Produced by full layer compilation (`Node.compile()`).
 *
 * @useCase Encapsulates all compiled node properties evaluated from base canon and active change layers.
 * @processFlow Instantiated in `Node.compile()`.
 */
export class CompiledState implements CompiledNodeState {
  public type: string;
  public props: Props;
  public css: Css;
  public content?: string | any;
  public children: Node[];
  public nativeChildren: Node[];
  public handlers: Handler[];
  public placement: Placement[];
  public component?: Component[];
  public isValid: boolean;

  constructor(init: {
    type: string;
    props: Props;
    css: Css;
    content?: string | any;
    children: Node[];
    nativeChildren: Node[];
    handlers: Handler[];
    placement: Placement[];
    component?: Component[];
    isValid: boolean;
  }) {
    this.type = init.type;
    this.props = init.props;
    this.css = init.css;
    this.content = init.content;
    this.children = init.children;
    this.nativeChildren = init.nativeChildren;
    this.handlers = init.handlers;
    this.placement = init.placement;
    this.component = init.component;
    this.isValid = init.isValid;
  }
}
