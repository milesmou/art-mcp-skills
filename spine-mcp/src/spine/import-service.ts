import * as fs from 'fs';
import { ImportOptions } from '../types';
import { createProjectFromJson, editProject, RebuildResult } from './rebuild-service';
import { readJsonFile } from '../utils/file-utils';

export type ImportResult = RebuildResult;

/** 已存在工程始终备份并重建选定骨架，保留项目内其他骨架。 */
export async function importJson(projectPath: string, jsonPath: string, options: ImportOptions = {}): Promise<ImportResult> {
  if (fs.existsSync(projectPath)) return importJsonInPlace(projectPath, jsonPath, options.skeletonName);
  const json = readJsonFile(jsonPath);
  return createProjectFromJson(projectPath, json, options.skeletonName ?? 'skeleton');
}

export async function importJsonInPlace(projectPath: string, jsonPath: string, skeletonName?: string): Promise<ImportResult> {
  const input = readJsonFile(jsonPath);
  return editProject(projectPath, target => {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, input);
  }, skeletonName, false, "project.rebuild");
}
