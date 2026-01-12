// src/viewer/SvgOverlay.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import type { MarkAction, MarkState, PdfPoint, Mark, Draft } from "../app/markTypes";
import {
  computeMarkAreaInUnits,
  computeMarkPerimeterInUnits,
  computePolygonAreaInUnits,
  computePolygonPerimeterInUnits,
  computePolylineLengthInUnits,
  rectPoints,
} from "../app/markStore";

type Props = {
  viewport: PageViewport | null;
  page: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  markState: MarkState;
  dispatch: React.Dispatch<MarkAction>;
};

type VpPoint = { x: number; y: number };

const HIT_R = 8; // px hit radius for handles
const HANDLE_R = 5;

function dist2(a: VpPoint, b: VpPoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export default function SvgOverlay({ viewport, page, containerRef, markState, dispatch }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverPdf, setHoverPdf] = useState<PdfPoint | null>(null);

  const marks = useMemo(() => markState.marks.filter((m) => m.page === page), [markState.marks, page]);

  const selected = useMemo(
    () => (markState.selectedId ? markState.marks.find((m) => m.id === markState.selectedId) ?? null : null),
    [markState.marks, markState.selectedId]
  );

  const draft = useMemo(() => {
    if (!markState.draft) return null;
    return markState.draft.page === page ? markState.draft : null;
  }, [markState.draft, page]);

  // Cursor
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.style.pointerEvents = "auto";

    const tool = markState.tool;
    if (tool === "line" || tool === "polygon" || tool === "rect" || tool === "circle" || tool === "scale" || tool === "text") {
      el.style.cursor = "crosshair";
    } else if (tool === "edit") {
      el.style.cursor = "grab";
    } else {
      el.style.cursor = "default";
    }
  }, [containerRef, markState.tool]);

  function toPdf(e: React.MouseEvent, svg: SVGSVGElement): PdfPoint | null {
    if (!viewport) return null;
    const rect = svg.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    const [x, y] = viewport.convertToPdfPoint(vx, vy);
    return { x, y };
  }

  function toVp(p: PdfPoint): VpPoint {
    const [x, y] = viewport!.convertToViewportPoint(p.x, p.y);
    return { x, y };
  }

  function mouseVpFromEvent(e: React.MouseEvent, svg: SVGSVGElement): VpPoint {
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function pathFromPdfPoints(points: PdfPoint[], close = false) {
    if (!viewport || points.length === 0) return "";
    const a = toVp(points[0]);
    let d = `M ${a.x} ${a.y}`;
    for (let i = 1; i < points.length; i++) {
      const p = toVp(points[i]);
      d += ` L ${p.x} ${p.y}`;
    }
    if (close) d += " Z";
    return d;
  }

  function ensureDraft(kind: Draft["kind"]) {
    if (draft) return;

    if (kind === "polygon") return dispatch({ type: "START_DRAFT", draft: { kind: "polygon", page, points: [] } });
    if (kind === "line") return dispatch({ type: "START_DRAFT", draft: { kind: "line", page } });
    if (kind === "rect") return dispatch({ type: "START_DRAFT", draft: { kind: "rect", page } });
    if (kind === "circle") return dispatch({ type: "START_DRAFT", draft: { kind: "circle", page } });
    if (kind === "text") return dispatch({ type: "START_DRAFT", draft: { kind: "text", page, text: "", fontSize: 14 } });

    // scale
    return dispatch({ type: "START_DRAFT", draft: { kind: "scale", page } });
  }

  // ---- Live measurement while drafting ----
  function updateLive(nextHover: PdfPoint | null) {
    if (!markState.scale || !draft || !nextHover) {
      dispatch({ type: "SET_LIVE", live: null });
      return;
    }

    if (draft.kind === "line") {
      if (!draft.a) return dispatch({ type: "SET_LIVE", live: null });
      const len = computePolylineLengthInUnits(markState.scale, [draft.a, nextHover]);
      dispatch({ type: "SET_LIVE", live: len != null ? { length: len } : null });
      return;
    }

    if (draft.kind === "polygon") {
      const pts = [...draft.points, nextHover];
      const area = computePolygonAreaInUnits(markState.scale, pts);
      const perim = computePolygonPerimeterInUnits(markState.scale, pts);
      dispatch({ type: "SET_LIVE", live: area != null || perim != null ? { area, perimeter: perim } : null });
      return;
    }

    if (draft.kind === "rect" && draft.a) {
      const pts = rectPoints({ id: "d", page, kind: "rect", a: draft.a, b: nextHover } as any);
      const area = computePolygonAreaInUnits(markState.scale, pts);
      const perim = computePolygonPerimeterInUnits(markState.scale, pts);
      dispatch({ type: "SET_LIVE", live: { area, perimeter: perim } });
      return;
    }

    if (draft.kind === "circle" && draft.c) {
      const r = Math.hypot(nextHover.x - draft.c.x, nextHover.y - draft.c.y);
      const m: Mark = { id: "d", page, kind: "circle", c: draft.c, r } as any;
      const area = computeMarkAreaInUnits(markState.scale, m);
      const perim = computeMarkPerimeterInUnits(markState.scale, m);
      dispatch({ type: "SET_LIVE", live: { area, perimeter: perim } });
      return;
    }

    dispatch({ type: "SET_LIVE", live: null });
  }

  // ---- Handle hit testing for edit mode ----
  function findHandleHit(m: Mark, mouseVp: VpPoint) {
    if (!viewport) return null;
    const r2 = HIT_R * HIT_R;

    if (m.kind === "line") {
      const a = toVp(m.a);
      const b = toVp(m.b);
      if (dist2(a, mouseVp) <= r2) return { kind: "line" as const, which: "a" as const };
      if (dist2(b, mouseVp) <= r2) return { kind: "line" as const, which: "b" as const };
      return null;
    }

    if (m.kind === "polygon") {
      for (let i = 0; i < m.points.length; i++) {
        const v = toVp(m.points[i]);
        if (dist2(v, mouseVp) <= r2) return { kind: "polygon" as const, index: i };
      }
      return null;
    }

    if (m.kind === "rect") {
      const pts = rectPoints(m);
      for (let i = 0; i < pts.length; i++) {
        const v = toVp(pts[i]);
        if (dist2(v, mouseVp) <= r2) return { kind: "rect" as const, index: i };
      }
      return null;
    }

    if (m.kind === "circle") {
      const c = toVp(m.c);
      if (dist2(c, mouseVp) <= r2) return { kind: "circle" as const, which: "c" as const };
      const rh = toVp({ x: m.c.x + m.r, y: m.c.y });
      if (dist2(rh, mouseVp) <= r2) return { kind: "circle" as const, which: "r" as const };
      return null;
    }

    if (m.kind === "text") {
      const p = toVp(m.p);
      if (dist2(p, mouseVp) <= r2) return { kind: "text" as const };
      return null;
    }

    return null;
  }

  function hitTestMark(m: Mark, mouseVp: VpPoint) {
    if (!viewport) return false;

    if (m.kind === "text") {
      const p = toVp(m.p);
      return mouseVp.x >= p.x - 10 && mouseVp.x <= p.x + 220 && mouseVp.y >= p.y - 22 && mouseVp.y <= p.y + 10;
    }

    if (m.kind === "line") {
      const a = toVp(m.a);
      const b = toVp(m.b);

      const minX = Math.min(a.x, b.x) - 6;
      const maxX = Math.max(a.x, b.x) + 6;
      const minY = Math.min(a.y, b.y) - 6;
      const maxY = Math.max(a.y, b.y) + 6;
      if (mouseVp.x < minX || mouseVp.x > maxX || mouseVp.y < minY || mouseVp.y > maxY) return false;

      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const wx = mouseVp.x - a.x;
      const wy = mouseVp.y - a.y;

      const c1 = wx * vx + wy * vy;
      if (c1 <= 0) return dist2(mouseVp, a) <= 10 * 10;

      const c2 = vx * vx + vy * vy;
      if (c2 <= c1) return dist2(mouseVp, b) <= 10 * 10;

      const t = c1 / c2;
      const px = a.x + t * vx;
      const py = a.y + t * vy;
      return dist2(mouseVp, { x: px, y: py }) <= 10 * 10;
    }

    if (m.kind === "polygon") {
      const vps = m.points.map(toVp);
      const xs = vps.map((p) => p.x);
      const ys = vps.map((p) => p.y);
      const minX = Math.min(...xs) - 6;
      const maxX = Math.max(...xs) + 6;
      const minY = Math.min(...ys) - 6;
      const maxY = Math.max(...ys) + 6;
      return mouseVp.x >= minX && mouseVp.x <= maxX && mouseVp.y >= minY && mouseVp.y <= maxY;
    }

    if (m.kind === "rect") {
      const pts = rectPoints(m).map(toVp);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs) - 6;
      const maxX = Math.max(...xs) + 6;
      const minY = Math.min(...ys) - 6;
      const maxY = Math.max(...ys) + 6;
      return mouseVp.x >= minX && mouseVp.x <= maxX && mouseVp.y >= minY && mouseVp.y <= maxY;
    }

    if (m.kind === "circle") {
      const c = toVp(m.c);
      const edge = toVp({ x: m.c.x + m.r, y: m.c.y });
      const rVp = Math.abs(edge.x - c.x);
      return dist2(mouseVp, c) <= (rVp + 6) * (rVp + 6);
    }

    return false;
  }

  // ---- Editing drag state (move or handle) ----
  const dragRef = useRef<
    | null
    | {
        id: string;
        mode: "move" | "handle";
        handle?: { kind: Mark["kind"]; index?: number; which?: "a" | "b" | "c" | "r" };
        startPdf: PdfPoint;
        startMark: Mark;
      }
  >(null);

  // Key handlers
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (markState.draft) dispatch({ type: "CANCEL_DRAFT" });
      }

      if (e.key === "Enter") {
        if (!draft) return;
        if (draft.kind === "polygon" && draft.points.length >= 3) dispatch({ type: "COMMIT_DRAFT" });
        if (draft.kind === "line" && draft.a && draft.b) dispatch({ type: "COMMIT_DRAFT" });
        if (draft.kind === "rect" && draft.a && draft.b) dispatch({ type: "COMMIT_DRAFT" });
        if (draft.kind === "circle" && draft.c && typeof draft.r === "number" && draft.r > 0) dispatch({ type: "COMMIT_DRAFT" });
        if (draft.kind === "text") dispatch({ type: "COMMIT_DRAFT" });
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        if (markState.tool === "edit" || markState.tool === "select") {
          if (markState.selectedId) dispatch({ type: "DELETE_SELECTED" });
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, dispatch, markState.draft, markState.tool, markState.selectedId]);

  // ---- Rect/Circle drag-to-create ----
  const draftDragRef = useRef<null | { kind: "rect" | "circle" }>(null);

  function onClick(e: React.MouseEvent) {
    if (!viewport || !svgRef.current) return;

    // If we're currently editing a text draft, don't let clicks do other things.
    if (draft?.kind === "text") return;

    const tool = markState.tool;

    // Selection click
    if (tool === "select" || tool === "edit") {
      const mouseVp = mouseVpFromEvent(e, svgRef.current);

      for (let i = marks.length - 1; i >= 0; i--) {
        if (hitTestMark(marks[i], mouseVp)) {
          dispatch({ type: "SELECT", id: marks[i].id });
          return;
        }
      }
      dispatch({ type: "SELECT", id: null });
      return;
    }

    // Scale
    if (tool === "scale") {
      ensureDraft("scale");
      const p = toPdf(e, svgRef.current);
      if (!p) return;
      dispatch({ type: "SET_SCALE_POINT", p, page });
      return;
    }

    // ✅ Text: click starts a draft with inline editor (NO instant commit)
    if (tool === "text") {
      const p = toPdf(e, svgRef.current);
      if (!p) return;
      dispatch({ type: "START_DRAFT", draft: { kind: "text", page, p, text: "", fontSize: 14 } });
      return;
    }

    // Line
    if (tool === "line") {
      ensureDraft("line");
      const p = toPdf(e, svgRef.current);
      if (!p) return;

      if (!draft || draft.kind !== "line" || !draft.a) {
        dispatch({ type: "START_DRAFT", draft: { kind: "line", page, a: p } });
        return;
      }

      dispatch({ type: "UPDATE_DRAFT", draft: { ...draft, b: p } });
      dispatch({ type: "COMMIT_DRAFT" });
      return;
    }

    // Polygon
    if (tool === "polygon") {
      ensureDraft("polygon");
      const p = toPdf(e, svgRef.current);
      if (!p) return;

      const d: Draft = draft && draft.kind === "polygon" ? draft : { kind: "polygon", page, points: [] };
      dispatch({ type: "UPDATE_DRAFT", draft: { ...d, points: [...d.points, p] } });
      return;
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!viewport || !svgRef.current) return;

    // Don't start drags while editing text draft
    if (draft?.kind === "text") return;

    const tool = markState.tool;
    const mouseVp = mouseVpFromEvent(e, svgRef.current);
    const mousePdf = toPdf(e, svgRef.current);
    if (!mousePdf) return;

    if (tool === "edit") {
      let target: Mark | null = null;

      if (selected && hitTestMark(selected, mouseVp)) target = selected;
      else {
        for (let i = marks.length - 1; i >= 0; i--) {
          if (hitTestMark(marks[i], mouseVp)) {
            target = marks[i];
            break;
          }
        }
      }

      if (!target) {
        dispatch({ type: "SELECT", id: null });
        return;
      }

      dispatch({ type: "SELECT", id: target.id });

      const handle = findHandleHit(target, mouseVp);

      dragRef.current = {
        id: target.id,
        mode: handle ? "handle" : "move",
        handle: handle ?? undefined,
        startPdf: mousePdf,
        startMark: target,
      };

      e.preventDefault();
      return;
    }

    if (tool === "rect") {
      dispatch({ type: "START_DRAFT", draft: { kind: "rect", page, a: mousePdf, b: mousePdf } });
      draftDragRef.current = { kind: "rect" };
      e.preventDefault();
      return;
    }

    if (tool === "circle") {
      dispatch({ type: "START_DRAFT", draft: { kind: "circle", page, c: mousePdf, r: 0 } });
      draftDragRef.current = { kind: "circle" };
      e.preventDefault();
      return;
    }
  }

  function onMouseUp() {
    dragRef.current = null;

    const dd = draftDragRef.current;
    if (dd) {
      draftDragRef.current = null;
      dispatch({ type: "COMMIT_DRAFT" });
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (!draft) return;
    if (draft.kind === "polygon" && draft.points.length >= 3) dispatch({ type: "COMMIT_DRAFT" });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!viewport || !svgRef.current) return;

    const p = toPdf(e, svgRef.current);
    setHoverPdf(p);
    updateLive(p);

    const dd = draftDragRef.current;
    if (dd && p && draft) {
      if (dd.kind === "rect" && draft.kind === "rect" && draft.a) {
        dispatch({ type: "UPDATE_DRAFT", draft: { ...draft, b: p } });
      }
      if (dd.kind === "circle" && draft.kind === "circle" && draft.c) {
        const r = Math.hypot(p.x - draft.c.x, p.y - draft.c.y);
        dispatch({ type: "UPDATE_DRAFT", draft: { ...draft, r } });
      }
      return;
    }

    const dr = dragRef.current;
    if (!dr || !p) return;

    const dx = p.x - dr.startPdf.x;
    const dy = p.y - dr.startPdf.y;
    const m = dr.startMark;

    if (dr.mode === "move") {
      if (m.kind === "line") {
        dispatch({
          type: "UPDATE_MARK",
          id: dr.id,
          patch: { a: { x: m.a.x + dx, y: m.a.y + dy }, b: { x: m.b.x + dx, y: m.b.y + dy } } as any,
        });
      } else if (m.kind === "polygon") {
        dispatch({
          type: "UPDATE_MARK",
          id: dr.id,
          patch: { points: m.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) } as any,
        });
      } else if (m.kind === "rect") {
        dispatch({
          type: "UPDATE_MARK",
          id: dr.id,
          patch: { a: { x: m.a.x + dx, y: m.a.y + dy }, b: { x: m.b.x + dx, y: m.b.y + dy } } as any,
        });
      } else if (m.kind === "circle") {
        dispatch({
          type: "UPDATE_MARK",
          id: dr.id,
          patch: { c: { x: m.c.x + dx, y: m.c.y + dy } } as any,
        });
      } else if (m.kind === "text") {
        dispatch({
          type: "UPDATE_MARK",
          id: dr.id,
          patch: { p: { x: m.p.x + dx, y: m.p.y + dy } } as any,
        });
      }
      return;
    }

    const h = dr.handle!;
    if (m.kind === "line" && h.which) {
      dispatch({
        type: "UPDATE_MARK",
        id: dr.id,
        patch: (h.which === "a" ? { a: p } : { b: p }) as any,
      });
      return;
    }

    if (m.kind === "polygon" && typeof h.index === "number") {
      const next = [...m.points];
      next[h.index] = p;
      dispatch({ type: "UPDATE_MARK", id: dr.id, patch: { points: next } as any });
      return;
    }

    if (m.kind === "rect" && typeof h.index === "number") {
      const pts = rectPoints(m);
      const opp = pts[(h.index + 2) % 4];
      dispatch({ type: "UPDATE_MARK", id: dr.id, patch: { a: opp, b: p } as any });
      return;
    }

    if (m.kind === "circle" && h.which) {
      if (h.which === "c") {
        dispatch({ type: "UPDATE_MARK", id: dr.id, patch: { c: p } as any });
      } else {
        const r = Math.hypot(p.x - m.c.x, p.y - m.c.y);
        dispatch({ type: "UPDATE_MARK", id: dr.id, patch: { r: Math.max(0, r) } as any });
      }
      return;
    }
  }

  function drawCenterLabel(m: Mark) {
    if (!viewport) return null;
    if (!markState.scale) return null;

    const showArea = !!m.measure?.showArea;
    const showPerim = !!m.measure?.showPerimeter;
    if (!showArea && !showPerim) return null;

    if (!(m.kind === "polygon" || m.kind === "rect" || m.kind === "circle")) return null;

    let centerPdf: PdfPoint | null = null;

    if (m.kind === "polygon") {
      const cx = m.points.reduce((s, p) => s + p.x, 0) / m.points.length;
      const cy = m.points.reduce((s, p) => s + p.y, 0) / m.points.length;
      centerPdf = { x: cx, y: cy };
    } else if (m.kind === "rect") {
      centerPdf = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
    } else if (m.kind === "circle") {
      centerPdf = m.c;
    }

    if (!centerPdf) return null;

    const vp = toVp(centerPdf);
    const parts: string[] = [];

    if (showArea) {
      const a = computeMarkAreaInUnits(markState.scale, m);
      if (a != null) parts.push(`A: ${a.toFixed(2)} ${(markState.scale.units ?? "")}²`);
    }
    if (showPerim) {
      const p = computeMarkPerimeterInUnits(markState.scale, m);
      if (p != null) parts.push(`P: ${p.toFixed(2)} ${markState.scale.units ?? ""}`);
    }

    if (!parts.length) return null;

    return (
      <text
        x={vp.x}
        y={vp.y}
        fontSize={13}
        textAnchor="middle"
        fill="#0f172a"
        stroke="#ffffff"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {parts.join("  •  ")}
      </text>
    );
  }

  if (!viewport) return null;

  const textDraft = draft?.kind === "text" ? draft : null;

  return (
    <svg
      ref={svgRef}
      width={viewport.width}
      height={viewport.height}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      style={{ position: "absolute", left: 0, top: 0 }}
    >
      <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="transparent" pointerEvents="all" />

      {/* Committed marks */}
      {marks.map((m) => {
        const stroke = m.style?.stroke ?? "#60a5fa";
        const sw = m.style?.strokeWidth ?? 2;
        const fill =
          m.style?.fill ??
          (m.kind === "polygon" || m.kind === "rect" || m.kind === "circle" ? "rgba(96,165,250,0.15)" : "none");
        const isSel = m.id === markState.selectedId;

        if (m.kind === "text") {
          const vp = toVp(m.p);
          const size = m.fontSize ?? 14;
          return (
            <g key={m.id} data-mark="1" data-mark-id={m.id}>
              <text x={vp.x} y={vp.y} fontSize={size} fill={stroke}>
                {m.text}
              </text>
              {isSel && (
                <rect
                  x={vp.x - 8}
                  y={vp.y - size - 6}
                  width={240}
                  height={size + 12}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  data-handle="1"
                />
              )}
              {isSel && <circle cx={vp.x} cy={vp.y} r={HANDLE_R} fill="#f59e0b" data-handle="1" />}
            </g>
          );
        }

        if (m.kind === "line") {
          const aVp = toVp(m.a);
          const bVp = toVp(m.b);
          return (
            <g key={m.id} data-mark="1" data-mark-id={m.id}>
              <path d={pathFromPdfPoints([m.a, m.b])} fill="none" stroke={stroke} strokeWidth={sw} />
              {isSel && (
                <>
                  <circle cx={aVp.x} cy={aVp.y} r={HANDLE_R} fill="#f59e0b" data-handle="1" />
                  <circle cx={bVp.x} cy={bVp.y} r={HANDLE_R} fill="#f59e0b" data-handle="1" />
                </>
              )}
            </g>
          );
        }

        if (m.kind === "polygon") {
          const d = pathFromPdfPoints(m.points, true);
          return (
            <g key={m.id} data-mark="1" data-mark-id={m.id}>
              <path d={d} fill={fill} stroke={stroke} strokeWidth={sw} />
              {isSel && drawCenterLabel(m)}
              {isSel &&
                m.points.map((p, i) => (
                  <circle key={i} cx={toVp(p).x} cy={toVp(p).y} r={HANDLE_R} fill="#f59e0b" data-handle="1" />
                ))}
            </g>
          );
        }

        if (m.kind === "rect") {
          const pts = rectPoints(m);
          const d = pathFromPdfPoints(pts, true);
          return (
            <g key={m.id} data-mark="1" data-mark-id={m.id}>
              <path d={d} fill={fill} stroke={stroke} strokeWidth={sw} />
              {isSel && drawCenterLabel(m)}
              {isSel &&
                pts.map((p, i) => (
                  <circle key={i} cx={toVp(p).x} cy={toVp(p).y} r={HANDLE_R} fill="#f59e0b" data-handle="1" />
                ))}
            </g>
          );
        }

        if (m.kind === "circle") {
          const cVp = toVp(m.c);
          const edgeVp = toVp({ x: m.c.x + m.r, y: m.c.y });
          const rVp = Math.abs(edgeVp.x - cVp.x);

          return (
            <g key={m.id} data-mark="1" data-mark-id={m.id}>
              <circle cx={cVp.x} cy={cVp.y} r={rVp} fill={fill} stroke={stroke} strokeWidth={sw} />
              {isSel && drawCenterLabel(m)}
              {isSel && (
                <>
                  <circle cx={cVp.x} cy={cVp.y} r={HANDLE_R} fill="#f59e0b" data-handle="1" />
                  <circle cx={edgeVp.x} cy={edgeVp.y} r={HANDLE_R} fill="#f59e0b" data-handle="1" />
                </>
              )}
            </g>
          );
        }

        return null;
      })}

      {/* Draft previews */}
      {draft?.kind === "line" && draft.a && hoverPdf && (
        <path d={pathFromPdfPoints([draft.a, hoverPdf])} fill="none" stroke="#22c55e" strokeWidth={2} />
      )}

      {draft?.kind === "polygon" && (
        <path
          d={pathFromPdfPoints(hoverPdf ? [...draft.points, hoverPdf] : draft.points, false)}
          fill="none"
          stroke="#22c55e"
          strokeWidth={2}
        />
      )}

      {draft?.kind === "rect" && draft.a && draft.b && (
        <path
          d={pathFromPdfPoints(rectPoints({ id: "d", page, kind: "rect", a: draft.a, b: draft.b } as any), true)}
          fill="rgba(34,197,94,0.12)"
          stroke="#22c55e"
          strokeWidth={2}
        />
      )}

      {draft?.kind === "circle" && draft.c && typeof draft.r === "number" && draft.r > 0 &&
        (() => {
          const cVp = toVp(draft.c);
          const edgeVp = toVp({ x: draft.c.x + draft.r!, y: draft.c.y });
          const rVp = Math.abs(edgeVp.x - cVp.x);
          return <circle cx={cVp.x} cy={cVp.y} r={rVp} fill="rgba(34,197,94,0.12)" stroke="#22c55e" strokeWidth={2} />;
        })()}

      {/* ✅ Text draft inline editor */}
      {textDraft?.p &&
        (() => {
          const vp = toVp(textDraft.p);
          const value = textDraft.text ?? "";
          const size = textDraft.fontSize ?? 14;

          return (
            <foreignObject x={vp.x} y={vp.y - size - 12} width={320} height={90}>
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 6,
      padding: 8,
      borderRadius: 12,
      border: "1px solid rgba(0,0,0,0.15)",
      background: "rgba(255,255,255,0.95)",
      backdropFilter: "blur(6px)",
      width: 300,
    }}
    onMouseDown={(e) => e.stopPropagation()}
    onClick={(e) => e.stopPropagation()}
  >

                <input
                  autoFocus
                  value={value}
                  placeholder="Type text… (Enter to place)"
                  onChange={(e) =>
                    dispatch({ type: "UPDATE_DRAFT", draft: { ...textDraft, text: e.target.value } })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Escape") dispatch({ type: "CANCEL_DRAFT" });
                    if (e.key === "Enter") dispatch({ type: "COMMIT_DRAFT" });
                    e.stopPropagation();
                  }}
                  style={{
                    width: "100%",
                    fontSize: `${size}px`,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.18)",
                    outline: "none",
                  }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={8}
                    max={72}
                    value={size}
                    onChange={(e) =>
                      dispatch({ type: "UPDATE_DRAFT", draft: { ...textDraft, fontSize: Number(e.target.value) } })
                    }
                    style={{ flex: 1 }}
                  />
                  <div style={{ width: 44, textAlign: "right", fontSize: 12, opacity: 0.7 }}>
                    {size}px
                  </div>
                </div>

                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  Enter = place • Esc = cancel
                </div>
              </div>
            </foreignObject>
          );
        })()}

      {/* Scale preview */}
      {draft?.kind === "scale" && (
        <>
          {draft.a && <circle cx={toVp(draft.a).x} cy={toVp(draft.a).y} r={HANDLE_R} fill="#f59e0b" />}
          {draft.b && <circle cx={toVp(draft.b).x} cy={toVp(draft.b).y} r={HANDLE_R} fill="#f59e0b" />}

          {draft.a && !draft.b && hoverPdf && (
            <path
              d={pathFromPdfPoints([draft.a, hoverPdf])}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={3}
              strokeDasharray="6 6"
            />
          )}

          {draft.a && draft.b && (
            <path
              d={pathFromPdfPoints([draft.a, draft.b])}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={3}
              strokeDasharray="6 6"
            />
          )}
        </>
      )}
    </svg>
  );
}
