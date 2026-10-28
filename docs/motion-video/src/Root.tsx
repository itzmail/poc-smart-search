import React from "react";
import { Composition } from "remotion";
import { FPS, HEIGHT, WIDTH } from "./config";
import { HardeningVideo } from "./HardeningVideo";
import { totalFrames } from "./SceneSequence";
import { hardeningScenes, traceScenes } from "./scenes/scenes";
import { TraceVideo } from "./TraceVideo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="TraceVideo" component={TraceVideo} durationInFrames={totalFrames(traceScenes)} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="HardeningVideo" component={HardeningVideo} durationInFrames={totalFrames(hardeningScenes)} fps={FPS} width={WIDTH} height={HEIGHT} />
  </>
);
