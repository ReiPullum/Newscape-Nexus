const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const mongoUri = process.env.MONGO_URI || '';
let mongoClient;
let marketCollection;

async function connectDb() {
  if (!mongoUri) {
    console.warn('MONGO_URI is not configured, using inline cache only.');
    return;
  }

  mongoClient = new MongoClient(mongoUri, { useUnifiedTopology: true });
  await mongoClient.connect();
  const db = mongoClient.db(process.env.MONGO_DB || 'newscape');
  marketCollection = db.collection('market_items');
  await marketCollection.createIndex({ id: 1 }, { unique: true });
  console.log('Connected to MongoDB');
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

app.get('/api/market/:id', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!itemId) {
    return res.status(400).json({ error: 'Invalid item id' });
  }

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

    res.json(itemData);
  } catch (err) {
    console.error('market get error', err.message || err);
    res.status(502).json({ error: 'Failed to fetch RS3 data' });
  }
});

app.post('/api/market/batch', async (req, res) => {
  const itemIds = Array.isArray(req.body.itemIds) ? req.body.itemIds : [];
  if (itemIds.length === 0) {
    return res.status(400).json({ error: 'itemIds required' });
  }

  try {
    const results = await Promise.all(
      itemIds.map(async (id) => {
        const r = await fetchRs3Item(id);
        if (!r || !r.item) {
          console.warn(`market batch: item ${id} not found`);
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

    res.json(results.filter((it) => it !== null));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Failed batch fetch' });
  }
});

const port = process.env.PORT || 3000;

function startServer() {
  const server = app.listen(port, () => {
    console.log(`Backend API listening on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${port} is already in use.`);
      console.error('Run: npx kill-port ' + port + '  then retry npm run dev');
      process.exit(1);
    } else {
      throw err;
    }
  });
}

connectDb().then(startServer).catch((err) => {
  console.error('Could not connect DB', err);
  startServer();
});
