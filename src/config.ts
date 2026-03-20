import "dotenv/config";

import path from "node:path";
import { z } from "zod";

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
  VALIDATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(120000)
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
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.parse(process.env);
  const cwd = process.cwd();

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
    validatorTimeoutMs: parsed.VALIDATOR_TIMEOUT_MS
  };

  cachedConfig = config;
  return config;
}
