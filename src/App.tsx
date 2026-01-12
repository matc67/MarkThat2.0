// src/App.tsx
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./app/styles.css";

import PdfViewer from "./viewer/PdfViewer";
import {
  initialHistory,
  markHistoryReducer,
  computeMarkAreaInUnits,
  computeMarkLengthInUnits,
  computeMarkPerimeterInUnits,
} from "./app/markStore";
import type { Tool, Mark } from "./app/markTypes";
import { exportPdfWithMarks } from "./app/exportPdf";

import Sidebar from "./app/sidebar/Sidebar";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function App() {
  const [file, setFile] = useState<File | undefined>(undefined);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.2);

  const [hist, dispatch] = useReducer(markHistoryReducer, initialHistory);
  const state = hist.present;

  const viewerDropRef = useRef<HTMLDivElement | null>(null);

  const onMeta = useCallback((m: { pages: number }) => {
    setPages(m.pages);
    setPage((prev) => (m.pages ? clamp(prev, 1, m.pages) : 1));
  }, []);

  function clampPage(next: number) {
    if (!pages) return 1;
    return clamp(next, 1, pages);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf") return;
    setFile(f);
    setPage(1);
  }

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

  // Keyboard shortcuts: Esc, Undo/Redo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape") {
        dispatch({ type: "CANCEL_DRAFT" });
        return;
      }

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: "REDO" });
        else dispatch({ type: "UNDO" });
        return;
      }

      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // --- Download helpers ---
  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onDownloadPdf() {
    if (!file) return;

    try {
      const originalPdfBytes = await file.arrayBuffer();
      const outBytes = await exportPdfWithMarks({ originalPdfBytes, markState: state });

      const outBlob = new Blob([new Uint8Array(outBytes)], { type: "application/pdf" });

      const base = file.name?.replace(/\.pdf$/i, "") || "marked";
      downloadBlob(outBlob, `${base}-marked.pdf`);
    } catch (err) {
      console.error(err);
      alert("Failed to export PDF. Check console for details.");
    }
  }

  function setTool(tool: Tool) {
    dispatch({ type: "SET_TOOL", tool });
  }

  const selected = useMemo(() => {
    if (!state.selectedId) return null;
    return state.marks.find((m) => m.id === state.selectedId) ?? null;
  }, [state.marks, state.selectedId]);

  function patchSelected(patch: Partial<Mark>) {
    if (!selected) return;
    dispatch({ type: "UPDATE_MARK", id: selected.id, patch: patch as any });
  }

  const totalsThisPage = useMemo(() => {
    if (!state.scale)
      return {
        line: undefined as number | undefined,
        area: undefined as number | undefined,
        perim: undefined as number | undefined,
      };

    const marks = state.marks.filter((m) => m.page === page);
    let line = 0;
    let area = 0;
    let perim = 0;

    for (const m of marks) {
      const l = computeMarkLengthInUnits(state.scale, m);
      if (l != null) line += l;

      const a = computeMarkAreaInUnits(state.scale, m);
      if (a != null) area += a;

      const p = computeMarkPerimeterInUnits(state.scale, m);
      if (p != null) perim += p;
    }

    return { line, area, perim };
  }, [state.marks, state.scale, page]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">MarkThat</div>
        <div className="muted">PDF takeoffs (MVP)</div>

        <label className="file">
          <span className="muted">Open PDF</span>
          <input type="file" accept="application/pdf" onChange={onPickFile} />
        </label>

        <div className="toolGroup">
          <button className={`btn ${state.tool === "select" ? "btnOn" : ""}`} onClick={() => setTool("select")}>
            Select
          </button>
          <button className={`btn ${state.tool === "edit" ? "btnOn" : ""}`} onClick={() => setTool("edit")}>
            Edit
          </button>
          <button className={`btn ${state.tool === "scale" ? "btnOn" : ""}`} onClick={() => setTool("scale")}>
            Scale
          </button>
          <button className={`btn ${state.tool === "line" ? "btnOn" : ""}`} onClick={() => setTool("line")}>
            Line
          </button>
          <button className={`btn ${state.tool === "polygon" ? "btnOn" : ""}`} onClick={() => setTool("polygon")}>
            Polygon
          </button>
          <button className={`btn ${state.tool === "rect" ? "btnOn" : ""}`} onClick={() => setTool("rect")}>
            Rect
          </button>
          <button className={`btn ${state.tool === "circle" ? "btnOn" : ""}`} onClick={() => setTool("circle")}>
            Circle
          </button>
          <button className={`btn ${state.tool === "text" ? "btnOn" : ""}`} onClick={() => setTool("text")}>
            Text
          </button>
        </div>

        <button className="btn" onClick={() => dispatch({ type: "UNDO" })} disabled={hist.past.length === 0}>
          Undo
        </button>
        <button className="btn" onClick={() => dispatch({ type: "REDO" })} disabled={hist.future.length === 0}>
          Redo
        </button>

        <button className="btn" onClick={onDownloadPdf} disabled={!file}>
          Download PDF
        </button>

        <button className="btn" onClick={() => setPage((p) => clampPage(p - 1))} disabled={!file || page <= 1}>
          Prev
        </button>
        <button className="btn" onClick={() => setPage((p) => clampPage(p + 1))} disabled={!file || page >= pages}>
          Next
        </button>

        <button className="btn" onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))} disabled={!file}>
          -
        </button>
        <button className="btn" onClick={() => setZoom((z) => Math.min(5, +(z + 0.1).toFixed(2)))} disabled={!file}>
          +
        </button>

        <div className="muted" style={{ marginLeft: "auto" }}>
          {file ? `Page ${page} / ${pages} • Zoom ${(zoom * 100).toFixed(0)}%` : "No PDF loaded"}
        </div>
      </div>

      <div className="main">
        <div className="viewerShell" ref={viewerDropRef} onDragOver={dropHandlers.onDragOver} onDrop={dropHandlers.onDrop}>
          <PdfViewer
            file={file}
            page={page}
            zoom={zoom}
            onMeta={onMeta}
            onRequestZoom={setZoom}
            markState={state}
            dispatch={dispatch}
          />
        </div>

        <Sidebar
          page={page}
          tool={state.tool}
          draft={state.draft}
          scale={state.scale}
          live={state.live}
          totalsThisPage={totalsThisPage}
          defaultStyle={state.defaultStyle}
          selected={selected}
          dispatch={dispatch}
          setTool={setTool}
          patchSelected={patchSelected}
        />
      </div>
    </div>
  );
}
