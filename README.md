# Multi-Agent Orchestrator MVP (Node.js + TypeScript)

Production-like MVP orchestration engine for incremental component-by-component migration from project A to project B.

## What this project implements

- Supervisor (LLM): plans and decides next small task (`continue | retry | done | failed`)
- Worker (LLM): executes exactly one small task per iteration and reports structured result
- Validator (code module): runs build/lint/tests and returns structured output
- Explicit orchestrator loop with finite-stop guards
- File-based durable state + iteration logs
- Compact context packaging (state + summary + local iteration slice)
- Demo mode (`DEMO_MODE=true`) for loop verification without real migration setup

## File structure

```text
src/
  index.ts
  orchestrator.ts
  agents/
    llm.ts
    prompts.ts
    supervisor.ts
    worker.ts
  state/
    schemas.ts
    state-manager.ts
    types.ts
  tools/
    context-builder.ts
    file-tools.ts
    shell-tools.ts
  validator/
    validator.ts
  server/
    server.ts
  runtime/
    events.ts
  config.ts
  logger.ts

state/
  state.json
  context-summary.md
  example-initial-state.json

logs/
  latest.md
  iterations/
    iteration-1.json
    example-iteration-log.json

examples/
  project-a/
    src/components/Button.tsx
  project-b/
    package.json
    src/components/README.md

web/
  src/
    App.tsx
    main.tsx
    components/ui/*
    lib/utils.ts
  package.json
  vite.config.ts
```

## Install

```bash
npm install
```

## Configure

Create `.env` from `.env.example` and set:

- `OPENAI_API_KEY`
- `MODEL_SUPERVISOR`
- `MODEL_WORKER`
- `PROJECT_SOURCE_PATH`
- `PROJECT_TARGET_PATH`
- `BUILD_COMMAND`
- `LINT_COMMAND`
- `TEST_COMMAND`
- `MAX_ITERATIONS`
- `MAX_RETRIES_PER_TASK`
- Optional: `DEMO_MODE=true`

## Run

Development:

```bash
npm run dev -- --goal "Постепенно перенести проект A в проект B по компонентам"
```

Production build:

```bash
npm run build
node dist/index.js --goal "Постепенно перенести проект A в проект B по компонентам"
```

Resume existing run:

```bash
node dist/index.js --resume
```

Dry run:

```bash
node dist/index.js --goal "..." --dry-run
```

Verbose:

```bash
node dist/index.js --goal "..." --verbose
```

## Web GUI (Vite + React)

API server:

```bash
npm run dev:api
```

Web UI (second terminal):

```bash
npm run dev:web
```

Open `http://localhost:5173`.

What GUI supports:

- start global task from form
- pass source/target directories
- configure goal + build/lint/test commands
- toggle `dry-run`, `verbose`, `demo-mode`
- live event stream via SSE
- command timeline (start/output/finish)
- iteration log viewer and run artifacts

## CLI flags

- `--goal "..."`
- `--resume`
- `--dry-run`
- `--verbose`

Behavior:

- `--resume`: loads existing `state/state.json`
- `--dry-run`: no project file writes by Worker artifacts/copy step
- `--verbose`: prints debug logs

## Orchestrator stop rules

Success stop:

1. Supervisor returns `done` OR all tasks are completed
2. Validator has no blocking failures (`overall !== failed`)
3. No open blockers

Failure stop:

1. Reached `MAX_ITERATIONS`
2. Task exceeded `MAX_RETRIES_PER_TASK`
3. Supervisor returned `failed`
4. Fatal runtime error / stagnation protection triggered

## Persistence

- `state/state.json` - full machine state
- `state/context-summary.md` - compact rolling summary
- `logs/iterations/iteration-N.json` - full iteration-level trace
- `logs/latest.md` - human-readable current status

State includes:

- `globalGoal`, `status`, `iteration`
- `plan`, `currentTask`
- `completedTasks`, `failedTasks`
- `retryCounters`
- `lastValidation`
- `blockers`
- `history`

## Demo mode

With `DEMO_MODE=true`, Supervisor and Worker use deterministic mock behavior (no OpenAI API call), while Validator still runs configured shell commands.

The repo includes demo projects:

- `examples/project-a` (source)
- `examples/project-b` (target)

so you can validate full loop quickly.
