// app.js
// Sets up Express application — middleware, routes, and error handling.

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const app = express();

// Trust Vercel / reverse proxy headers (needed for express-rate-limit and secure cookies)
app.set('trust proxy', 1);

// --- Security middleware ---
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(
  cors({
    origin: process.env.CLIENT_URL || true, // Allow same-origin / all Vercel domains
    credentials: true,
  })
);

// --- Body parsing ---
app.use(express.json());

// --- Routes ---

// Health-check route
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Eventpatro server is running.',
    timestamp: new Date().toISOString(),
  });
});

// Authentication routes (signup, login, me)
const authRoutes = require('./routes/auth.routes');
app.use('/api/auth', authRoutes);

// Event routes (public listing + admin CRUD + registration management)
const eventRoutes = require('./routes/event.routes');
app.use('/api/events', eventRoutes);

// Registration routes
const registrationRoutes = require('./routes/registration.routes');
app.use('/api/registrations', registrationRoutes);

// Upload routes
const uploadRoutes = require('./routes/upload.routes');
app.use('/api/upload', uploadRoutes);

// Serve uploaded files statically (fallback)
const path = require('path');
const uploadStaticDir = process.env.VERCEL
  ? '/tmp/uploads'
  : path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadStaticDir));

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// --- Global error handler ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message =
    err.isOperational
      ? err.message
      : (process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : err.message);

  console.error('Express Error:', err);

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

module.exports = app;
