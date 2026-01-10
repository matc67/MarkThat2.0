// src/app/markTypes.ts

export type Tool =
  | "select"
  | "edit"
  | "line"
  | "polygon"
  | "rect"
  | "circle"
  | "scale"
  | "text";

export type Units = "ft" | "in" | "m" | "mm";

export type PdfPoint = { x: number; y: number };

export type ScaleCal = {
  page: number;
  a: PdfPoint;
  b: PdfPoint;
  realDistance: number;
  units: Units;
  unitsPerPdfPoint: number;
};

export type MarkKind = "line" | "polygon" | "rect" | "circle" | "text";

export type MarkMeasure = {
  showArea?: boolean;
  showPerimeter?: boolean;
  showSegmentLengths?: boolean;
};

export type MarkStyle = {
  stroke?: string;      // css hex or rgb/rgba
  strokeWidth?: number;
  fill?: string;        // css rgba or hex
};

export type MarkBase = {
  id: string;
  page: number;
  kind: MarkKind;
  style?: MarkStyle;
  measure?: MarkMeasure;
};

export type LineMark = MarkBase & {
  kind: "line";
  a: PdfPoint;
  b: PdfPoint;
};

export type PolygonMark = MarkBase & {
  kind: "polygon";
  points: PdfPoint[];
};

export type RectMark = MarkBase & {
  kind: "rect";
  a: PdfPoint;
  b: PdfPoint;
};

export type CircleMark = MarkBase & {
  kind: "circle";
  c: PdfPoint;
  r: number;
};

export type TextMark = MarkBase & {
  kind: "text";
  p: PdfPoint;
  text: string;
  fontSize?: number;
};

export type Mark = LineMark | PolygonMark | RectMark | CircleMark | TextMark;

export type Draft =
  | { kind: "line"; page: number; a?: PdfPoint; b?: PdfPoint }
  | { kind: "polygon"; page: number; points: PdfPoint[] }
  | { kind: "rect"; page: number; a?: PdfPoint; b?: PdfPoint }
  | { kind: "circle"; page: number; c?: PdfPoint; r?: number }
  | { kind: "scale"; page: number; a?: PdfPoint; b?: PdfPoint }
  | { kind: "text"; page: number; p?: PdfPoint };

export type MarkState = {
  tool: Tool;
  scale: ScaleCal | null;
  marks: Mark[];
  draft: Draft | null;
  live: { length?: number; area?: number; perimeter?: number } | null;
  selectedId: string | null;

  // ✅ new
  defaultStyle: {
    stroke: string;
    strokeWidth: number;
    fill: string; // store as rgba(...) so opacity is embedded
  };
};

export type MarkAction =
  | { type: "SET_TOOL"; tool: Tool }
  | { type: "SET_LIVE"; live: MarkState["live"] }
  | { type: "START_DRAFT"; draft: Draft }
  | { type: "UPDATE_DRAFT"; draft: Draft }
  | { type: "COMMIT_DRAFT" }
  | { type: "CANCEL_DRAFT" }
  | { type: "SET_SCALE_POINT"; p: PdfPoint; page: number }
  | { type: "SET_SCALE"; scale: ScaleCal }
  | { type: "SELECT"; id: string | null }
  | { type: "UPDATE_MARK"; id: string; patch: Partial<Mark> }
  | { type: "DELETE_SELECTED" }
  | { type: "SET_DEFAULT_STYLE"; style: MarkState["defaultStyle"] }
  | { type: "UNDO" }
  | { type: "REDO" };
