const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_ORIGIN: z.string().default('http://localhost:4200'),
  MONGO_URI: z.string().optional().default(''),
  MONGO_DB: z.string().default('newscape'),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  ADMIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  JWT_ACCESS_SECRET: z.string().default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().default('dev-refresh-secret-change-me'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  PASSWORD_RESET_TTL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  PASSWORD_HISTORY_LIMIT: z.coerce.number().int().positive().default(5),
  AUTH_ADMIN_USERNAME: z.string().default('admin'),
  AUTH_ADMIN_PASSWORD: z.string().default('change-me-now'),
  AUTH_ADMIN_PASSWORD_HASH: z.string().optional().default(''),
  AUTH_ADMIN_EMAIL: z.string().email().default('admin@newscape.local'),
  AUTH_USER_USERNAME: z.string().default('user'),
  AUTH_USER_PASSWORD: z.string().default('change-me-now'),
  AUTH_USER_PASSWORD_HASH: z.string().optional().default(''),
  AUTH_USER_EMAIL: z.string().email().default('user@newscape.local'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().email().default('no-reply@newscape.local'),
  PASSWORD_RESET_BASE_URL: z.string().url().default('http://localhost:4200/login'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ENABLE_REQUEST_LOGGING: z.enum(['true', 'false']).default('true'),
});

function loadConfig(env = process.env) {
  const parsed = envSchema.parse(env);
  const config = {
    nodeEnv: parsed.NODE_ENV,
    isProduction: parsed.NODE_ENV === 'production',
    port: parsed.PORT,
    allowedOrigins: parsed.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
    mongoUri: parsed.MONGO_URI,
    mongoDb: parsed.MONGO_DB,
    rateLimits: {
      api: parsed.API_RATE_LIMIT_MAX,
      auth: parsed.AUTH_RATE_LIMIT_MAX,
      admin: parsed.ADMIN_RATE_LIMIT_MAX,
    },
    jwt: {
      accessSecret: parsed.JWT_ACCESS_SECRET,
      refreshSecret: parsed.JWT_REFRESH_SECRET,
      accessTtl: parsed.JWT_ACCESS_TTL,
      refreshTtl: parsed.JWT_REFRESH_TTL,
    },
    passwordResetTtlMs: parsed.PASSWORD_RESET_TTL_MS,
    authLockoutThreshold: parsed.AUTH_LOCKOUT_THRESHOLD,
    authLockoutMs: parsed.AUTH_LOCKOUT_MS,
    passwordHistoryLimit: parsed.PASSWORD_HISTORY_LIMIT,
    seedUsers: {
      admin: {
        username: parsed.AUTH_ADMIN_USERNAME,
        password: parsed.AUTH_ADMIN_PASSWORD,
        passwordHash: parsed.AUTH_ADMIN_PASSWORD_HASH,
        email: parsed.AUTH_ADMIN_EMAIL,
      },
      user: {
        username: parsed.AUTH_USER_USERNAME,
        password: parsed.AUTH_USER_PASSWORD,
        passwordHash: parsed.AUTH_USER_PASSWORD_HASH,
        email: parsed.AUTH_USER_EMAIL,
      },
    },
    smtp: {
      host: parsed.SMTP_HOST,
      port: parsed.SMTP_PORT,
      secure: parsed.SMTP_SECURE === 'true',
      user: parsed.SMTP_USER,
      pass: parsed.SMTP_PASS,
      from: parsed.SMTP_FROM,
    },
    passwordResetBaseUrl: parsed.PASSWORD_RESET_BASE_URL,
    logLevel: parsed.LOG_LEVEL,
    enableRequestLogging: parsed.ENABLE_REQUEST_LOGGING === 'true',
  };

  validateProductionConfig(config);
  return config;
}

function validateProductionConfig(config) {
  if (!config.isProduction) {
    return;
  }

  const issues = [];

  if (!config.mongoUri) {
    issues.push('MONGO_URI is required in production');
  }
  if (config.jwt.accessSecret === 'dev-access-secret-change-me') {
    issues.push('JWT_ACCESS_SECRET must be changed in production');
  }
  if (config.jwt.refreshSecret === 'dev-refresh-secret-change-me') {
    issues.push('JWT_REFRESH_SECRET must be changed in production');
  }
  if (config.seedUsers.admin.password === 'change-me-now' && !config.seedUsers.admin.passwordHash) {
    issues.push('Admin password defaults are not allowed in production');
  }
  if (config.seedUsers.user.password === 'change-me-now' && !config.seedUsers.user.passwordHash) {
    issues.push('User password defaults are not allowed in production');
  }
  if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
    issues.push('SMTP_HOST, SMTP_USER, and SMTP_PASS are required in production');
  }
  if (!config.passwordResetBaseUrl.startsWith('https://')) {
    issues.push('PASSWORD_RESET_BASE_URL must use https in production');
  }

  if (issues.length > 0) {
    throw new Error(`Invalid production configuration: ${issues.join('; ')}`);
  }
}

module.exports = {
  loadConfig,
  validateProductionConfig,
};