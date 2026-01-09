const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    unique: true,
    required: true,
    index: true, // Explicitly add index for faster lookups
  },
  password: {
    type: String,
    required: true,
    select: false, // Don't include password by default
  },
  profileImage: {
    type: String,
    default: "",
  },
  about: {
    type: String,
    default: "Hey there! I am using Ahmad's ChatApp.",
  },
  lastSeen: {
    type: Date,
    default: Date.now,
  },
  isOnline: {
    type: Boolean,
    default: false,
    index: true, // Index for online status queries
  },
}, { timestamps: true });

// Compound index for sorting users by online status
userSchema.index({ isOnline: -1, lastSeen: -1 });

module.exports = mongoose.model("User", userSchema);
