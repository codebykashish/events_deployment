// server/index.js
// Vercel Express Service entry point
const app = require('./src/app');
const connectDB = require('./src/config/db');

// Middleware to ensure database is connected before processing requests
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection middleware error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message,
    });
  }
});

module.exports = app;
