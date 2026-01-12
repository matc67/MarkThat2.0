// src/app/sidebar/DefaultStylePanel.tsx
import React, { useMemo } from "react";
import type { MarkAction, MarkState } from "../markTypes";

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

export default function DefaultStylePanel(props: {
  defaultStyle: MarkState["defaultStyle"];
  dispatch: React.Dispatch<MarkAction>;
}) {
  const { defaultStyle, dispatch } = props;

  const fillIsTransparent = useMemo(() => {
    const s = (defaultStyle.fill ?? "").trim().toLowerCase();
    return s === "transparent" || s === "none";
  }, [defaultStyle.fill]);

  const fillOpacity01 = useMemo(() => parseOpacityFromRgba(defaultStyle.fill), [defaultStyle.fill]);
  const fillOpacityPct = Math.round(fillOpacity01 * 100);

  function setDefaultStyle(next: Partial<typeof defaultStyle>) {
    dispatch({ type: "SET_DEFAULT_STYLE", style: { ...defaultStyle, ...next } });
  }

  return (
    <div className="panel">
      <div className="panelTitleRow">
        <div className="panelTitle">Default Style</div>
        <div className="panelSub">Used when you create new markups</div>
      </div>

      <div className="kv">
        {/* Stroke */}
        <div>Stroke</div>
        <div>
          <input
            className="input"
            type="color"
            value={defaultStyle.stroke}
            onChange={(e) => setDefaultStyle({ stroke: e.target.value })}
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
            value={defaultStyle.strokeWidth}
            onChange={(e) => setDefaultStyle({ strokeWidth: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
          <div className="muted" style={{ width: 44, textAlign: "right" }}>
            {defaultStyle.strokeWidth}px
          </div>
        </div>

        {/* Fill Color */}
        <div>Fill</div>
        <div>
          <input
            className="input"
            type="color"
            value={defaultStyle.stroke /* base for UI picker */}
            onChange={(e) => {
              const op = fillIsTransparent ? 0.15 : fillOpacity01;
              setDefaultStyle({ fill: rgbaFromHex(e.target.value, op) });
            }}
            style={{ width: "100%", padding: 0, height: 34 }}
            disabled={fillIsTransparent}
          />

          <label className="checkRow" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={fillIsTransparent}
              onChange={(e) => {
                if (e.target.checked) setDefaultStyle({ fill: "transparent" });
                else setDefaultStyle({ fill: rgbaFromHex(defaultStyle.stroke, 0.15) });
              }}
            />
            <span>Transparent</span>
          </label>
        </div>

        {/* Opacity slider */}
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
              setDefaultStyle({ fill: rgbaFromHex(defaultStyle.stroke, op) });
            }}
            style={{ width: "100%" }}
          />
          <div className="muted" style={{ width: 44, textAlign: "right" }}>
            {fillIsTransparent ? "—" : `${fillOpacityPct}%`}
          </div>
        </div>
      </div>
    </div>
  );
}
