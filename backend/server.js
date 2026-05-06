const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
require('dotenv').config();
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');

const config = loadConfig(process.env);
const logger = createLogger({ service: 'newscape-nexus-backend', level: config.logLevel });

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

const marketParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const marketBatchBodySchema = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
});

app.use('/api', apiLimiter);

/** @type {Pool | null} */
let pgPool = null;

const CACHE_TTL_MS = 60_000; // 1 minute, same as the previous Mongo TTL

app.get('/health/live', (_req, res) => {
  return res.json({ status: 'ok', service: 'newscape-nexus-backend', ts: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  if (!config.databaseUrl) {
    return res.status(503).json({ status: 'degraded', checks: { postgres: 'missing-config' } });
  }

  try {
    if (!pgPool) {
      throw new Error('pg-pool-not-initialized');
    }
    await pgPool.query('SELECT 1');
    return res.json({ status: 'ok', checks: { postgres: 'ok' } });
  } catch (err) {
    logger.error('readiness check failed', { error: err.message || String(err) });
    return res.status(503).json({ status: 'degraded', checks: { postgres: 'unavailable' } });
  }
});

async function connectDb() {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL is not configured, using in-process cache only.');
    return;
  }

  pgPool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.isProduction ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Verify connectivity on startup.
  await pgPool.query('SELECT 1');

  // Create the cache table if it doesn't exist yet.
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS market_items (
      id         INTEGER PRIMARY KEY,
      data       JSONB    NOT NULL,
      updated_at BIGINT   NOT NULL
    )
  `);

  logger.info('connected to PostgreSQL and market_items table is ready');
}

async function getCachedItem(itemId) {
  if (!pgPool) return null;

  const result = await pgPool.query(
    'SELECT data, updated_at FROM market_items WHERE id = $1',
    [itemId]
  );

  if (result.rows.length === 0) return null;

  const { data, updated_at: updatedAt } = result.rows[0];
  if (Date.now() - Number(updatedAt) < CACHE_TTL_MS) {
    return data; // still fresh
  }

  return null; // stale — caller will re-fetch
}

async function setCachedItem(itemId, itemData) {
  if (!pgPool) return;

  await pgPool.query(
    `INSERT INTO market_items (id, data, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET data       = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
    [itemId, JSON.stringify(itemData), Date.now()]
  );
}

async function fetchRs3Item(itemId) {
  const url = `https://services.runescape.com/m=itemdb_rs/api/catalogue/detail.json?item=${itemId}`;

  try {
    const res = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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

async function fetchRs3Graph(itemId) {
  const url = `https://services.runescape.com/m=itemdb_rs/api/graph/${itemId}.json`;

  try {
    const res = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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

async function fetchRs3TradeAmount(itemId) {
  const url = `https://secure.runescape.com/m=itemdb_rs/viewitem?obj=${itemId}`;

  const res = await axios.get(url, {
    timeout: 10000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
  });

  return parseTradeStats(res.data);
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  if (typeof priceStr === 'number') return priceStr;

  // RS3 often returns formats like "3,864" and "- 33".
  const str = String(priceStr).trim().replace(/,/g, '').replace(/\s+/g, '');
  const multipliers = { k: 1000, m: 1000000, b: 1000000000 };
  const match = str.match(/^([+-]?[\d.]+)([kmb]?)$/i);

  if (!match) return 0;
  const [, num, suffix] = match;
  const multiplier = multipliers[suffix.toLowerCase()] || 1;
  return Math.floor(parseFloat(num) * multiplier);
}

function parseQuantity(qty) {
  if (qty === null || qty === undefined || qty === '') return 0;
  if (typeof qty === 'number') return Math.floor(qty);

  const normalized = String(qty).replace(/,/g, '').trim();
  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parsePercent(percentStr) {
  if (percentStr === null || percentStr === undefined || percentStr === '') return 0;
  if (typeof percentStr === 'number') return percentStr;

  const normalized = String(percentStr).replace('%', '').replace(/\s+/g, '').trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseTradeSeriesPoints(html) {
  if (!html || typeof html !== 'string') return [];

  // Example in RS page source:
  // trade30.push([new Date('2026/03/15'), 30464]);
  const pattern = /trade(30|90|180)\.push\(\[new Date\('([^']+)'\),\s*([\d,]+)\]\);/g;
  let match;
  const seriesMap = { 30: [], 90: [], 180: [] };

  while ((match = pattern.exec(html)) !== null) {
    const windowDays = Number(match[1]);
    const date = new Date(match[2]);
    const value = parseQuantity(match[3]);
    if (!Number.isFinite(windowDays) || Number.isNaN(date.getTime())) continue;
    seriesMap[windowDays].push({ timestamp: date.getTime(), value });
  }

  const preferredSeries = [180, 90, 30]
    .map((windowDays) => seriesMap[windowDays] || [])
    .find((series) => series.length > 0) || [];

  return preferredSeries.sort((a, b) => a.timestamp - b.timestamp);
}

function calculateAverageTradeAmount(points, days) {
  if (!Array.isArray(points) || points.length === 0 || days <= 0) return 0;

  const count = Math.min(days, points.length);
  const recent = points.slice(points.length - count);
  const total = recent.reduce((sum, point) => sum + point.value, 0);
  return Math.round(total / recent.length);
}

function parseTradeStats(html) {
  const points = parseTradeSeriesPoints(html);
  if (points.length === 0) {
    return {
      latestAmount: 0,
      average7d: 0,
      average14d: 0,
    };
  }

  return {
    latestAmount: points[points.length - 1].value,
    average7d: calculateAverageTradeAmount(points, 7),
    average14d: calculateAverageTradeAmount(points, 14),
  };
}

function calculateGraphWindowChange(graphDaily, days) {
  if (!graphDaily || typeof graphDaily !== 'object') return 0;

  const points = Object.entries(graphDaily)
    .map(([timestamp, value]) => ({ timestamp: Number(timestamp), value: Number(value) }))
    .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.value))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length === 0) return 0;

  const latestIndex = points.length - 1;
  const latestPoint = points[latestIndex];
  const targetTimestamp = latestPoint.timestamp - days * 24 * 60 * 60 * 1000;

  // Prefer the closest point at or before the target window; fallback to earliest available.
  let referencePoint = points[0];
  for (let i = latestIndex - 1; i >= 0; i -= 1) {
    if (points[i].timestamp <= targetTimestamp) {
      referencePoint = points[i];
      break;
    }
  }

  return Math.round(latestPoint.value - referencePoint.value);
}

function buildItemData(id, raw, graph, tradeStats) {
  return {
    id,
    name: raw.item.name,
    current: {
      price: parsePrice(raw.item.current?.price),
      trend: raw.item.current?.trend || 'neutral',
    },
    today: {
      price: parsePrice(raw.item.today?.price),
      trend: raw.item.today?.trend || 'neutral',
    },
    day30: {
      changeValue: calculateGraphWindowChange(graph?.daily, 30),
      changePercent: parsePercent(raw.item.day30?.change),
    },
    day90: {
      changeValue: calculateGraphWindowChange(graph?.daily, 90),
      changePercent: parsePercent(raw.item.day90?.change),
    },
    day180: {
      changeValue: calculateGraphWindowChange(graph?.daily, 180),
      changePercent: parsePercent(raw.item.day180?.change),
    },
    amountTraded: tradeStats.latestAmount,
    amountTraded7dAvg: tradeStats.average7d,
    amountTraded14dAvg: tradeStats.average14d,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/market/:id', validateParams(marketParamSchema), async (req, res) => {
  const itemId = req.params.id;

  try {
    const cached = await getCachedItem(itemId);
    if (cached) {
      return res.json(cached);
    }

    const [raw, graph, tradeStats] = await Promise.all([
      fetchRs3Item(itemId),
      fetchRs3Graph(itemId).catch(() => null),
      fetchRs3TradeAmount(itemId).catch(() => ({ latestAmount: 0, average7d: 0, average14d: 0 })),
    ]);

    if (!raw || !raw.item) {
      return res.status(404).json({ error: `Item ${itemId} not found in RS3 API` });
    }

    const itemData = buildItemData(itemId, raw, graph, tradeStats);
    await setCachedItem(itemId, itemData);

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
        const cached = await getCachedItem(id);
        if (cached) return cached;
        const [r, graph, tradeStats] = await Promise.all([
          fetchRs3Item(id),
          fetchRs3Graph(id).catch(() => null),
          fetchRs3TradeAmount(id).catch(() => ({ latestAmount: 0, average7d: 0, average14d: 0 })),
        ]);
        if (!r || !r.item) {
          logger.warn('market batch item not found', { itemId: id });
          return null;
        }

        const itemData = buildItemData(id, r, graph, tradeStats);
        await setCachedItem(id, itemData);
        return itemData;
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
  logger.error('could not connect to DB', { error: err.message || String(err) });
  startServer();
});