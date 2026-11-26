# Complete Step-by-Step Guide: Deploying Eventpatro (MERN Monorepo) on Vercel

This document provides a comprehensive, reproducible walkthrough for deploying **Eventpatro** — a full-stack MERN application (React 19 + Vite frontend, Node.js + Express backend, MongoDB Atlas database, Cloudinary media storage, and Nodemailer email delivery) — onto **Vercel** as a unified multi-service project under a single domain.

---

## Architecture Overview

```
                           ┌────────────────────────────────────────┐
                           │          Vercel Single Domain          │
                           │      (e.g., your-app.vercel.app)       │
                           └───────────────────┬────────────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       │                                               │
                Routes to /api/*                                Routes to /*
                       │                                               │
                       ▼                                               ▼
        ┌─────────────────────────────┐                 ┌─────────────────────────────┐
        │       Backend Service       │                 │      Frontend Service       │
        │      Express.js / Node      │                 │         Vite / React        │
        │     (server/index.js)       │                 │     (client/index.html)     │
        └──────────────┬──────────────┘                 └─────────────────────────────┘
                       │
                       ├───────────────────────────────┐
                       ▼                               ▼
        ┌─────────────────────────────┐ ┌─────────────────────────────┐
        │        MongoDB Atlas        │ │     Cloudinary CDN          │
        │    Cloud Database Cluster   │ │    Image & Poster Storage   │
        └─────────────────────────────┘ └─────────────────────────────┘
```

Both applications share one domain and deployment lifecycle, completely eliminating cross-origin resource sharing (CORS) issues and cookie partition restrictions between frontend and backend.

---

## 1. Migration from AWS to Vercel (Cleanup)

Before setting up Vercel, all legacy infrastructure files from earlier AWS EC2 deployments were removed to prevent conflicts and ensure a clean Git history:

1. **Remove Old Git History**:
   ```bash
   rm -rf .git
   ```
2. **Remove AWS / EC2 Specific Files**:
   - `infra/` folder (CloudFormation templates, Nginx reverse proxy configs, Ubuntu EC2 setup scripts).
   - `.github/workflows/deploy.yml` (GitHub Actions workflow for AWS SSH deployments).
   - `server/ecosystem.config.cjs` (PM2 process manager config for persistent VM servers).
   - AWS deployment markdown documentation files.
3. **Initialize New Repository**:
   ```bash
   git init -b main
   git remote add origin https://github.com/codebykashish/events_deployment.git
   ```

---

## 2. Vercel Multi-Services Configuration

Vercel natively supports deploying multiple frontend and backend services from a single repository using **Vercel Services**.

### Root Configuration: `vercel.json`
Place this in the repository root directory:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "client": {
      "root": "client",
      "framework": "vite"
    },
    "server": {
      "root": "server",
      "framework": "express"
    }
  },
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": {
        "service": "server"
      }
    },
    {
      "source": "/(.*)",
      "destination": {
        "service": "client"
      }
    }
  ]
}
```

* **`services.client`**: Instructs Vercel to build the frontend inside `client/` using Vite.
* **`services.server`**: Instructs Vercel to build and serve the backend inside `server/` using Express.
* **`rewrites`**: Dispatches requests matching `/api/*` to the Express backend and all other requests to the Vite client.

### Client SPA Routing Configuration: `client/vercel.json`
To support client-side routing (React Router v7) and prevent `404 NOT_FOUND` errors when refreshing routes such as `/dashboard` or `/login`, place a scoped `vercel.json` inside the `client/` directory:

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## 3. Adapting the Express Backend for Serverless

In a standard VM or container environment, Express runs indefinitely using `app.listen(PORT)`. In Vercel, requests are dispatched serverlessly. The following adaptations were made:

### A. Dedicated Export Entry Point (`server/index.js`)
Created `server/index.js` to export the Express application instance for Vercel, while preserving `server/src/server.js` for local development (`npm run dev`):

```javascript
// server/index.js
const app = require('./src/app');

module.exports = app;
```

### B. MongoDB Atlas Connection Caching (`server/src/config/db.js`)
Serverless containers may spin up on demand. Recreating database connections on every request exhausts MongoDB Atlas connection pools. Connection caching using `global.mongoose` ensures connection reuse across warm function invocations:

```javascript
const mongoose = require('mongoose');

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
    }).then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
};

module.exports = connectDB;
```

### C. Pre-Route Database Middleware (`server/src/app.js`)
To guarantee that the database is connected before any controller or route handler executes, an async middleware was mounted at the top of Express:

```javascript
const connectDB = require('./config/db');

app.set('trust proxy', 1);

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});
```

### D. Safe Filesystem Handling for Serverless (`server/src/routes/upload.routes.js`)
Vercel serverless environments enforce a read-only filesystem (except `/tmp`). Directory creation checks were made resilient with a `/tmp/uploads` fallback:

```javascript
const uploadDir = process.env.VERCEL
  ? '/tmp/uploads'
  : path.join(__dirname, '../../uploads');

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (e) {
  console.warn('Could not create upload directory:', e.message);
}
```

---

## 4. MongoDB Atlas Configuration

1. Log in to [MongoDB Atlas](https://cloud.mongodb.com).
2. Go to **Network Access** under Security:
   - Click **Add IP Address** -> Select **Allow Access From Anywhere (`0.0.0.0/0`)**. Serverless functions run on dynamic cloud IP addresses, so restricting by static IP is not supported.
3. Go to **Database Access**:
   - Ensure a database user exists with read/write permissions to the `eventpatro` database.
4. Construct the Atlas URI:
   ```
   mongodb+srv://<username>:<password>@<cluster-url>/eventpatro?retryWrites=true&w=majority&appName=eventpatro-db
   ```

---

## 5. Environment Variables Configuration

Set these variables in your Vercel Project under **Settings -> Environment Variables**. Check all three environments: **Production**, **Preview**, and **Development**.

| Variable | Required | Description | Example / Format |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | **Yes** | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net/eventpatro?retryWrites=true&w=majority` |
| `NODE_ENV` | **Yes** | Node environment mode | `production` |
| `JWT_SECRET` | **Yes** | Secret string for signing auth tokens | Any secure random string |
| `JWT_EXPIRES_IN`| No (defaults to 7d) | Token expiration duration | `7d` |
| `SMTP_USER` | **Yes** | Gmail address for sending OTP codes | `your-email@gmail.com` |
| `SMTP_PASS` | **Yes** | Gmail 16-character App Password | `xxxx xxxx xxxx xxxx` |
| `EMAIL_FROM_NAME`| **Yes** | Name displayed on sent emails | `Eventpatro Sunway` |
| `CLOUDINARY_CLOUD_NAME` | **Yes** | Cloudinary Cloud Name | *(From Cloudinary Console)* |
| `CLOUDINARY_API_KEY` | **Yes** | Cloudinary API Key | *(From Cloudinary Console)* |
| `CLOUDINARY_API_SECRET` | **Yes** | Cloudinary API Secret | *(From Cloudinary Console)* |

---

## 6. Database Seeding

When deploying to a fresh database, run the seed scripts from your local terminal against MongoDB Atlas to seed the admin account and sample events:

```bash
# 1. Seed administrator account (admin@sunway.edu.np / Admin@Sunway2026)
MONGODB_URI="<your-mongodb-atlas-uri>" node server/src/scripts/seedAdmin.js

# 2. Seed initial campus events
MONGODB_URI="<your-mongodb-atlas-uri>" node server/src/scripts/seedEvents.js
```

---

## 7. Troubleshooting & Root Cause Analysis

### Error 1: `Unexpected token 'A', "A server error..." is not valid JSON`
* **Cause**: The serverless function crashed during module evaluation before sending a JSON response. This was triggered by top-level synchronous `fs.mkdirSync()` attempting to write to the read-only filesystem.
* **Fix**: Wrapped filesystem calls in `try/catch` with a `/tmp` fallback, and ensured `server/index.js` cleanly exports `app`.

### Error 2: `500 FUNCTION_INVOCATION_FAILED` on API Routes
* **Cause**: Asynchronous `connectDB()` was running in the background without being awaited before route handlers executed queries like `Event.find()`.
* **Fix**: Placed an `await connectDB()` middleware at the very top of `server/src/app.js` before all route registrations.

### Error 3: `404 NOT_FOUND` on Reloading `/dashboard` or `/login`
* **Cause**: Vite is a Single Page Application (SPA). Navigating or refreshing a non-root route caused Vercel to search for a literal `dashboard` or `dashboard.html` static file, which does not exist.
* **Fix**: Created `client/vercel.json` with a rewrite from `/(.*)` to `/index.html`, allowing React Router v7 to handle the client URL.

### Error 4: `The vercel.json schema validation failed: routes[0].dest should be string`
* **Cause**: Mixing legacy `routes` syntax with Vercel Services destination objects (`{ "service": "..." }`).
* **Fix**: Maintained pure `rewrites` syntax in `vercel.json` and delegated SPA routing to `client/vercel.json`.

---

## 8. Verifying Your Live Deployment

1. **API Health Check**:
   Visit `https://<your-project>.vercel.app/api/health`
   Expected response:
   ```json
   { "success": true, "message": "Eventpatro server is running." }
   ```
2. **Frontend Landing Page**:
   Visit `https://<your-project>.vercel.app/` — verify that campus events (Hackathon, Cultural Fest, AI Masterclass, etc.) load from MongoDB Atlas.
3. **Authentication & Protected Routes**:
   Log in with `admin@sunway.edu.np` / `Admin@Sunway2026`. Verify redirection to `/dashboard` and perform a browser refresh (`Ctrl + Shift + R`) to confirm persistent SPA routing.
