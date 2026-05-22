export interface CssDef {
  selector: string;
  styles: Record<string, string>;
}

export interface PlacementConfig {
  placementName?: string;
  targetPlacement?: string[];
}

export interface ComponentBinding {
  reference: string;
  target?: string;
  value: string | null;
}

export interface NodeData {
  type: string;
  placement?: PlacementConfig;
  component?: ComponentBinding[];
  content?: string | NodeData | NodeData[];
  props?: Record<string, any>;
  css?: {
    id?: string;
    classes?: string[];
    style?: Record<string, string>;
    cssDef?: CssDef[];
  };
}

export interface ContentPayload {
  metadata?: Record<string, any>;
  component?: ComponentBinding[];
  content: NodeData[];
}
