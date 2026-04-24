# Newscape-Nexus

Newscape-Nexus is a full-stack RuneScape GE tracker built with Angular + Express + MongoDB.

Current state:
- Public GE market dashboard 
- Backend-managed data access 
- Production ready foundation in place 

## Stack and Tools Used

Frontend:
- Angular 21
- TypeScript
- RxJS
- Angular Router and HttpClient

Backend:
- Node.js + Express
- MongoDB Node Driver
- Axios (RS3 API fetches)
- Zod (request/env validation)
- Helmet + CORS + express-rate-limit

Dev/Quality Tooling:
- Nodemon
- Node test runner (`node --test`)
- npm scripts
- GitHub Actions CI

## Architecture

Application Flow:

Frontend (browser) -> Backend API -> MongoDB + RS3 API -> Backend API -> Frontend

## Features Implemented

Public GE tracker:
- `GET /api/market/:id` for single-item normalized market data
- `POST /api/market/batch` for batch market fetches
- Backend caching layer for market responses
- Self generated list of all items in Runescape3

Operational and production-readiness features:
- Strict environment validation with fail-fast production checks
- Structured JSON logging
- Health endpoints:
	- `GET /health/live`
	- `GET /health/ready`
- CI pipeline for backend tests/audit and frontend build

## Local Development

Prerequisites:
- Node.js 22+
- npm
- MongoDB Atlas URI (or local MongoDB)

1. Install dependencies

```powershell
npm --prefix .\backend install
npm --prefix .\web install
```

2. Configure backend environment

- Copy `backend/.env.example` to `backend/.env`
- Set at minimum:
	- `MONGO_URI`
	- `MONGO_DB`
	- `JWT_ACCESS_SECRET`
	- `JWT_REFRESH_SECRET`

3. Start backend

```powershell
npm --prefix .\backend run dev
```

4. Start frontend

```powershell
npm --prefix .\web start
```

Default URLs:
- Frontend: `http://localhost:4200`
- Backend: `http://localhost:3000`

## Useful Scripts

Backend:
- `npm --prefix .\backend run dev`
- `npm --prefix .\backend run start`
- `npm --prefix .\backend test`

Frontend:
- `npm --prefix .\web start`
- `npm --prefix .\web run build`
- `npm --prefix .\web test`

## Verification Status

Recently verified:
- Frontend build passes
- Backend tests pass
- No frontend source exposure of Mongo credential patterns

## Deployment Direction

- Frontend: Cloudflare Pages / static hosting
- Backend: Railway/Render/Fly/VM container
- Database: MongoDB Atlas
- Reverse proxy/TLS in front of backend for production traffic
