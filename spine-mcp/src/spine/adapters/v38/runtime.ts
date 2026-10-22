import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

let runtime: any;
/** 无贴图、无窗口的官方 3.8 runtime，供数据校验、权重和布料采样共用。 */
export function getCoreRuntime(): any {
  if (!runtime) {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../../../vendor/spine-ts/spine-core.js"), "utf8"), context, { timeout: 5000 });
    runtime = context.spine;
  }
  return runtime;
}

export function readSkeletonData(json: any): any {
  const s = getCoreRuntime();
  const region = () => Object.assign(new s.TextureRegion(), { u: 0, v: 0, u2: 1, v2: 1,
    width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0 });
  const loader = {
    newRegionAttachment: (_: any, n: string) => Object.assign(new s.RegionAttachment(n), { region: region() }),
    newMeshAttachment: (_: any, n: string) => Object.assign(new s.MeshAttachment(n), { region: region() }),
    newBoundingBoxAttachment: (_: any, n: string) => new s.BoundingBoxAttachment(n),
    newPathAttachment: (_: any, n: string) => new s.PathAttachment(n),
    newPointAttachment: (_: any, n: string) => new s.PointAttachment(n),
    newClippingAttachment: (_: any, n: string) => new s.ClippingAttachment(n),
  };
  return new s.SkeletonJson(loader).readSkeletonData(json);
}

export function sampleSkeleton(data: any, animationName?: string, time = 0, skinName = "default"): any {
  const s = getCoreRuntime(), sk = new s.Skeleton(data);
  if (data.findSkin(skinName)) sk.setSkinByName(skinName);
  sk.setSlotsToSetupPose();
  if (animationName) {
    if (!data.findAnimation(animationName)) throw new Error(`动画不存在：${animationName}`);
    const state = new s.AnimationState(new s.AnimationStateData(data));
    state.setAnimation(0, animationName, false); state.update(time); state.apply(sk);
  }
  sk.updateWorldTransform();
  return sk;
}
