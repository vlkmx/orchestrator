import { execaCommand } from "execa";

import { AppConfig } from "../config.js";
import { CommandResult } from "../state/types.js";

function truncateOutput(output: string, maxLength = 12_000): string {
  if (output.length <= maxLength) {
    return output;
  }
  return `${output.slice(0, maxLength)}\n...[truncated]`;
}

async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandResult> {
  try {
    const result = await execaCommand(command, {
      cwd,
      timeout: timeoutMs,
      reject: false,
      shell: true
    });

    return {
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode ?? 1,
      stdout: truncateOutput(result.stdout ?? ""),
      stderr: truncateOutput(result.stderr ?? "")
    };
  } catch (error) {
    const err = error as Error;
    return {
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: truncateOutput(err.message)
    };
  }
}

export async function runBuild(config: AppConfig): Promise<CommandResult> {
  if (!config.buildCommand.trim()) {
    return { status: "skipped", exitCode: 0, stdout: "", stderr: "" };
  }
  return runCommand(config.buildCommand, config.projectTargetPath, config.validatorTimeoutMs);
}

export async function runLint(config: AppConfig): Promise<CommandResult> {
  if (!config.lintCommand.trim()) {
    return { status: "skipped", exitCode: 0, stdout: "", stderr: "" };
  }
  return runCommand(config.lintCommand, config.projectTargetPath, config.validatorTimeoutMs);
}

export async function runTests(config: AppConfig): Promise<CommandResult> {
  if (!config.testCommand.trim()) {
    return { status: "skipped", exitCode: 0, stdout: "", stderr: "" };
  }
  return runCommand(config.testCommand, config.projectTargetPath, config.validatorTimeoutMs);
}
