export interface RuntimeFrameOptions {
  skeletonJsonPath: string;
  atlasPath: string;
  imagePath: string;
  animationName?: string;
  time?: number;
  width?: number;
  height?: number;
  wireframe?: boolean;
}
export interface RuntimeFrameResult {
  width: number;
  height: number;
  rgba: Buffer;
  animationName: string;
  time: number;
}
