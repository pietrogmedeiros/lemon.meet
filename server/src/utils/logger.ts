/**
 * Simple logger utility
 * TODO: Integrar com Winston ou Pino em produção
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const colors = {
  info: '\x1b[36m',    // cyan
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
  debug: '\x1b[90m',   // gray
  reset: '\x1b[0m'
};

function log(level: LogLevel, message: string, ...args: any[]) {
  const timestamp = new Date().toISOString();
  const color = colors[level];
  const reset = colors.reset;
  
  console[level === 'error' ? 'error' : 'log'](
    `${color}[${timestamp}] [${level.toUpperCase()}]${reset} ${message}`,
    ...args
  );
}

export const logger = {
  info: (message: string, ...args: any[]) => log('info', message, ...args),
  warn: (message: string, ...args: any[]) => log('warn', message, ...args),
  error: (message: string, ...args: any[]) => log('error', message, ...args),
  debug: (message: string, ...args: any[]) => log('debug', message, ...args)
};
