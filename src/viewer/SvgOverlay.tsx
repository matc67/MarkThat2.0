import React, { useEffect, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";

type Point = { x: number; y: number };

type Props = {
  viewport: PageViewport | null;
  containerRef: React.RefObject<HTMLDivElement>;
};

export default function SvgOverlay({ viewport, containerRef }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);

  // Enable pointer events once viewport exists
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.pointerEvents = viewport ? "auto" : "none";
      containerRef.current.style.cursor = viewport ? "crosshair" : "default";
    }
  }, [viewport, containerRef]);

  function onClick(e: React.MouseEvent) {
    if (!viewport || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert screen → PDF coords
    const [pdfX, pdfY] = viewport.convertToPdfPoint(screenX, screenY);

    setPoints((pts) => [...pts, { x: pdfX, y: pdfY }]);
  }

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      onClick={onClick}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        overflow: "visible",
      }}
    >
      {viewport &&
        points.map((p, i) => {
          const [vx, vy] = viewport.convertToViewportPoint(p.x, p.y);
          return (
            <circle
              key={i}
              cx={vx}
              cy={vy}
              r={4}
              fill="#60a5fa"
              stroke="black"
              strokeWidth={1}
            />
          );
        })}
    </svg>
  );
}
