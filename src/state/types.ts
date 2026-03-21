export type OrchestratorStatus = "idle" | "running" | "done" | "failed";

export type TaskType =
  | "analyze"
  | "migrate_component"
  | "fix_build"
  | "write_tests"
  | "refactor";

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed";

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  component: string;
  sourcePaths: string[];
  targetPaths: string[];
  instructions: string;
  acceptanceCriteria: string[];
  status: TaskStatus;
}

export type SupervisorDecisionType = "continue" | "retry" | "done" | "failed";

export interface StatePatch {
  markDone: string[];
  markInProgress: string[];
  markBlocked: string[];
}

export interface SupervisorDecision {
  decision: SupervisorDecisionType;
  reason: string;
  nextTask: Omit<Task, "status"> | null;
  statePatch: StatePatch;
}

export type WorkerTaskStatus = "completed" | "partial" | "failed";

export type WorkerFileOp =
  | {
      op: "write";
      path: string;
      content: string;
    }
  | {
      op: "delete";
      path: string;
    };

export interface WorkerResult {
  summary: string;
  changedFiles: string[];
  createdFiles: string[];
  deletedFiles: string[];
  risks: string[];
  openQuestions: string[];
  fileOps: WorkerFileOp[];
  taskStatus: WorkerTaskStatus;
}

export type CheckStatus = "passed" | "failed" | "skipped";

export interface CommandResult {
  status: CheckStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ValidatorResult {
  build: CommandResult;
  lint: CommandResult;
  tests: CommandResult;
  overall: "passed" | "failed" | "partial";
}

export interface HistoryEntry {
  iteration: number;
  timestamp: string;
  taskId: string | null;
  decision: SupervisorDecisionType;
  decisionReason: string;
  workerSummary: string;
  workerStatus: WorkerTaskStatus | "skipped";
  validationOverall: ValidatorResult["overall"] | "skipped";
}

export interface OrchestratorState {
  globalGoal: string;
  status: OrchestratorStatus;
  iteration: number;
  plan: Task[];
  currentTask: Task | null;
  completedTasks: string[];
  failedTasks: string[];
  retryCounters: Record<string, number>;
  lastValidation: ValidatorResult | null;
  blockers: string[];
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface IterationLog {
  iteration: number;
  timestamp: string;
  decision: SupervisorDecision;
  supervisorRawResponse: string;
  workerResult: WorkerResult | null;
  workerRawResponse: string;
  validationResult: ValidatorResult | null;
  stateSnapshot: Pick<
    OrchestratorState,
    | "status"
    | "iteration"
    | "currentTask"
    | "completedTasks"
    | "failedTasks"
    | "retryCounters"
    | "blockers"
  >;
  notes: string[];
}

export interface CliOptions {
  goal: string | undefined;
  resume: boolean;
  dryRun: boolean;
  verbose: boolean;
}

export interface RuntimeFlags {
  dryRun: boolean;
  verbose: boolean;
  resume: boolean;
}
