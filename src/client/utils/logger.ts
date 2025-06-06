// src/client/utils/logger.ts

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogContext {
  [key: string]: any;
}

interface Logger {
  trace(context: LogContext, msg: string): void;
  trace(msg: string): void;
  debug(context: LogContext, msg: string): void;
  debug(msg: string): void;
  info(context: LogContext, msg: string): void;
  info(msg: string): void;
  warn(context: LogContext, msg: string): void;
  warn(msg: string): void;
  error(context: LogContext, msg: string): void;
  error(msg: string): void;
  fatal(context: LogContext, msg: string): void;
  fatal(msg: string): void;
  child(context: LogContext): Logger;
}

class BrowserLogger implements Logger {
  private level: LogLevel;
  private context: LogContext;
  private levelValues: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
  };

  constructor(level: LogLevel = 'info', context: LogContext = {}) {
    this.level = level;
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelValues[level] >= this.levelValues[this.level];
  }

  private formatMessage(level: LogLevel, msg: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const merged = { ...this.context, ...context };
    const contextStr = Object.keys(merged).length > 0 
      ? ` ${JSON.stringify(merged)}` 
      : '';
    return `[${timestamp}] ${level.toUpperCase()}${contextStr} ${msg}`;
  }

  private log(level: LogLevel, msgOrContext: string | LogContext, msg?: string): void {
    if (!this.shouldLog(level)) return;

    let message: string;
    let context: LogContext | undefined;

    if (typeof msgOrContext === 'string') {
      message = msgOrContext;
    } else {
      context = msgOrContext;
      message = msg!;
    }

    const formatted = this.formatMessage(level, message, context);
    const colorMap: Record<LogLevel, string> = {
      trace: 'color: gray',
      debug: 'color: blue',
      info: 'color: green',
      warn: 'color: orange',
      error: 'color: red',
      fatal: 'color: red; font-weight: bold',
    };

    const style = colorMap[level];

    switch (level) {
      case 'trace':
      case 'debug':
        console.debug(`%c${formatted}`, style);
        break;
      case 'info':
        console.info(`%c${formatted}`, style);
        break;
      case 'warn':
        console.warn(`%c${formatted}`, style);
        break;
      case 'error':
      case 'fatal':
        console.error(`%c${formatted}`, style);
        break;
    }

    // For production, you could send logs to a remote service here
    if (level === 'error' || level === 'fatal') {
      this.sendToRemote(level, message, { ...this.context, ...context });
    }
  }

  private sendToRemote(level: LogLevel, message: string, context: LogContext): void {
    // Placeholder for sending logs to a remote service
    // In production, you might send to services like Sentry, LogRocket, etc.
    if (import.meta.env.PROD) {
      // Example: Send to your logging endpoint
      // fetch('/api/logs', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ level, message, context, timestamp: new Date().toISOString() })
      // }).catch(() => {});
    }
  }

  trace(msgOrContext: string | LogContext, msg?: string): void {
    this.log('trace', msgOrContext, msg);
  }

  debug(msgOrContext: string | LogContext, msg?: string): void {
    this.log('debug', msgOrContext, msg);
  }

  info(msgOrContext: string | LogContext, msg?: string): void {
    this.log('info', msgOrContext, msg);
  }

  warn(msgOrContext: string | LogContext, msg?: string): void {
    this.log('warn', msgOrContext, msg);
  }

  error(msgOrContext: string | LogContext, msg?: string): void {
    this.log('error', msgOrContext, msg);
  }

  fatal(msgOrContext: string | LogContext, msg?: string): void {
    this.log('fatal', msgOrContext, msg);
  }

  child(context: LogContext): Logger {
    return new BrowserLogger(this.level, { ...this.context, ...context });
  }
}

// Determine log level from environment or localStorage
const getLogLevel = (): LogLevel => {
  // Check localStorage for runtime override
  const override = localStorage.getItem('LOG_LEVEL');
  if (override && ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(override)) {
    return override as LogLevel;
  }
  
  // Use debug in development, info in production
  return import.meta.env.DEV ? 'debug' : 'info';
};

// Create base logger
export const logger = new BrowserLogger(getLogLevel(), {
  service: 'typewriting-monkey-client',
  environment: import.meta.env.MODE,
});

// Component-specific loggers
export const socketLogger = logger.child({ component: 'socket' });
export const renderLogger = logger.child({ component: 'render' });
export const statsLogger = logger.child({ component: 'stats' });
export const chunkLogger = logger.child({ component: 'chunks' });

// Performance logging helper
export const logPerformance = (
  logger: Logger,
  operation: string,
  startTime: number,
  metadata?: LogContext
): void => {
  const duration = performance.now() - startTime;
  logger.info({
    operation,
    duration,
    ...metadata,
  }, `${operation} completed in ${duration.toFixed(2)}ms`);
};

// Error logging helper
export const logError = (
  logger: Logger,
  error: Error | unknown,
  context?: LogContext
): void => {
  if (error instanceof Error) {
    logger.error({
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...context,
    }, error.message);
  } else {
    logger.error({
      error: String(error),
      ...context,
    }, 'Unknown error occurred');
  }
};

// Export utilities for runtime log level changes
export const setLogLevel = (level: LogLevel): void => {
  localStorage.setItem('LOG_LEVEL', level);
  console.info(`Log level changed to ${level}. Refresh the page to apply.`);
};

// Expose to window for debugging
if (import.meta.env.DEV) {
  (window as any).__logger = {
    setLevel: setLogLevel,
    logger,
  };
  console.info('Logger utilities available at window.__logger');
}