import React from "react";
import { SceneSequence } from "./SceneSequence";
import { traceScenes } from "./scenes/scenes";

export const TraceVideo: React.FC = () => <SceneSequence scenes={traceScenes} />;
