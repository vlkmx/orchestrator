import { AppConfig } from "./config.js";
import { Logger } from "./logger.js";
import { SupervisorAgent } from "./agents/supervisor.js";
import { WorkerAgent } from "./agents/worker.js";
import { StateManager } from "./state/state-manager.js";
import {
  CliOptions,
  HistoryEntry,
  IterationLog,
  OrchestratorState,
  SupervisorDecision,
  Task,
  ValidatorResult,
  WorkerResult
} from "./state/types.js";
import { buildSupervisorContext, buildWorkerContext } from "./tools/context-builder.js";
import { runValidator } from "./validator/validator.js";

export class Orchestrator {
  private readonly stateManager: StateManager;
  private readonly supervisor: SupervisorAgent;
  private readonly worker: WorkerAgent;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.stateManager = new StateManager(config, logger);
    this.supervisor = new SupervisorAgent(config, logger);
    this.worker = new WorkerAgent(config, logger);
  }

  async run(options: CliOptions): Promise<void> {
    await this.stateManager.ensureStorage();

    let state = await this.bootstrapState(options);
    this.logger.info(`Orchestrator started. goal="${state.globalGoal}"`);
    this.config.eventSink?.emitEvent({
      runId: this.config.runId,
      type: "run_started",
      message: `Run started: ${state.globalGoal}`,
      data: {
        goal: state.globalGoal
      }
    });

    while (state.status === "running") {
      if (state.iteration >= this.config.maxIterations) {
        state.status = "failed";
        state.blockers.push(`Reached MAX_ITERATIONS=${this.config.maxIterations}`);
        await this.persistTerminalState(state, "Reached max iterations limit.");
        throw new Error(`Reached MAX_ITERATIONS=${this.config.maxIterations}`);
      }

      const iteration = state.iteration + 1;
      this.logger.info(`Iteration ${iteration} started`);
      this.config.eventSink?.emitEvent({
        runId: this.config.runId,
        type: "iteration_started",
        message: `Iteration ${iteration} started`,
        data: { iteration }
      });

      const supervisorContext = await buildSupervisorContext(
        state,
        this.stateManager.paths.summaryFilePath
      );

      const supervisorRun = await this.supervisor.decide(state, supervisorContext);
      const decision = supervisorRun.decision;
      this.config.eventSink?.emitEvent({
        runId: this.config.runId,
        type: "supervisor_decision",
        message: `Supervisor decision: ${decision.decision}`,
        data: {
          iteration,
          decision
        }
      });

      let workerResult: WorkerResult | null = null;
      let workerRawResponse = "";
      let validationResult: ValidatorResult | null = null;
      const notes: string[] = [];

      if (decision.decision === "failed") {
        state.status = "failed";
        state.blockers.push(`Supervisor failed: ${decision.reason}`);
        notes.push("Supervisor requested fatal stop.");
      } else if (decision.decision === "done") {
        if (this.canFinalizeNow(state, state.lastValidation)) {
          const finalValidation = await runValidator(this.config);
          state.lastValidation = finalValidation;
          validationResult = finalValidation;
          this.config.eventSink?.emitEvent({
            runId: this.config.runId,
            type: "validation_result",
            message: `Final validator overall: ${finalValidation.overall}`,
            data: {
              iteration,
              validationResult: finalValidation,
              final: true
            }
          });
          if (finalValidation.overall === "failed") {
            state.status = "failed";
            state.blockers.push("Final validation failed before completion.");
            notes.push("Final validation failed.");
          } else {
          state.status = "done";
          state.currentTask = null;
          notes.push("Supervisor marked objective done and stop conditions are satisfied.");
          }
        } else {
          notes.push("Supervisor returned done but stop conditions were not satisfied. Falling back.");
          const fallbackTask = this.pickFallbackTask(state);
          if (!fallbackTask) {
            state.status = "failed";
            state.blockers.push("No fallback task available after premature done decision.");
          } else {
            const fallbackDecision: SupervisorDecision = {
              decision: "continue",
              reason: "Fallback from premature done.",
              nextTask: {
                id: fallbackTask.id,
                type: fallbackTask.type,
                title: fallbackTask.title,
                component: fallbackTask.component,
                sourcePaths: fallbackTask.sourcePaths,
                targetPaths: fallbackTask.targetPaths,
                instructions: fallbackTask.instructions,
                acceptanceCriteria: fallbackTask.acceptanceCriteria
              },
              statePatch: {
                markDone: [],
                markInProgress: [fallbackTask.id],
                markBlocked: []
              }
            };

            const runOutcome = await this.runTaskIteration(
              state,
              fallbackDecision,
              iteration,
              options,
              notes
            );
            state = runOutcome.state;
            workerResult = runOutcome.workerResult;
            workerRawResponse = runOutcome.workerRawResponse;
            validationResult = runOutcome.validationResult;
          }
        }
      } else {
        const runOutcome = await this.runTaskIteration(state, decision, iteration, options, notes);
        state = runOutcome.state;
        workerResult = runOutcome.workerResult;
        workerRawResponse = runOutcome.workerRawResponse;
        validationResult = runOutcome.validationResult;
      }

      if (state.status === "running" && this.detectStagnation(state)) {
        state.status = "failed";
        state.blockers.push("Detected stagnation: no successful progress across recent iterations.");
        notes.push("Loop protection triggered due to stagnation.");
      }

      state.iteration = iteration;
      state.updatedAt = new Date().toISOString();

      const logEntry: IterationLog = {
        iteration,
        timestamp: new Date().toISOString(),
        decision,
        supervisorRawResponse: supervisorRun.rawResponse,
        workerResult,
        workerRawResponse,
        validationResult,
        stateSnapshot: {
          status: state.status,
          iteration: state.iteration,
          currentTask: state.currentTask,
          completedTasks: state.completedTasks,
          failedTasks: state.failedTasks,
          retryCounters: state.retryCounters,
          blockers: state.blockers
        },
        notes
      };

      await this.stateManager.saveState(state);
      this.config.eventSink?.emitEvent({
        runId: this.config.runId,
        type: "state_saved",
        message: "State saved",
        data: {
          iteration,
          statePath: this.stateManager.paths.stateFilePath
        }
      });
      await this.stateManager.saveIterationLog(logEntry);
      await this.stateManager.writeSummary(state, decision.reason, workerResult, validationResult);
      await this.stateManager.writeLatestStatus(state, notes.join(" | ") || decision.reason);

      this.logger.info(`Iteration ${iteration} finished with state=${state.status}`);
      this.config.eventSink?.emitEvent({
        runId: this.config.runId,
        type: "iteration_finished",
        message: `Iteration ${iteration} finished with ${state.status}`,
        data: { iteration, status: state.status }
      });

      if (state.status === "done") {
        this.logger.info("Orchestration completed successfully.");
        this.config.eventSink?.emitEvent({
          runId: this.config.runId,
          type: "run_finished",
          message: "Run finished successfully",
          data: { iteration }
        });
        return;
      }

      if (state.status === "failed") {
        this.logger.error("Orchestration failed. Check logs/latest.md and iteration logs.");
        this.config.eventSink?.emitEvent({
          runId: this.config.runId,
          type: "run_failed",
          message: "Run failed",
          data: { iteration, blockers: state.blockers }
        });
        throw new Error("Orchestration failed");
      }
    }
  }

  private async runTaskIteration(
    state: OrchestratorState,
    decision: SupervisorDecision,
    iteration: number,
    options: CliOptions,
    notes: string[]
  ): Promise<{
    state: OrchestratorState;
    workerResult: WorkerResult;
    workerRawResponse: string;
    validationResult: ValidatorResult;
  }> {
    if (!decision.nextTask) {
      throw new Error(`Decision ${decision.decision} requires nextTask.`);
    }

    state.plan = this.applyStatePatch(state.plan, decision.statePatch);

    const task: Task = {
      ...decision.nextTask,
      status: "in_progress"
    };

    state.plan = this.stateManager.upsertTask(state.plan, task);
    state.plan = this.stateManager.setTaskStatus(state.plan, task.id, "in_progress");
    state.currentTask = task;

    const workerContext = await buildWorkerContext(
      state,
      task,
      this.stateManager.paths.summaryFilePath,
      this.config.projectSourcePath,
      this.config.projectTargetPath
    );

    const workerRun = await this.worker.runOneTask(state, task, workerContext, iteration, options.dryRun);
    this.config.eventSink?.emitEvent({
      runId: this.config.runId,
      type: "worker_result",
      message: `Worker finished task ${task.id} with ${workerRun.result.taskStatus}`,
      data: {
        iteration,
        taskId: task.id,
        workerResult: workerRun.result
      }
    });
    const validationResult = this.shouldRunValidation(state, task, workerRun.result)
      ? await runValidator(this.config)
      : this.createSkippedValidation();
    state.lastValidation = validationResult;
    this.config.eventSink?.emitEvent({
      runId: this.config.runId,
      type: "validation_result",
      message: `Validator overall: ${validationResult.overall}`,
      data: {
        iteration,
        validationResult
      }
    });

    this.applyWorkerAndValidationOutcome(state, task, workerRun.result, validationResult, notes);

    const historyEntry: HistoryEntry = {
      iteration,
      timestamp: new Date().toISOString(),
      taskId: task.id,
      decision: decision.decision,
      decisionReason: decision.reason,
      workerSummary: workerRun.result.summary,
      workerStatus: workerRun.result.taskStatus,
      validationOverall: validationResult.overall
    };

    state.history.push(historyEntry);

    return {
      state,
      workerResult: workerRun.result,
      workerRawResponse: workerRun.rawResponse,
      validationResult
    };
  }

  private applyWorkerAndValidationOutcome(
    state: OrchestratorState,
    task: Task,
    workerResult: WorkerResult,
    validation: ValidatorResult,
    notes: string[]
  ): void {
    const isValidationFailed = validation.overall === "failed";
    const taskRetries = state.retryCounters[task.id] ?? 0;

    if (workerResult.taskStatus === "completed" && !isValidationFailed) {
      state.plan = this.stateManager.setTaskStatus(state.plan, task.id, "completed");
      if (!state.completedTasks.includes(task.id)) {
        state.completedTasks.push(task.id);
      }
      state.blockers = state.blockers.filter((item) => !item.includes(task.id));
      notes.push(`Task ${task.id} marked completed.`);
      return;
    }

    const nextRetryCount = taskRetries + 1;
    state.retryCounters[task.id] = nextRetryCount;

    if (workerResult.taskStatus === "failed") {
      state.plan = this.stateManager.setTaskStatus(state.plan, task.id, "failed");
      if (!state.failedTasks.includes(task.id)) {
        state.failedTasks.push(task.id);
      }
      state.blockers.push(`Task ${task.id} failed at worker stage.`);
      notes.push(`Worker failed task ${task.id}. retry=${nextRetryCount}`);
    } else if (isValidationFailed) {
      state.plan = this.stateManager.setTaskStatus(state.plan, task.id, "blocked");
      state.blockers.push(`Task ${task.id} blocked by validator failure.`);
      notes.push(`Validator failed for task ${task.id}. retry=${nextRetryCount}`);
    } else {
      state.plan = this.stateManager.setTaskStatus(state.plan, task.id, "in_progress");
      notes.push(`Task ${task.id} partial completion. retry=${nextRetryCount}`);
    }

    if (nextRetryCount > this.config.maxRetriesPerTask) {
      state.status = "failed";
      state.blockers.push(
        `Task ${task.id} exceeded MAX_RETRIES_PER_TASK=${this.config.maxRetriesPerTask}`
      );
      notes.push(`Fatal: retry limit exceeded for task ${task.id}.`);
    }
  }

  private applyStatePatch(plan: Task[], patch: SupervisorDecision["statePatch"]): Task[] {
    const markDone = new Set(patch.markDone);
    const markInProgress = new Set(patch.markInProgress);
    const markBlocked = new Set(patch.markBlocked);

    return plan.map((task) => {
      if (markDone.has(task.id)) {
        return { ...task, status: "completed" };
      }
      if (markBlocked.has(task.id)) {
        return { ...task, status: "blocked" };
      }
      if (markInProgress.has(task.id)) {
        return { ...task, status: "in_progress" };
      }
      return task;
    });
  }

  private canFinalizeNow(state: OrchestratorState, validation: ValidatorResult | null): boolean {
    const noBlockingValidation = !validation || validation.overall !== "failed";
    const noBlockers = state.blockers.length === 0;

    return noBlockingValidation && noBlockers;
  }

  private pickFallbackTask(state: OrchestratorState): Task | null {
    const current = state.plan.find((task) => task.status === "in_progress");
    if (current) {
      return current;
    }

    const pending = state.plan.find((task) => task.status === "pending");
    if (pending) {
      return pending;
    }

    return null;
  }

  private detectStagnation(state: OrchestratorState): boolean {
    if (state.history.length < 5) {
      if (state.history.length < 3) {
        return false;
      }
    }

    const recentFive = state.history.slice(-5);
    const noCompletedInFive = recentFive.length === 5 && recentFive.every((item) => item.workerStatus !== "completed");

    const recentThree = state.history.slice(-3);
    const repeatedSameTaskNoProgress =
      recentThree.length === 3 &&
      recentThree.every((item) => item.taskId === recentThree[0]?.taskId) &&
      recentThree.every((item) => item.workerStatus === "partial");

    return noCompletedInFive || repeatedSameTaskNoProgress;
  }

  private async bootstrapState(options: CliOptions): Promise<OrchestratorState> {
    const existing = await this.stateManager.loadState();

    if (options.resume) {
      if (!existing) {
        throw new Error("--resume requested but state/state.json does not exist.");
      }
      existing.status = existing.status === "done" ? "done" : "running";
      this.stateManager.logLoadedState(existing);
      return existing;
    }

    if (!options.goal) {
      throw new Error("--goal is required when starting without --resume.");
    }

    const fresh = this.stateManager.createInitialState(options.goal);
    fresh.status = "running";
    await this.stateManager.saveState(fresh);
    await this.stateManager.writeSummary(fresh, "Initialized new orchestrator run.", null, null);
    await this.stateManager.writeLatestStatus(fresh, "Initialized new orchestrator run.");

    return fresh;
  }

  private async persistTerminalState(state: OrchestratorState, note: string): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.stateManager.saveState(state);
    await this.stateManager.writeSummary(state, note, null, state.lastValidation);
    await this.stateManager.writeLatestStatus(state, note);
  }

  private shouldRunValidation(
    state: OrchestratorState,
    task: Task,
    workerResult: WorkerResult
  ): boolean {
    if (task.type === "analyze") {
      return false;
    }

    const hasFileChanges =
      workerResult.changedFiles.length > 0 ||
      workerResult.createdFiles.length > 0 ||
      workerResult.deletedFiles.length > 0;

    if (!hasFileChanges) {
      return false;
    }

    const migratedCount = state.completedTasks.filter((taskId) => taskId.startsWith("migrate::")).length;
    const nextCount = migratedCount + 1;
    return nextCount % this.config.validateEveryNTasks === 0;
  }

  private createSkippedValidation(): ValidatorResult {
    return {
      build: { status: "skipped", exitCode: 0, stdout: "", stderr: "" },
      lint: { status: "skipped", exitCode: 0, stdout: "", stderr: "" },
      tests: { status: "skipped", exitCode: 0, stdout: "", stderr: "" },
      overall: "passed"
    };
  }
}
