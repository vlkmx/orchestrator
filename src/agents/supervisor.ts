import OpenAI from "openai";

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
