import React, { useEffect, useMemo, useState } from "react";
import type { MarkAction, MarkState, Draft, PdfPoint, ScaleCal, Units } from "../markTypes";

type UiUnits = "mm" | "m" | "in" | "ft" | "ft-in-frac";

function parseNumberLoose(s: string): number | null {
  const v = Number(String(s).trim());
  return Number.isFinite(v) ? v : null;
}

function parseFractionalInches(input: string): number | null {
  const s = input.toLowerCase().replace(/["]/g, "").replace(/\s+/g, " ").trim();
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

  const asNum = parseNumberLoose(t);
  if (asNum != null) return asNum;

  const m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;

  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function mapUiUnitsToStore(u: UiUnits): Units {
  if (u === "ft-in-frac") return "ft";
  return u as Units;
}

export default function ScalePanel(props: {
  page: number;
  tool: MarkState["tool"];
  draft: Draft | null;
  scale: MarkState["scale"];
  dispatch: React.Dispatch<MarkAction>;
}) {
  const { page, draft, dispatch } = props;

  // Local UI state
  const [scaleUnits, setScaleUnits] = useState<UiUnits>("ft-in-frac");
  const [scaleInput, setScaleInput] = useState<string>("10");
  const [scaleFt, setScaleFt] = useState("0");
  const [scaleIn, setScaleIn] = useState("0");
  const [scaleFrac, setScaleFrac] = useState("0");
  const [scaleError, setScaleError] = useState<string | null>(null);

  const scaleDraft = useMemo(() => {
    if (!draft) return null;
    if (draft.kind !== "scale") return null;
    if (draft.page !== page) return null;
    return draft;
  }, [draft, page]);

  const canApplyScale = !!(scaleDraft?.a && scaleDraft?.b);

  function parseScaleDistanceToStoreUnits(u: UiUnits): number | null {
    if (u === "mm" || u === "m" || u === "ft") {
      const v = parseNumberLoose(scaleInput.trim());
      return v != null && v > 0 ? v : null;
    }

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

  // Clear error if they leave Scale tool (draft gets nulled / changes)
  useEffect(() => {
    setScaleError(null);
  }, [page]);

  return (
    <div className="panel">
      <div className="panelTitleRow">
        <div className="panelTitle">Scale</div>
        <div className="panelSub">Click 2 points → enter real length → apply</div>
      </div>

      <div className="kv" style={{ marginBottom: 8 }}>
        <div>Pick</div>
        <div className="muted">
          {canApplyScale ? "2 points selected" : scaleDraft?.a ? "Pick second point…" : "Pick first point…"}
        </div>

        <div>Units</div>
        <div>
          <select className="input" value={scaleUnits} onChange={(e) => setScaleUnits(e.target.value as UiUnits)} style={{ width: "100%" }}>
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
              <input
                className="input"
                value={scaleFrac}
                onChange={(e) => setScaleFrac(e.target.value)}
                placeholder="frac (3/8 or 0)"
                style={{ width: "34%" }}
              />
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
        <button className={`btn btnPrimary`} onClick={onApplyScale} disabled={!canApplyScale}>
          Apply scale
        </button>
      </div>

      <div style={{ marginTop: 10 }} className="muted">
        Tip: inches can be <b>10 3/8</b>. ft-in-frac uses the three boxes.
      </div>
    </div>
  );
}
