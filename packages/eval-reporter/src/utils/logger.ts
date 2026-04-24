export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/* eslint-disable no-console */
const consoleLogger: Logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
/* eslint-enable no-console */

let current: Logger = consoleLogger;

/**
 * Proxy that delegates to the current logger. Importers hold a stable reference;
 * calling `setLogger()` swaps the underlying implementation for everyone.
 */
export const logger: Logger = {
  info: (...args) => current.info(...args),
  warn: (...args) => current.warn(...args),
  error: (...args) => current.error(...args),
};

export function setLogger(l: Logger): void {
  current = l;
}
