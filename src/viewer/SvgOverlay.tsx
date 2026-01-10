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
    if (tool === "line" || tool === "polygon" || tool === "rect" || tool === "circle" || tool === "scale") {
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

    if (kind === "polygon") {
      dispatch({ type: "START_DRAFT", draft: { kind: "polygon", page, points: [] } });
      return;
    }
    if (kind === "line") {
      dispatch({ type: "START_DRAFT", draft: { kind: "line", page } });
      return;
    }
    if (kind === "rect") {
      dispatch({ type: "START_DRAFT", draft: { kind: "rect", page } });
      return;
    }
    if (kind === "circle") {
      dispatch({ type: "START_DRAFT", draft: { kind: "circle", page } });
      return;
    }
    // scale
    dispatch({ type: "START_DRAFT", draft: { kind: "scale", page } });
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

    // scale doesn't show measurements
    dispatch({ type: "SET_LIVE", live: null });
  }

  // ---- Edit dragging (move whole mark) ----
  const dragRef = useRef<
    | null
    | {
        id: string;
        startPdf: PdfPoint;
        startMark: Mark;
      }
  >(null);

  function hitTestMark(m: Mark, mouseVp: VpPoint) {
    if (!viewport) return false;

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

  // Key handlers: Enter commits, Delete removes selected
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        if (!draft) return;
        if (draft.kind === "polygon" && draft.points.length >= 3) dispatch({ type: "COMMIT_DRAFT" });
        if (draft.kind === "line" && draft.a && draft.b) dispatch({ type: "COMMIT_DRAFT" });
        if (draft.kind === "rect" && draft.a && draft.b) dispatch({ type: "COMMIT_DRAFT" });
        if (draft.kind === "circle" && draft.c && typeof draft.r === "number" && draft.r > 0) dispatch({ type: "COMMIT_DRAFT" });
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        if (markState.tool === "edit" || markState.tool === "select") {
          if (markState.selectedId) dispatch({ type: "DELETE_SELECTED" });
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, dispatch, markState.tool, markState.selectedId]);

  // ---- Rect/Circle drag-to-create ----
  const draftDragRef = useRef<null | { kind: "rect" | "circle" }>(null);

  function onClick(e: React.MouseEvent) {
    if (!viewport || !svgRef.current) return;

    const tool = markState.tool;

    // Selection click
    if (tool === "select" || tool === "edit") {
      const rect = svgRef.current.getBoundingClientRect();
      const mouseVp: VpPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      for (let i = marks.length - 1; i >= 0; i--) {
        if (hitTestMark(marks[i], mouseVp)) {
          dispatch({ type: "SELECT", id: marks[i].id });
          return;
        }
      }
      dispatch({ type: "SELECT", id: null });
      return;
    }

    // Scale tool click
    if (tool === "scale") {
      ensureDraft("scale");
      const p = toPdf(e, svgRef.current);
      if (!p) return;
      dispatch({ type: "SET_SCALE_POINT", p, page });
      return;
    }

    // Line 2-click tool
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

    // Polygon click-to-add-points
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

    const tool = markState.tool;

    const rect = svgRef.current.getBoundingClientRect();
    const mouseVp: VpPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const mousePdf = toPdf(e, svgRef.current);
    if (!mousePdf) return;

    // Edit: drag to move
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
      dragRef.current = { id: target.id, startPdf: mousePdf, startMark: target };

      e.preventDefault();
      return;
    }

    // Rect / Circle click-drag create
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

    // update rect/circle draft while dragging
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

    // edit dragging (move whole mark)
    const dr = dragRef.current;
    if (!dr || !p) return;

    const dx = p.x - dr.startPdf.x;
    const dy = p.y - dr.startPdf.y;
    const m = dr.startMark;

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
      {/* ✅ Event-capture layer: makes hover + scale preview reliable everywhere */}
      <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="transparent" />

      {/* Committed marks */}
      {marks.map((m) => {
        const stroke = m.style?.stroke ?? "#60a5fa";
        const sw = m.style?.strokeWidth ?? 2;
        const fill =
          m.style?.fill ??
          (m.kind === "polygon" || m.kind === "rect" || m.kind === "circle" ? "rgba(96,165,250,0.15)" : "none");
        const isSel = m.id === markState.selectedId;

        if (m.kind === "line") {
          return (
            <g key={m.id}>
              <path d={pathFromPdfPoints([m.a, m.b])} fill="none" stroke={stroke} strokeWidth={sw} />
            </g>
          );
        }

        if (m.kind === "polygon") {
          const d = pathFromPdfPoints(m.points, true);
          return (
            <g key={m.id}>
              <path d={d} fill={fill} stroke={stroke} strokeWidth={sw} />
              {isSel && drawCenterLabel(m)}
            </g>
          );
        }

        if (m.kind === "rect") {
          const pts = rectPoints(m);
          const d = pathFromPdfPoints(pts, true);
          return (
            <g key={m.id}>
              <path d={d} fill={fill} stroke={stroke} strokeWidth={sw} />
              {isSel && drawCenterLabel(m)}
            </g>
          );
        }

        if (m.kind === "circle") {
          const cVp = toVp(m.c);
          const edgeVp = toVp({ x: m.c.x + m.r, y: m.c.y });
          const rVp = Math.abs(edgeVp.x - cVp.x);
          return (
            <g key={m.id}>
              <circle cx={cVp.x} cy={cVp.y} r={rVp} fill={fill} stroke={stroke} strokeWidth={sw} />
              {isSel && drawCenterLabel(m)}
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

      {draft?.kind === "circle" && draft.c && typeof draft.r === "number" && draft.r > 0 && (() => {
        const cVp = toVp(draft.c);
        const edgeVp = toVp({ x: draft.c.x + draft.r, y: draft.c.y });
        const rVp = Math.abs(edgeVp.x - cVp.x);
        return (
          <circle cx={cVp.x} cy={cVp.y} r={rVp} fill="rgba(34,197,94,0.12)" stroke="#22c55e" strokeWidth={2} />
        );
      })()}

      {/* Scale preview */}
      {draft?.kind === "scale" && (
        <>
          {draft.a && <circle cx={toVp(draft.a).x} cy={toVp(draft.a).y} r={5} fill="#f59e0b" />}
          {draft.b && <circle cx={toVp(draft.b).x} cy={toVp(draft.b).y} r={5} fill="#f59e0b" />}

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
