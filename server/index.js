// server/index.js
// Vercel Express Service entry point
const app = require('./src/app');
const connectDB = require('./src/config/db');

// Connect to MongoDB
connectDB().catch((err) => {
  console.error('Failed to connect to MongoDB on startup:', err.message);
});

module.exports = app;
