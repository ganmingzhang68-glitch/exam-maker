export interface RuntimeConfig {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigins: string[];
  trustProxy: boolean;
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? 3001);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function parseCorsOrigins(value: string | undefined): string[] {
  const origins = (value ?? 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return [...new Set(origins)];
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  return {
    nodeEnv,
    host: env.HOST?.trim() || (nodeEnv === 'production' ? '127.0.0.1' : '0.0.0.0'),
    port: parsePort(env.PORT),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGIN),
    trustProxy: parseBoolean(env.TRUST_PROXY),
  };
}

export function validateRuntimeConfig(config: RuntimeConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (config.nodeEnv !== 'production') return;

  const jwtSecret = env.JWT_SECRET?.trim() ?? '';
  if (jwtSecret.length < 32 || jwtSecret === 'exam-maker-secret-dev' || jwtSecret.startsWith('replace-')) {
    throw new Error('Production requires JWT_SECRET with at least 32 characters');
  }
  if (config.corsOrigins.length === 0 || config.corsOrigins.includes('*')) {
    throw new Error('Production requires explicit CORS_ORIGIN values; wildcard is not allowed');
  }
}

export function isCorsOriginAllowed(origin: string | undefined, config: RuntimeConfig): boolean {
  if (!origin) return true;
  return config.corsOrigins.includes(origin.replace(/\/$/, ''));
}
