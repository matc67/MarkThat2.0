import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

// IMPORTANT for Vite: import worker as a URL
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Tell PDF.js where the worker file lives
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export type PdfDoc = PDFDocumentProxy;

export async function loadPdfFromArrayBuffer(buf: ArrayBuffer): Promise<PdfDoc> {
  const task = pdfjsLib.getDocument({ data: buf });
  const doc = await task.promise;
  return doc;
}
