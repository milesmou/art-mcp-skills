import { ExportOptions } from "../../../types";
import { ErrorCode, SpineError } from "../../../utils/error-codes";

/** 各格式默认扩展名 */
const DEFAULT_EXT: Record<string, string> = {
  json: ".json",
  binary: ".skel",
  texture: ".png",
  video: ".mp4",
};

/**
 * 依据导出选项生成 CLI 导出设置 JSON 对象。
 * json/binary 格式已实测验证；texture/video 按 CLI 约定构造。
 */
export function generateExportSettings(options: ExportOptions): Record<string, any> {
  const ext = options.extension ?? DEFAULT_EXT[options.format];
  switch (options.format) {
    case "json":
      return {
        class: "json",
        extension: ext,
        format: "JSON",
        nonessential: options.nonessential ?? true,
        prettyPrint: options.prettyPrint ?? true,
      };
    case "binary":
      return {
        class: "binary",
        extension: ext,
        nonessential: options.nonessential ?? true,
      };
    case "texture":
      // 注意：图片导出类名为 "images"（3.8.75 实测，非 "texture"）。
      // 完整 schema 需在 Phase 4 render_preview 时对照 Spine 编辑器预设确认。
      return {
        class: "images",
        extension: ext,
        nonessential: options.nonessential ?? true,
        ...(options.fps ? { fps: options.fps } : {}),
        ...(options.frameCount ? { frameCount: options.frameCount } : {}),
      };
    case "video":
      return {
        class: "video",
        extension: ext,
        nonessential: options.nonessential ?? true,
        ...(options.fps ? { fps: options.fps } : {}),
        ...(options.loop !== undefined ? { loop: options.loop } : {}),
        ...(options.width ? { width: options.width } : {}),
        ...(options.height ? { height: options.height } : {}),
      };
    default:
      throw new SpineError(ErrorCode.INVALID_ARGUMENT, `不支持的导出格式：${options.format}`, "支持 json|binary|texture|video。");
  }
}


export const importArgs = (input: string, output: string, name: string): string[] => ["-i", input, "-o", output, "-r", name];
