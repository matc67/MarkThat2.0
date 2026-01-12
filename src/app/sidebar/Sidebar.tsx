// src/app/sidebar/Sidebar.tsx
import React from "react";
import type { Tool, Draft, ScaleCal, Mark, MarkAction, MarkState } from "../markTypes";

import DefaultStylePanel from "./DefaultStylePanel.js";
import ScalePanel from "./ScalePanel.js";
import SelectedObjectPanel from "./SelectedObjectPanel.js";
import MeasurementPanel from "./MeasurementPanel.js";

type Totals = {
  line?: number;
  area?: number;
  perim?: number;
};

type Props = {
  page: number;
  tool: Tool;
  draft: Draft | null;
  scale: ScaleCal | null;
  live: MarkState["live"];
  totalsThisPage: Totals;
  defaultStyle: MarkState["defaultStyle"];
  selected: Mark | null;
  dispatch: React.Dispatch<MarkAction>;
  setTool: (t: Tool) => void;
  patchSelected: (patch: Partial<Mark>) => void;
};

export default function Sidebar(props: Props) {
  const { tool } = props;

  return (
    <div className="sidebar">
      <div className="sidebarStack">
        <DefaultStylePanel defaultStyle={props.defaultStyle} dispatch={props.dispatch} />

        {tool === "scale" && (
          <ScalePanel
            page={props.page}
            tool={props.tool}
            draft={props.draft}
            scale={props.scale}
            dispatch={props.dispatch}
          />
        )}

        <SelectedObjectPanel
          selected={props.selected}
          defaultStyle={props.defaultStyle}
          scale={props.scale}
          dispatch={props.dispatch}
          setTool={props.setTool}
          patchSelected={props.patchSelected}
        />

        <MeasurementPanel
          tool={props.tool}
          scale={props.scale}
          live={props.live}
          totalsThisPage={props.totalsThisPage}
        />
      </div>
    </div>
  );
}
