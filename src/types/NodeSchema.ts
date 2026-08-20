/**
 * CSS definition schema representing dynamic selectors and property declarations.
 *
 * @useCase Raw JSON data input passed to `StyleNode` constructor during instantiation to declare scoped CSS rules and pseudoclass selectors.
 * @processFlow Consumed during Phase 0 instantiation as data input for `StyleNode` class construction.
 */
export interface CssDef {
  selector: string;
  styles: Record<string, string>;
}

/**
 * Placement configuration schema for drop-zones and source targets.
 *
 * @useCase Raw JSON data input passed to `Placement` constructor during instantiation to define template drop-zones (`placementName`) or content placement requests (`targetPlacement`).
 * @processFlow Consumed during Phase 0 instantiation as data input for `Placement` class construction.
 */
export interface PlacementConfig {
  /** Name of the drop-zone offered by this node. */
  placementName?: string | undefined;
  /** Array of target drop-zone names requested by content. */
  targetPlacement?: string[] | undefined;
  /** Active placement slot name designated by TargetPlacementResolverWorker. */
  activePlacement?: string | undefined;
}

/**
 * Handler definition schema representing attached event handlers or pipeline lifecycle hooks.
 *
 * @useCase Raw JSON data input passed to `Handler` constructor during instantiation to define DOM event listeners or pipeline lifecycle hooks.
 * @processFlow Consumed during Phase 0 instantiation as data input for `Handler` class construction.
 */
export interface HandlerDef {
  name: string;
  event?: string | undefined;
  phase?: string | undefined;
  body: string;
}

/**
 * Component binding schema declaring payload injection references.
 *
 * @useCase Raw JSON data input passed to `Component` constructor during instantiation to bind reusable styling presets, event handlers, or structural JSON sub-trees to a node.
 * @processFlow Consumed during Phase 0 instantiation as data input for `Component` class construction.
 */
export interface ComponentBinding {
  /** Identifier reference matching a component stored in database or template payload. */
  reference: string;
  /** Target schema property path (e.g. 'css.style', 'handlers.click', or 'type'). */
  target?: string | undefined;
  /** Resolved value payload. */
  value?: string | HandlerDef | NodeData | NodeData[] | null | undefined;
}

/**
 * Version tracking entry for a node's historical state changes (Pending Implementation).
 *
 * @useCase Schema reserved for recording historical node state snapshots for future rollback, undo/redo, or version auditing.
 * @processFlow Currently pending full implementation in `Node`; designed to store snapshots in `NodeData.versions`.
 */
export interface NodeVersion {
  name?: string | undefined;
  timestamp: number;
  content?: string | undefined;
  children?: NodeData[] | undefined;
  props?: Record<string, any> | undefined;
  component?: ComponentBinding[] | undefined;
  css?: {
    id?: string | undefined;
    classes?: string[] | undefined;
    style?: Record<string, string> | undefined;
    cssDef?: CssDef[] | undefined;
  } | undefined;
}

/**
 * Fundamental JSON schema defining every Virtual DOM Node in Preempt.
 *
 * @useCase Raw JSON data input stored in database `Templates`, `Content`, and `Components`, passed to `Node` constructor during instantiation.
 * @processFlow Consumed by `InstantiationWorker` in Phase 0 as data input for OOP `Node` class object construction.
 */
export interface NodeData {
  type: string;
  placement?: PlacementConfig[] | undefined;
  component?: ComponentBinding[] | undefined;
  content?: string | undefined;
  children?: NodeData[] | undefined;
  props?: Record<string, any> | undefined;
  handlers?: HandlerDef[] | undefined;
  css?: {
    id?: string | undefined;
    classes?: string[] | undefined;
    style?: Record<string, string> | undefined;
    cssDef?: CssDef[] | undefined;
  } | undefined;
  versions?: NodeVersion[] | undefined;
}

/**
 * Complete template layout structure returned from the backend DB.
 *
 * @useCase Raw JSON data input passed to `Template` constructor during instantiation to form the page layout tree.
 * @processFlow Consumed as data input for `Template` class object construction and passed as `templateData` to `Supervisor.process()`.
 */
export interface TemplateData {
  root: NodeData;
  children?: NodeData[] | undefined;
  component?: ComponentBinding[] | undefined;
}

/**
 * Authenticated user profile state injected during Server-Side Rendering.
 *
 * @useCase User session payload injected into `ContentPayload.userData` and attached to `Supervisor.instance.userData`.
 * @processFlow Injected during server-side rendering setup to expose user profile data to frontend handlers and root content nodes.
 */
export interface UserData {
  username: string;
  email: string;
  isAdmin: boolean;
  isContributor: boolean;
  isShadowed: boolean;
  hasAuthenticated?: boolean;
}

/**
 * Content payload structure containing page content nodes and session metadata.
 *
 * @useCase Raw JSON data input passed to `Payload` constructor during instantiation to inject dynamic content nodes into layout placements.
 * @processFlow Consumed as data input for `Payload` class construction and passed to `Supervisor.process()` or `Supervisor.injectContent()`.
 */
export interface ContentPayload {
  metadata?: Record<string, any> | undefined;
  userData?: UserData | undefined;
  component?: ComponentBinding[] | undefined;
  content: NodeData[];
}

/**
 * Query criteria interface for searching and matching nodes within the Virtual DOM tree.
 *
 * @useCase Search query criteria dictionary passed to `node.findNode(query)` and `NodeQueryUtils.matches()`.
 * @processFlow Evaluated during tree traversal to match and retrieve specific UI nodes by type, class, ID, or component reference.
 */
export interface NodeQuery {
  type?: string | undefined;
  id?: string | undefined;
  classes?: string[] | undefined;
  props?: Record<string, any> | undefined;
  handlers?: Record<string, string> | undefined;
  style?: Record<string, string> | undefined;
  components?: { target?: string; reference?: string }[] | undefined;
  hasNonTypeTargetComponents?: boolean | undefined;
  format?: string | undefined;
}

export type LayerMode = 'replace' | 'append' | 'replaceAll';

export interface CompiledNodeState {
  type: string;
  props: any;
  css: any;
  content?: string | any;
  children: Node[];
  nativeChildren: Node[];
  handlers: any[];
  placement: any[];
  component?: any[] | undefined;
  isValid: boolean;
}

import type { Node } from "../core/node.js";
/** State update payload pushed to `Node._nextStateQueue`. */
export type NextState = Partial<Node> | Record<string, any>;
/** State snapshot payload saved for rollback operations. */
export type RollbackState = Partial<Node> | Record<string, any>;



