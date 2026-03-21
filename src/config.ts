import "dotenv/config";

import path from "node:path";
import { z } from "zod";
import { EventSink } from "./runtime/events.js";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  MODEL_SUPERVISOR: z.string().default("gpt-5.2"),
  MODEL_WORKER: z.string().default("gpt-5.2-mini"),
  PROJECT_SOURCE_PATH: z.string().default("."),
  PROJECT_TARGET_PATH: z.string().default("."),
  BUILD_COMMAND: z.string().default("npm run build"),
  LINT_COMMAND: z.string().default("npm run lint"),
  TEST_COMMAND: z.string().default("npm run test"),
  MAX_ITERATIONS: z.coerce.number().int().positive().default(40),
  MAX_RETRIES_PER_TASK: z.coerce.number().int().positive().default(3),
  STATE_DIR: z.string().default("./state"),
  LOGS_DIR: z.string().default("./logs"),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  SUPERVISOR_MAX_JSON_RETRIES: z.coerce.number().int().positive().default(3),
  WORKER_MAX_JSON_RETRIES: z.coerce.number().int().positive().default(3),
  VALIDATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  DETERMINISTIC_SUPERVISOR: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  DETERMINISTIC_WORKER: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  VALIDATE_EVERY_N_TASKS: z.coerce.number().int().positive().default(3),
  WORKER_WRITE_REPORTS: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

export interface AppConfig {
  openAIApiKey: string | undefined;
  modelSupervisor: string;
  modelWorker: string;
  projectSourcePath: string;
  projectTargetPath: string;
  buildCommand: string;
  lintCommand: string;
  testCommand: string;
  maxIterations: number;
  maxRetriesPerTask: number;
  stateDir: string;
  logsDir: string;
  demoMode: boolean;
  supervisorMaxJsonRetries: number;
  workerMaxJsonRetries: number;
  validatorTimeoutMs: number;
  runId: string;
  eventSink: EventSink | null;
  deterministicSupervisor: boolean;
  deterministicWorker: boolean;
  validateEveryNTasks: number;
  workerWriteReports: boolean;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.parse(process.env);
  const cwd = process.cwd();
  const runId = "default-run";

  const config: AppConfig = {
    openAIApiKey: parsed.OPENAI_API_KEY,
    modelSupervisor: parsed.MODEL_SUPERVISOR,
    modelWorker: parsed.MODEL_WORKER,
    projectSourcePath: path.resolve(cwd, parsed.PROJECT_SOURCE_PATH),
    projectTargetPath: path.resolve(cwd, parsed.PROJECT_TARGET_PATH),
    buildCommand: parsed.BUILD_COMMAND,
    lintCommand: parsed.LINT_COMMAND,
    testCommand: parsed.TEST_COMMAND,
    maxIterations: parsed.MAX_ITERATIONS,
    maxRetriesPerTask: parsed.MAX_RETRIES_PER_TASK,
    stateDir: path.resolve(cwd, parsed.STATE_DIR),
    logsDir: path.resolve(cwd, parsed.LOGS_DIR),
    demoMode: parsed.DEMO_MODE ?? false,
    supervisorMaxJsonRetries: parsed.SUPERVISOR_MAX_JSON_RETRIES,
    workerMaxJsonRetries: parsed.WORKER_MAX_JSON_RETRIES,
    validatorTimeoutMs: parsed.VALIDATOR_TIMEOUT_MS,
    runId,
    eventSink: null,
    deterministicSupervisor: parsed.DETERMINISTIC_SUPERVISOR ?? true,
    deterministicWorker: parsed.DETERMINISTIC_WORKER ?? false,
    validateEveryNTasks: parsed.VALIDATE_EVERY_N_TASKS,
    workerWriteReports: parsed.WORKER_WRITE_REPORTS ?? false
  };

  assertWithinProject(config.projectSourcePath, "PROJECT_SOURCE_PATH");
  assertWithinProject(config.projectTargetPath, "PROJECT_TARGET_PATH");
  assertWithinProject(config.stateDir, "STATE_DIR");
  assertWithinProject(config.logsDir, "LOGS_DIR");

  cachedConfig = config;
  return config;
}

function assertWithinProject(absolutePath: string, label: string): void {
  const projectRoot = path.resolve(process.cwd());
  const normalized = path.resolve(absolutePath);
  const rootPrefix = projectRoot.endsWith(path.sep) ? projectRoot : `${projectRoot}${path.sep}`;
  if (!(normalized === projectRoot || normalized.startsWith(rootPrefix))) {
    throw new Error(`${label} must be inside project root: ${projectRoot}`);
  }
}
