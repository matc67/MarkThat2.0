import React, { useEffect, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";

import { loadPdfFromArrayBuffer, PdfDoc } from "./pdfjs";
import SvgOverlay from "./SvgOverlay";

type Props = {
  file?: File;
  page: number;
  zoom: number;
  onMeta: (meta: { pages: number }) => void;
  onRequestZoom: (nextZoom: number) => void; // ctrl+scroll / pinch zoom
};

export default function PdfViewer({
  file,
  page,
  zoom,
  onMeta,
  onRequestZoom,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);

  // Ctrl + scroll (and trackpad pinch on macOS) zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;

      e.preventDefault();

      // deltaY > 0 => usually zoom out
      const direction = e.deltaY > 0 ? -1 : 1;
      const step = 0.1;

      const next = Math.min(5, Math.max(0.25, +(zoom + direction * step).toFixed(2)));
      onRequestZoom(next);
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel as any);
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
      if (!doc || !pdfCanvasRef.current) return;

      const pageObj = await doc.getPage(page);
      if (cancelled) return;

      const vp = pageObj.getViewport({ scale: zoom });
      setViewport(vp);

      const canvas = pdfCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);

      // Keep overlay perfectly aligned (same pixel size as PDF canvas)
      if (overlayRef.current) {
        overlayRef.current.style.width = `${canvas.width}px`;
        overlayRef.current.style.height = `${canvas.height}px`;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const task = pageObj.render({ canvasContext: ctx, viewport: vp });
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
        <div className="dropHint">
          Open a PDF using the button above or drag/drop into the viewer area.
        </div>
      ) : (
        <div style={{ padding: 18 }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <canvas ref={pdfCanvasRef} />

            {/* Overlay container stays same size as canvas */}
            <div
              ref={overlayRef}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
              }}
            >
              <SvgOverlay viewport={viewport} containerRef={overlayRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
