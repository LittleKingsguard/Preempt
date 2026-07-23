export interface CssDef {
  selector: string;
  styles: Record<string, string>;
}



export interface PlacementConfig {
  placementName?: string | undefined;
  targetPlacement?: string[] | undefined;
}

export interface HandlerDef {
  name: string;
  event?: string | undefined;
  phase?: string | undefined;
  body: string;
}

export interface ComponentBinding {
  reference: string;
  target?: string | undefined;
  value?: string | HandlerDef | NodeData | NodeData[] | null | undefined;
}
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
  node?: any | undefined;
}

export interface TemplateData {
  root: NodeData;
  children?: NodeData[] | undefined;
  component?: ComponentBinding[] | undefined;
}

export interface UserData {
  username: string;
  email: string;
  isAdmin: boolean;
  isContributor: boolean;
  isShadowed: boolean;
  hasAuthenticated?: boolean;
}

export interface ContentPayload {
  metadata?: Record<string, any> | undefined;
  userData?: UserData | undefined;
  component?: ComponentBinding[] | undefined;
  content: NodeData[];
}

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

import type { Node } from "../core/Node.js";
export type NextState = Partial<Node>;
export type RollbackState = Partial<Node>;
