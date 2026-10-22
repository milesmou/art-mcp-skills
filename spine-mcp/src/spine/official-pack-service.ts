import * as fs from "fs";
import * as path from "path";
import { cliExecutor } from "./cli-executor";
import { configManager } from "../config-manager";
import { assertCapability, requireAdapter } from "./adapters/registry";
import { withProjectContext } from "./project-context";
import { currentProjectContext } from "./execution-context";
import { ErrorCode, SpineError } from "../utils/error-codes";
import { parseAtlas } from "./atlas-utils";
import { ensureDir, removeDir, readJsonFile, writeJsonFile } from "../utils/file-utils";
import sharp from "sharp";

export interface OfficialPackOptions {
  inputDir: string; outputDir: string; atlasName?: string; projectPath?: string;
  packSettingsPath?: string; settings?: Record<string, unknown>;
}
export async function packOfficialAtlas(options: OfficialPackOptions): Promise<any> {
  const run = async () => {
    const input = fs.realpathSync(options.inputDir), output = path.resolve(options.outputDir), name = options.atlasName ?? "atlas";
    if (!fs.statSync(input).isDirectory() || !name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new SpineError(ErrorCode.INVALID_ARGUMENT, "inputDir 必须是目录，atlasName 必须是不含路径的有效文件名。");
    const assertOutput = () => {
      if (fs.existsSync(output) && (!fs.statSync(output).isDirectory() || fs.readdirSync(output).length)) throw new SpineError(ErrorCode.INVALID_ARGUMENT, "outputDir 必须不存在或为空；请使用独立输出目录，避免覆盖已有图集。");
    };
    assertOutput();
    assertCapability(currentProjectContext()?.adapter ?? requireAdapter(configManager.get().spineVersion), "atlas.pack");
    const settings = options.packSettingsPath ? readJsonFile(options.packSettingsPath) : options.settings ?? {};
    if (!settings || Array.isArray(settings) || typeof settings !== "object") throw new SpineError(ErrorCode.INVALID_ARGUMENT, "打包设置必须是 JSON 对象。");
    ensureDir(path.dirname(output));
    const stage = fs.mkdtempSync(path.join(path.dirname(output), ".spine-pack-"));
    const settingsDir = fs.mkdtempSync(path.join(path.dirname(output), ".spine-pack-settings-"));
    try {
      const settingsPath = path.join(settingsDir, "pack.json");
      // PNG + .atlas are fixed so output pages can be verified before publishing.
      writeJsonFile(settingsPath, { ...settings, outputFormat: "png", atlasExtension: ".atlas" });
      const args = ["-i", input, "-o", stage, "-n", name, "-p", settingsPath];
      if (options.projectPath) args.push("-j", path.resolve(options.projectPath));
      await cliExecutor.exec({ args });
      const files: string[] = [];
      const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new SpineError(ErrorCode.REBUILD_VALIDATION, "打包输出不允许符号链接。");
        if (entry.isDirectory()) walk(file); else files.push(file);
      } };
      walk(stage);
      const atlases = files.filter(f => f.endsWith(".atlas"));
      if (!atlases.length) throw new SpineError(ErrorCode.REBUILD_VALIDATION, "Spine 打包未生成 .atlas。");
      const pages: any[] = [];
      for (const file of atlases) {
        const atlas = parseAtlas(fs.readFileSync(file, "utf8"));
        if (!atlas.pages.length || !atlas.regions.length) throw new SpineError(ErrorCode.REBUILD_VALIDATION, "图集内容为空。");
        for (const page of atlas.pages) {
          const image = path.resolve(path.dirname(file), page.name), relative = path.relative(stage, image);
          if (relative.startsWith("..") || path.isAbsolute(relative) || !files.includes(image)) throw new SpineError(ErrorCode.REBUILD_VALIDATION, "图集引用了输出目录之外或不存在的图片。");
          const metadata = await sharp(image).metadata();
          if (metadata.width !== page.size.w || metadata.height !== page.size.h) throw new SpineError(ErrorCode.REBUILD_VALIDATION, "图集页面尺寸与图片不一致。");
          pages.push({ file: path.join(output, relative), width: metadata.width, height: metadata.height });
        }
      }
      assertOutput();
      if (fs.existsSync(output)) fs.rmdirSync(output); // Empty directory only; never recursively delete user output.
      fs.renameSync(stage, output);
      return { backend: "spine-cli", atlasPaths: atlases.map(f => path.join(output, path.relative(stage, f))), pages,
        files: files.map(f => path.join(output, path.relative(stage, f))) };
    } finally { if (fs.existsSync(stage)) removeDir(stage); removeDir(settingsDir); }
  };
  return options.projectPath ? withProjectContext(options.projectPath, "atlas.pack", run) : run();
}
