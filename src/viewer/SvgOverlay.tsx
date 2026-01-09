import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import type { MarkAction, MarkState, PdfPoint } from "../app/markTypes";
import { computeAreaInUnits2, computeLengthInUnits } from "../app/markStore";

type Props = {
  viewport: PageViewport | null;
  page: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  markState: MarkState;
  dispatch: React.Dispatch<MarkAction>;
};

type VpPoint = { x: number; y: number };

export default function SvgOverlay({ viewport, page, containerRef, markState, dispatch }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverPdf, setHoverPdf] = useState<PdfPoint | null>(null);

  // Always compute lists (hooks must not depend on viewport)
  const polylines = useMemo(
    () => markState.polylines.filter((p) => p.page === page),
    [markState.polylines, page]
  );

  const polygons = useMemo(
    () => markState.polygons.filter((p) => p.page === page),
    [markState.polygons, page]
  );

  const draft = useMemo(() => {
    if (!markState.draft) return null;
    return markState.draft.page === page ? markState.draft : null;
  }, [markState.draft, page]);

  // Cursor + pointer events on overlay container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.style.pointerEvents = "auto";
    const tool = markState.tool;
    el.style.cursor =
      tool === "polyline" || tool === "polygon" || tool === "scale" ? "crosshair" : "default";
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
    // Only call when viewport is non-null
    const [x, y] = viewport!.convertToViewportPoint(p.x, p.y);
    return { x, y };
  }

  function updateLive(nextHover: PdfPoint | null) {
    // live measurement only if we have a scale AND a draft tool that measures
    if (!markState.scale || !draft) {
      dispatch({ type: "SET_LIVE", live: null });
      return;
    }

    if ((draft.kind === "polyline" || draft.kind === "polygon") && nextHover) {
      const pts = [...draft.points, nextHover];

      if (draft.kind === "polyline") {
        const len = computeLengthInUnits(markState.scale, pts);
        dispatch({ type: "SET_LIVE", live: len != null ? { length: len } : null });
      } else {
        const area = computeAreaInUnits2(markState.scale, pts);
        dispatch({ type: "SET_LIVE", live: area != null ? { area } : null });
      }
      return;
    }

    dispatch({ type: "SET_LIVE", live: null });
  }

  function ensureDraft() {
    if (draft) return;

    if (markState.tool === "polyline") {
      dispatch({ type: "START_DRAFT", draft: { kind: "polyline", page, points: [] } });
    } else if (markState.tool === "polygon") {
      dispatch({ type: "START_DRAFT", draft: { kind: "polygon", page, points: [] } });
    } else if (markState.tool === "scale") {
      dispatch({ type: "START_DRAFT", draft: { kind: "scale", page } });
    }
  }

  function onClick(e: React.MouseEvent) {
    if (!viewport) return;
    if (!svgRef.current) return;
    if (markState.tool === "select") return;

    ensureDraft();

    const p = toPdf(e, svgRef.current);
    if (!p) return;

    if (markState.tool === "polyline" || markState.tool === "polygon") {
      dispatch({ type: "ADD_DRAFT_POINT", p, page });
      return;
    }

    if (markState.tool === "scale") {
      // Just set A and B. The Scale panel will handle entering real distance + Apply.
      dispatch({ type: "SET_SCALE_POINT", p, page });
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    // Double click commits shapes only (NO scale prompt)
    if (draft?.kind === "polyline") dispatch({ type: "COMMIT_DRAFT" });
    if (draft?.kind === "polygon") dispatch({ type: "COMMIT_DRAFT" });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!viewport) return;
    if (!svgRef.current) return;

    // No draft => clear hover and live
    if (!draft) {
      setHoverPdf(null);
      updateLive(null);
      return;
    }

    const p = toPdf(e, svgRef.current);
    setHoverPdf(p);
    updateLive(p);
  }

  function pathFromPdfPoints(points: PdfPoint[]) {
    if (!viewport) return "";
    if (points.length === 0) return "";

    const a = toVp(points[0]);
    let d = `M ${a.x} ${a.y}`;
    for (let i = 1; i < points.length; i++) {
      const p = toVp(points[i]);
      d += ` L ${p.x} ${p.y}`;
    }
    return d;
  }

  // Render nothing until viewport exists (AFTER hooks)
  if (!viewport) return null;

  return (
    <svg
      ref={svgRef}
      width={viewport.width}
      height={viewport.height}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseMove={onMouseMove}
      style={{ position: "absolute", left: 0, top: 0 }}
    >
      {/* Existing committed polylines */}
      {polylines.map((l) => (
        <path
          key={l.id}
          d={pathFromPdfPoints(l.points)}
          fill="none"
          stroke="#60a5fa"
          strokeWidth={2}
        />
      ))}

      {/* Existing committed polygons */}
      {polygons.map((g) => (
        <path
          key={g.id}
          d={pathFromPdfPoints([...g.points, g.points[0]])}
          fill="rgba(96,165,250,0.15)"
          stroke="#60a5fa"
          strokeWidth={2}
        />
      ))}

      {/* Draft polyline preview */}
      {draft?.kind === "polyline" && (
        <path
          d={pathFromPdfPoints(hoverPdf ? [...draft.points, hoverPdf] : draft.points)}
          fill="none"
          stroke="#22c55e"
          strokeWidth={2}
        />
      )}

      {/* Draft polygon preview */}
      {draft?.kind === "polygon" && (
        <path
          d={pathFromPdfPoints(hoverPdf ? [...draft.points, hoverPdf] : draft.points)}
          fill="rgba(34,197,94,0.12)"
          stroke="#22c55e"
          strokeWidth={2}
        />
      )}

      {/* Draft scale line (A/B points only) */}
      {draft?.kind === "scale" && (
        <>
          {draft.a && <circle cx={toVp(draft.a).x} cy={toVp(draft.a).y} r={5} fill="#f59e0b" />}
          {draft.b && <circle cx={toVp(draft.b).x} cy={toVp(draft.b).y} r={5} fill="#f59e0b" />}
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
