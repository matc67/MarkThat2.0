// src/app/exportPdf.ts
import { PDFDocument, rgb } from "pdf-lib";
import type { MarkState, PdfPoint } from "./markTypes";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function hexToRgb01(hex: string) {
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const s = m[1];
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

// supports rgba(96,165,250,0.15) or rgb(96,165,250)
function cssRgbToRgb01(input: string) {
  const s = input.trim().toLowerCase();
  const m = s.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/
  );
  if (!m) return null;

  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = m[4] == null ? 1 : Number(m[4]);
  if (![r, g, b, a].every((v) => Number.isFinite(v))) return null;

  return { color: rgb(r / 255, g / 255, b / 255), opacity: clamp01(a) };
}

function parseCssColor(input: string | undefined | null): { color: any; opacity: number } | null {
  if (!input) return null;

  const asRgb = cssRgbToRgb01(input);
  if (asRgb) return asRgb;

  const asHex = hexToRgb01(input);
  if (asHex) return { color: asHex, opacity: 1 };

  return null;
}

function drawPolyline(
  page: any,
  pts: PdfPoint[],
  opts: { color: any; opacity: number; thickness: number; closed?: boolean }
) {
  if (pts.length < 2) return;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    page.drawLine({
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
      thickness: opts.thickness,
      color: opts.color,
      opacity: opts.opacity,
    });
  }
  if (opts.closed && pts.length >= 3) {
    const a = pts[pts.length - 1];
    const b = pts[0];
    page.drawLine({
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
      thickness: opts.thickness,
      color: opts.color,
      opacity: opts.opacity,
    });
  }
}

// ✅ Fill polygon using drawSvgPath (works in older pdf-lib versions)
function polygonToSvgPath(pts: PdfPoint[]) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  d += " Z";
  return d;
}

export async function exportPdfWithMarks(args: {
  originalPdfBytes: ArrayBuffer;
  markState: MarkState;
}): Promise<Uint8Array> {
  const { originalPdfBytes, markState } = args;

  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const pages = pdfDoc.getPages();

  const defaultStroke = rgb(96 / 255, 165 / 255, 250 / 255); // #60a5fa
  const defaultStrokeOpacity = 1;
  const defaultFillOpacity = 0.15;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNumber = i + 1;

    const marks = markState.marks.filter((m) => m.page === pageNumber);

    for (const m of marks) {
      const sw = m.style?.strokeWidth ?? 2;

      const strokeParsed = parseCssColor(m.style?.stroke);
      const strokeColor = strokeParsed?.color ?? defaultStroke;
      const strokeOpacity = strokeParsed?.opacity ?? defaultStrokeOpacity;

      const fillParsed = parseCssColor(m.style?.fill);
      const fillColor = fillParsed?.color ?? strokeColor;
      const fillOpacity =
        fillParsed?.opacity ??
        (m.kind === "rect" || m.kind === "circle" || m.kind === "polygon" ? defaultFillOpacity : 0);

      if (m.kind === "line") {
        page.drawLine({
          start: { x: m.a.x, y: m.a.y },
          end: { x: m.b.x, y: m.b.y },
          thickness: sw,
          color: strokeColor,
          opacity: strokeOpacity,
        });
        continue;
      }

      // ✅ Polygon: fill via drawSvgPath + outline via drawLine
      if (m.kind === "polygon") {
        if (m.points.length < 2) continue;

        if (m.points.length >= 3 && fillOpacity > 0) {
          const d = polygonToSvgPath(m.points);

          // pdf-lib typings vary, so cast to any
          (page as any).drawSvgPath(d, {
            color: fillColor,
            opacity: clamp01(fillOpacity),
          });
        }

        // stroke outline (always)
        drawPolyline(page, m.points, {
          color: strokeColor,
          opacity: strokeOpacity,
          thickness: sw,
          closed: true,
        });

        continue;
      }

      if (m.kind === "rect") {
        const x1 = Math.min(m.a.x, m.b.x);
        const y1 = Math.min(m.a.y, m.b.y);
        const x2 = Math.max(m.a.x, m.b.x);
        const y2 = Math.max(m.a.y, m.b.y);

        const w = x2 - x1;
        const h = y2 - y1;

        page.drawRectangle({
          x: x1,
          y: y1,
          width: w,
          height: h,
          borderColor: strokeColor,
          borderWidth: sw,
          borderOpacity: strokeOpacity,
          color: fillColor,
          opacity: clamp01(fillOpacity),
        });

        continue;
      }

      if (m.kind === "circle") {
        page.drawCircle({
          x: m.c.x,
          y: m.c.y,
          size: m.r,
          borderColor: strokeColor,
          borderWidth: sw,
          borderOpacity: strokeOpacity,
          color: fillColor,
          opacity: clamp01(fillOpacity),
        });
        continue;
      }

      // ✅ Text export (from our earlier update)
      if (m.kind === "text") {
        const size = (m as any).fontSize ?? 14;
        page.drawText((m as any).text ?? "", {
          x: (m as any).p.x,
          y: (m as any).p.y,
          size,
          color: strokeColor,
          opacity: strokeOpacity,
        });
        continue;
      }
    }
  }

  return await pdfDoc.save();
}
