export interface CssDef {
  selector: string;
  styles: Record<string, string>;
}

export interface PlacementConfig {
  placementName?: string;
  targetPlacement?: string[];
  _referencingNodes?: any[];
}

export interface ComponentBinding {
  reference: string;
  target?: string;
  value?: string | NodeData | NodeData[] | null;
  _referencingNodes?: any[];
}
export interface NodeVersion {
  name?: string;
  timestamp: number;
  content?: string | NodeData | NodeData[];
  props?: Record<string, any>;
  component?: ComponentBinding[];
  css?: {
    id?: string;
    classes?: string[];
    style?: Record<string, string>;
    cssDef?: CssDef[];
  };
}


export interface NodeData {
  type: string;
  placement?: PlacementConfig;
  component?: ComponentBinding[];
  content?: string | NodeData | NodeData[];
  props?: Record<string, any>;
  handlers?: Record<string, string>;
  css?: {
    id?: string;
    classes?: string[];
    style?: Record<string, string>;
    cssDef?: CssDef[];
  };
  versions?: NodeVersion[];
  node?: any;
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
  metadata?: Record<string, any>;
  userData?: UserData;
  component?: ComponentBinding[];
  content: NodeData[];
}

export interface NodeQuery {
  type?: string;
  id?: string;
  classes?: string[];
  props?: Record<string, any>;
  handlers?: Record<string, string>;
  style?: Record<string, string>;
  components?: { target?: string; reference?: string }[];
  format?: string;
}
