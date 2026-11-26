# Step-by-Step Guide: Deploying a Full-Stack MERN Monorepo on Vercel

This guide documents the exact process used to deploy **Eventpatro** (a full-stack MERN application with a Vite/React frontend, Express.js backend, and MongoDB Atlas database) to **Vercel** under a single custom domain using **Vercel Services**.

---

## Architecture Overview

```
                        ┌────────────────────────────────────────┐
                        │           Vercel Single Domain         │
                        │        (e.g., your-app.vercel.app)     │
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
     │     (server/index.js)       │                 │      (client/index.html)    │
     └──────────────┬──────────────┘                 └─────────────────────────────┘
                    │
                    ▼
     ┌─────────────────────────────┐
     │      MongoDB Atlas          │
     │   Cloud Database Cluster    │
     └─────────────────────────────┘
```

---

## Step 1: Clean Up Old Deployment & AWS Configurations

Before switching to Vercel, legacy deployment files from EC2/AWS were removed:
1. Removed `.git` to break tracking from any previous repository and start with a clean Git history:
   ```bash
   rm -rf .git
   ```
2. Removed AWS and EC2 files:
   - `infra/` (CloudFormation templates, Nginx configuration, bash setup scripts)
   - `.github/workflows/deploy.yml` (Old GitHub Actions EC2 deployment workflow)
   - `server/ecosystem.config.cjs` (PM2 process file for persistent EC2 servers)
   - AWS deployment markdown documentation
3. Initialized a clean repository and linked to the new GitHub repo:
   ```bash
   git init -b main
   git remote add origin https://github.com/codebykashish/events_deployment.git
   ```

---

## Step 2: Configure Vercel Services (`vercel.json`)

Vercel supports **Multi-Service Projects**, allowing both the Vite frontend and the Express backend to live in the same repository, deploy together, and share the same domain (eliminating CORS and cookie issues).

Create `vercel.json` in the **root** directory:

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
        "service": "client",
        "path": "/index.html"
      }
    }
  ]
}
```

### Key Highlights of this Configuration:
- **`services.client`**: Points to the `client/` folder with the `vite` framework preset.
- **`services.server`**: Points to the `server/` folder with the `express` framework preset.
- **`rewrites`**:
  - `/api/(.*)` forwards all API calls to the Express `server` service.
  - `/(.*)` with `"path": "/index.html"` handles **React Router Single Page Application (SPA)** fallback, preventing 404 errors when reloading routes like `/dashboard` or `/login`.

---

## Step 3: Adapt Express Backend for Serverless

In standard server environments (EC2, local), Express runs a persistent process with `app.listen(PORT)`. On Vercel, requests are handled serverless.

### 1. Export the Express Application
Create `server/index.js` as the entrypoint for the service:
```javascript
// server/index.js
const app = require('./src/app');

module.exports = app;
```

### 2. Cache MongoDB Connection
In serverless functions, a new container can spin up per request or be reused. To avoid opening hundreds of database connections:
In `server/src/config/db.js`:
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

### 3. Ensure DB Connection Middleware Runs First
In `server/src/app.js`, attach a middleware before routes so every API call awaits the database connection:
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

### 4. Prevent Read-Only Filesystem Errors
Vercel serverless environments have a read-only filesystem. If your code writes to disk locally (e.g., local uploads), wrap any directory creation or point to `/tmp`:
```javascript
const uploadDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '../../uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (e) {
  console.warn('Could not create upload directory:', e.message);
}
```

---

## Step 4: Configure MongoDB Atlas

1. Log in to [MongoDB Atlas](https://cloud.mongodb.com/).
2. Under **Security** -> **Network Access**:
   - Add IP address: `0.0.0.0/0` (Allow access from anywhere). Serverless functions run on dynamic IPs, so restricting by IP is not possible.
3. Under **Database Access**:
   - Ensure you have a database user (e.g. `kashishdhamistudy_db_user`) with read/write privileges.
4. Construct your connection string:
   ```
   mongodb+srv://<username>:<password>@<cluster-url>/eventpatro?retryWrites=true&w=majority
   ```

---

## Step 5: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and log in.
2. Click **Add New...** -> **Project**.
3. Select your repository (`events_deployment`) and click **Import**.
4. In **Project Configuration**:
   - Keep the Root Directory as `./`.
   - Vercel automatically detects the `services` defined in `vercel.json`.
5. Under **Environment Variables**, add the following (check **Production**, **Preview**, and **Development** for each):

| Variable Name | Description |
| :--- | :--- |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Secret key for signing user tokens |
| `JWT_EXPIRES_IN` | `7d` |
| `SMTP_USER` | Gmail address for sending OTP verification |
| `SMTP_PASS` | Gmail 16-character App Password |
| `EMAIL_FROM_NAME` | Display sender name in emails |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name for image uploads |
| `CLOUDINARY_API_KEY` | Cloudinary API Key |
| `CLOUDINARY_API_SECRET` | Cloudinary API Secret |

6. Click **Deploy**.

---

## Step 6: Seed Initial Data (Admin & Events)

If deploying to a fresh database, run the seed scripts against your Atlas cluster:

```bash
MONGODB_URI="<your-mongodb-atlas-uri>" node server/src/scripts/seedAdmin.js
MONGODB_URI="<your-mongodb-atlas-uri>" node server/src/scripts/seedEvents.js
```

This creates the default administrator (`admin@sunway.edu.np`) and populates the sample events shown on the homepage.

---

## Troubleshooting Common Errors

### 1. `Unexpected token 'A', "A server error..." is not valid JSON`
- **Cause**: The serverless function crashed during startup or top-level file execution, causing Vercel to return a default 500 HTML error page instead of JSON.
- **Fix**: Check `server/src/routes/upload.routes.js` for disk writes or unhandled file operations, and ensure `server/index.js` exports the `app`. Check Vercel **Logs** to inspect the stack trace.

### 2. `404 NOT_FOUND` on refreshing routes like `/dashboard` or `/login`
- **Cause**: Static file servers look for physical HTML files matching the route path.
- **Fix**: Ensure the `/(.*)` rewrite in `vercel.json` redirects to `"path": "/index.html"`.

### 3. Rate limiter or proxy issues
- **Cause**: Behind Vercel's edge proxy, Express receives requests from proxy IPs.
- **Fix**: Add `app.set('trust proxy', 1);` in `app.js`.
