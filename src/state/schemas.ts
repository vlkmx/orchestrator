import { z } from "zod";

export const taskTypeSchema = z.enum([
  "analyze",
  "migrate_component",
  "fix_build",
  "write_tests",
  "refactor"
]);

export const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "failed"
]);

export const taskSchema = z.object({
  id: z.string().min(1),
  type: taskTypeSchema,
  title: z.string().min(1),
  component: z.string().min(1),
  sourcePaths: z.array(z.string()),
  targetPaths: z.array(z.string()),
  instructions: z.string().min(1),
  acceptanceCriteria: z.array(z.string()),
  status: taskStatusSchema
});

export const supervisorDecisionSchema = z.object({
  decision: z.enum(["continue", "retry", "done", "failed"]),
  reason: z.string().min(1),
  nextTask: z
    .object({
      id: z.string().min(1),
      type: taskTypeSchema,
      title: z.string().min(1),
      component: z.string().min(1),
      sourcePaths: z.array(z.string()),
      targetPaths: z.array(z.string()),
      instructions: z.string().min(1),
      acceptanceCriteria: z.array(z.string())
    })
    .nullable(),
  statePatch: z.object({
    markDone: z.array(z.string()),
    markInProgress: z.array(z.string()),
    markBlocked: z.array(z.string())
  })
});

export const workerResultSchema = z.object({
  summary: z.string().min(1),
  changedFiles: z.array(z.string()),
  createdFiles: z.array(z.string()),
  deletedFiles: z.array(z.string()),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
  taskStatus: z.enum(["completed", "partial", "failed"])
});

export const commandResultSchema = z.object({
  status: z.enum(["passed", "failed", "skipped"]),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string()
});

export const validatorResultSchema = z.object({
  build: commandResultSchema,
  lint: commandResultSchema,
  tests: commandResultSchema,
  overall: z.enum(["passed", "failed", "partial"])
});

export const historyEntrySchema = z.object({
  iteration: z.number().int().min(0),
  timestamp: z.string().min(1),
  taskId: z.string().nullable(),
  decision: z.enum(["continue", "retry", "done", "failed"]),
  decisionReason: z.string().min(1),
  workerSummary: z.string().min(1),
  workerStatus: z.enum(["completed", "partial", "failed", "skipped"]),
  validationOverall: z.enum(["passed", "failed", "partial", "skipped"])
});

export const orchestratorStateSchema = z.object({
  globalGoal: z.string().min(1),
  status: z.enum(["idle", "running", "done", "failed"]),
  iteration: z.number().int().min(0),
  plan: z.array(taskSchema),
  currentTask: taskSchema.nullable(),
  completedTasks: z.array(z.string()),
  failedTasks: z.array(z.string()),
  retryCounters: z.record(z.string(), z.number().int().min(0)),
  lastValidation: validatorResultSchema.nullable(),
  blockers: z.array(z.string()),
  history: z.array(historyEntrySchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const iterationLogSchema = z.object({
  iteration: z.number().int().min(0),
  timestamp: z.string().min(1),
  decision: supervisorDecisionSchema,
  supervisorRawResponse: z.string(),
  workerResult: workerResultSchema.nullable(),
  workerRawResponse: z.string(),
  validationResult: validatorResultSchema.nullable(),
  stateSnapshot: z.object({
    status: z.enum(["idle", "running", "done", "failed"]),
    iteration: z.number().int().min(0),
    currentTask: taskSchema.nullable(),
    completedTasks: z.array(z.string()),
    failedTasks: z.array(z.string()),
    retryCounters: z.record(z.string(), z.number().int().min(0)),
    blockers: z.array(z.string())
  }),
  notes: z.array(z.string())
});

export const cliArgsSchema = z.object({
  goal: z.union([z.string(), z.undefined()]),
  resume: z.boolean(),
  dryRun: z.boolean(),
  verbose: z.boolean()
});

export type SupervisorDecisionSchema = z.infer<typeof supervisorDecisionSchema>;
export type WorkerResultSchema = z.infer<typeof workerResultSchema>;
export type ValidatorResultSchema = z.infer<typeof validatorResultSchema>;
export type OrchestratorStateSchema = z.infer<typeof orchestratorStateSchema>;
