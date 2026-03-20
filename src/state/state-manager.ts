import path from "node:path";

import { AppConfig } from "../config.js";
import { Logger } from "../logger.js";
import { ensureDir, readJson, writeFileSafe, writeJson } from "../tools/file-tools.js";
import { iterationLogSchema, orchestratorStateSchema } from "./schemas.js";
import { IterationLog, OrchestratorState, Task, ValidatorResult, WorkerResult } from "./types.js";

export interface StatePaths {
  stateFilePath: string;
  summaryFilePath: string;
  latestLogPath: string;
  iterationDir: string;
}

export class StateManager {
  public readonly paths: StatePaths;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.paths = {
      stateFilePath: path.join(config.stateDir, "state.json"),
      summaryFilePath: path.join(config.stateDir, "context-summary.md"),
      latestLogPath: path.join(config.logsDir, "latest.md"),
      iterationDir: path.join(config.logsDir, "iterations")
    };
  }

  async ensureStorage(): Promise<void> {
    await ensureDir(this.config.stateDir);
    await ensureDir(this.config.logsDir);
    await ensureDir(this.paths.iterationDir);
  }

  createInitialState(globalGoal: string): OrchestratorState {
    const now = new Date().toISOString();
    return {
      globalGoal,
      status: "idle",
      iteration: 0,
      plan: [],
      currentTask: null,
      completedTasks: [],
      failedTasks: [],
      retryCounters: {},
      lastValidation: null,
      blockers: [],
      history: [],
      createdAt: now,
      updatedAt: now
    };
  }

  async loadState(): Promise<OrchestratorState | null> {
    const raw = await readJson<unknown>(this.paths.stateFilePath);
    if (!raw) {
      return null;
    }

    const parsed = orchestratorStateSchema.parse(raw);
    return parsed;
  }

  async saveState(state: OrchestratorState): Promise<void> {
    const payload = orchestratorStateSchema.parse({
      ...state,
      updatedAt: new Date().toISOString()
    });

    await writeJson(this.paths.stateFilePath, payload);
  }

  async saveIterationLog(log: IterationLog): Promise<void> {
    const validated = iterationLogSchema.parse(log);
    const filePath = path.join(this.paths.iterationDir, `iteration-${validated.iteration}.json`);
    await writeJson(filePath, validated);
  }

  async writeSummary(
    state: OrchestratorState,
    decisionReason: string,
    workerResult: WorkerResult | null,
    validationResult: ValidatorResult | null
  ): Promise<void> {
    const pending = state.plan.filter((task) => task.status === "pending").length;
    const inProgress = state.plan.filter((task) => task.status === "in_progress").length;
    const done = state.plan.filter((task) => task.status === "completed").length;

    const content = [
      "# Context Summary",
      "",
      `- Updated: ${new Date().toISOString()}`,
      `- Goal: ${state.globalGoal}`,
      `- Status: ${state.status}`,
      `- Iteration: ${state.iteration}`,
      `- Plan: completed=${done}, in_progress=${inProgress}, pending=${pending}`,
      `- Current task: ${state.currentTask ? `${state.currentTask.id} (${state.currentTask.title})` : "none"}`,
      `- Blockers: ${state.blockers.length === 0 ? "none" : state.blockers.join("; ")}`,
      `- Last supervisor reason: ${decisionReason}`,
      `- Last worker status: ${workerResult ? workerResult.taskStatus : "skipped"}`,
      `- Last validator overall: ${validationResult ? validationResult.overall : "skipped"}`,
      "",
      "## Next Focus",
      state.currentTask
        ? `Continue with task ${state.currentTask.id} and satisfy acceptance criteria before moving forward.`
        : "Request next smallest actionable task from supervisor."
    ].join("\n");

    await writeFileSafe(this.paths.summaryFilePath, `${content}\n`);
  }

  async writeLatestStatus(state: OrchestratorState, note: string): Promise<void> {
    const lines = [
      "# Latest Orchestrator Status",
      "",
      `- Timestamp: ${new Date().toISOString()}`,
      `- Global goal: ${state.globalGoal}`,
      `- Status: ${state.status}`,
      `- Iteration: ${state.iteration}`,
      `- Current task: ${state.currentTask ? state.currentTask.id : "none"}`,
      `- Completed tasks: ${state.completedTasks.length}`,
      `- Failed tasks: ${state.failedTasks.length}`,
      `- Blockers: ${state.blockers.length}`,
      `- Note: ${note}`,
      "",
      "## Recent History"
    ];

    for (const item of state.history.slice(-5)) {
      lines.push(
        `- #${item.iteration} decision=${item.decision}, task=${item.taskId ?? "none"}, worker=${item.workerStatus}, validator=${item.validationOverall}`
      );
    }

    await writeFileSafe(this.paths.latestLogPath, `${lines.join("\n")}\n`);
  }

  upsertTask(plan: Task[], incoming: Task): Task[] {
    const index = plan.findIndex((item) => item.id === incoming.id);
    if (index === -1) {
      return [...plan, incoming];
    }

    const updated = [...plan];
    updated[index] = {
      ...updated[index],
      ...incoming
    };
    return updated;
  }

  setTaskStatus(plan: Task[], taskId: string, status: Task["status"]): Task[] {
    return plan.map((task) => (task.id === taskId ? { ...task, status } : task));
  }

  logLoadedState(state: OrchestratorState): void {
    this.logger.debug(
      `Loaded state: iteration=${state.iteration}, status=${state.status}, planItems=${state.plan.length}`
    );
  }
}
