export interface CssDef {
  selector: string;
  styles: Record<string, string>;
}

export interface NodeData {
  type: string;
  content?: string | NodeData | NodeData[];
  props?: Record<string, any>;
  css?: {
    id?: string;
    classes?: string[];
    style?: Record<string, string>;
    cssDef?: CssDef[];
  };
}
