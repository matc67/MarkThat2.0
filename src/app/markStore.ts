import type { MarkAction, MarkState, PdfPoint, ScaleCal } from "./markTypes";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function dist(a: PdfPoint, b: PdfPoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function polygonArea(points: PdfPoint[]) {
  // Shoelace formula (absolute)
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function computeLengthInUnits(scale: ScaleCal | null, points: PdfPoint[]) {
  if (!scale || points.length < 2) return undefined;
  let totalPdf = 0;
  for (let i = 1; i < points.length; i++) totalPdf += dist(points[i - 1], points[i]);
  return totalPdf * scale.unitsPerPdfPoint;
}

export function computeAreaInUnits2(scale: ScaleCal | null, points: PdfPoint[]) {
  if (!scale || points.length < 3) return undefined;
  const aPdf2 = polygonArea(points);
  const k = scale.unitsPerPdfPoint;
  return aPdf2 * k * k;
}

export const initialMarkState: MarkState = {
  tool: "select",
  scale: null,
  polylines: [],
  polygons: [],
  draft: null,
  live: null,
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

function reducePresent(state: MarkState, action: MarkAction): MarkState {
  switch (action.type) {
    case "SET_TOOL":
      return { ...state, tool: action.tool, draft: null, live: null };

    case "SET_LIVE":
      return { ...state, live: action.live };

    case "START_DRAFT":
      return { ...state, draft: action.draft, live: null };

    case "CANCEL_DRAFT":
      return { ...state, draft: null, live: null };

    case "ADD_DRAFT_POINT": {
      const d = state.draft;
      if (!d) return state;
      if (d.page !== action.page) return state;

      if (d.kind === "polyline" || d.kind === "polygon") {
        return { ...state, draft: { ...d, points: [...d.points, action.p] } };
      }
      return state;
    }

    case "SET_SCALE_POINT": {
      const d = state.draft;
      if (!d || d.kind !== "scale" || d.page !== action.page) return state;
      if (!d.a) return { ...state, draft: { ...d, a: action.p } };
      return { ...state, draft: { ...d, b: action.p } };
    }

    case "SET_SCALE":
      return { ...state, scale: action.scale, draft: null, live: null };

    case "COMMIT_DRAFT": {
      const d = state.draft;
      if (!d) return state;

      if (d.kind === "polyline" && d.points.length >= 2) {
        return {
          ...state,
          polylines: [...state.polylines, { id: uid(), page: d.page, points: d.points }],
          draft: null,
          live: null,
        };
      }

      if (d.kind === "polygon" && d.points.length >= 3) {
        return {
          ...state,
          polygons: [...state.polygons, { id: uid(), page: d.page, points: d.points }],
          draft: null,
          live: null,
        };
      }

      // scale draft is committed via SET_SCALE
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

  // For live updates, don't push history
  if (action.type === "SET_LIVE") {
    return { ...hist, present: reducePresent(present, action) };
  }

  const next = reducePresent(present, action);
  if (next === present) return hist;

  // Push to history for actions that change saved state
  return push(present, next, hist);
}
