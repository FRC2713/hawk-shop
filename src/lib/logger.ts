/**
 * Simple logger utility with environment-aware log levels
 *
 * In development: all logs are shown
 * In production: only warnings and errors are shown
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const isDev = process.env.NODE_ENV === "development";

/**
 * Format a log message with timestamp and level
 */
function formatMessage(level: LogLevel, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  return prefix;
}

/**
 * Logger object with methods for different log levels
 */
export const logger = {
  /**
   * Debug level - only shown in development
   * Use for detailed debugging information
   */
  debug: (...args: unknown[]): void => {
    if (isDev) {
      console.log(formatMessage("debug", args), ...args);
    }
  },

  /**
   * Info level - only shown in development
   * Use for general informational messages
   */
  info: (...args: unknown[]): void => {
    if (isDev) {
      console.info(formatMessage("info", args), ...args);
    }
  },

  /**
   * Warning level - always shown
   * Use for potentially problematic situations
   */
  warn: (...args: unknown[]): void => {
    console.warn(formatMessage("warn", args), ...args);
  },

  /**
   * Error level - always shown
   * Use for error conditions
   */
  error: (...args: unknown[]): void => {
    console.error(formatMessage("error", args), ...args);
  },
};

export default logger;
