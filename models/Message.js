const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },
    message: {
      type: String,
      required: true,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "file"],
      default: "text",
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    // For group messages - track who has delivered/read
    deliveredTo: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        deliveredAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    readBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true } // adds createdAt and updatedAt
);

// Add indexes for better query performance
messageSchema.index({ groupId: 1, createdAt: -1 }); // For group messages sorted by time
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 }); // For direct messages
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 }); // For reverse direct messages
messageSchema.index({ status: 1 }); // For filtering by status

module.exports = mongoose.model("Message", messageSchema);
