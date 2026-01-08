import React, { useCallback, useMemo, useRef, useState } from "react";
import "./app/styles.css";
import PdfViewer from "./viewer/PdfViewer";

export default function App() {
  const [file, setFile] = useState<File | undefined>(undefined);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.2);

  const viewerDropRef = useRef<HTMLDivElement | null>(null);

  const onMeta = useCallback((m: { pages: number }) => {
    setPages(m.pages);
    setPage((prev) => (m.pages ? Math.min(Math.max(prev, 1), m.pages) : 1));
  }, []);

  function clampPage(next: number) {
    if (!pages) return 1;
    return Math.min(Math.max(next, 1), pages);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPage(1);
  }

  // Drag/drop support (MVP)
  const dropHandlers = useMemo(() => {
    function onDragOver(e: React.DragEvent) {
      e.preventDefault();
    }
    function onDrop(e: React.DragEvent) {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      if (f.type !== "application/pdf") return;
      setFile(f);
      setPage(1);
    }
    return { onDragOver, onDrop };
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">MarkThat</div>
        <div className="muted">PDF takeoffs (MVP)</div>

        <label className="file">
          <span className="muted">Open PDF</span>
          <input type="file" accept="application/pdf" onChange={onPickFile} />
        </label>

        <button
          className="btn"
          onClick={() => setPage((p) => clampPage(p - 1))}
          disabled={!file || page <= 1}
        >
          Prev
        </button>
        <button
          className="btn"
          onClick={() => setPage((p) => clampPage(p + 1))}
          disabled={!file || page >= pages}
        >
          Next
        </button>

        <button
          className="btn"
          onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))}
          disabled={!file}
          title="Zoom out"
        >
          -
        </button>
        <button
          className="btn"
          onClick={() => setZoom((z) => Math.min(5, +(z + 0.1).toFixed(2)))}
          disabled={!file}
          title="Zoom in"
        >
          +
        </button>

        <div className="muted" style={{ marginLeft: "auto" }}>
          {file ? `Page ${page} / ${pages} • Zoom ${(zoom * 100).toFixed(0)}%` : "No PDF loaded"}
        </div>
      </div>

      <div className="main">
        <div
          className="viewerShell"
          ref={viewerDropRef}
          onDragOver={dropHandlers.onDragOver}
          onDrop={dropHandlers.onDrop}
        >
          <PdfViewer file={file} page={page} zoom={zoom} onMeta={onMeta} />
        </div>

        <div className="sidebar">
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Measurement Panel (MVP)</div>
          <div className="kv">
            <div>Scale</div>
            <div className="muted">Not set</div>

            <div>Tool</div>
            <div className="muted">None</div>

            <div>Length</div>
            <div className="muted">—</div>

            <div>Area</div>
            <div className="muted">—</div>
          </div>

          <div style={{ marginTop: 14 }} className="muted">
            Next step: lock in viewport transforms + add SVG overlay + polyline tool.
          </div>
        </div>
      </div>
    </div>
  );
}
