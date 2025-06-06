// src/server/utils/logger.ts
import pino from 'pino';
import type { Logger } from 'pino';

// Determine environment
const isDevelopment = process.env.NODE_ENV !== 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Base logger configuration
const baseConfig: pino.LoggerOptions = {
  level: LOG_LEVEL,
  
  // Add timestamp in production, pino-pretty handles it in dev
  ...(isDevelopment ? {} : {
    timestamp: pino.stdTimeFunctions.isoTime,
  }),
  
  // Base context that will be included in all logs
  base: {
    pid: process.pid,
    hostname: process.env.HOSTNAME || 'localhost',
    service: 'typewriting-monkey-server',
  },
  
  // Redact sensitive information
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    remove: true,
  },
  
  // Custom serializers for common objects
  serializers: {
    req: (req: any) => ({
      method: req.method,
      url: req.url,
      path: req.path,
      parameters: req.params,
      query: req.query,
      remoteAddress: req.remoteAddress,
      remotePort: req.remotePort,
      id: req.id,
    }),
    res: (res: any) => ({
      statusCode: res.statusCode,
      headers: res.headers,
    }),
    err: pino.stdSerializers.err,
  },
};

// Create the base logger
export const logger = pino(baseConfig);

// Create child loggers for different components
export const createLogger = (component: string, context?: Record<string, any>): Logger => {
  return logger.child({ component, ...context });
};

// Specific loggers for major components
export const monkeyLogger = createLogger('monkey');
export const detectorLogger = createLogger('word-detector');
export const storeLogger = createLogger('chunk-store');
export const wsLogger = createLogger('websocket');
export const httpLogger = createLogger('http');
export const firebaseLogger = createLogger('firebase');
export const startupLogger = createLogger('startup');

// Helper to log performance metrics
export const logPerformance = (
  logger: Logger,
  operation: string,
  startTime: number,
  metadata?: Record<string, any>
) => {
  const duration = Date.now() - startTime;
  logger.info({
    operation,
    duration,
    ...metadata,
  }, `${operation} completed in ${duration}ms`);
};

// Helper for structured error logging
export const logError = (
  logger: Logger,
  error: Error | unknown,
  context?: Record<string, any>
) => {
  if (error instanceof Error) {
    logger.error({
      err: error,
      ...context,
    }, error.message);
  } else {
    logger.error({
      error: String(error),
      ...context,
    }, 'Unknown error occurred');
  }
};

// Export types
export type { Logger };