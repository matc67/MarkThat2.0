import React, { useMemo, useState } from "react";
import type { MarkAction, MarkState, PdfPoint, ScaleCal } from "./markTypes";

type Units = "mm" | "m" | "in" | "ft" | "ft-in";

type Props = {
  page: number;
  markState: MarkState;
  dispatch: React.Dispatch<MarkAction>;
};

function hypotPdf(a: PdfPoint, b: PdfPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const FRACTIONS = [
  { label: "0", value: 0 },
  { label: "1/2", value: 0.5 },
  { label: "1/4", value: 0.25 },
  { label: "3/4", value: 0.75 },
  { label: "1/8", value: 0.125 },
  { label: "3/8", value: 0.375 },
  { label: "5/8", value: 0.625 },
  { label: "7/8", value: 0.875 },
  { label: "1/16", value: 0.0625 },
  { label: "3/16", value: 0.1875 },
  { label: "5/16", value: 0.3125 },
  { label: "7/16", value: 0.4375 },
  { label: "9/16", value: 0.5625 },
  { label: "11/16", value: 0.6875 },
  { label: "13/16", value: 0.8125 },
  { label: "15/16", value: 0.9375 },
];

export default function ScalePanel({ page, markState, dispatch }: Props) {
  const draftScale = useMemo(() => {
    const d = markState.draft;
    if (!d || d.kind !== "scale" || d.page !== page) return null;
    if (!d.a || !d.b) return null;
    return { a: d.a, b: d.b };
  }, [markState.draft, page]);

  const [units, setUnits] = useState<Units>("ft");
  const [num, setNum] = useState<string>("10");

  // ft-in-fraction inputs
  const [feet, setFeet] = useState<string>("10");
  const [inches, setInches] = useState<string>("0");
  const [frac, setFrac] = useState<number>(0);

  const pdfDist = draftScale ? hypotPdf(draftScale.a, draftScale.b) : 0;

  const canApply = !!draftScale && pdfDist > 0;

  function currentScaleLabel() {
    const s = markState.scale;
    if (!s) return "Not set";
    if (s.page !== page) return `Set (page ${s.page})`;
    return `Set: ${s.realDistance.toFixed(4)} ${s.units} / PDF-point`;
  }

  function computeRealDistance(): { real: number; storeUnits: ScaleCal["units"] } | null {
    if (units === "ft-in") {
      const f = Number(feet);
      const inch = Number(inches);
      if (!Number.isFinite(f) || f < 0) return null;
      if (!Number.isFinite(inch) || inch < 0) return null;

      // total feet in decimal:
      const totalInches = f * 12 + inch + frac;
      const totalFeet = totalInches / 12;

      if (!(totalFeet > 0)) return null;
      return { real: totalFeet, storeUnits: "ft" };
    }

    const v = Number(num);
    if (!Number.isFinite(v) || v <= 0) return null;

    // storeUnits must match your ScaleCal union; assuming "mm" | "m" | "in" | "ft"
    return { real: v, storeUnits: units as any };
  }

  function onApply() {
    if (!draftScale) return;
    const parsed = computeRealDistance();
    if (!parsed) return;

    const { real, storeUnits } = parsed;
    const unitsPerPdfPoint = real / pdfDist;

    const scale: ScaleCal = {
      page,
      a: draftScale.a,
      b: draftScale.b,
      realDistance: real,
      units: storeUnits,
      unitsPerPdfPoint,
    };

    dispatch({ type: "SET_SCALE", scale });
  }

  return (
    <div className="panel">
      <div className="panelTitleRow">
        <div className="panelTitle">Scale</div>
        <div className="panelSub">{currentScaleLabel()}</div>
      </div>

      {!draftScale ? (
        <div className="muted">
          Select the <b>Scale</b> tool, then click two points on the PDF.
        </div>
      ) : (
        <>
          <div className="muted" style={{ marginBottom: 10 }}>
            Line length captured. Now enter the real-world distance.
          </div>

          <div className="formRow">
            <label className="label">Units</label>
            <select className="select" value={units} onChange={(e) => setUnits(e.target.value as Units)}>
              <option value="mm">mm</option>
              <option value="m">m</option>
              <option value="in">inches</option>
              <option value="ft">feet</option>
              <option value="ft-in">feet + inches + fraction</option>
            </select>
          </div>

          {units !== "ft-in" ? (
            <div className="formRow">
              <label className="label">Distance</label>
              <input
                className="input"
                value={num}
                onChange={(e) => setNum(e.target.value)}
                inputMode="decimal"
                placeholder="e.g., 10"
              />
            </div>
          ) : (
            <div className="grid3">
              <div className="formRow">
                <label className="label">Feet</label>
                <input className="input" value={feet} onChange={(e) => setFeet(e.target.value)} inputMode="numeric" />
              </div>
              <div className="formRow">
                <label className="label">Inches</label>
                <input
                  className="input"
                  value={inches}
                  onChange={(e) => setInches(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="formRow">
                <label className="label">Fraction</label>
                <select className="select" value={frac} onChange={(e) => setFrac(Number(e.target.value))}>
                  {FRACTIONS.map((f) => (
                    <option key={f.label} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <button className="btnPrimary" onClick={onApply} disabled={!canApply}>
            Apply Scale
          </button>

          <div className="muted" style={{ marginTop: 10 }}>
            Tip: if you click a third time while in Scale tool, your reducer can choose whether to reset A/B (optional).
          </div>
        </>
      )}
    </div>
  );
}
