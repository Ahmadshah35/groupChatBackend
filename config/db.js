const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 50,          // Increased for 3 browsers with multiple tabs
      minPoolSize: 20,          // Higher minimum ready connections
      maxIdleTimeMS: 60000,     // Keep idle connections longer (1 min)
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,   // Reduced from 45s to 30s
      family: 4,
      compressors: ['zlib'],
      connectTimeoutMS: 10000,
    });
    
    // Optimize mongoose for performance
    mongoose.set('strictQuery', false);
    mongoose.set('autoIndex', false); // Disable auto-indexing in production for speed
    
    // Handle connection errors
    mongoose.connection.on('error', err => {
      console.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
    });
    
    console.log("MongoDB Connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    throw err;
  }
};

module.exports = connectDB;
