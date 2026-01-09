const Message = require("./models/Message");
const User = require("./models/User");

const onlineUsers = new Map();

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("🔗 User connected:", socket.id);

    // User joins
    socket.on("join", async (userId) => {
      console.log("📥 Received join event for userId:", userId);
      onlineUsers.set(userId, socket.id);
      
      // Update user online status (fire and forget - don't block)
      setImmediate(() => {
        User.findByIdAndUpdate(userId, { 
          isOnline: true,
          lastSeen: new Date() 
        }).exec().catch(err => console.error("Error updating user status:", err));
      });

      io.emit("onlineUsers", Array.from(onlineUsers.keys()));
      console.log(`✅ User joined: ${userId} with socket: ${socket.id} - Total online: ${onlineUsers.size}`);
      console.log(`📋 Current online users:`, Array.from(onlineUsers.entries()));
    });

    // Send message via socket (for real-time delivery)
    socket.on("sendMessage", (data) => {
      const receiverSocket = onlineUsers.get(data.receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit("receiveMessage", data);
      }
    });

    // Send group message via socket
    socket.on("sendGroupMessage", (data) => {
      // Emit to all group members
      if (data.groupMembers && Array.isArray(data.groupMembers)) {
        data.groupMembers.forEach((memberId) => {
          const memberSocket = onlineUsers.get(memberId);
          if (memberSocket && memberSocket !== socket.id) {
            io.to(memberSocket).emit("receiveGroupMessage", data);
          }
        });
      }
    });

    // Typing indicator for direct messages
    socket.on("typing", ({ receiverId, senderId, isTyping }) => {
      const receiverSocket = onlineUsers.get(receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit("typing", { senderId, isTyping });
      }
    });

    // Typing indicator for groups
    socket.on("groupTyping", ({ groupId, senderId, senderName, isTyping }) => {
      socket.broadcast.emit("groupTyping", { groupId, senderId, senderName, isTyping });
    });

    // Message delivered
    socket.on("messageDelivered", async ({ messageId, userId }) => {
      // Fire and forget - don't block the socket
      setImmediate(async () => {
        try {
          const message = await Message.findById(messageId).lean();
          if (message) {
            if (message.groupId) {
              // For group messages
              if (!message.deliveredTo.some((d) => d.userId.toString() === userId)) {
                await Message.findByIdAndUpdate(messageId, {
                  $push: { deliveredTo: { userId, deliveredAt: new Date() } },
                  $set: { status: message.status === "sent" ? "delivered" : message.status }
                }).exec();
              }
            } else {
              // For direct messages
              if (message.status === "sent") {
                await Message.findByIdAndUpdate(messageId, { status: "delivered" }).exec();
              }
            }
            
            // Notify sender (non-blocking)
            const senderSocket = onlineUsers.get(message.senderId.toString());
            if (senderSocket) {
              io.to(senderSocket).emit("messageStatusUpdate", {
                messageId,
                status: "delivered"
              });
            }
          }
        } catch (err) {
          console.error("Error updating message delivery:", err);
        }
      });
    });

    // Message read/seen
    socket.on("messageRead", async ({ messageId, userId }) => {
      // Fire and forget - don't block
      setImmediate(async () => {
        try {
          const message = await Message.findById(messageId).lean();
          if (message) {
            if (message.groupId) {
              // For group messages
              if (!message.readBy.some((r) => r.userId.toString() === userId)) {
                await Message.findByIdAndUpdate(messageId, {
                  $push: { readBy: { userId, readAt: new Date() } }
                }).exec();
              }
            } else {
              // For direct messages
              await Message.findByIdAndUpdate(messageId, { status: "read" }).exec();
            }
            
            // Notify sender (non-blocking)
            const senderSocket = onlineUsers.get(message.senderId.toString());
            if (senderSocket) {
              io.to(senderSocket).emit("messageStatusUpdate", {
                messageId,
                status: "read"
              });
            }
          }
        } catch (err) {
          console.error("Error updating message read:", err);
        }
      });
    });

    // Mark all messages as read (fire and forget)
    socket.on("markMessagesRead", ({ senderId, receiverId }) => {
      setImmediate(async () => {
        try {
          await Message.updateMany(
            {
              senderId,
              receiverId,
              status: { $ne: "read" },
            },
            { status: "read" }
          ).exec();

          // Notify sender (non-blocking)
          const senderSocket = onlineUsers.get(senderId);
          if (senderSocket) {
            io.to(senderSocket).emit("messagesMarkedRead", { receiverId });
          }
        } catch (err) {
          console.error("Error marking messages as read:", err);
        }
      });
    });

    // Disconnect
    socket.on("disconnect", async () => {
      console.log("User disconnected:", socket.id);
      
      let disconnectedUserId;
      for (let [key, value] of onlineUsers) {
        if (value === socket.id) {
          disconnectedUserId = key;
          onlineUsers.delete(key);
          break;
        }
      }

      if (disconnectedUserId) {
        // Update user offline status (fire and forget - don't block)
        setImmediate(() => {
          User.findByIdAndUpdate(disconnectedUserId, {
            isOnline: false,
            lastSeen: new Date(),
          }).exec().catch(err => console.error("Error updating user status on disconnect:", err));
        });
      }

      io.emit("onlineUsers", Array.from(onlineUsers.keys()));
      console.log("Online users after disconnect:", onlineUsers.size);
    });
  });

  return onlineUsers;
};
