// src/app/sidebar/SelectedObjectPanel.tsx
import React, { useMemo } from "react";
import type { MarkAction, MarkState, Mark, Tool } from "../markTypes";
import { computeMarkAreaInUnits, computeMarkLengthInUnits, computeMarkPerimeterInUnits } from "../markStore";

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
  if (!s || s === "transparent" || s === "none") return 0.15;
  const m = s.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/);
  if (!m) return 0.15;
  const v = Number(m[1]);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.15;
}

export default function SelectedObjectPanel(props: {
  selected: Mark | null;
  defaultStyle: MarkState["defaultStyle"];
  scale: MarkState["scale"];
  dispatch: React.Dispatch<MarkAction>;
  setTool: (t: Tool) => void;
  patchSelected: (patch: Partial<Mark>) => void;
}) {
  const { selected, defaultStyle, scale, dispatch, setTool, patchSelected } = props;

  const strokeHex = (selected?.style?.stroke as string) ?? defaultStyle.stroke;
  const strokeWidth = selected?.style?.strokeWidth ?? defaultStyle.strokeWidth;

  const fillRaw = selected?.style?.fill ?? defaultStyle.fill;

  const fillIsTransparent = useMemo(() => {
    const s = (fillRaw ?? "").trim().toLowerCase();
    return s === "transparent" || s === "none";
  }, [fillRaw]);

  const fillOpacity01 = useMemo(() => parseOpacityFromRgba(fillRaw), [fillRaw]);
  const fillOpacityPct = Math.round(fillOpacity01 * 100);

  return (
    <div className="panel">
      <div className="panelTitleRow">
        <div className="panelTitle">Selected</div>
        <div className="panelSub">{selected ? `${selected.kind} • ${selected.id}` : "Nothing selected"}</div>
      </div>

      {!selected ? (
        <div className="muted">
          Use <b>Select</b> or <b>Edit</b>, then click a markup.
        </div>
      ) : (
        <>
          <div className="rowBtns">
            <button className="btn" onClick={() => setTool("edit")}>
              Edit
            </button>
            <button className="btnDanger" onClick={() => dispatch({ type: "DELETE_SELECTED" })}>
              Delete
            </button>
          </div>

          <hr className="hr" />

          <div className="kv">
            {/* Stroke */}
            <div>Stroke</div>
            <div>
              <input
                className="input"
                type="color"
                value={strokeHex}
                onChange={(e) => patchSelected({ style: { ...(selected.style ?? {}), stroke: e.target.value } } as any)}
                style={{ width: "100%", padding: 0, height: 34 }}
              />
            </div>

            {/* Width slider */}
            <div>Width</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="range"
                min={1}
                max={12}
                value={strokeWidth}
                onChange={(e) =>
                  patchSelected({ style: { ...(selected.style ?? {}), strokeWidth: Number(e.target.value) } } as any)
                }
                style={{ width: "100%" }}
              />
              <div className="muted" style={{ width: 44, textAlign: "right" }}>
                {strokeWidth}px
              </div>
            </div>

            {/* Fill only for shapes */}
            {selected.kind !== "line" && selected.kind !== "text" && (
              <>
                <div>Fill</div>
                <div>
                  <input
                    className="input"
                    type="color"
                    value={strokeHex /* we don't store base fill hex separately; use UI base */}
                    disabled={fillIsTransparent}
                    onChange={(e) => {
                      const op = fillIsTransparent ? 0.15 : fillOpacity01;
                      patchSelected({ style: { ...(selected.style ?? {}), fill: rgbaFromHex(e.target.value, op) } } as any);
                    }}
                    style={{ width: "100%", padding: 0, height: 34 }}
                  />

                  <label className="checkRow" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={fillIsTransparent}
                      onChange={(e) => {
                        if (e.target.checked) patchSelected({ style: { ...(selected.style ?? {}), fill: "transparent" } } as any);
                        else patchSelected({ style: { ...(selected.style ?? {}), fill: rgbaFromHex(strokeHex, 0.15) } } as any);
                      }}
                    />
                    <span>Transparent</span>
                  </label>
                </div>

                <div>Opacity</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={fillIsTransparent ? 0 : fillOpacityPct}
                    disabled={fillIsTransparent}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      const op = Math.max(0, Math.min(1, pct / 100));
                      patchSelected({ style: { ...(selected.style ?? {}), fill: rgbaFromHex(strokeHex, op) } } as any);
                    }}
                    style={{ width: "100%" }}
                  />
                  <div className="muted" style={{ width: 44, textAlign: "right" }}>
                    {fillIsTransparent ? "—" : `${fillOpacityPct}%`}
                  </div>
                </div>
              </>
            )}

            {/* Text editing */}
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
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="range"
                    min={8}
                    max={72}
                    value={(selected as any).fontSize ?? 14}
                    onChange={(e) => patchSelected({ fontSize: Number(e.target.value) } as any)}
                    style={{ width: "100%" }}
                  />
                  <div className="muted" style={{ width: 44, textAlign: "right" }}>
                    {((selected as any).fontSize ?? 14)}px
                  </div>
                </div>
              </>
            )}

            {/* Measurements */}
            <div>Measure</div>
            <div className="muted">
              {scale
                ? (() => {
                    const parts: string[] = [];
                    const l = computeMarkLengthInUnits(scale, selected);
                    const a = computeMarkAreaInUnits(scale, selected);
                    const p = computeMarkPerimeterInUnits(scale, selected);
                    if (l != null) parts.push(`L ${l.toFixed(2)} ${scale.units}`);
                    if (a != null) parts.push(`A ${a.toFixed(2)} ${scale.units}²`);
                    if (p != null) parts.push(`P ${p.toFixed(2)} ${scale.units}`);
                    return parts.length ? parts.join(" • ") : "—";
                  })()
                : "Set scale to measure"}
            </div>
          </div>

          {selected.kind !== "line" && selected.kind !== "text" && (
            <>
              <hr className="hr" />
              <div className="checks">
                <label className="checkRow">
                  <input
                    type="checkbox"
                    checked={!!selected.measure?.showArea}
                    onChange={(e) => patchSelected({ measure: { ...(selected.measure ?? {}), showArea: e.target.checked } } as any)}
                  />
                  <span>Show area label</span>
                </label>

                <label className="checkRow">
                  <input
                    type="checkbox"
                    checked={!!selected.measure?.showPerimeter}
                    onChange={(e) => patchSelected({ measure: { ...(selected.measure ?? {}), showPerimeter: e.target.checked } } as any)}
                  />
                  <span>Show perimeter label</span>
                </label>

                {(selected.kind === "polygon" || selected.kind === "rect") && (
                  <label className="checkRow">
                    <input
                      type="checkbox"
                      checked={!!selected.measure?.showSegmentLengths}
                      onChange={(e) =>
                        patchSelected({ measure: { ...(selected.measure ?? {}), showSegmentLengths: e.target.checked } } as any)
                      }
                    />
                    <span>Show segment lengths</span>
                  </label>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
