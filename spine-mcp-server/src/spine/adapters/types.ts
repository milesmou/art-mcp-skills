import type { ExportOptions } from "../../types";
import type { RuntimeFrameOptions, RuntimeFrameResult } from "../preview-types";

export const CAPABILITIES = ["metadata.read", "project.read", "project.export", "project.rebuild", "project.clean", "runtime.sample",
  "runtime.preview", "legacy.edit", "mesh.inspect", "mesh.weights", "mesh.deform", "animation.cloth", "animation.range",
  "animation.curves", "events.edit", "attachment.manage", "atlas.pack", "mesh.generate", "mesh.autoWeights", "physics.preserve", "physics.edit"] as const;
export type Capability = typeof CAPABILITIES[number];
export interface CapabilityState { readonly supported: boolean; readonly reason?: string; }
export interface SpineAdapter {
  readonly family: string;
  readonly status: "supported" | "planned";
  readonly capabilities: Readonly<Record<Capability, Readonly<CapabilityState>>>;
  readonly runtime: {
    getCore(): any;
    readData(json: any): any;
    sample(data: any, animationName?: string, time?: number, skinName?: string): any;
  };
  readonly json: {
    validate(json: any): void;
    verify(expected: any, actual: any): void;
    deformPath(skin: string, slot: string, attachment: string): string[];
  };
  readonly preview: {
    isAvailable(): boolean;
    renderFrame(options: RuntimeFrameOptions): Promise<RuntimeFrameResult>;
  };
  readonly cli: {
    exportSettings(options: ExportOptions): Record<string, any>;
    importArgs(input: string, output: string, skeletonName: string): string[];
  };
}
