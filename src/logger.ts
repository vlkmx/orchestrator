export class Logger {
  constructor(private readonly verbose: boolean) {}

  info(message: string): void {
    console.log(message);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(`[debug] ${message}`);
    }
  }

  warn(message: string): void {
    console.warn(`[warn] ${message}`);
  }

  error(message: string): void {
    console.error(`[error] ${message}`);
  }
}
