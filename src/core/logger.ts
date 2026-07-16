import { config } from "./config.js";

type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

class Logger {
  private level: number;

  constructor() {
    this.level = config.isProduction ? LOG_LEVELS.info : LOG_LEVELS.debug;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= this.level;
  }

  private format(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta !== undefined ? ` | ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) return;
    const formatted = this.format(level, message, meta);
    if (level === "error") {
      console.error(formatted);
    } else if (level === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  error(message: string, meta?: unknown): void {
    this.log("error", message, meta);
    if (meta instanceof Error) {
      console.error(meta.stack);
    }
  }

  warn(message: string, meta?: unknown): void {
    this.log("warn", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log("info", message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.log("debug", message, meta);
  }
}

export const logger = new Logger();