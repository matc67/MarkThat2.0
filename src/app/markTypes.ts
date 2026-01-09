export type Tool = "select" | "polyline" | "polygon" | "scale";

export type Units = "ft" | "in" | "m" | "mm";

export type PdfPoint = { x: number; y: number };

export type Polyline = {
  id: string;
  page: number;
  points: PdfPoint[];
};

export type Polygon = {
  id: string;
  page: number;
  points: PdfPoint[];
};

export type ScaleCal = {
  page: number;
  a: PdfPoint;
  b: PdfPoint;
  realDistance: number; // in "units"
  units: Units;
  unitsPerPdfPoint: number; // conversion factor
};

export type Draft =
  | { kind: "polyline"; page: number; points: PdfPoint[] }
  | { kind: "polygon"; page: number; points: PdfPoint[] }
  | { kind: "scale"; page: number; a?: PdfPoint; b?: PdfPoint };

export type MarkState = {
  tool: Tool;
  scale: ScaleCal | null;
  polylines: Polyline[];
  polygons: Polygon[];
  draft: Draft | null;
  live: { length?: number; area?: number } | null; // computed in "units"
};

export type MarkAction =
  | { type: "SET_TOOL"; tool: Tool }
  | { type: "SET_LIVE"; live: MarkState["live"] }
  | { type: "START_DRAFT"; draft: Draft }
  | { type: "ADD_DRAFT_POINT"; p: PdfPoint; page: number }
  | { type: "SET_SCALE_POINT"; p: PdfPoint; page: number }
  | { type: "COMMIT_DRAFT" }
  | { type: "CANCEL_DRAFT" }
  | { type: "SET_SCALE"; scale: ScaleCal }
  | { type: "UNDO" }
  | { type: "REDO" };
