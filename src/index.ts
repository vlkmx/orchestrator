import { getConfig } from "./config.js";
import { Logger } from "./logger.js";
import { Orchestrator } from "./orchestrator.js";
import { cliArgsSchema } from "./state/schemas.js";
import { CliOptions } from "./state/types.js";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    goal: undefined,
    resume: false,
    dryRun: false,
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--goal") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--goal requires a value.");
      }
      options.goal = value;
      index += 1;
      continue;
    }

    if (arg === "--resume") {
      options.resume = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  cliArgsSchema.parse(options);
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig();
  const logger = new Logger(options.verbose);

  logger.info(
    `Starting orchestrator (dryRun=${String(options.dryRun)}, resume=${String(options.resume)}, demoMode=${String(config.demoMode)})`
  );

  const orchestrator = new Orchestrator(config, logger);
  await orchestrator.run(options);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fatal] ${message}`);
  process.exit(1);
});
