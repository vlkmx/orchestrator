import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";

import { AppConfig } from "../config.js";
import { Logger } from "../logger.js";
import { supervisorDecisionSchema } from "../state/schemas.js";
import { OrchestratorState, SupervisorDecision, Task } from "../state/types.js";
import { SupervisorContext } from "../tools/context-builder.js";
import { callModelForJson } from "./llm.js";
import { supervisorSystemPrompt } from "./prompts.js";

export interface SupervisorRunResult {
  decision: SupervisorDecision;
  rawResponse: string;
}

export class SupervisorAgent {
  private readonly client: OpenAI | null;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.client = config.openAIApiKey
      ? new OpenAI({ apiKey: config.openAIApiKey })
      : null;
  }

  async decide(state: OrchestratorState, context: SupervisorContext): Promise<SupervisorRunResult> {
    if (this.config.deterministicSupervisor) {
      const decision = await this.decideDeterministic(state);
      return {
        decision,
        rawResponse: JSON.stringify(decision)
      };
    }

    if (this.config.demoMode) {
      const decision = this.decideInDemoMode(state);
      return {
        decision,
        rawResponse: JSON.stringify(decision)
      };
    }

    if (!this.client) {
      throw new Error("OPENAI_API_KEY is missing while DEMO_MODE=false");
    }

    const { parsed, rawText } = await callModelForJson({
      client: this.client,
      model: this.config.modelSupervisor,
      systemPrompt: supervisorSystemPrompt,
      schema: supervisorDecisionSchema,
      maxRetries: this.config.supervisorMaxJsonRetries,
      userPayload: {
        globalGoal: state.globalGoal,
        status: state.status,
        iteration: state.iteration,
        currentTask: state.currentTask,
        plan: context.planSnapshot,
        summary: context.summary,
        blockers: state.blockers,
        completedTasks: state.completedTasks,
        failedTasks: state.failedTasks,
        lastValidation: context.lastValidation,
        recentHistory: context.recentHistory
      }
    });

    const decision = this.normalizeDecision(parsed, state);
    this.logger.debug(`Supervisor decision: ${decision.decision}; reason=${decision.reason}`);

    return {
      decision,
      rawResponse: rawText
    };
  }

  private normalizeDecision(candidate: SupervisorDecision, state: OrchestratorState): SupervisorDecision {
    if ((candidate.decision === "continue" || candidate.decision === "retry") && !candidate.nextTask) {
      const fallback = this.pickFallbackTask(state);
      if (!fallback) {
        return {
          decision: "failed",
          reason:
            "Supervisor returned continue/retry without nextTask and no fallback pending task exists.",
          nextTask: null,
          statePatch: candidate.statePatch
        };
      }

      return {
        ...candidate,
        nextTask: {
          id: fallback.id,
          type: fallback.type,
          title: fallback.title,
          component: fallback.component,
          sourcePaths: fallback.sourcePaths,
          targetPaths: fallback.targetPaths,
          instructions: fallback.instructions,
          acceptanceCriteria: fallback.acceptanceCriteria
        }
      };
    }

    if ((candidate.decision === "done" || candidate.decision === "failed") && candidate.nextTask) {
      return {
        ...candidate,
        nextTask: null
      };
    }

    return candidate;
  }

  private decideInDemoMode(state: OrchestratorState): SupervisorDecision {
    if (this.canFinish(state)) {
      return {
        decision: "done",
        reason: "All planned tasks are completed and no blockers remain.",
        nextTask: null,
        statePatch: { markDone: [], markInProgress: [], markBlocked: [] }
      };
    }

    const existing = this.pickFallbackTask(state);
    if (existing) {
      return {
        decision: existing.status === "in_progress" ? "retry" : "continue",
        reason: "Proceed with next smallest available task.",
        nextTask: {
          id: existing.id,
          type: existing.type,
          title: existing.title,
          component: existing.component,
          sourcePaths: existing.sourcePaths,
          targetPaths: existing.targetPaths,
          instructions: existing.instructions,
          acceptanceCriteria: existing.acceptanceCriteria
        },
        statePatch: {
          markDone: [],
          markInProgress: [existing.id],
          markBlocked: []
        }
      };
    }

    const bootstrapTask = this.createBootstrapTask();
    return {
      decision: "continue",
      reason: "Bootstrap plan with repository analysis task.",
      nextTask: bootstrapTask,
      statePatch: {
        markDone: [],
        markInProgress: [bootstrapTask.id],
        markBlocked: []
      }
    };
  }

  private async decideDeterministic(state: OrchestratorState): Promise<SupervisorDecision> {
    const current = this.pickFallbackTask(state);
    if (current) {
      return {
        decision: "continue",
        reason: "Continue current in-progress migration task.",
        nextTask: {
          id: current.id,
          type: current.type,
          title: current.title,
          component: current.component,
          sourcePaths: current.sourcePaths,
          targetPaths: current.targetPaths,
          instructions: current.instructions,
          acceptanceCriteria: current.acceptanceCriteria
        },
        statePatch: {
          markDone: [],
          markInProgress: [current.id],
          markBlocked: []
        }
      };
    }

    const next = await this.findNextMigrationTask(state);
    if (!next) {
      return {
        decision: "done",
        reason: "No remaining file differences between source and target directories.",
        nextTask: null,
        statePatch: { markDone: [], markInProgress: [], markBlocked: [] }
      };
    }

    return {
      decision: "continue",
      reason: "Deterministic planner selected next file migration task.",
      nextTask: next,
      statePatch: {
        markDone: [],
        markInProgress: [next.id],
        markBlocked: []
      }
    };
  }

  private async findNextMigrationTask(state: OrchestratorState): Promise<Omit<Task, "status"> | null> {
    const sourceRoot = this.config.projectSourcePath;
    const targetRoot = this.config.projectTargetPath;
    const sourceFiles = await collectMigrationFiles(sourceRoot);

    for (const sourceAbsPath of sourceFiles) {
      const relativePath = path.relative(sourceRoot, sourceAbsPath).replace(/\\/g, "/");
      const taskId = toTaskId(relativePath);
      if (state.completedTasks.includes(taskId)) {
        continue;
      }

      const targetAbsPath = path.join(targetRoot, relativePath);
      const [sourceContent, targetContent] = await Promise.all([
        readText(sourceAbsPath),
        readText(targetAbsPath)
      ]);

      if (sourceContent === null) {
        continue;
      }

      if (targetContent !== null && targetContent === sourceContent) {
        continue;
      }

      const component = relativePath.split("/")[0] || "root";
      return {
        id: taskId,
        type: "migrate_component",
        title: `Migrate ${relativePath}`,
        component,
        sourcePaths: [relativePath],
        targetPaths: [relativePath],
        instructions: `Copy ${relativePath} from source project to target project, preserving file content.`,
        acceptanceCriteria: [
          `Target file ${relativePath} exists`,
          `Target file content equals source file content`
        ]
      };
    }

    return null;
  }

  private pickFallbackTask(state: OrchestratorState): Task | null {
    const inProgress = state.plan.find((task) => task.status === "in_progress");
    if (inProgress) {
      return inProgress;
    }

    const pending = state.plan.find((task) => task.status === "pending");
    if (pending) {
      return pending;
    }

    return null;
  }

  private createBootstrapTask(): Omit<Task, "status"> {
    return {
      id: "analyze-initial-structure",
      type: "analyze",
      title: "Map source components and select first migration slice",
      component: "core",
      sourcePaths: [],
      targetPaths: [],
      instructions:
        "Inspect source and target structures, identify one safe first component to migrate, and record exact file pairs.",
      acceptanceCriteria: [
        "Component inventory created",
        "First migration candidate identified",
        "Risks and blockers documented"
      ]
    };
  }

  private canFinish(state: OrchestratorState): boolean {
    const hasPlan = state.plan.length > 0;
    const allDone = hasPlan && state.plan.every((task) => task.status === "completed");
    const noBlockers = state.blockers.length === 0;
    const validatorAllows = !state.lastValidation || state.lastValidation.overall !== "failed";

    return allDone && noBlockers && validatorAllows;
  }
}

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".orchestrator",
  ".orchestrator-data"
]);

async function collectMigrationFiles(root: string): Promise<string[]> {
  const srcRoot = path.join(root, "src");
  const preferredRoot = await exists(srcRoot) ? srcRoot : root;
  const results: string[] = [];
  await walk(preferredRoot, results);
  return results.sort();
}

async function walk(current: string, collector: string[]): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      await walk(fullPath, collector);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    collector.push(fullPath);
  }
}

function toTaskId(relativePath: string): string {
  return `migrate::${relativePath.replace(/[^a-zA-Z0-9/_-]/g, "_")}`;
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
