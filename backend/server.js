const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
require('dotenv').config();
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createResetDelivery } = require('./reset-delivery');

const config = loadConfig(process.env);
const logger = createLogger({ service: 'newscape-nexus-backend', level: config.logLevel });
const resetDelivery = createResetDelivery({ config, logger });

const app = express();
app.disable('x-powered-by');
app.use(helmet());

const allowedOrigins = config.allowedOrigins;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients (no Origin header) and configured web origins.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS blocked for this origin'));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));

if (config.enableRequestLogging) {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info('request completed', {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        ip: req.ip,
      });
    });
    next();
  });
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimits.api,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.rateLimits.auth,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimits.admin,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests. Try again later.' },
});

const accessTokenSecret = config.jwt.accessSecret;
const refreshTokenSecret = config.jwt.refreshSecret;
const accessTokenTtl = config.jwt.accessTtl;
const refreshTokenTtl = config.jwt.refreshTtl;
const passwordResetTtlMs = config.passwordResetTtlMs;
const authLockoutThreshold = config.authLockoutThreshold;
const authLockoutMs = config.authLockoutMs;
const passwordHistoryLimit = config.passwordHistoryLimit;

const memoryUsers = [
  {
    id: 'admin-1',
    username: config.seedUsers.admin.username,
    usernameLower: config.seedUsers.admin.username.toLowerCase(),
    email: config.seedUsers.admin.email,
    emailLower: config.seedUsers.admin.email.toLowerCase(),
    passwordHash: config.seedUsers.admin.passwordHash || bcrypt.hashSync(config.seedUsers.admin.password, 10),
    role: 'admin',
    isActive: true,
    failedLoginAttempts: 0,
    passwordHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'user-1',
    username: config.seedUsers.user.username,
    usernameLower: config.seedUsers.user.username.toLowerCase(),
    email: config.seedUsers.user.email,
    emailLower: config.seedUsers.user.email.toLowerCase(),
    passwordHash: config.seedUsers.user.passwordHash || bcrypt.hashSync(config.seedUsers.user.password, 10),
    role: 'user',
    isActive: true,
    failedLoginAttempts: 0,
    passwordHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const memoryRefreshTokenStore = new Map();
const memoryPasswordResets = [];
const memoryAuditLogs = [];

let userCollection;
let refreshTokenCollection;
let passwordResetCollection;
let auditLogCollection;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createOpaqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive !== false,
    failedLoginAttempts: user.failedLoginAttempts || 0,
    lockedUntil: user.lockedUntil || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function getRequestMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || 'unknown',
  };
}

async function recordAuditEvent({ action, actorUserId = null, targetUserId = null, outcome = 'success', req = null, metadata = {} }) {
  const event = {
    id: crypto.randomUUID(),
    action,
    actorUserId,
    targetUserId,
    outcome,
    metadata,
    ...(req ? getRequestMeta(req) : {}),
    createdAt: new Date(),
  };

  if (auditLogCollection) {
    await auditLogCollection.insertOne(event);
    return;
  }

  memoryAuditLogs.push(event);
  if (memoryAuditLogs.length > 1000) {
    memoryAuditLogs.shift();
  }
}

async function listAuditEvents(limit = 100) {
  if (auditLogCollection) {
    return auditLogCollection.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
  }
  return [...memoryAuditLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

async function findUserByUsername(username) {
  const usernameLower = username.toLowerCase();
  if (userCollection) {
    return userCollection.findOne({ usernameLower });
  }
  return memoryUsers.find((u) => u.usernameLower === usernameLower) || null;
}

async function findUserByEmail(email) {
  const emailLower = email.toLowerCase();
  if (userCollection) {
    return userCollection.findOne({ emailLower });
  }
  return memoryUsers.find((u) => u.emailLower === emailLower) || null;
}

async function findUserById(id) {
  if (userCollection) {
    return userCollection.findOne({ id });
  }
  return memoryUsers.find((u) => u.id === id) || null;
}

async function createUser({ username, email, passwordHash, role }) {
  const usernameLower = username.toLowerCase();
  const emailLower = email.toLowerCase();
  const userDoc = {
    id: crypto.randomUUID(),
    username,
    usernameLower,
    email,
    emailLower,
    passwordHash,
    role,
    isActive: true,
    failedLoginAttempts: 0,
    passwordHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (userCollection) {
    await userCollection.insertOne(userDoc);
    return userDoc;
  }

  if (memoryUsers.some((u) => u.usernameLower === usernameLower || u.emailLower === emailLower)) {
    throw new Error('duplicate-username');
  }
  memoryUsers.push(userDoc);
  return userDoc;
}

async function updateUserPassword(userId, passwordHash) {
  if (userCollection) {
    const existing = await userCollection.findOne({ id: userId });
    const nextHistory = [
      existing?.passwordHash,
      ...(existing?.passwordHistory || []),
    ].filter(Boolean).slice(0, passwordHistoryLimit);
    await userCollection.updateOne(
      { id: userId },
      {
        $set: {
          passwordHash,
          passwordHistory: nextHistory,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        },
      }
    );
    return;
  }

  const user = memoryUsers.find((u) => u.id === userId);
  if (user) {
    user.passwordHistory = [user.passwordHash, ...(user.passwordHistory || [])].filter(Boolean).slice(0, passwordHistoryLimit);
    user.passwordHash = passwordHash;
    user.passwordChangedAt = new Date();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = new Date();
  }
}

async function updateUserRole(userId, role) {
  if (userCollection) {
    await userCollection.updateOne({ id: userId }, { $set: { role, updatedAt: new Date() } });
    return;
  }
  const user = memoryUsers.find((u) => u.id === userId);
  if (user) {
    user.role = role;
    user.updatedAt = new Date();
  }
}

async function listUsers() {
  if (userCollection) {
    return userCollection.find({}, { projection: { _id: 0, id: 1, username: 1, email: 1, role: 1, isActive: 1, failedLoginAttempts: 1, lockedUntil: 1, createdAt: 1, updatedAt: 1 } }).toArray();
  }
  return memoryUsers.map((u) => sanitizeUser(u));
}

async function countActiveAdmins() {
  if (userCollection) {
    return userCollection.countDocuments({ role: 'admin', isActive: { $ne: false } });
  }
  return memoryUsers.filter((u) => u.role === 'admin' && u.isActive !== false).length;
}

async function updateUserActiveState(userId, isActive) {
  if (userCollection) {
    await userCollection.updateOne(
      { id: userId },
      {
        $set: {
          isActive,
          updatedAt: new Date(),
          lockedUntil: null,
          ...(isActive ? { failedLoginAttempts: 0 } : {}),
        },
      }
    );
    return;
  }

  const user = memoryUsers.find((u) => u.id === userId);
  if (user) {
    user.isActive = isActive;
    user.lockedUntil = null;
    if (isActive) {
      user.failedLoginAttempts = 0;
    }
    user.updatedAt = new Date();
  }
}

async function deleteUser(userId) {
  if (userCollection) {
    await userCollection.deleteOne({ id: userId });
    return;
  }

  const index = memoryUsers.findIndex((u) => u.id === userId);
  if (index >= 0) {
    memoryUsers.splice(index, 1);
  }
}

async function recordFailedLogin(userId) {
  const nextCount = 1;
  if (userCollection) {
    const user = await userCollection.findOne({ id: userId });
    const failedLoginAttempts = (user?.failedLoginAttempts || 0) + 1;
    const shouldLock = failedLoginAttempts >= authLockoutThreshold;
    await userCollection.updateOne(
      { id: userId },
      {
        $set: {
          failedLoginAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + authLockoutMs) : user?.lockedUntil || null,
          updatedAt: new Date(),
        },
      }
    );
    return failedLoginAttempts;
  }

  const user = memoryUsers.find((u) => u.id === userId);
  if (!user) return nextCount;
  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
  if (user.failedLoginAttempts >= authLockoutThreshold) {
    user.lockedUntil = new Date(Date.now() + authLockoutMs);
  }
  user.updatedAt = new Date();
  return user.failedLoginAttempts;
}

async function clearFailedLogins(userId) {
  if (userCollection) {
    await userCollection.updateOne(
      { id: userId },
      { $set: { failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() } }
    );
    return;
  }

  const user = memoryUsers.find((u) => u.id === userId);
  if (user) {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = new Date();
  }
}

async function passwordWasRecentlyUsed(user, plainPassword) {
  const hashes = [user.passwordHash, ...(user.passwordHistory || [])].filter(Boolean);
  for (const hash of hashes) {
    if (await bcrypt.compare(plainPassword, hash)) {
      return true;
    }
  }
  return false;
}

async function storeRefreshToken(userId, refreshToken) {
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  if (refreshTokenCollection) {
    await refreshTokenCollection.updateOne(
      { userId },
      { $set: { tokenHash, expiresAt, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    return;
  }

  memoryRefreshTokenStore.set(userId, { tokenHash, expiresAt });
}

async function isRefreshTokenActive(userId, refreshToken) {
  const tokenHash = hashToken(refreshToken);
  if (refreshTokenCollection) {
    const doc = await refreshTokenCollection.findOne({ userId });
    if (!doc || !doc.tokenHash || !doc.expiresAt) return false;
    return doc.tokenHash === tokenHash && new Date(doc.expiresAt).getTime() > Date.now();
  }
  const doc = memoryRefreshTokenStore.get(userId);
  if (!doc) return false;
  return doc.tokenHash === tokenHash && new Date(doc.expiresAt).getTime() > Date.now();
}

async function revokeRefreshTokens(userId) {
  if (refreshTokenCollection) {
    await refreshTokenCollection.deleteMany({ userId });
    return;
  }
  memoryRefreshTokenStore.delete(userId);
}

async function createPasswordResetToken(userId) {
  const token = createOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + passwordResetTtlMs);

  if (passwordResetCollection) {
    await passwordResetCollection.deleteMany({ userId });
    await passwordResetCollection.insertOne({
      userId,
      tokenHash,
      expiresAt,
      used: false,
      createdAt: new Date(),
    });
    return token;
  }

  for (let i = memoryPasswordResets.length - 1; i >= 0; i -= 1) {
    if (memoryPasswordResets[i].userId === userId) {
      memoryPasswordResets.splice(i, 1);
    }
  }
  memoryPasswordResets.push({ userId, tokenHash, expiresAt, used: false, createdAt: new Date() });
  return token;
}

async function consumePasswordResetToken(token) {
  const tokenHash = hashToken(token);
  const now = new Date();

  if (passwordResetCollection) {
    const resetDoc = await passwordResetCollection.findOne({ tokenHash, used: false });
    if (!resetDoc || new Date(resetDoc.expiresAt).getTime() <= now.getTime()) {
      return null;
    }
    await passwordResetCollection.updateOne(
      { _id: resetDoc._id },
      { $set: { used: true, usedAt: now } }
    );
    return resetDoc.userId;
  }

  const resetDoc = memoryPasswordResets.find((r) => r.tokenHash === tokenHash && !r.used);
  if (!resetDoc || new Date(resetDoc.expiresAt).getTime() <= now.getTime()) {
    return null;
  }
  resetDoc.used = true;
  resetDoc.usedAt = now;
  return resetDoc.userId;
}

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    accessTokenSecret,
    { expiresIn: accessTokenTtl }
  );
}

function issueRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, tokenType: 'refresh' },
    refreshTokenSecret,
    { expiresIn: refreshTokenTtl }
  );
}

function setRefreshCookie(res, refreshToken) {
  res.cookie('ns_refresh_token', refreshToken, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('ns_refresh_token', {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/api/auth',
  });
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  try {
    const payload = jwt.verify(token, accessTokenSecret);
    const user = await findUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'Invalid access token user' });
    }
    if (user.isActive === false) {
      return res.status(403).json({ error: 'Account is inactive' });
    }
    req.user = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    }
    req.body = parsed.data;
    return next();
  };
}

function validateParams(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request parameters', details: parsed.error.flatten() });
    }
    req.params = parsed.data;
    return next();
  };
}

const loginBodySchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
});

const resetRequestBodySchema = z.object({
  username: z.string().min(3).max(64),
});

const resetConfirmBodySchema = z.object({
  token: z.string().min(32).max(256),
  newPassword: z.string().min(12).max(128),
});

const marketParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const marketBatchBodySchema = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
});

const createUserBodySchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.string().email(),
  password: z.string().min(12).max(128),
  role: z.enum(['admin', 'user']).default('user'),
});

const updateUserRoleBodySchema = z.object({
  role: z.enum(['admin', 'user']),
});

const updateUserStatusBodySchema = z.object({
  isActive: z.boolean(),
});

const userIdParamSchema = z.object({
  id: z.string().min(2).max(64),
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

const mongoUri = config.mongoUri;
let mongoClient;
let marketCollection;

app.get('/health/live', (_req, res) => {
  return res.json({ status: 'ok', service: 'newscape-nexus-backend', ts: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  if (!mongoUri) {
    return res.status(503).json({ status: 'degraded', checks: { mongo: 'missing-config' } });
  }

  try {
    if (!mongoClient) {
      throw new Error('mongo-client-not-initialized');
    }
    await mongoClient.db(config.mongoDb).command({ ping: 1 });
    return res.json({ status: 'ok', checks: { mongo: 'ok' } });
  } catch (err) {
    logger.error('readiness check failed', { error: err.message || String(err) });
    return res.status(503).json({ status: 'degraded', checks: { mongo: 'unavailable' } });
  }
});

async function connectDb() {
  if (!mongoUri) {
    logger.warn('MONGO_URI is not configured, using inline cache only.');
    return;
  }

  mongoClient = new MongoClient(mongoUri, { useUnifiedTopology: true });
  await mongoClient.connect();
  const db = mongoClient.db(config.mongoDb);
  marketCollection = db.collection('market_items');
  userCollection = db.collection('users');
  refreshTokenCollection = db.collection('refresh_tokens');
  passwordResetCollection = db.collection('password_resets');
  auditLogCollection = db.collection('audit_logs');

  await marketCollection.createIndex({ id: 1 }, { unique: true });
  await userCollection.createIndex({ usernameLower: 1 }, { unique: true });
  await userCollection.createIndex(
    { emailLower: 1 },
    {
      unique: true,
      partialFilterExpression: { emailLower: { $type: 'string' } },
    }
  );
  await userCollection.createIndex({ id: 1 }, { unique: true });
  await refreshTokenCollection.createIndex({ userId: 1 }, { unique: true });
  await refreshTokenCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await passwordResetCollection.createIndex({ tokenHash: 1 }, { unique: true });
  await passwordResetCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await auditLogCollection.createIndex({ createdAt: -1 });
  await auditLogCollection.createIndex({ actorUserId: 1, createdAt: -1 });
  await auditLogCollection.createIndex({ targetUserId: 1, createdAt: -1 });

  const defaultUsers = [
    {
      username: config.seedUsers.admin.username,
      usernameLower: config.seedUsers.admin.username.toLowerCase(),
      email: config.seedUsers.admin.email,
      emailLower: config.seedUsers.admin.email.toLowerCase(),
      passwordHash: config.seedUsers.admin.passwordHash || bcrypt.hashSync(config.seedUsers.admin.password, 10),
      role: 'admin',
    },
    {
      username: config.seedUsers.user.username,
      usernameLower: config.seedUsers.user.username.toLowerCase(),
      email: config.seedUsers.user.email,
      emailLower: config.seedUsers.user.email.toLowerCase(),
      passwordHash: config.seedUsers.user.passwordHash || bcrypt.hashSync(config.seedUsers.user.password, 10),
      role: 'user',
    },
  ];

  for (const baseUser of defaultUsers) {
    await userCollection.updateOne(
      { usernameLower: baseUser.usernameLower },
      {
        $set: {
          email: baseUser.email,
          emailLower: baseUser.emailLower,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          id: crypto.randomUUID(),
          username: baseUser.username,
          usernameLower: baseUser.usernameLower,
          passwordHash: baseUser.passwordHash,
          role: baseUser.role,
          isActive: true,
          failedLoginAttempts: 0,
          passwordHistory: [],
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  logger.info('connected to MongoDB', { database: config.mongoDb });
}

async function fetchRs3Item(itemId) {
  const url = `https://services.runescape.com/m=itemdb_rs/api/catalogue/detail.json?item=${itemId}`;

  try {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Newscape-Nexus/1.0 (+https://github.com)',
        Accept: 'application/json',
      },
    });
    return res.data;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return null;
    }
    throw err;
  }
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  if (typeof priceStr === 'number') return priceStr;
  
  const str = String(priceStr).trim();
  const multipliers = { k: 1000, m: 1000000, b: 1000000000 };
  const match = str.match(/^([\d.]+)([kmb]?)$/i);
  
  if (!match) return 0;
  const [, num, suffix] = match;
  const multiplier = multipliers[suffix.toLowerCase()] || 1;
  return Math.floor(parseFloat(num) * multiplier);
}

app.post('/api/auth/login', validateBody(loginBodySchema), async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await findUserByUsername(username);

    if (!user) {
      await recordAuditEvent({ action: 'auth.login', outcome: 'failure', req, metadata: { username, reason: 'user-not-found' } });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isActive === false) {
      await recordAuditEvent({ action: 'auth.login', actorUserId: user.id, targetUserId: user.id, outcome: 'failure', req, metadata: { reason: 'inactive-account' } });
      return res.status(403).json({ error: 'Account is inactive' });
    }

    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      await recordAuditEvent({ action: 'auth.login', actorUserId: user.id, targetUserId: user.id, outcome: 'failure', req, metadata: { reason: 'account-locked', lockedUntil: user.lockedUntil } });
      return res.status(423).json({ error: 'Account is temporarily locked' });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      const attempts = await recordFailedLogin(user.id);
      await recordAuditEvent({ action: 'auth.login', actorUserId: user.id, targetUserId: user.id, outcome: 'failure', req, metadata: { reason: 'bad-password', failedLoginAttempts: attempts } });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await clearFailedLogins(user.id);

    const accessToken = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user);
    await storeRefreshToken(user.id, refreshToken);
    setRefreshCookie(res, refreshToken);

    await recordAuditEvent({ action: 'auth.login', actorUserId: user.id, targetUserId: user.id, outcome: 'success', req });

    return res.json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: accessTokenTtl,
      user: sanitizeUser(user),
    });
  } catch (err) {
    logger.error('login error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.ns_refresh_token;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Missing refresh token' });
    }

    const payload = jwt.verify(refreshToken, refreshTokenSecret);
    if (payload.tokenType !== 'refresh') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const active = await isRefreshTokenActive(payload.sub, refreshToken);
    if (!active) {
      await recordAuditEvent({ action: 'auth.refresh', actorUserId: payload.sub, targetUserId: payload.sub, outcome: 'failure', req, metadata: { reason: 'refresh-revoked' } });
      return res.status(401).json({ error: 'Refresh token revoked' });
    }

    const user = await findUserById(payload.sub);
    if (!user || user.isActive === false) {
      await recordAuditEvent({ action: 'auth.refresh', actorUserId: payload.sub, targetUserId: payload.sub, outcome: 'failure', req, metadata: { reason: 'inactive-or-missing-user' } });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const nextRefreshToken = issueRefreshToken(user);
    await storeRefreshToken(user.id, nextRefreshToken);
    setRefreshCookie(res, nextRefreshToken);

    await recordAuditEvent({ action: 'auth.refresh', actorUserId: user.id, targetUserId: user.id, outcome: 'success', req });

    return res.json({
      accessToken: issueAccessToken(user),
      tokenType: 'Bearer',
      expiresIn: accessTokenTtl,
    });
  } catch (err) {
    await recordAuditEvent({ action: 'auth.refresh', outcome: 'failure', req, metadata: { reason: 'invalid-refresh-token' } });
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  return revokeRefreshTokens(req.user?.sub)
    .then(() => {
      return recordAuditEvent({ action: 'auth.logout', actorUserId: req.user?.sub, targetUserId: req.user?.sub, outcome: 'success', req });
    })
    .then(() => {
      clearRefreshCookie(res);
      return res.status(204).send();
    })
    .catch(() => {
      clearRefreshCookie(res);
      return res.status(204).send();
    });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.user.sub);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json(sanitizeUser(user));
});

app.post('/api/auth/password-reset/request', validateBody(resetRequestBodySchema), async (req, res) => {
  try {
    const user = await findUserByUsername(req.body.username);
    if (!user) {
      await recordAuditEvent({ action: 'auth.password-reset.request', outcome: 'success', req, metadata: { username: req.body.username, userFound: false } });
      return res.status(204).send();
    }

    const resetToken = await createPasswordResetToken(user.id);
    await resetDelivery.sendPasswordReset({ user, resetToken });
    const resetResponse = { message: 'If the account exists, a reset link has been issued.' };

    if (!config.isProduction) {
      resetResponse.resetToken = resetToken;
    }

    await recordAuditEvent({ action: 'auth.password-reset.request', actorUserId: user.id, targetUserId: user.id, outcome: 'success', req });

    return res.status(200).json(resetResponse);
  } catch (err) {
    logger.error('password reset request error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Could not process reset request' });
  }
});

app.post('/api/auth/password-reset/confirm', validateBody(resetConfirmBodySchema), async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const userId = await consumePasswordResetToken(token);
    if (!userId) {
      await recordAuditEvent({ action: 'auth.password-reset.confirm', outcome: 'failure', req, metadata: { reason: 'invalid-reset-token' } });
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const user = await findUserById(userId);
    if (!user || user.isActive === false) {
      await recordAuditEvent({ action: 'auth.password-reset.confirm', actorUserId: userId, targetUserId: userId, outcome: 'failure', req, metadata: { reason: 'inactive-or-missing-user' } });
      return res.status(400).json({ error: 'Invalid reset target' });
    }

    if (await passwordWasRecentlyUsed(user, newPassword)) {
      await recordAuditEvent({ action: 'auth.password-reset.confirm', actorUserId: userId, targetUserId: userId, outcome: 'failure', req, metadata: { reason: 'password-reuse' } });
      return res.status(400).json({ error: 'Password was used recently. Choose a new password.' });
    }

    const nextHash = await bcrypt.hash(newPassword, 12);
    await updateUserPassword(userId, nextHash);
    await revokeRefreshTokens(userId);
    await recordAuditEvent({ action: 'auth.password-reset.confirm', actorUserId: userId, targetUserId: userId, outcome: 'success', req });

    return res.status(204).send();
  } catch (err) {
    logger.error('password reset confirm error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Could not reset password' });
  }
});

app.get('/api/admin/users', requireAuth, requireRole('admin'), adminLimiter, async (req, res) => {
  try {
    const users = await listUsers();
    await recordAuditEvent({ action: 'admin.users.list', actorUserId: req.user.sub, outcome: 'success', req, metadata: { count: users.length } });
    return res.json(users);
  } catch (err) {
    logger.error('admin list users error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

app.post('/api/admin/users', requireAuth, requireRole('admin'), adminLimiter, validateBody(createUserBodySchema), async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (await findUserByUsername(username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({ username, email, passwordHash, role });
    await recordAuditEvent({ action: 'admin.users.create', actorUserId: req.user.sub, targetUserId: user.id, outcome: 'success', req, metadata: { role: user.role } });
    return res.status(201).json(sanitizeUser(user));
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    if (err && err.message === 'duplicate-username') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    logger.error('admin create user error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

app.patch('/api/admin/users/:id/role', requireAuth, requireRole('admin'), adminLimiter, validateParams(userIdParamSchema), validateBody(updateUserRoleBodySchema), async (req, res) => {
  try {
    const target = await findUserById(req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (target.id === req.user.sub && req.body.role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }

    if (target.role === 'admin' && target.isActive !== false && req.body.role !== 'admin') {
      const adminCount = await countActiveAdmins();
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last active admin' });
      }
    }

    await updateUserRole(target.id, req.body.role);
    const updated = await findUserById(target.id);
    await recordAuditEvent({ action: 'admin.users.role-update', actorUserId: req.user.sub, targetUserId: target.id, outcome: 'success', req, metadata: { role: updated.role } });
    return res.json(sanitizeUser(updated));
  } catch (err) {
    logger.error('admin update role error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Failed to update user role' });
  }
});

app.patch('/api/admin/users/:id/status', requireAuth, requireRole('admin'), adminLimiter, validateParams(userIdParamSchema), validateBody(updateUserStatusBodySchema), async (req, res) => {
  try {
    const target = await findUserById(req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (target.id === req.user.sub && req.body.isActive === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    if (target.role === 'admin' && target.isActive !== false && req.body.isActive === false) {
      const adminCount = await countActiveAdmins();
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot deactivate the last active admin' });
      }
    }

    await updateUserActiveState(target.id, req.body.isActive);
    if (!req.body.isActive) {
      await revokeRefreshTokens(target.id);
    }
    const updated = await findUserById(target.id);
    await recordAuditEvent({ action: 'admin.users.status-update', actorUserId: req.user.sub, targetUserId: target.id, outcome: 'success', req, metadata: { isActive: updated.isActive !== false } });
    return res.json(sanitizeUser(updated));
  } catch (err) {
    logger.error('admin update status error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Failed to update user status' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireRole('admin'), adminLimiter, validateParams(userIdParamSchema), async (req, res) => {
  try {
    const target = await findUserById(req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (target.id === req.user.sub) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    if (target.role === 'admin' && target.isActive !== false) {
      const adminCount = await countActiveAdmins();
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last active admin' });
      }
    }

    await revokeRefreshTokens(target.id);
    await deleteUser(target.id);
    await recordAuditEvent({ action: 'admin.users.delete', actorUserId: req.user.sub, targetUserId: target.id, outcome: 'success', req, metadata: { username: target.username } });
    return res.status(204).send();
  } catch (err) {
    logger.error('admin delete user error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/admin/audit-logs', requireAuth, requireRole('admin'), adminLimiter, async (req, res) => {
  try {
    const events = await listAuditEvents(100);
    return res.json(events);
  } catch (err) {
    logger.error('admin audit logs error', { error: err.message || String(err) });
    return res.status(500).json({ error: 'Failed to list audit logs' });
  }
});

app.get('/api/market/:id', validateParams(marketParamSchema), async (req, res) => {
  const itemId = req.params.id;

  try {
    if (marketCollection) {
      const cached = await marketCollection.findOne({ id: itemId });
      if (cached && Date.now() - cached.updatedAt < 60000) {
        return res.json(cached.data);
      }
    }

    const raw = await fetchRs3Item(itemId);
    if (!raw || !raw.item) {
      return res.status(404).json({ error: `Item ${itemId} not found in RS3 API` });
    }

    const itemData = {
      id: itemId,
      name: raw.item.name,
      current: {
        price: parsePrice(raw.item.current?.price),
        trend: raw.item.current?.trend || 'neutral',
      },
      today: {
        price: parsePrice(raw.item.today?.price),
        trend: raw.item.today?.trend || 'neutral',
      },
      fetchedAt: new Date().toISOString(),
    };

    if (marketCollection) {
      await marketCollection.updateOne(
        { id: itemId },
        { $set: { data: itemData, updatedAt: Date.now() } },
        { upsert: true }
      );
    }

    return res.json(itemData);
  } catch (err) {
    logger.error('market get error', { error: err.message || String(err), itemId });
    return res.status(502).json({ error: 'Failed to fetch RS3 data' });
  }
});

app.post('/api/market/batch', validateBody(marketBatchBodySchema), async (req, res) => {
  const itemIds = req.body.itemIds;

  try {
    const results = await Promise.all(
      itemIds.map(async (id) => {
        const r = await fetchRs3Item(id);
        if (!r || !r.item) {
          logger.warn('market batch item not found', { itemId: id });
          return null;
        }
        return {
          id,
          name: r.item.name,
          current: {
            price: parsePrice(r.item.current?.price),
            trend: r.item.current?.trend || 'neutral',
          },
          today: {
            price: parsePrice(r.item.today?.price),
            trend: r.item.today?.trend || 'neutral',
          },
          fetchedAt: new Date().toISOString(),
        };
      })
    );

    return res.json(results.filter((it) => it !== null));
  } catch (err) {
    logger.error('market batch fetch error', { error: err.message || String(err), itemIds });
    return res.status(502).json({ error: 'Failed batch fetch' });
  }
});

const port = config.port;

function startServer() {
  const server = app.listen(port, () => {
    logger.info('backend API listening', { url: `http://localhost:${port}` });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('port already in use', { port, hint: `Run: npx kill-port ${port} then retry npm run dev` });
      process.exit(1);
    } else {
      throw err;
    }
  });
}

connectDb().then(startServer).catch((err) => {
  logger.error('could not connect DB', { error: err.message || String(err) });
  startServer();
});
