import pino, { type Logger } from 'pino';

/**
 * JSON logs for production (what Docker and log collectors expect), and readable ones when a
 * person is watching a terminal and pino-pretty (a dev dependency) is installed.
 */
export function createLogger(level: string): Logger {
  const pretty = process.stdout.isTTY && canResolve('pino-pretty');
  return pino({
    level,
    redact: { paths: ['token', '*.token', 'authorization', '*.authorization'], censor: '[redacted]' },
    ...(pretty && {
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    }),
  });
}

function canResolve(specifier: string): boolean {
  try {
    import.meta.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}
