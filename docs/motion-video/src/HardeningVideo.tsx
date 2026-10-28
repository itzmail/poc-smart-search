import React from "react";
import { SceneSequence } from "./SceneSequence";
import { hardeningScenes } from "./scenes/scenes";

export const HardeningVideo: React.FC = () => <SceneSequence scenes={hardeningScenes} />;
