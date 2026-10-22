import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { configManager } from "../config-manager";
import { ErrorCode, SpineError } from "../utils/error-codes";
import { createTempDir, removeDir, readJsonFile, writeJsonFile } from "../utils/file-utils";

export const externalToolsRoot = path.resolve(__dirname, "../..");
export function externalPython(): string {
  const configured = configManager.get().externalToolsPython;
  const local = path.join(externalToolsRoot, ".venv-external", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return configured || (fs.existsSync(local) ? local : "python");
}

/** 文件协议避免 libigl 的原生日志污染 JSON；不经过 shell，不继承 MCP stdin。 */
export async function runWeightSolver(input: unknown): Promise<any> {
  const dir = createTempDir("spine-bbw-");
  const inputPath = path.join(dir, "input.json"), outputPath = path.join(dir, "output.json");
  const cfg = { ...configManager.get() };
  try {
    writeJsonFile(inputPath, input);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(externalPython(), [path.join(externalToolsRoot, "scripts/external-tools/auto_weights.py"), inputPath, outputPath],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUTF8: "1" } });
      let log = "", settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => {
        child.kill(); finish(new SpineError(ErrorCode.EXTERNAL_TOOL_TIMEOUT, "自动权重求解超时，工程未修改。"));
      }, cfg.externalToolsTimeoutMs);
      const collect = (chunk: Buffer) => { log = (log + chunk.toString("utf8")).slice(-16000); };
      child.stdout.on("data", collect); child.stderr.on("data", collect);
      child.on("error", err => finish(new SpineError(ErrorCode.EXTERNAL_TOOL_MISSING, `无法启动权重求解器：${err.message}`, "运行 npm run setup:external，或设置 SPINE_TOOLS_PYTHON。")));
      child.on("close", code => {
        if (code !== 0 || !fs.existsSync(outputPath)) finish(new SpineError(
          /No module named/.test(log) ? ErrorCode.EXTERNAL_TOOL_MISSING : ErrorCode.EXTERNAL_TOOL_FAILED,
          `libigl 权重求解失败：${log.trim() || `退出码 ${code}`}`, "运行 npm run setup:external 安装求解器依赖。"));
        else finish();
      });
    });
    return readJsonFile(outputPath);
  } finally { removeDir(dir); }
}
