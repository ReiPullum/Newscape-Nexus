# Newscape-Nexus

## Full-stack architecture (for portfolio)

- Angular frontend in `web/`
- Express + MongoAPI backend in `backend/`
- Runtime: Node.js for API, connecting to RuneScape GE and MongoDB Atlas

### Run backend locally

1. `cd backend`
2. `cp .env.example .env` and set `MONGO_URI` + `MONGO_DB`
3. `npm install`
4. `npm run dev`

### Run frontend locally

1. `cd web`
2. `npm install`
3. `npm run start` (or `ng serve --open --port 4200`)

### What it does

- `/api/market/:id` returns cached/normalized RS3 item data
- `/api/market/batch` returns multiple items in one request
- `MarketDataService` calls backend path and maps to `MarketItem`

### Deployment path

- Frontend: Cloudflare Pages
- Backend: Railway/Heroku/Cloudflare Workers (proxy) or Cloudflare Pages Functions
- DB: MongoDB Atlas
