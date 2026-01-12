// src/viewer/PdfViewer.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";

import { loadPdfFromArrayBuffer, PdfDoc } from "./pdfjs";
import SvgOverlay from "./SvgOverlay";
import type { MarkAction, MarkState } from "../app/markTypes";

type Props = {
  file?: File;
  page: number;
  zoom: number;
  onMeta: (meta: { pages: number }) => void;
  onRequestZoom: (nextZoom: number) => void;

  markState: MarkState;
  dispatch: React.Dispatch<MarkAction>;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function PdfViewer({
  file,
  page,
  zoom,
  onMeta,
  onRequestZoom,
  markState,
  dispatch,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);

  // --- Space key state (pan modifier) ---
  const spaceDownRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        // prevent page scroll while holding space
        e.preventDefault();
        spaceDownRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDownRef.current = false;
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // --- Ctrl + scroll / pinch zoom ---
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const direction = e.deltaY > 0 ? -1 : 1;
      const step = 0.1;
      const next = clamp(+(zoom + direction * step).toFixed(2), 0.25, 5);
      onRequestZoom(next);
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, onRequestZoom]);

  // --- Load PDF when file changes ---
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!file) {
        setDoc(null);
        setViewport(null);
        onMeta({ pages: 0 });
        return;
      }

      const buf = await file.arrayBuffer();
      const pdfDoc = await loadPdfFromArrayBuffer(buf);
      if (cancelled) return;

      setDoc(pdfDoc);
      onMeta({ pages: pdfDoc.numPages });
    }

    run().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [file, onMeta]);

  // --- Render page when doc/page/zoom changes ---
  useEffect(() => {
    let cancelled = false;

    async function render() {
      const canvas = pdfCanvasRef.current;
      if (!doc || !canvas) return;

      const pageObj = await doc.getPage(page);
      if (cancelled) return;

      const vp = pageObj.getViewport({ scale: zoom });
      setViewport(vp);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);

      const overlayEl = overlayRef.current;
      if (overlayEl) {
        overlayEl.style.width = `${canvas.width}px`;
        overlayEl.style.height = `${canvas.height}px`;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const task = pageObj.render({ canvasContext: ctx, viewport: vp, canvas });
      await task.promise;
    }

    render().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [doc, page, zoom]);

  // ---------------------------
  // PANNING (Option A)
  // - Select: drag empty space pans
  // - Edit: drag object moves (overlay); drag empty can pan (nice)
  // - Space + drag anywhere pans (overrides everything)
  // ---------------------------
  const panRef = useRef<{
    active: boolean;
    candidate: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }>({
    active: false,
    candidate: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  const panTools = useMemo(() => new Set(["select", "edit"]), []);

  function isOnMark(target: EventTarget | null) {
    const el = target as Element | null;
    if (!el) return false;
    // SvgOverlay marks have <g data-mark="1">
    return !!el.closest?.("[data-mark='1']");
  }

  function beginCandidatePan(e: React.PointerEvent) {
    const scroller = scrollRef.current;
    if (!scroller) return;

    panRef.current.candidate = true;
    panRef.current.active = false;
    panRef.current.pointerId = e.pointerId;
    panRef.current.startX = e.clientX;
    panRef.current.startY = e.clientY;
    panRef.current.startScrollLeft = scroller.scrollLeft;
    panRef.current.startScrollTop = scroller.scrollTop;
  }

  function activatePanIfNeeded(e: React.PointerEvent) {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const pr = panRef.current;
    if (!pr.candidate || pr.active) return;

    const dx = e.clientX - pr.startX;
    const dy = e.clientY - pr.startY;
    const dist = Math.hypot(dx, dy);

    // small threshold so clicks still work
    if (dist < 3) return;

    pr.active = true;

    // capture pointer so we keep receiving move events
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function applyPan(e: React.PointerEvent) {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const pr = panRef.current;
    if (!pr.active) return;

    const dx = e.clientX - pr.startX;
    const dy = e.clientY - pr.startY;

    scroller.scrollLeft = pr.startScrollLeft - dx;
    scroller.scrollTop = pr.startScrollTop - dy;

    e.preventDefault();
  }

  function endPan(e: React.PointerEvent) {
    const pr = panRef.current;

    if (pr.pointerId === e.pointerId) {
      pr.active = false;
      pr.candidate = false;
      pr.pointerId = null;
    }

    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  // Capture-phase handlers so Space-pan can override overlay move
  function onPointerDownCapture(e: React.PointerEvent) {
    if (e.button !== 0) return; // left button only
    const tool = markState.tool;

    // Space always pans, any tool (but you can restrict if you want)
    if (spaceDownRef.current) {
      beginCandidatePan(e);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Only allow drag-pan in select/edit (Option A)
    if (!panTools.has(tool)) return;

    const startedOnMark = isOnMark(e.target);

    // Select: pan only if NOT starting on an object
    if (tool === "select") {
      if (startedOnMark) return;
      beginCandidatePan(e);
      return;
    }

    // Edit: let object-drag move objects; pan only if empty space
    if (tool === "edit") {
      if (startedOnMark) return;
      beginCandidatePan(e);
      return;
    }
  }

  function onPointerMoveCapture(e: React.PointerEvent) {
    activatePanIfNeeded(e);
    applyPan(e);

    // if we are panning via space, keep overlay from doing anything
    if (panRef.current.active && spaceDownRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onPointerUpCapture(e: React.PointerEvent) {
    endPan(e);
  }

  function onPointerCancelCapture(e: React.PointerEvent) {
    endPan(e);
  }

  // Cursor hint: space = grab
  const cursorStyle = useMemo(() => {
    if (spaceDownRef.current) return "grab";
    if (markState.tool === "edit") return "default";
    if (markState.tool === "select") return "default";
    return "default";
  }, [markState.tool]);

  return (
    <div
      ref={scrollRef}
      style={{ height: "100%", overflow: "auto", cursor: cursorStyle }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onPointerUpCapture={onPointerUpCapture}
      onPointerCancelCapture={onPointerCancelCapture}
    >
      {!file ? (
        <div className="dropHint">Open a PDF using the button above or drag/drop into the viewer area.</div>
      ) : (
        <div style={{ padding: 18 }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <canvas ref={pdfCanvasRef} />

            <div ref={overlayRef} style={{ position: "absolute", left: 0, top: 0 }}>
              <SvgOverlay
                viewport={viewport}
                page={page}
                containerRef={overlayRef}
                markState={markState}
                dispatch={dispatch}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
