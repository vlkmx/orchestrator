import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import cors from "cors";
import express from "express";
import { z } from "zod";

import { AppConfig, getConfig } from "../config.js";
import { Logger } from "../logger.js";
import { Orchestrator } from "../orchestrator.js";
import { InMemoryEventBus, RuntimeEvent } from "../runtime/events.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const eventBus = new InMemoryEventBus(10_000);
const baseConfig = getConfig();

type RunStatus = "idle" | "running" | "done" | "failed";

interface RunRecord {
  runId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  config: AppConfig;
}

const runs = new Map<string, RunRecord>();
let activeRunId: string | null = null;
const appendQueues = new Map<string, Promise<void>>();

const runPayloadSchema = z.object({
  goal: z.string().min(1),
  projectSourcePath: z.string().min(1),
  projectTargetPath: z.string().min(1),
  buildCommand: z.string().min(1),
  lintCommand: z.string().min(1),
  testCommand: z.string().min(1),
  maxIterations: z.coerce.number().int().positive().default(40),
  maxRetriesPerTask: z.coerce.number().int().positive().default(3),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(true),
  demoMode: z.boolean().default(false),
  deterministicSupervisor: z.boolean().default(true),
  deterministicWorker: z.boolean().default(false)
});

eventBus.on("event", (event: RuntimeEvent) => {
  void persistEvent(event);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, activeRunId });
});

app.get("/api/events", (req, res) => {
  const since = Number(req.query.since ?? 0);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const backlog = Number.isFinite(since)
    ? eventBus.getEventsSince(since)
    : eventBus.getLatest(200);

  for (const event of backlog) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const onEvent = (event: RuntimeEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  eventBus.on("event", onEvent);

  req.on("close", () => {
    eventBus.off("event", onEvent);
    res.end();
  });
});

app.get("/api/runs/current", (_req, res) => {
  if (!activeRunId) {
    res.json({ activeRun: null });
    return;
  }

  const run = runs.get(activeRunId) ?? null;
  res.json({ activeRun: run });
});

app.get("/api/runs/:runId", async (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const statePath = path.join(run.config.stateDir, "state.json");
  const summaryPath = path.join(run.config.stateDir, "context-summary.md");
  const latestPath = path.join(run.config.logsDir, "latest.md");
  const eventsPath = path.join(run.config.logsDir, "events.ndjson");
  const commandsPath = path.join(run.config.logsDir, "commands.ndjson");
  const iterationDir = path.join(run.config.logsDir, "iterations");

  const [state, summary, latest, iterationFiles, events, commands] = await Promise.all([
    readSafeJson(statePath),
    readSafeText(summaryPath),
    readSafeText(latestPath),
    readIterationFiles(iterationDir),
    readSafeText(eventsPath),
    readSafeText(commandsPath)
  ]);

  res.json({
    run,
    artifacts: {
      state,
      summary,
      latest,
      iterationFiles,
      events,
      commands
    }
  });
});

app.get("/api/runs/:runId/iterations/:file", async (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const filePath = path.join(run.config.logsDir, "iterations", req.params.file);
  try {
    const content = await fs.readFile(filePath, "utf8");
    res.type("application/json").send(content);
  } catch {
    res.status(404).json({ error: "Iteration file not found" });
  }
});

app.post("/api/runs/start", async (req, res) => {
  if (activeRunId) {
    res.status(409).json({ error: "Another run is already active", activeRunId });
    return;
  }

  const payload = runPayloadSchema.parse(req.body);
  if (!isWithinProject(path.resolve(payload.projectSourcePath))) {
    res.status(400).json({ error: "projectSourcePath must be inside current project folder" });
    return;
  }
  if (!isWithinProject(path.resolve(payload.projectTargetPath))) {
    res.status(400).json({ error: "projectTargetPath must be inside current project folder" });
    return;
  }

  const runId = createRunId();
  const runRoot = path.resolve(process.cwd(), ".orchestrator-data", "runs", runId);

  const config: AppConfig = {
    ...baseConfig,
    runId,
    eventSink: eventBus,
    demoMode: payload.demoMode,
    projectSourcePath: path.resolve(payload.projectSourcePath),
    projectTargetPath: path.resolve(payload.projectTargetPath),
    buildCommand: payload.buildCommand,
    lintCommand: payload.lintCommand,
    testCommand: payload.testCommand,
    maxIterations: payload.maxIterations,
    maxRetriesPerTask: payload.maxRetriesPerTask,
    deterministicSupervisor: payload.deterministicSupervisor,
    deterministicWorker: payload.deterministicWorker,
    stateDir: path.join(runRoot, "state"),
    logsDir: path.join(runRoot, "logs")
  };

  const run: RunRecord = {
    runId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    config
  };

  runs.set(runId, run);
  activeRunId = runId;

  eventBus.emitEvent({
    runId,
    type: "run_started",
    message: `Run ${runId} queued from UI`,
    data: {
      goal: payload.goal,
      config: {
        projectSourcePath: config.projectSourcePath,
        projectTargetPath: config.projectTargetPath,
        stateDir: config.stateDir,
        logsDir: config.logsDir,
        demoMode: config.demoMode,
        deterministicSupervisor: config.deterministicSupervisor,
        deterministicWorker: config.deterministicWorker,
        dryRun: payload.dryRun
      }
    }
  });

  const logger = new Logger(payload.verbose, runId, eventBus);
  const orchestrator = new Orchestrator(config, logger);

  void orchestrator
    .run({
      goal: payload.goal,
      resume: false,
      dryRun: payload.dryRun,
      verbose: payload.verbose
    })
    .then(() => {
      run.status = "done";
      run.finishedAt = new Date().toISOString();
      activeRunId = null;
    })
    .catch((error) => {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      run.finishedAt = new Date().toISOString();
      activeRunId = null;

      eventBus.emitEvent({
        runId,
        type: "run_failed",
        message: `Run ${runId} failed`,
        data: { error: run.error }
      });
    });

  res.status(202).json({ runId, status: run.status });
});

const port = Number(process.env.ORCHESTRATOR_API_PORT ?? 8787);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Orchestrator API listening on http://localhost:${port}`);
});

function createRunId(): string {
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  return `run-${stamp}`;
}

async function readSafeText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readSafeJson(filePath: string): Promise<unknown | null> {
  const content = await readSafeText(filePath);
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

async function readIterationFiles(iterationDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(iterationDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function isWithinProject(absolutePath: string): boolean {
  const projectRoot = path.resolve(process.cwd());
  const normalized = path.resolve(absolutePath);
  const rootPrefix = projectRoot.endsWith(path.sep) ? projectRoot : `${projectRoot}${path.sep}`;
  return normalized === projectRoot || normalized.startsWith(rootPrefix);
}

async function persistEvent(event: RuntimeEvent): Promise<void> {
  const run = runs.get(event.runId);
  if (!run) {
    return;
  }

  const eventFile = path.join(run.config.logsDir, "events.ndjson");
  const commandFile = path.join(run.config.logsDir, "commands.ndjson");
  const line = `${JSON.stringify(event)}\n`;

  const previous = appendQueues.get(event.runId) ?? Promise.resolve();
  const next = previous
    .then(async () => {
      await fs.mkdir(run.config.logsDir, { recursive: true });
      await fs.appendFile(eventFile, line, "utf8");
      if (event.type.startsWith("command_")) {
        await fs.appendFile(commandFile, line, "utf8");
      }
    })
    .catch(() => {
      // Ignore persistence failures to avoid breaking main run loop.
    });

  appendQueues.set(event.runId, next);
}
