import React from "react";
import { AbsoluteFill } from "remotion";
import { fmtMs } from "../data/trace";
import { font, theme } from "../theme";

type Props = {
  step: number;
  title: string;
  ms?: number;
  input: React.ReactNode;
  process: React.ReactNode;
  output: React.ReactNode;
};

const Col: React.FC<{ label: string; children: React.ReactNode; flex: number }> = ({ label, children, flex }) => (
  <div className="flex flex-col gap-4" style={{ flex }}>
    <div className="text-2xl font-semibold uppercase tracking-widest" style={{ color: theme.muted }}>
      {label}
    </div>
    {children}
  </div>
);

// Left = INPUT, middle = WHAT HAPPENS, right = OUTPUT. Pill shows the step time from timings_ms.
export const StepLayout: React.FC<Props> = ({ step, title, ms, input, process, output }) => (
  <AbsoluteFill className="px-20 pb-40 pt-16" style={{ background: theme.bg, color: theme.text, fontFamily: font }}>
    <div className="mb-10 flex items-center gap-6">
      <div className="text-5xl font-bold" style={{ color: theme.accent }}>
        Step {step}
      </div>
      <div className="text-5xl font-bold">{title}</div>
      {ms !== undefined && (
        <div className="ml-auto rounded-full px-6 py-2 font-mono text-3xl" style={{ background: theme.panel, color: theme.warn }}>
          {fmtMs(ms)}
        </div>
      )}
    </div>
    <div className="flex flex-1 gap-12">
      <Col label="Input" flex={1}>
        {input}
      </Col>
      <Col label="Yang terjadi" flex={1.4}>
        {process}
      </Col>
      <Col label="Output" flex={1}>
        {output}
      </Col>
    </div>
  </AbsoluteFill>
);
