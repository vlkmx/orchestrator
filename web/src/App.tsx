import { FormEvent, ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Activity, FolderOpen, Play, Terminal } from "lucide-react";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

type RuntimeEventType =
  | "run_started"
  | "run_finished"
  | "run_failed"
  | "log"
  | "iteration_started"
  | "iteration_finished"
  | "supervisor_decision"
  | "worker_result"
  | "validation_result"
  | "command_started"
  | "command_output"
  | "command_finished"
  | "state_saved";

interface RuntimeEvent {
  id: number;
  timestamp: string;
  runId: string;
  type: RuntimeEventType;
  message: string;
  data?: Record<string, unknown>;
}

interface RunRecord {
  runId: string;
  status: "idle" | "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  config: {
    stateDir: string;
    logsDir: string;
    projectSourcePath: string;
    projectTargetPath: string;
    demoMode: boolean;
  };
}

interface RunArtifacts {
  state: unknown;
  summary: string | null;
  latest: string | null;
  iterationFiles: string[];
}

interface CurrentRunResponse {
  activeRun: RunRecord | null;
}

interface RunDetailsResponse {
  run: RunRecord;
  artifacts: RunArtifacts;
}

interface StartPayload {
  goal: string;
  projectSourcePath: string;
  projectTargetPath: string;
  buildCommand: string;
  lintCommand: string;
  testCommand: string;
  maxIterations: number;
  maxRetriesPerTask: number;
  dryRun: boolean;
  verbose: boolean;
  demoMode: boolean;
}

const defaultPayload: StartPayload = {
  goal: "Постепенно перенести проект A в проект B по компонентам",
  projectSourcePath: "/Users/max/Desktop/projects/multiagents-test/examples/project-a",
  projectTargetPath: "/Users/max/Desktop/projects/multiagents-test/examples/project-b",
  buildCommand: "npm run build",
  lintCommand: "npm run lint",
  testCommand: "npm run test",
  maxIterations: 40,
  maxRetriesPerTask: 3,
  dryRun: false,
  verbose: true,
  demoMode: true
};

export default function App(): ReactElement {
  const [payload, setPayload] = useState<StartPayload>(defaultPayload);
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<RunArtifacts | null>(null);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [selectedIteration, setSelectedIteration] = useState<string | null>(null);
  const [iterationContent, setIterationContent] = useState<string>("");
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const commandEvents = useMemo(
    () => events.filter((event) => event.type.startsWith("command_")),
    [events]
  );

  useEffect(() => {
    void refreshCurrentRun();

    const interval = window.setInterval(() => {
      void refreshCurrentRun();
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }

    void refreshRunDetails(selectedRunId);

    const interval = window.setInterval(() => {
      void refreshRunDetails(selectedRunId);
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const since = events.at(-1)?.id ?? 0;
    const source = new EventSource(`${API_BASE}/api/events?since=${since}`);
    eventSourceRef.current = source;

    source.onmessage = (message) => {
      try {
        const incoming = JSON.parse(message.data) as RuntimeEvent;
        setEvents((prev) => {
          if (prev.some((item) => item.id === incoming.id)) {
            return prev;
          }
          return [...prev, incoming].slice(-500);
        });

        if (!selectedRunId) {
          setSelectedRunId(incoming.runId);
        }
      } catch {
        // Keep stream alive.
      }
    };

    return () => {
      source.close();
    };
  }, []);

  async function refreshCurrentRun(): Promise<void> {
    const response = await fetch(`${API_BASE}/api/runs/current`);
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as CurrentRunResponse;
    setActiveRun(data.activeRun);

    if (data.activeRun?.runId) {
      setSelectedRunId((prev) => prev ?? data.activeRun?.runId ?? null);
    }
  }

  async function refreshRunDetails(runId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/runs/${runId}`);
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as RunDetailsResponse;
    setArtifacts(data.artifacts);
    setActiveRun(data.run);
  }

  async function onStartRun(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsStarting(true);
    setStartError(null);

    try {
      const response = await fetch(`${API_BASE}/api/runs/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to start run");
      }

      const body = (await response.json()) as { runId: string };
      setSelectedRunId(body.runId);
      await refreshCurrentRun();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsStarting(false);
    }
  }

  async function loadIteration(fileName: string): Promise<void> {
    if (!selectedRunId) {
      return;
    }

    const response = await fetch(`${API_BASE}/api/runs/${selectedRunId}/iterations/${fileName}`);
    if (!response.ok) {
      return;
    }

    const content = await response.text();
    setSelectedIteration(fileName);
    setIterationContent(content);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 md:px-8">
      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/80 p-5 backdrop-blur">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-sky-400" />
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-100">Orchestrator Control Center</h1>
        </div>
        <p className="mb-0 mt-2 text-sm text-slate-400">
          Запуск глобальной миграционной задачи, live-события, итерации и системные команды в реальном времени.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={onStartRun}>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-slate-300">Global Goal</label>
              <Textarea
                value={payload.goal}
                onChange={(event) => setPayload((prev) => ({ ...prev, goal: event.target.value }))}
              />
            </div>

            <Field label="Source Project Directory" value={payload.projectSourcePath} onChange={(value) => setPayload((prev) => ({ ...prev, projectSourcePath: value }))} />
            <Field label="Target Project Directory" value={payload.projectTargetPath} onChange={(value) => setPayload((prev) => ({ ...prev, projectTargetPath: value }))} />
            <Field label="Build Command" value={payload.buildCommand} onChange={(value) => setPayload((prev) => ({ ...prev, buildCommand: value }))} />
            <Field label="Lint Command" value={payload.lintCommand} onChange={(value) => setPayload((prev) => ({ ...prev, lintCommand: value }))} />
            <Field label="Test Command" value={payload.testCommand} onChange={(value) => setPayload((prev) => ({ ...prev, testCommand: value }))} />

            <div>
              <label className="mb-1 block text-sm text-slate-300">Max Iterations</label>
              <Input
                type="number"
                value={payload.maxIterations}
                onChange={(event) =>
                  setPayload((prev) => ({ ...prev, maxIterations: Number(event.target.value) || 1 }))
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-slate-300">Max Retries Per Task</label>
              <Input
                type="number"
                value={payload.maxRetriesPerTask}
                onChange={(event) =>
                  setPayload((prev) => ({ ...prev, maxRetriesPerTask: Number(event.target.value) || 1 }))
                }
              />
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center gap-5 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
              <Toggle
                label="Dry Run"
                checked={payload.dryRun}
                onChange={(checked) => setPayload((prev) => ({ ...prev, dryRun: checked }))}
              />
              <Toggle
                label="Verbose"
                checked={payload.verbose}
                onChange={(checked) => setPayload((prev) => ({ ...prev, verbose: checked }))}
              />
              <Toggle
                label="Demo Mode"
                checked={payload.demoMode}
                onChange={(checked) => setPayload((prev) => ({ ...prev, demoMode: checked }))}
              />
            </div>

            <div className="md:col-span-2 flex items-center justify-between gap-4">
              <Button type="submit" disabled={isStarting || Boolean(activeRun && activeRun.status === "running")}>
                <Play className="mr-2 h-4 w-4" />
                {isStarting ? "Starting..." : "Start Global Task"}
              </Button>
              {startError ? <span className="text-sm text-red-300">{startError}</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>Current Run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {activeRun ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge className={statusColor(activeRun.status)}>{activeRun.status}</Badge>
                  <span className="text-slate-400">{activeRun.runId}</span>
                </div>
                <p className="m-0 text-slate-300">Started: {formatDate(activeRun.startedAt)}</p>
                <p className="m-0 text-slate-300">Finished: {activeRun.finishedAt ? formatDate(activeRun.finishedAt) : "-"}</p>
                <p className="m-0 flex items-center gap-2 text-slate-300">
                  <FolderOpen className="h-4 w-4 text-sky-400" />
                  {activeRun.config.projectTargetPath}
                </p>
                {activeRun.error ? <p className="m-0 text-red-300">{activeRun.error}</p> : null}
              </>
            ) : (
              <p className="m-0 text-slate-400">No active run.</p>
            )}

            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-200">Latest Summary</h4>
              <pre className="max-h-48 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
                {artifacts?.summary ?? "-"}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Live Event Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[380px] space-y-2 overflow-auto rounded-md bg-slate-950 p-3">
              {events.length === 0 ? (
                <p className="text-sm text-slate-400">Waiting for events...</p>
              ) : (
                events
                  .slice()
                  .reverse()
                  .map((event) => (
                    <div key={event.id} className="rounded border border-slate-800 bg-slate-900 p-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-sky-300">{event.type}</span>
                        <span className="text-slate-500">{formatDate(event.timestamp)}</span>
                      </div>
                      <p className="mb-0 mt-1 text-sm text-slate-200">{event.message}</p>
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>System Commands</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[340px] space-y-2 overflow-auto rounded-md bg-slate-950 p-3">
              {commandEvents.length === 0 ? (
                <p className="text-sm text-slate-400">No command events yet.</p>
              ) : (
                commandEvents
                  .slice()
                  .reverse()
                  .map((event) => (
                    <div key={event.id} className="rounded border border-slate-800 p-2 text-xs text-slate-300">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-emerald-300">{event.type}</span>
                        <span className="text-slate-500">{formatDate(event.timestamp)}</span>
                      </div>
                      <p className="mb-0 mt-1 break-all">{String(event.data?.command ?? event.message)}</p>
                      {event.type === "command_output" ? (
                        <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[11px]">
                          {String(event.data?.chunk ?? "")}
                        </pre>
                      ) : null}
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Iteration Logs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(artifacts?.iterationFiles ?? []).map((file) => (
                <Button key={file} variant={file === selectedIteration ? "default" : "secondary"} size="sm" onClick={() => void loadIteration(file)}>
                  {file}
                </Button>
              ))}
            </div>

            <div className="max-h-[320px] overflow-auto rounded-md bg-slate-950 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
                <Terminal className="h-4 w-4" />
                {selectedIteration ?? "Select iteration log"}
              </div>
              <pre className="m-0 whitespace-pre-wrap text-xs text-slate-200">{iterationContent || "No iteration selected."}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div>
      <label className="mb-1 block text-sm text-slate-300">{label}</label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-500"
      />
      {label}
    </label>
  );
}

function statusColor(status: RunRecord["status"]): string {
  if (status === "running") {
    return "border-sky-400 bg-sky-500/10 text-sky-300";
  }
  if (status === "done") {
    return "border-emerald-400 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "failed") {
    return "border-red-400 bg-red-500/10 text-red-300";
  }
  return "border-slate-500 bg-slate-500/10 text-slate-300";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleString();
}
