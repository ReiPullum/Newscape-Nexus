const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('./config');

test('loadConfig provides safe development defaults', () => {
  const config = loadConfig({});
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 3000);
  assert.equal(config.rateLimits.api, 60);
  assert.deepEqual(config.allowedOrigins, ['http://localhost:4200']);
});

test('loadConfig rejects incomplete production configuration', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }),
    /Invalid production configuration/
  );
});

test('loadConfig accepts complete production configuration', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    PORT: '3000',
    FRONTEND_ORIGIN: 'https://app.example.com',
    MONGO_URI: 'mongodb://example',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    AUTH_ADMIN_PASSWORD_HASH: '$2a$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOpqrstuvwxyz12345',
    AUTH_USER_PASSWORD_HASH: '$2a$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOpqrstuvwxyz12345',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'mailer',
    SMTP_PASS: 'secret',
    PASSWORD_RESET_BASE_URL: 'https://app.example.com/reset-password',
  });

  assert.equal(config.isProduction, true);
  assert.equal(config.allowedOrigins[0], 'https://app.example.com');
  assert.equal(config.smtp.host, 'smtp.example.com');
});