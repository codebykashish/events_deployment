const mongoose = require('mongoose');
const app = require('../server/src/app');

// Cache the MongoDB connection across serverless invocations
let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }

  // Reuse existing connection if mongoose has already connected
  if (mongoose.connection.readyState >= 1) {
    isConnected = true;
    return;
  }

  const db = await mongoose.connect(uri, {
    bufferCommands: false, // Disable mongoose buffering in serverless functions
  });

  isConnected = db.connections[0].readyState === 1;
};

// Vercel serverless function entry handler
module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (error) {
    console.error('Serverless DB Connection Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: process.env.NODE_ENV === 'production' ? undefined : error.message,
    });
  }

  return app(req, res);
};
