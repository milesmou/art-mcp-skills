/**
 * 版本校验器：识别项目/文件的 Spine 版本。
 *
 * 实现策略（已实测验证）：
 * - .json 文件：直接读取 JSON 中的 skeleton.spine 字段
 * - .spine 项目（二进制）：调用 `Spine.com -i <path>`（Info 命令），
 *   从 stdout 解析 `Spine version: x.y.z`
 */
import * as fs from "fs";
import * as path from "path";
import { cliExecutor } from "./cli-executor";
import { logger } from "../logger";
import { SUPPORTED_SPINE_VERSION, isSupportedSpineVersion } from "../constants";
import { ErrorCode, SpineError } from "../utils/error-codes";
import { currentProjectContext } from "./execution-context";

/** 版本检测结果 */
export interface VersionResult {
  version: string;
  /** 文件是否为 .json（数据文件） */
  isJson: boolean;
  /** 是否属于支持的 3.8 系列 */
  isSupported: boolean;
  /** 若版本存在但不属于 3.8 系列，附带友好警告 */
  warning?: string;
}

/** 从 JSON 内容中提取 spine 版本 */
function versionFromJson(raw: string): string | undefined {
  try {
    const data = JSON.parse(raw);
    const version = data?.skeleton?.spine;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/** 从 Info 命令 stdout 中解析项目版本，如 `Spine version: 3.8.55` */
function versionFromInfoOutput(stdout: string): string | undefined {
  const m = stdout.match(/Spine version:\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)(?=\s|$)/i);
  if (m) {
    return m[1];
  }
  // 兜底读取编辑器版本，不将 Spine Launcher 的独立版本号当作工程版本。
  const m2 = stdout.match(/^Spine\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)(?=\s|$)/im);
  return m2 ? m2[1] : undefined;
}

class VersionValidator {
  /**
   * 检测文件版本。
   * @param filePath .spine 项目文件或 .json 数据文件
   */
  async detect(filePath: string): Promise<VersionResult> {
    if (!fs.existsSync(filePath)) {
      throw new SpineError(
        ErrorCode.INVALID_ARGUMENT,
        `文件不存在：${filePath}`,
        "请传入有效的绝对路径。"
      );
    }
    const ext = path.extname(filePath).toLowerCase();
    const isJson = ext === ".json";
    let version: string | undefined;

    if (isJson) {
      // JSON 数据文件：直接读取
      const raw = fs.readFileSync(filePath, "utf8");
      version = versionFromJson(raw);
      if (!version) {
        // 可能是导出设置类 JSON，无 skeleton.spine
        return {
          version: "unknown",
          isJson: true,
          isSupported: false,
          warning: "该 JSON 不是 Spine 数据文件（缺少 skeleton.spine 字段）。",
        };
      }
    } else {
      // 二进制 .spine：走 Info 命令
      const stdout = await cliExecutor.execToString(currentProjectContext() ? ["-i", filePath] : ["-u", "project", "-i", filePath]);
      version = versionFromInfoOutput(stdout);
      if (!version) {
        throw new SpineError(
          ErrorCode.CLI_EXEC_FAILED,
          "无法从 Spine CLI 输出中识别版本号。",
          "请确认该文件是有效的 Spine 项目文件。"
        );
      }
    }

    const isSupported = isSupportedSpineVersion(version);
    const warning = isSupported
      ? undefined
      : `检测到当前 Spine 项目版本为 ${version}，本服务器支持 Spine ${SUPPORTED_SPINE_VERSION}.x 系列，其他主次版本的编辑及 JSON 导入导出可能不兼容。`;

    if (warning) {
      logger.warn(warning);
    } else {
      logger.info(`项目版本 ${version}，属于支持的 Spine ${SUPPORTED_SPINE_VERSION}.x 系列`);
    }

    return { version, isJson, isSupported, warning };
  }

  /** 快速判断版本是否属于 3.8 系列 */
  isSupported(version: string): boolean {
    return isSupportedSpineVersion(version);
  }
}

/** 全局单例 */
export const versionValidator = new VersionValidator();
