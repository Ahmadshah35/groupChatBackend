// backend/routes/chat.routes.js
const router = require("express").Router();
const { auth } = require("../middleware/auth.middleware");
const { getMessages, sendMessage, markAsRead } = require("../controllers/chat.controller");

// Get messages between logged-in user and another user
router.get("/:receiverId", auth, getMessages);

// Send a new message
router.post("/", auth, sendMessage);

// Mark messages as read
router.post("/mark-read", auth, markAsRead);

module.exports = router;
