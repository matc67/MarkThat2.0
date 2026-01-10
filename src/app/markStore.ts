// src/app/markStore.ts
import type {
  Mark,
  MarkAction,
  MarkState,
  PdfPoint,
  ScaleCal,
  RectMark,
  CircleMark,
  LineMark,
  PolygonMark,
  TextMark,
} from "./markTypes";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function dist(a: PdfPoint, b: PdfPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(points: PdfPoint[]) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

function polygonPerimeter(points: PdfPoint[]) {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i]);
  if (points.length >= 3) sum += dist(points[points.length - 1], points[0]);
  return sum;
}

export function computeLengthInUnits(scale: ScaleCal | null, a: PdfPoint, b: PdfPoint) {
  if (!scale) return undefined;
  const dPdf = dist(a, b);
  return dPdf * scale.unitsPerPdfPoint;
}

export function computePolylineLengthInUnits(scale: ScaleCal | null, points: PdfPoint[]) {
  if (!scale || points.length < 2) return undefined;
  let totalPdf = 0;
  for (let i = 1; i < points.length; i++) totalPdf += dist(points[i - 1], points[i]);
  return totalPdf * scale.unitsPerPdfPoint;
}

export function computePolygonAreaInUnits(scale: ScaleCal | null, points: PdfPoint[]) {
  if (!scale || points.length < 3) return undefined;
  const aPdf2 = polygonArea(points);
  const k = scale.unitsPerPdfPoint;
  return aPdf2 * k * k;
}

export function computePolygonPerimeterInUnits(scale: ScaleCal | null, points: PdfPoint[]) {
  if (!scale || points.length < 3) return undefined;
  const pPdf = polygonPerimeter(points);
  return pPdf * scale.unitsPerPdfPoint;
}

export function rectPoints(r: RectMark): PdfPoint[] {
  const x1 = r.a.x;
  const y1 = r.a.y;
  const x2 = r.b.x;
  const y2 = r.b.y;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function computeMarkAreaInUnits(scale: ScaleCal | null, m: Mark) {
  if (!scale) return undefined;

  if (m.kind === "polygon") return computePolygonAreaInUnits(scale, m.points);
  if (m.kind === "rect") return computePolygonAreaInUnits(scale, rectPoints(m));
  if (m.kind === "circle") {
    const k = scale.unitsPerPdfPoint;
    return Math.PI * (m.r * k) * (m.r * k);
  }
  return undefined;
}

export function computeMarkPerimeterInUnits(scale: ScaleCal | null, m: Mark) {
  if (!scale) return undefined;

  if (m.kind === "polygon") return computePolygonPerimeterInUnits(scale, m.points);
  if (m.kind === "rect") return computePolygonPerimeterInUnits(scale, rectPoints(m));
  if (m.kind === "circle") {
    const k = scale.unitsPerPdfPoint;
    return 2 * Math.PI * (m.r * k);
  }
  return undefined;
}

export function computeMarkLengthInUnits(scale: ScaleCal | null, m: Mark) {
  if (!scale) return undefined;
  if (m.kind === "line") return computeLengthInUnits(scale, m.a, m.b);
  return undefined;
}

export const initialMarkState: MarkState = {
  tool: "select",
  scale: null,
  marks: [],
  draft: null,
  live: null,
  selectedId: null,

  defaultStyle: {
    stroke: "#60a5fa",
    strokeWidth: 2,
    fill: "rgba(96,165,250,0.15)",
  },
};

type HistoryState = {
  past: MarkState[];
  present: MarkState;
  future: MarkState[];
};

export const initialHistory: HistoryState = {
  past: [],
  present: initialMarkState,
  future: [],
};

function push(present: MarkState, next: MarkState, hist: HistoryState): HistoryState {
  return { past: [...hist.past, present], present: next, future: [] };
}

// ✅ Apply app default style to a mark unless user already overrode values
function withDefaults<T extends Mark>(m: T, defaultStyle: MarkState["defaultStyle"]): T {
  const style = {
    stroke: defaultStyle.stroke,
    strokeWidth: defaultStyle.strokeWidth,
    fill:
      m.kind === "polygon" || m.kind === "rect" || m.kind === "circle"
        ? defaultStyle.fill
        : m.kind === "text"
        ? undefined
        : undefined,
    ...(m.style ?? {}),
  };
  const measure = { ...(m.measure ?? {}) };
  return { ...m, style, measure };
}

function reducePresent(state: MarkState, action: MarkAction): MarkState {
  switch (action.type) {
    case "SET_TOOL":
      return {
        ...state,
        tool: action.tool,
        draft: null,
        live: null,
        selectedId: action.tool === "select" || action.tool === "edit" ? state.selectedId : null,
      };

    case "SET_DEFAULT_STYLE":
      return { ...state, defaultStyle: action.style };

    case "SELECT":
      return { ...state, selectedId: action.id };

    case "SET_LIVE":
      return { ...state, live: action.live };

    case "START_DRAFT":
      return { ...state, draft: action.draft, live: null, selectedId: null };

    case "UPDATE_DRAFT":
      return { ...state, draft: action.draft };

    case "CANCEL_DRAFT":
      return { ...state, draft: null, live: null };

    case "SET_SCALE_POINT": {
      const d = state.draft;
      if (!d || d.kind !== "scale" || d.page !== action.page) return state;
      if (!d.a) return { ...state, draft: { ...d, a: action.p } };
      return { ...state, draft: { ...d, b: action.p } };
    }

    case "SET_SCALE":
      return { ...state, scale: action.scale, draft: null, live: null };

    case "UPDATE_MARK": {
      const nextMarks = state.marks.map((m) => (m.id === action.id ? ({ ...m, ...(action.patch as any) } as Mark) : m));
      return { ...state, marks: nextMarks };
    }

    case "DELETE_SELECTED": {
      if (!state.selectedId) return state;
      const next = state.marks.filter((m) => m.id !== state.selectedId);
      return { ...state, marks: next, selectedId: null, live: null };
    }

    case "COMMIT_DRAFT": {
      const d = state.draft;
      if (!d) return state;

      const page = d.page;

      if (d.kind === "line" && d.a && d.b) {
        const mark = withDefaults<LineMark>(
          {
            id: uid(),
            page,
            kind: "line",
            a: d.a,
            b: d.b,
          } as LineMark,
          state.defaultStyle
        );

        return { ...state, marks: [...state.marks, mark], draft: null, live: null, selectedId: mark.id };
      }

      if (d.kind === "polygon" && d.points.length >= 3) {
        const mark = withDefaults<PolygonMark>(
          {
            id: uid(),
            page,
            kind: "polygon",
            points: d.points,
          } as PolygonMark,
          state.defaultStyle
        );

        return { ...state, marks: [...state.marks, mark], draft: null, live: null, selectedId: mark.id };
      }

      if (d.kind === "rect" && d.a && d.b) {
        const mark = withDefaults<RectMark>(
          {
            id: uid(),
            page,
            kind: "rect",
            a: d.a,
            b: d.b,
          } as RectMark,
          state.defaultStyle
        );

        return { ...state, marks: [...state.marks, mark], draft: null, live: null, selectedId: mark.id };
      }

      if (d.kind === "circle" && d.c && typeof d.r === "number" && d.r > 0) {
        const mark = withDefaults<CircleMark>(
          {
            id: uid(),
            page,
            kind: "circle",
            c: d.c,
            r: d.r,
          } as CircleMark,
          state.defaultStyle
        );

        return { ...state, marks: [...state.marks, mark], draft: null, live: null, selectedId: mark.id };
      }

      if (d.kind === "text" && d.p) {
        const mark = withDefaults<TextMark>(
          {
            id: uid(),
            page,
            kind: "text",
            p: d.p,
            text: "Text",
            fontSize: 14,
          } as TextMark,
          state.defaultStyle
        );

        return { ...state, marks: [...state.marks, mark], draft: null, live: null, selectedId: mark.id };
      }

      return state;
    }

    default:
      return state;
  }
}

export function markHistoryReducer(hist: HistoryState, action: MarkAction): HistoryState {
  const present = hist.present;

  if (action.type === "UNDO") {
    const prev = hist.past[hist.past.length - 1];
    if (!prev) return hist;
    return {
      past: hist.past.slice(0, -1),
      present: prev,
      future: [present, ...hist.future],
    };
  }

  if (action.type === "REDO") {
    const next = hist.future[0];
    if (!next) return hist;
    return {
      past: [...hist.past, present],
      present: next,
      future: hist.future.slice(1),
    };
  }

  if (action.type === "SET_LIVE") {
    return { ...hist, present: reducePresent(present, action) };
  }

  const next = reducePresent(present, action);
  if (next === present) return hist;
  return push(present, next, hist);
}
