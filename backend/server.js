const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { MongoClient } = require('mongodb');
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

  await marketCollection.createIndex({ id: 1 }, { unique: true });

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

async function fetchRs3Graph(itemId) {
  const url = `https://services.runescape.com/m=itemdb_rs/api/graph/${itemId}.json`;

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

async function fetchRs3TradeAmount(itemId) {
  const url = `https://secure.runescape.com/m=itemdb_rs/viewitem?obj=${itemId}`;

  const res = await axios.get(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Newscape-Nexus/1.0 (+https://github.com)',
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

app.get('/api/market/:id', validateParams(marketParamSchema), async (req, res) => {
  const itemId = req.params.id;

  try {
    if (marketCollection) {
      const cached = await marketCollection.findOne({ id: itemId });
      if (cached && Date.now() - cached.updatedAt < 60000) {
        return res.json(cached.data);
      }
    }

    const [raw, graph, tradeStats] = await Promise.all([
      fetchRs3Item(itemId),
      fetchRs3Graph(itemId).catch(() => null),
      fetchRs3TradeAmount(itemId).catch(() => ({ latestAmount: 0, average7d: 0, average14d: 0 })),
    ]);
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
        const [r, graph, tradeStats] = await Promise.all([
          fetchRs3Item(id),
          fetchRs3Graph(id).catch(() => null),
          fetchRs3TradeAmount(id).catch(() => ({ latestAmount: 0, average7d: 0, average14d: 0 })),
        ]);
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
          day30: {
            changeValue: calculateGraphWindowChange(graph?.daily, 30),
            changePercent: parsePercent(r.item.day30?.change),
          },
          day90: {
            changeValue: calculateGraphWindowChange(graph?.daily, 90),
            changePercent: parsePercent(r.item.day90?.change),
          },
          day180: {
            changeValue: calculateGraphWindowChange(graph?.daily, 180),
            changePercent: parsePercent(r.item.day180?.change),
          },
          amountTraded: tradeStats.latestAmount,
          amountTraded7dAvg: tradeStats.average7d,
          amountTraded14dAvg: tradeStats.average14d,
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
