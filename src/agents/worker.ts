import fs from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

import { AppConfig } from "../config.js";
import { Logger } from "../logger.js";
import { workerResultSchema } from "../state/schemas.js";
import { OrchestratorState, Task, WorkerResult } from "../state/types.js";
import { WorkerContext } from "../tools/context-builder.js";
import { ensureDir, readFileSafe, writeFileSafe } from "../tools/file-tools.js";
import { callModelForJson } from "./llm.js";
import { workerSystemPrompt } from "./prompts.js";

export interface WorkerRunResult {
  result: WorkerResult;
  rawResponse: string;
}

interface ArtifactChangeSet {
  changedFiles: string[];
  createdFiles: string[];
  deletedFiles: string[];
}

export class WorkerAgent {
  private readonly client: OpenAI | null;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.client = config.openAIApiKey
      ? new OpenAI({ apiKey: config.openAIApiKey })
      : null;
  }

  async runOneTask(
    state: OrchestratorState,
    task: Task,
    context: WorkerContext,
    iteration: number,
    dryRun: boolean
  ): Promise<WorkerRunResult> {
    let baseResult: WorkerResult;
    let rawResponse: string;

    if (this.config.demoMode) {
      baseResult = this.createDemoResult(task);
      rawResponse = JSON.stringify(baseResult);
    } else {
      if (!this.client) {
        throw new Error("OPENAI_API_KEY is missing while DEMO_MODE=false");
      }

      const { parsed, rawText } = await callModelForJson({
        client: this.client,
        model: this.config.modelWorker,
        systemPrompt: workerSystemPrompt,
        schema: workerResultSchema,
        maxRetries: this.config.workerMaxJsonRetries,
        userPayload: {
          globalGoal: state.globalGoal,
          currentTask: task,
          compactSummary: context.summary,
          relevantFiles: context.relevantFiles,
          lastValidation: context.lastValidation,
          recentHistory: context.recentHistory
        }
      });

      baseResult = parsed;
      rawResponse = rawText;
    }

    const artifactChanges = await this.applyTaskArtifacts(task, baseResult, iteration, dryRun);

    const mergedResult: WorkerResult = {
      ...baseResult,
      changedFiles: unique([...baseResult.changedFiles, ...artifactChanges.changedFiles]),
      createdFiles: unique([...baseResult.createdFiles, ...artifactChanges.createdFiles]),
      deletedFiles: unique([...baseResult.deletedFiles, ...artifactChanges.deletedFiles])
    };

    return {
      result: mergedResult,
      rawResponse
    };
  }

  private createDemoResult(task: Task): WorkerResult {
    return {
      summary: `Executed task ${task.id}: ${task.title}`,
      changedFiles: [],
      createdFiles: [],
      deletedFiles: [],
      risks: task.type === "migrate_component" ? ["Potential style or prop mismatch after migration"] : [],
      openQuestions: [],
      taskStatus: "completed"
    };
  }

  private async applyTaskArtifacts(
    task: Task,
    workerResult: WorkerResult,
    iteration: number,
    dryRun: boolean
  ): Promise<ArtifactChangeSet> {
    if (dryRun) {
      return {
        changedFiles: [],
        createdFiles: [],
        deletedFiles: []
      };
    }

    const createdFiles: string[] = [];
    const changedFiles: string[] = [];

    const reportDir = path.join(this.config.projectTargetPath, ".orchestrator", "steps");
    await ensureDir(reportDir);

    const reportPath = path.join(reportDir, `${String(iteration).padStart(3, "0")}-${task.id}.md`);
    const reportContent = [
      `# Iteration ${iteration}`,
      "",
      `- Task ID: ${task.id}`,
      `- Task Title: ${task.title}`,
      `- Task Type: ${task.type}`,
      `- Component: ${task.component}`,
      `- Worker Status: ${workerResult.taskStatus}`,
      "",
      "## Summary",
      workerResult.summary,
      "",
      "## Risks",
      ...(workerResult.risks.length > 0 ? workerResult.risks.map((risk) => `- ${risk}`) : ["- none"]),
      "",
      "## Open Questions",
      ...(workerResult.openQuestions.length > 0
        ? workerResult.openQuestions.map((question) => `- ${question}`)
        : ["- none"])
    ].join("\n");

    const existingReport = await readFileSafe(reportPath);
    await writeFileSafe(reportPath, `${reportContent}\n`);
    if (existingReport === null) {
      createdFiles.push(reportPath);
    } else {
      changedFiles.push(reportPath);
    }

    if (task.type === "migrate_component") {
      const migrated = await this.copySourceToTarget(task);
      createdFiles.push(...migrated.createdFiles);
      changedFiles.push(...migrated.changedFiles);
    }

    return {
      changedFiles: unique(changedFiles),
      createdFiles: unique(createdFiles),
      deletedFiles: []
    };
  }

  private async copySourceToTarget(task: Task): Promise<ArtifactChangeSet> {
    const createdFiles: string[] = [];
    const changedFiles: string[] = [];

    const pairsCount = Math.min(task.sourcePaths.length, task.targetPaths.length);
    for (let index = 0; index < pairsCount; index += 1) {
      const srcRelative = task.sourcePaths[index];
      const targetRelative = task.targetPaths[index];
      if (!srcRelative || !targetRelative) {
        continue;
      }

      const sourceAbs = path.resolve(this.config.projectSourcePath, srcRelative);
      const targetAbs = path.resolve(this.config.projectTargetPath, targetRelative);

      let sourceContent: string | null = null;
      try {
        sourceContent = await fs.readFile(sourceAbs, "utf8");
      } catch {
        this.logger.warn(`Worker skip copy: source not readable ${sourceAbs}`);
      }

      if (sourceContent === null) {
        continue;
      }

      const targetBefore = await readFileSafe(targetAbs);
      await writeFileSafe(targetAbs, sourceContent);
      if (targetBefore === null) {
        createdFiles.push(targetAbs);
      } else {
        changedFiles.push(targetAbs);
      }
    }

    return {
      changedFiles,
      createdFiles,
      deletedFiles: []
    };
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
