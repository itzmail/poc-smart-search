import React from "react";
import { Series } from "remotion";
import { SceneCard } from "./components/SceneCard";
import { FPS } from "./config";
import { durations, SceneDef } from "./scenes/scenes";

export const totalFrames = (scenes: SceneDef[]) => durations(scenes, FPS).reduce((a, b) => a + b, 0);

export const SceneSequence: React.FC<{ scenes: SceneDef[] }> = ({ scenes }) => {
  const frames = durations(scenes, FPS);
  return (
    <Series>
      {scenes.map((s, i) => (
        <Series.Sequence key={s.code} durationInFrames={frames[i]}>
          {s.component ? <s.component /> : <SceneCard code={s.code} title={s.title} caption={s.caption} />}
        </Series.Sequence>
      ))}
    </Series>
  );
};
