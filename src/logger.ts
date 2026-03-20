import { EventSink } from "./runtime/events.js";

export class Logger {
  constructor(
    private readonly verbose: boolean,
    private readonly runId = "default-run",
    private readonly eventSink: EventSink | null = null
  ) {}

  private emit(level: "info" | "debug" | "warn" | "error", message: string): void {
    if (!this.eventSink) {
      return;
    }
    this.eventSink.emitEvent({
      runId: this.runId,
      type: "log",
      message: `[${level}] ${message}`
    });
  }

  info(message: string): void {
    console.log(message);
    this.emit("info", message);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(`[debug] ${message}`);
      this.emit("debug", message);
    }
  }

  warn(message: string): void {
    console.warn(`[warn] ${message}`);
    this.emit("warn", message);
  }

  error(message: string): void {
    console.error(`[error] ${message}`);
    this.emit("error", message);
  }
}
