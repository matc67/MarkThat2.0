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
import type { Tool, Units, ScaleCal, PdfPoint, Mark } from "./app/markTypes";
import { exportPdfWithMarks } from "./app/exportPdf";

/**
 * UI-only units -> mapped to store Units
 * "ft-in-frac" stored as "ft"
 */
type UiUnits = "mm" | "m" | "in" | "ft" | "ft-in-frac";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseNumberLoose(s: string): number | null {
  const v = Number(String(s).trim());
  return Number.isFinite(v) ? v : null;
}

function parseFractionalInches(input: string): number | null {
  const s = input
    .toLowerCase()
    .replace(/["]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return null;

  const asNum = parseNumberLoose(s);
  if (asNum != null) return asNum;

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
 * ✅ fixed:
 * - accepts "", "0", "0.0" as 0
 * - accepts "3/8" style fractions
 */
function parseFracOrZero(s: string): number | null {
  const t = String(s ?? "").trim();
  if (!t || t === "0" || t === "0.0" || t === "0.00") return 0;

  // allow decimal too
  const asNum = parseNumberLoose(t);
  if (asNum != null) return asNum;

  const m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function formatScale(stateScale: ScaleCal | null | undefined) {
  if (!stateScale) return "Not set";
  return `${stateScale.realDistance} ${stateScale.units} (calibrated)`;
}

// rgba helper for fill opacity UI
function rgbaFromHex(hex: string, opacity: number) {
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return `rgba(96,165,250,${opacity})`;
  const s = m[1];
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, opacity));
  return `rgba(${r},${g},${b},${a})`;
}

function parseOpacityFromRgba(fill: string): number {
  const s = (fill ?? "").trim().toLowerCase();
  const m = s.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/);
  if (!m) return 0.15;
  const v = Number(m[1]);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.15;
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
  const [scaleUnits, setScaleUnits] = useState<UiUnits>("ft-in-frac");
  const [scaleInput, setScaleInput] = useState<string>("10"); // used for non ft-in-frac
  const [scaleFt, setScaleFt] = useState("0");
  const [scaleIn, setScaleIn] = useState("0");
  const [scaleFrac, setScaleFrac] = useState("0"); // e.g. 3/8 or 0
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

  const scaleDraft = useMemo(() => {
    if (!state.draft) return null;
    if (state.draft.kind !== "scale") return null;
    if (state.draft.page !== page) return null;
    return state.draft;
  }, [state.draft, page]);

  const canApplyScale = !!(scaleDraft?.a && scaleDraft?.b);

  function mapUiUnitsToStore(u: UiUnits): Units {
    if (u === "ft-in-frac") return "ft";
    return u as Units;
  }

  function parseScaleDistanceToStoreUnits(u: UiUnits): number | null {
    // mm / m / ft numeric
    if (u === "mm" || u === "m" || u === "ft") {
      const v = parseNumberLoose(scaleInput.trim());
      return v != null && v > 0 ? v : null;
    }

    // inches can be fractional
    if (u === "in") {
      const inches = parseFractionalInches(scaleInput.trim());
      return inches != null && inches > 0 ? inches : null;
    }

    // ft-in-frac uses 3 boxes
    const ft = parseNumberLoose(scaleFt) ?? 0;
    const inch = parseNumberLoose(scaleIn) ?? 0;
    const frac = parseFracOrZero(scaleFrac);
    if (frac == null) return null;

    const totalIn = inch + frac;
    const feet = ft + totalIn / 12;
    return feet > 0 ? feet : null;
  }

  function onApplyScale() {
    setScaleError(null);

    if (!scaleDraft?.a || !scaleDraft?.b) {
      setScaleError("Pick two points on the drawing first.");
      return;
    }

    const storeUnits = mapUiUnitsToStore(scaleUnits);
    const realDistance = parseScaleDistanceToStoreUnits(scaleUnits);

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
    dispatch({ type: "CANCEL_DRAFT" });
  }

  function onResetScalePick() {
    dispatch({ type: "CANCEL_DRAFT" });
    setScaleError(null);
  }

  useEffect(() => {
    if (state.tool !== "scale") setScaleError(null);
  }, [state.tool]);

  const selected = useMemo(() => {
    if (!state.selectedId) return null;
    return state.marks.find((m) => m.id === state.selectedId) ?? null;
  }, [state.marks, state.selectedId]);

  const totalsThisPage = useMemo(() => {
    if (!state.scale) return { line: undefined as number | undefined, area: undefined as number | undefined, perim: undefined as number | undefined };

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

  function patchSelected(patch: Partial<Mark>) {
    if (!selected) return;
    dispatch({ type: "UPDATE_MARK", id: selected.id, patch: patch as any });
  }

  // ---- Default Style UI state (kept directly in reducer state) ----
  const defaultStroke = state.defaultStyle.stroke;
  const defaultStrokeWidth = state.defaultStyle.strokeWidth;
  const defaultFillHexForUi = useMemo(() => {
    // if fill is rgba, we still show stroke as base color for fill
    return state.defaultStyle.stroke;
  }, [state.defaultStyle.stroke]);

  const defaultFillOpacity = useMemo(() => parseOpacityFromRgba(state.defaultStyle.fill), [state.defaultStyle.fill]);

  function setDefaultStyle(next: Partial<typeof state.defaultStyle>) {
    dispatch({ type: "SET_DEFAULT_STYLE", style: { ...state.defaultStyle, ...next } });
  }

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

        <div className="sidebar">
          {/* Default Style */}
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Default Style</div>

          <div className="kv" style={{ marginBottom: 12 }}>
            <div>Stroke</div>
            <div>
              <input
                className="input"
                type="color"
                value={defaultStroke}
                onChange={(e) => setDefaultStyle({ stroke: e.target.value })}
                style={{ width: "100%", padding: 0 }}
              />
            </div>

            <div>Width</div>
            <div>
              <input
                className="input"
                type="number"
                min={1}
                max={12}
                value={defaultStrokeWidth}
                onChange={(e) => setDefaultStyle({ strokeWidth: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                style={{ width: "100%" }}
              />
            </div>

            <div>Fill</div>
            <div>
              <input
                className="input"
                type="color"
                value={defaultFillHexForUi}
                onChange={(e) => {
                  const next = rgbaFromHex(e.target.value, defaultFillOpacity);
                  setDefaultStyle({ fill: next });
                }}
                style={{ width: "100%", padding: 0 }}
              />
            </div>

            <div>Opacity</div>
            <div>
              <input
                className="input"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={defaultFillOpacity}
                onChange={(e) => {
                  const op = Math.max(0, Math.min(1, Number(e.target.value) || 0));
                  setDefaultStyle({ fill: rgbaFromHex(defaultFillHexForUi, op) });
                }}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <hr style={{ margin: "12px 0", opacity: 0.2 }} />

          {/* Scale panel only when Scale tool is active */}
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
                    <option value="ft-in-frac">ft-in-frac</option>
                  </select>
                </div>

                <div>Length</div>
                <div>
                  {scaleUnits === "ft-in-frac" ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="input" value={scaleFt} onChange={(e) => setScaleFt(e.target.value)} placeholder="ft" style={{ width: "33%" }} />
                      <input className="input" value={scaleIn} onChange={(e) => setScaleIn(e.target.value)} placeholder="in" style={{ width: "33%" }} />
                      <input className="input" value={scaleFrac} onChange={(e) => setScaleFrac(e.target.value)} placeholder="frac (3/8 or 0)" style={{ width: "34%" }} />
                    </div>
                  ) : (
                    <input
                      className="input"
                      value={scaleInput}
                      onChange={(e) => setScaleInput(e.target.value)}
                      placeholder={scaleUnits === "in" ? `Example: 10 3/8` : "Example: 10"}
                      style={{ width: "100%" }}
                    />
                  )}
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

          {/* Selected object panel */}
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Selected Object</div>

          {!selected ? (
            <div className="muted" style={{ marginBottom: 14 }}>
              None selected. Use <b>Select</b> or <b>Edit</b>, then click an object.
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <div className="kv">
                <div>ID</div>
                <div className="muted">{selected.id}</div>

                <div>Type</div>
                <div className="muted">{selected.kind}</div>

                <div>Mode</div>
                <div>
                  <button className="btn" onClick={() => setTool("edit")}>
                    Edit
                  </button>
                </div>

                {/* Style overrides */}
                <div>Stroke</div>
                <div>
                  <input
                    className="input"
                    type="color"
                    value={(selected.style?.stroke as string) ?? state.defaultStyle.stroke}
                    onChange={(e) => patchSelected({ style: { ...(selected.style ?? {}), stroke: e.target.value } } as any)}
                    style={{ width: "100%", padding: 0 }}
                  />
                </div>

                <div>Width</div>
                <div>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={12}
                    value={selected.style?.strokeWidth ?? state.defaultStyle.strokeWidth}
                    onChange={(e) =>
                      patchSelected({
                        style: { ...(selected.style ?? {}), strokeWidth: Math.max(1, Math.min(12, Number(e.target.value) || 1)) },
                      } as any)
                    }
                    style={{ width: "100%" }}
                  />
                </div>

                {selected.kind !== "line" && selected.kind !== "text" && (
                  <>
                    <div>Fill</div>
                    <div>
                      <input
                        className="input"
                        type="color"
                        value={(selected.style?.stroke as string) ?? state.defaultStyle.stroke}
                        onChange={(e) => {
                          const op = parseOpacityFromRgba(selected.style?.fill ?? state.defaultStyle.fill);
                          patchSelected({ style: { ...(selected.style ?? {}), fill: rgbaFromHex(e.target.value, op) } } as any);
                        }}
                        style={{ width: "100%", padding: 0 }}
                      />
                    </div>

                    <div>Opacity</div>
                    <div>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={parseOpacityFromRgba(selected.style?.fill ?? state.defaultStyle.fill)}
                        onChange={(e) => {
                          const op = Math.max(0, Math.min(1, Number(e.target.value) || 0));
                          const baseHex = (selected.style?.stroke as string) ?? state.defaultStyle.stroke;
                          patchSelected({ style: { ...(selected.style ?? {}), fill: rgbaFromHex(baseHex, op) } } as any);
                        }}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </>
                )}

                {selected.kind === "text" && (
                  <>
                    <div>Text</div>
                    <div>
                      <input
                        className="input"
                        value={(selected as any).text ?? ""}
                        onChange={(e) => patchSelected({ text: e.target.value } as any)}
                        style={{ width: "100%" }}
                      />
                    </div>

                    <div>Size</div>
                    <div>
                      <input
                        className="input"
                        type="number"
                        min={6}
                        max={72}
                        value={(selected as any).fontSize ?? 14}
                        onChange={(e) => patchSelected({ fontSize: Math.max(6, Math.min(72, Number(e.target.value) || 14)) } as any)}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </>
                )}

                {/* Measurements */}
                <div>Measurements</div>
                <div className="muted">
                  {state.scale
                    ? (() => {
                        const parts: string[] = [];
                        const l = computeMarkLengthInUnits(state.scale, selected);
                        const a = computeMarkAreaInUnits(state.scale, selected);
                        const p = computeMarkPerimeterInUnits(state.scale, selected);
                        if (l != null) parts.push(`L ${l.toFixed(2)} ${state.scale.units}`);
                        if (a != null) parts.push(`A ${a.toFixed(2)} ${state.scale.units}²`);
                        if (p != null) parts.push(`P ${p.toFixed(2)} ${state.scale.units}`);
                        return parts.length ? parts.join(" • ") : "—";
                      })()
                    : "Set scale to measure"}
                </div>

                {selected.kind !== "line" && selected.kind !== "text" && (
                  <>
                    <div>Show area</div>
                    <div>
                      <input
                        type="checkbox"
                        checked={!!selected.measure?.showArea}
                        onChange={(e) => patchSelected({ measure: { ...(selected.measure ?? {}), showArea: e.target.checked } } as any)}
                      />
                    </div>

                    <div>Show perimeter</div>
                    <div>
                      <input
                        type="checkbox"
                        checked={!!selected.measure?.showPerimeter}
                        onChange={(e) => patchSelected({ measure: { ...(selected.measure ?? {}), showPerimeter: e.target.checked } } as any)}
                      />
                    </div>

                    {(selected.kind === "polygon" || selected.kind === "rect") && (
                      <>
                        <div>Segment lengths</div>
                        <div>
                          <input
                            type="checkbox"
                            checked={!!selected.measure?.showSegmentLengths}
                            onChange={(e) =>
                              patchSelected({ measure: { ...(selected.measure ?? {}), showSegmentLengths: e.target.checked } } as any)
                            }
                          />
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button className="btn" onClick={() => dispatch({ type: "DELETE_SELECTED" })}>
                  Delete
                </button>
              </div>

              <hr style={{ marginTop: 14, opacity: 0.2 }} />
            </div>
          )}

          {/* Measurement panel */}
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
                : state.live?.perimeter != null
                ? `Perimeter: ${state.live.perimeter.toFixed(2)} ${state.scale?.units ?? ""}`
                : "—"}
            </div>

            <div>Total line length (page)</div>
            <div className="muted">
              {totalsThisPage.line != null && state.scale ? `${totalsThisPage.line.toFixed(2)} ${state.scale.units}` : "—"}
            </div>

            <div>Total area (page)</div>
            <div className="muted">
              {totalsThisPage.area != null && state.scale ? `${totalsThisPage.area.toFixed(2)} ${state.scale.units}²` : "—"}
            </div>

            <div>Total perimeter (page)</div>
            <div className="muted">
              {totalsThisPage.perim != null && state.scale ? `${totalsThisPage.perim.toFixed(2)} ${state.scale.units}` : "—"}
            </div>
          </div>

          <div style={{ marginTop: 14 }} className="muted">
            Tips: Line = 2 clicks • Polygon = click points + Enter/Double-click • Text = click to place • Edit = drag • Esc cancels • Ctrl/Cmd+Z undo
          </div>
        </div>
      </div>
    </div>
  );
}
