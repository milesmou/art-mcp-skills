/** 只负责识别版本族，不把“已识别”当作“已支持”。 */
export function versionFamily(version: unknown): string | undefined {
  return typeof version === "string" ? /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version)?.slice(1, 3).join(".") : undefined;
}
export function isExactVersion(version: string): boolean { return /^\d+\.\d+\.\d+$/.test(version); }
export function projectVersionFromOutput(stdout: string): string | undefined {
  return stdout.match(/^\s*Spine version:\s*(\d+\.\d+(?:\.\d+)?)(?=\s|$)/im)?.[1];
}
export function editorVersionFromOutput(stdout: string): string | undefined {
  return stdout.match(/^Spine (\d+\.\d+\.\d+)(?:\s|$)/m)?.[1]
    ?? stdout.match(/^Launching: Spine (\d+\.\d+\.\d+)(?:\s|$)/m)?.[1];
}
