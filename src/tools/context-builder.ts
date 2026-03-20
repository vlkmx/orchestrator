import path from "node:path";

import { OrchestratorState, Task, ValidatorResult } from "../state/types.js";
import { listFiles, readFileSafe } from "./file-tools.js";

const MAX_HISTORY_ITEMS = 6;
const MAX_FILE_LIST = 80;

export interface SupervisorContext {
  summary: string;
  recentHistory: OrchestratorState["history"];
  lastValidation: ValidatorResult | null;
  planSnapshot: Array<Pick<Task, "id" | "title" | "status" | "component" | "type">>;
}

export interface WorkerContext {
  summary: string;
  currentTask: Task;
  relevantFiles: string[];
  lastValidation: ValidatorResult | null;
  recentHistory: OrchestratorState["history"];
}

export async function buildSupervisorContext(
  state: OrchestratorState,
  summaryPath: string
): Promise<SupervisorContext> {
  const summary = (await readFileSafe(summaryPath)) ?? "No summary yet.";

  return {
    summary,
    recentHistory: state.history.slice(-MAX_HISTORY_ITEMS),
    lastValidation: state.lastValidation,
    planSnapshot: state.plan.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      component: task.component,
      type: task.type
    }))
  };
}

export async function buildWorkerContext(
  state: OrchestratorState,
  currentTask: Task,
  summaryPath: string,
  projectSourcePath: string,
  projectTargetPath: string
): Promise<WorkerContext> {
  const summary = (await readFileSafe(summaryPath)) ?? "No summary yet.";

  const sourceFiles = await collectRelevantFiles(projectSourcePath, currentTask.sourcePaths);
  const targetFiles = await collectRelevantFiles(projectTargetPath, currentTask.targetPaths);

  return {
    summary,
    currentTask,
    relevantFiles: [...new Set([...sourceFiles, ...targetFiles])].slice(0, MAX_FILE_LIST),
    lastValidation: state.lastValidation,
    recentHistory: state.history.slice(-MAX_HISTORY_ITEMS)
  };
}

async function collectRelevantFiles(projectRoot: string, preferredPaths: string[]): Promise<string[]> {
  const absolutePreferred = preferredPaths
    .filter((value) => value.trim().length > 0)
    .map((value) => path.resolve(projectRoot, value));

  if (absolutePreferred.length > 0) {
    return absolutePreferred;
  }

  const allFiles = await listFiles(projectRoot);
  return allFiles.slice(0, MAX_FILE_LIST);
}
