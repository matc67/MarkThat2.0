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

  // ✅ NEW: ref to the page wrapper (the element that contains canvas + overlay)
  const pageWrapRef = useRef<HTMLDivElement | null>(null);

  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);

  // --- Space key state (pan modifier) ---
  const spaceDownRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        spaceDownRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDownRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown as any);
      window.removeEventListener("keyup", onKeyUp as any);
    };
  }, []);

  // ---------------------------
  // ZOOM AROUND MOUSE
  // - Capture mouse position relative to pageWrap (localX/localY)
  // - After re-render, restore scroll so that same content point is under mouse
  // ---------------------------
  const pendingZoomAnchorRef = useRef<null | {
    mx: number; // mouse x in scroller viewport coords
    my: number; // mouse y in scroller viewport coords
    localX: number; // mouse x in pageWrap coords (old zoom pixels)
    localY: number; // mouse y in pageWrap coords (old zoom pixels)
    oldZoom: number;
    scrollLeft: number;
    scrollTop: number;
  }>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const scrollerEl = scrollRef.current;
      const wrap = pageWrapRef.current;
      if (!scrollerEl || !wrap) return;

      const scRect = scrollerEl.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();

      // mouse in scroller viewport coords
      const mx = e.clientX - scRect.left;
      const my = e.clientY - scRect.top;

      // mouse in pageWrap coords (old zoom pixels)
      const localX = e.clientX - wrapRect.left;
      const localY = e.clientY - wrapRect.top;

      pendingZoomAnchorRef.current = {
        mx,
        my,
        localX,
        localY,
        oldZoom: zoom,
        scrollLeft: scrollerEl.scrollLeft,
        scrollTop: scrollerEl.scrollTop,
      };

      const direction = e.deltaY > 0 ? -1 : 1;
      const step = 0.1;
      const next = clamp(+(zoom + direction * step).toFixed(2), 0.25, 5);
      onRequestZoom(next);
    }

    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel as any);
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

      // ✅ Apply "zoom around mouse" after sizes update
      const scroller = scrollRef.current;
      const wrap = pageWrapRef.current;
      const anchor = pendingZoomAnchorRef.current;

      if (!scroller || !wrap || !anchor) return;

      const ratio = zoom / anchor.oldZoom;
      if (!Number.isFinite(ratio) || ratio <= 0) {
        pendingZoomAnchorRef.current = null;
        return;
      }

      // We want: (content point under mouse) stays constant after zoom.
      // contentX = scrollLeft + mx
      // That content point corresponds to: wrapOffsetX + localX
      // After zoom: localX becomes localX * ratio
      // So set scrollLeft' = (wrapOffsetX + localX*ratio) - mx

      const scRect = scroller.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();

      // wrap offset in scroller-content coords (using the OLD scroll position we stored)
      const wrapOffsetX = anchor.scrollLeft + (wrapRect.left - scRect.left);
      const wrapOffsetY = anchor.scrollTop + (wrapRect.top - scRect.top);

      const targetScrollLeft = wrapOffsetX + anchor.localX * ratio - anchor.mx;
      const targetScrollTop = wrapOffsetY + anchor.localY * ratio - anchor.my;

      scroller.scrollLeft = targetScrollLeft;
      scroller.scrollTop = targetScrollTop;

      pendingZoomAnchorRef.current = null;
    }

    render().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [doc, page, zoom]);

  // ---------------------------
  // PANNING (Option A)
  // - Select: drag empty space pans
  // - Edit: drag object moves; drag empty can pan
  // - Space + drag anywhere pans
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
    const pr = panRef.current;
    if (!pr.candidate || pr.active) return;

    const dx = e.clientX - pr.startX;
    const dy = e.clientY - pr.startY;
    if (Math.hypot(dx, dy) < 3) return;

    pr.active = true;
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

  function onPointerDownCapture(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const tool = markState.tool;

    if (spaceDownRef.current) {
      beginCandidatePan(e);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!panTools.has(tool)) return;

    const startedOnMark = isOnMark(e.target);

    if (tool === "select") {
      if (startedOnMark) return;
      beginCandidatePan(e);
      return;
    }

    if (tool === "edit") {
      if (startedOnMark) return;
      beginCandidatePan(e);
      return;
    }
  }

  function onPointerMoveCapture(e: React.PointerEvent) {
    activatePanIfNeeded(e);
    applyPan(e);

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

  const cursorStyle = useMemo(() => {
    if (spaceDownRef.current) return "grab";
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
          {/* ✅ NEW: attach pageWrapRef here */}
          <div ref={pageWrapRef} style={{ position: "relative", display: "inline-block" }}>
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
