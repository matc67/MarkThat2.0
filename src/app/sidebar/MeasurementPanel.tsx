import React from "react";
import type { MarkState } from "../markTypes";

function formatScale(scale: MarkState["scale"]) {
  if (!scale) return "Not set";
  return `${scale.realDistance} ${scale.units} (calibrated)`;
}

export default function MeasurementPanel(props: {
  tool: MarkState["tool"];
  scale: MarkState["scale"];
  live: MarkState["live"];
  totalsThisPage: { line?: number; area?: number; perim?: number };
}) {
  const { tool, scale, live, totalsThisPage } = props;

  return (
    <div className="panel">
      <div className="panelTitleRow">
        <div className="panelTitle">Measurements</div>
        <div className="panelSub">Live readouts + page totals</div>
      </div>

      <div className="kv">
        <div>Scale</div>
        <div className="muted">{formatScale(scale)}</div>

        <div>Tool</div>
        <div className="muted">{tool}</div>

        <div>Live</div>
        <div className="muted">
          {live?.length != null
            ? `Length: ${live.length.toFixed(2)} ${scale?.units ?? ""}`
            : live?.area != null
            ? `Area: ${live.area.toFixed(2)} ${(scale?.units ?? "")}²`
            : live?.perimeter != null
            ? `Perimeter: ${live.perimeter.toFixed(2)} ${scale?.units ?? ""}`
            : "—"}
        </div>

        <div>Total line</div>
        <div className="muted">{totalsThisPage.line != null && scale ? `${totalsThisPage.line.toFixed(2)} ${scale.units}` : "—"}</div>

        <div>Total area</div>
        <div className="muted">{totalsThisPage.area != null && scale ? `${totalsThisPage.area.toFixed(2)} ${scale.units}²` : "—"}</div>

        <div>Total perim</div>
        <div className="muted">{totalsThisPage.perim != null && scale ? `${totalsThisPage.perim.toFixed(2)} ${scale.units}` : "—"}</div>
      </div>

      <div style={{ marginTop: 14 }} className="muted">
        Tips: Line = 2 clicks • Polygon = click points + Enter/Double-click • Text = click to place • Edit = drag • Esc cancels • Ctrl/Cmd+Z undo
      </div>
    </div>
  );
}
