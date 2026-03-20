import { AppConfig } from "../config.js";
import { validatorResultSchema } from "../state/schemas.js";
import { ValidatorResult } from "../state/types.js";
import { runBuild, runLint, runTests } from "../tools/shell-tools.js";

function computeOverall(result: Omit<ValidatorResult, "overall">): ValidatorResult["overall"] {
  const statuses = [result.build.status, result.lint.status, result.tests.status];
  if (statuses.every((status) => status === "passed" || status === "skipped")) {
    return "passed";
  }
  if (statuses.some((status) => status === "passed")) {
    return "partial";
  }
  return "failed";
}

export async function runValidator(config: AppConfig): Promise<ValidatorResult> {
  const build = await runBuild(config);
  const lint = await runLint(config);
  const tests = await runTests(config);

  const payload: ValidatorResult = {
    build,
    lint,
    tests,
    overall: computeOverall({ build, lint, tests })
  };

  return validatorResultSchema.parse(payload);
}
