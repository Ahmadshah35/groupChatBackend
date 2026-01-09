require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const compression = require("compression");
const path = require("path");
const connectDB = require("./config/db");
const socketHandler = require("./socket");
const chatController = require("./controllers/chat.controller");
const groupController = require("./controllers/group.controller");
const authController = require("./controllers/auth.controller");

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with proper CORS
const io = require("socket.io")(server, {
  cors: {
    origin: "https://chat.apiforapp.link",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6, // 1MB max message size
  perMessageDeflate: false, // Disable compression for faster sends
  httpCompression: false
});

// Middlewares with proper CORS configuration
app.use(cors({
  origin: "https://chat.apiforapp.link",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Enable compression for all responses
app.use(compression({
  level: 6, // Balance between speed and compression
  threshold: 1024, // Only compress responses larger than 1KB
}));

// Add response headers to prevent browser throttling
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Keep-Alive', 'timeout=65');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Optimize server for handling concurrent connections
server.maxConnections = 1000;
server.timeout = 30000; // 30 second timeout
server.keepAliveTimeout = 61000; // Keep alive slightly longer than default
server.headersTimeout = 62000; // Headers timeout slightly longer

// Serve static files (uploaded images)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/chat", require("./routes/chat.routes"));
app.use("/api/group", require("./routes/group.routes"));

// Socket setup
const onlineUsers = socketHandler(io);

// Pass io and onlineUsers to chat, group, and auth controllers
chatController.setIoAndUsers(io, onlineUsers);
groupController.setIoAndUsers(io, onlineUsers);
authController.setIoAndUsers(io, onlineUsers);

// Connect to database first, then start server
const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to connect to database:", err);
    process.exit(1);
  });
