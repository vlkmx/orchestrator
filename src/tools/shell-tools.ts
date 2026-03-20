import { execa } from "execa";

import { AppConfig } from "../config.js";
import { CommandResult } from "../state/types.js";

function truncateOutput(output: string, maxLength = 12_000): string {
  if (output.length <= maxLength) {
    return output;
  }
  return `${output.slice(0, maxLength)}\n...[truncated]`;
}

async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandResult> {
  const start = Date.now();
  configEvent(command, cwd, "command_started");
  try {
    const subprocess = execa(command, {
      cwd,
      timeout: timeoutMs,
      reject: false,
      shell: true
    });

    let stdout = "";
    let stderr = "";

    subprocess.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      configEvent(command, cwd, "command_output", {
        stream: "stdout",
        chunk: truncateOutput(text, 1500)
      });
    });

    subprocess.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      configEvent(command, cwd, "command_output", {
        stream: "stderr",
        chunk: truncateOutput(text, 1500)
      });
    });

    const result = await subprocess;
    configEvent(command, cwd, "command_finished", {
      exitCode: result.exitCode ?? 1,
      durationMs: Date.now() - start
    });

    return {
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode ?? 1,
      stdout: truncateOutput(stdout || result.stdout || ""),
      stderr: truncateOutput(stderr || result.stderr || "")
    };
  } catch (error) {
    const err = error as Error;
    configEvent(command, cwd, "command_finished", {
      exitCode: 1,
      durationMs: Date.now() - start,
      error: err.message
    });
    return {
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: truncateOutput(err.message)
    };
  }
}

let activeConfig: AppConfig | null = null;

function configEvent(
  command: string,
  cwd: string,
  type: "command_started" | "command_output" | "command_finished",
  data: Record<string, unknown> = {}
): void {
  if (!activeConfig?.eventSink) {
    return;
  }

  activeConfig.eventSink.emitEvent({
    runId: activeConfig.runId,
    type,
    message: type === "command_output" ? command : `${type}: ${command}`,
    data: {
      command,
      cwd,
      ...data
    }
  });
}

export async function runBuild(config: AppConfig): Promise<CommandResult> {
  activeConfig = config;
  if (!config.buildCommand.trim()) {
    return { status: "skipped", exitCode: 0, stdout: "", stderr: "" };
  }
  return runCommand(config.buildCommand, config.projectTargetPath, config.validatorTimeoutMs);
}

export async function runLint(config: AppConfig): Promise<CommandResult> {
  activeConfig = config;
  if (!config.lintCommand.trim()) {
    return { status: "skipped", exitCode: 0, stdout: "", stderr: "" };
  }
  return runCommand(config.lintCommand, config.projectTargetPath, config.validatorTimeoutMs);
}

export async function runTests(config: AppConfig): Promise<CommandResult> {
  activeConfig = config;
  if (!config.testCommand.trim()) {
    return { status: "skipped", exitCode: 0, stdout: "", stderr: "" };
  }
  return runCommand(config.testCommand, config.projectTargetPath, config.validatorTimeoutMs);
}
