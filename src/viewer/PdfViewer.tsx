import React, { useEffect, useRef, useState } from "react";
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

export default function PdfViewer({
  file,
  page,
  zoom,
  onMeta,
  onRequestZoom,
  markState,
  dispatch,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);

  // Ctrl + scroll / pinch zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      const step = 0.1;
      const next = Math.min(5, Math.max(0.25, +(zoom + direction * step).toFixed(2)));
      onRequestZoom(next);
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, onRequestZoom]);

  // Load PDF when file changes
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

  // Render page when doc/page/zoom changes
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

  return (
    <div ref={scrollRef} style={{ height: "100%", overflow: "auto" }}>
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
