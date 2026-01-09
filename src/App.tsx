import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./app/styles.css";

import PdfViewer from "./viewer/PdfViewer";
import { initialHistory, markHistoryReducer, computeAreaInUnits2, computeLengthInUnits } from "./app/markStore";
import type { Tool, Units, ScaleCal, PdfPoint } from "./app/markTypes";

/**
 * UI-only units (includes ft-in fractional option) -> mapped to your store Units.
 * We keep store Units unchanged. "ft-in" is stored as "ft" under the hood.
 */
type UiUnits = "mm" | "m" | "in" | "ft" | "ft-in";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseNumberLoose(s: string): number | null {
  const v = Number(String(s).trim());
  return Number.isFinite(v) ? v : null;
}

/**
 * Accepts:
 * - "10"
 * - "10.5"
 * - "10 3/4"
 * - "3/4"
 * - "10-3/4"
 * - "10 3/4\""
 */
function parseFractionalInches(input: string): number | null {
  const s = input
    .toLowerCase()
    .replace(/["]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return null;

  // Pure number
  const asNum = parseNumberLoose(s);
  if (asNum != null) return asNum;

  // "a b/c" or "a-b/c"
  const m = s.match(/^(\d+)?(?:\s*[-\s]\s*)?(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const whole = m[1] ? Number(m[1]) : 0;
    const num = Number(m[2]);
    const den = Number(m[3]);
    if (!Number.isFinite(whole) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return whole + num / den;
  }

  return null;
}

/**
 * Accepts:
 * - "10' 6 1/2"
 * - "10' 6-1/2"
 * - "10 6 1/2"  (we’ll allow missing ')
 * - "10'" (feet only)
 * - "6 1/2" (assume inches only)
 */
function parseFeetInchesFraction(input: string): number | null {
  const s = input
    .toLowerCase()
    .replace(/″|”/g, '"')
    .replace(/′|’/g, "'")
    .replace(/["]/g, "") // we don't need inches quote
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return null;

  // If includes a feet marker '
  if (s.includes("'")) {
    const [feetPartRaw, restRaw] = s.split("'");
    const feet = parseNumberLoose(feetPartRaw.trim());
    if (feet == null) return null;

    const rest = (restRaw ?? "").trim();
    if (!rest) return feet; // feet only

    // rest can be "6", "6 1/2", "6-1/2", "1/2"
    const inches = parseFractionalInches(rest);
    if (inches == null) return null;

    return feet + inches / 12;
  }

  // No feet marker: try "feet inches..." or just inches
  // If it looks like two parts: "10 6 1/2" => feet=10, inches="6 1/2"
  const parts = s.split(" ");
  if (parts.length >= 2) {
    const feet = parseNumberLoose(parts[0]);
    if (feet != null) {
      const inchesStr = parts.slice(1).join(" ");
      const inches = parseFractionalInches(inchesStr);
      if (inches == null) return null;
      return feet + inches / 12;
    }
  }

  // Otherwise treat as inches only
  const inchesOnly = parseFractionalInches(s);
  if (inchesOnly == null) return null;
  return inchesOnly / 12;
}

function formatScale(stateScale: ScaleCal | null | undefined) {
  if (!stateScale) return "Not set";
  return `${stateScale.realDistance} ${stateScale.units} (calibrated)`;
}

export default function App() {
  const [file, setFile] = useState<File | undefined>(undefined);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.2);

  const [hist, dispatch] = useReducer(markHistoryReducer, initialHistory);
  const state = hist.present;

  const viewerDropRef = useRef<HTMLDivElement | null>(null);

  // ---- Scale panel local UI state ----
  const [scaleUnits, setScaleUnits] = useState<UiUnits>("ft-in");
  const [scaleInput, setScaleInput] = useState<string>("10");
  const [scaleError, setScaleError] = useState<string | null>(null);

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

  const totalLengthThisPage = useMemo(() => {
    const lines = state.polylines.filter((p) => p.page === page);
    if (!state.scale) return undefined;
    let sum = 0;
    for (const l of lines) {
      const v = computeLengthInUnits(state.scale, l.points);
      if (v) sum += v;
    }
    return sum;
  }, [state.polylines, state.scale, page]);

  const totalAreaThisPage = useMemo(() => {
    const polys = state.polygons.filter((p) => p.page === page);
    if (!state.scale) return undefined;
    let sum = 0;
    for (const g of polys) {
      const v = computeAreaInUnits2(state.scale, g.points);
      if (v) sum += v;
    }
    return sum;
  }, [state.polygons, state.scale, page]);

  function setTool(tool: Tool) {
    dispatch({ type: "SET_TOOL", tool });
  }

  const scaleDraft = useMemo(() => {
    if (!state.draft) return null;
    if (state.draft.kind !== "scale") return null;
    if (state.draft.page !== page) return null;
    return state.draft;
  }, [state.draft, page]);

  const canApplyScale = !!(scaleDraft?.a && scaleDraft?.b);

  function mapUiUnitsToStore(u: UiUnits): Units {
    if (u === "ft-in") return "ft";
    return u as Units;
  }

  function parseScaleDistanceToStoreUnits(input: string, u: UiUnits): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (u === "mm" || u === "m") {
      const v = parseNumberLoose(trimmed);
      return v != null && v > 0 ? v : null;
    }

    if (u === "in") {
      const inches = parseFractionalInches(trimmed);
      return inches != null && inches > 0 ? inches : null;
    }

    if (u === "ft") {
      const v = parseNumberLoose(trimmed);
      return v != null && v > 0 ? v : null;
    }

    // ft-in fractional inches => store as feet
    const feet = parseFeetInchesFraction(trimmed);
    return feet != null && feet > 0 ? feet : null;
  }

  function onApplyScale() {
    setScaleError(null);

    if (!scaleDraft?.a || !scaleDraft?.b) {
      setScaleError("Pick two points on the drawing first.");
      return;
    }

    const storeUnits = mapUiUnitsToStore(scaleUnits);
    const realDistance = parseScaleDistanceToStoreUnits(scaleInput, scaleUnits);

    if (realDistance == null || !Number.isFinite(realDistance) || realDistance <= 0) {
      setScaleError("Enter a valid real-world length.");
      return;
    }

    const a: PdfPoint = scaleDraft.a;
    const b: PdfPoint = scaleDraft.b;

    const pdfDist = Math.hypot(a.x - b.x, a.y - b.y);
    if (!Number.isFinite(pdfDist) || pdfDist <= 0) {
      setScaleError("Invalid points (distance is zero). Try again.");
      return;
    }

    const scale: ScaleCal = {
      page,
      a,
      b,
      realDistance,
      units: storeUnits,
      unitsPerPdfPoint: realDistance / pdfDist,
    };

    dispatch({ type: "SET_SCALE", scale });
    dispatch({ type: "CANCEL_DRAFT" }); // exit scale draft after applying
  }

  function onResetScalePick() {
    // Clear current draft so user can click A/B again
    dispatch({ type: "CANCEL_DRAFT" });
    setScaleError(null);
  }

  // If user switches away from scale tool, clear scale error (UI nicety)
  useEffect(() => {
    if (state.tool !== "scale") setScaleError(null);
  }, [state.tool]);

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
          <button className={`btn ${state.tool === "scale" ? "btnOn" : ""}`} onClick={() => setTool("scale")}>
            Scale
          </button>
          <button className={`btn ${state.tool === "polyline" ? "btnOn" : ""}`} onClick={() => setTool("polyline")}>
            Length
          </button>
          <button className={`btn ${state.tool === "polygon" ? "btnOn" : ""}`} onClick={() => setTool("polygon")}>
            Area
          </button>
        </div>

        <button className="btn" onClick={() => dispatch({ type: "UNDO" })} disabled={hist.past.length === 0}>
          Undo
        </button>
        <button className="btn" onClick={() => dispatch({ type: "REDO" })} disabled={hist.future.length === 0}>
          Redo
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

        <div className="sidebar">
          {/* Clean Scale panel only when Scale tool is active */}
          {state.tool === "scale" && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Scale</div>

              <div className="kv">
                <div>Pick</div>
                <div className="muted">
                  {canApplyScale ? "2 points selected" : scaleDraft?.a ? "Pick second point…" : "Pick first point…"}
                </div>

                <div>Units</div>
                <div>
                  <select
                    className="input"
                    value={scaleUnits}
                    onChange={(e) => setScaleUnits(e.target.value as UiUnits)}
                    style={{ width: "100%" }}
                  >
                    <option value="mm">mm</option>
                    <option value="m">m</option>
                    <option value="in">in</option>
                    <option value="ft">ft</option>
                    <option value="ft-in">ft-in (fraction)</option>
                  </select>
                </div>

                <div>Length</div>
                <div>
                  <input
                    className="input"
                    value={scaleInput}
                    onChange={(e) => setScaleInput(e.target.value)}
                    placeholder={scaleUnits === "ft-in" ? `Example: 10' 6 1/2` : "Example: 10"}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              {scaleError && (
                <div style={{ marginTop: 10 }} className="muted">
                  <span style={{ color: "#fb7185" }}>{scaleError}</span>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button className="btn" onClick={onResetScalePick} disabled={!scaleDraft}>
                  Reset points
                </button>
                <button className={`btn ${canApplyScale ? "btnOn" : ""}`} onClick={onApplyScale} disabled={!canApplyScale}>
                  Apply scale
                </button>
              </div>

              <div style={{ marginTop: 10 }} className="muted">
                Tip: Click two points on the drawing, then enter the real length and apply.
              </div>

              <hr style={{ marginTop: 14, opacity: 0.2 }} />
            </div>
          )}

          <div style={{ fontWeight: 900, marginBottom: 10 }}>Measurement Panel</div>

          <div className="kv">
            <div>Scale</div>
            <div className="muted">{formatScale(state.scale)}</div>

            <div>Tool</div>
            <div className="muted">{state.tool}</div>

            <div>Live</div>
            <div className="muted">
              {state.live?.length != null
                ? `Length: ${state.live.length.toFixed(2)} ${state.scale?.units ?? ""}`
                : state.live?.area != null
                ? `Area: ${state.live.area.toFixed(2)} ${(state.scale?.units ?? "")}²`
                : "—"}
            </div>

            <div>Total length (page)</div>
            <div className="muted">
              {totalLengthThisPage != null && state.scale ? `${totalLengthThisPage.toFixed(2)} ${state.scale.units}` : "—"}
            </div>

            <div>Total area (page)</div>
            <div className="muted">
              {totalAreaThisPage != null && state.scale ? `${totalAreaThisPage.toFixed(2)} ${state.scale.units}²` : "—"}
            </div>
          </div>

          <div style={{ marginTop: 14 }} className="muted">
            Tips: Double-click to finish • Esc cancels • Ctrl/Cmd+Z undo
          </div>
        </div>
      </div>
    </div>
  );
}
