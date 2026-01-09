const Message = require("../models/Message");

let ioInstance;
let onlineUsersMap;

// Setter for io and users map
exports.setIoAndUsers = (io, onlineUsers) => {
  ioInstance = io;
  onlineUsersMap = onlineUsers;
};

// Get messages between two users
exports.getMessages = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { receiverId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    console.log(`📨 Fetching direct messages between ${senderId} and ${receiverId}, page: ${page}`);

    const query = {
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
      groupId: { $exists: false }, // Only direct messages
    };

    // Execute count and messages query in parallel
    const [totalMessages, messages] = await Promise.all([
      Message.countDocuments(query),
      Message.find(query)
        .populate("senderId", "name email profileImage about")
        .populate("receiverId", "name email profileImage about")
        .lean()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    console.log(`✅ Found ${messages.length} messages (total: ${totalMessages})`);

    // Reverse to show oldest first
    const reversedMessages = messages.reverse();

    // Mark messages as delivered (non-blocking)
    const undeliveredIds = reversedMessages
      .filter(m => m.receiverId._id.toString() === senderId && m.status === "sent")
      .map(m => m._id);

    if (undeliveredIds.length > 0) {
      Message.updateMany(
        { _id: { $in: undeliveredIds }, status: "sent" },
        { status: "delivered" }
      ).exec();

      // Notify sender about delivery
      const senderSocketId = onlineUsersMap.get(receiverId);
      if (senderSocketId && ioInstance) {
        ioInstance.to(senderSocketId).emit("messagesDelivered", {
          receiverId: senderId,
        });
      }
    }

    res.status(200).json({
      messages: reversedMessages,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalMessages / limit),
        totalMessages,
        hasMore: skip + reversedMessages.length < totalMessages,
      }
    });
  } catch (err) {
    console.error("❌ Error fetching direct messages:", err);
    console.error("Stack trace:", err.stack);
    res.status(500).json({ message: "Failed to fetch messages", error: err.message });
  }
};

// Send message
exports.sendMessage = async (req, res) => {
  try {
    console.log("📨 Received direct message request");
    const { receiverId, message } = req.body;
    const senderId = req.user.userId;
    
    console.log("📍 Sender ID:", senderId);
    console.log("📍 Receiver ID:", receiverId);
    console.log("📍 Message:", message);

    if (!receiverId || !message) {
      console.log("❌ Missing receiverId or message");
      return res.status(400).json({ message: "Receiver and message are required" });
    }

    // Check if receiver is online
    const receiverSocketId = onlineUsersMap.get(receiverId);
    const initialStatus = receiverSocketId ? "delivered" : "sent";
    
    console.log("💾 Creating message in database...");
    console.log("📋 Message data:", { senderId, receiverId, message, status: initialStatus });

    let newMessage;
    try {
      // Create message
      newMessage = await Message.create({
        senderId,
        receiverId,
        message,
        status: initialStatus,
      });
      console.log("✅ Message created:", newMessage._id);
    } catch (createErr) {
      console.error("❌ Error creating message:", createErr);
      console.error("❌ Validation errors:", createErr.errors);
      throw createErr;
    }

    // Populate message asynchronously and emit to both sender and receiver (fire and forget)
    Message.findById(newMessage._id)
      .populate("senderId", "name email profileImage about")
      .populate("receiverId", "name email profileImage about")
      .lean()
      .then(populatedMessage => {
        if (ioInstance) {
          console.log("📤 Emitting direct message to receiver only");
          // Emit to receiver if online (sender already has message from API response)
          if (receiverSocketId) {
            console.log(`  - Receiver: ${receiverId} (socket: ${receiverSocketId})`);
            ioInstance.to(receiverSocketId).emit("receiveMessage", populatedMessage);
          } else {
            console.log(`  - Receiver: ${receiverId} (OFFLINE)`);
          }
        } else {
          console.error("⚠️ ioInstance not available for message emit");
        }
      })
      .catch(err => console.error("❌ Error populating message:", err));

    // Return immediately with minimal data
    console.log("📤 Sending response to client...");
    res.status(201).json({
      _id: newMessage._id,
      senderId,
      receiverId,
      message: newMessage.message,
      status: newMessage.status,
      createdAt: newMessage.createdAt
    });
    console.log("✅ Response sent successfully");

  } catch (err) {
    console.error("❌ Error sending direct message:", err);
    console.error("❌ Stack trace:", err.stack);
    res.status(500).json({ message: "Failed to send message", error: err.message });
  }
};

// Mark messages as read
exports.markAsRead = async (req, res) => {
  try {
    const { senderId } = req.body;
    const receiverId = req.user.userId;

    await Message.updateMany(
      {
        senderId: senderId,
        receiverId: receiverId,
        status: { $ne: "read" },
      },
      { status: "read" }
    );

    // Notify sender
    const senderSocketId = onlineUsersMap.get(senderId);
    if (senderSocketId && ioInstance) {
      ioInstance.to(senderSocketId).emit("messagesRead", { receiverId });
    }

    res.status(200).json({ message: "Messages marked as read" });
  } catch (err) {
    console.error("Error marking messages as read:", err);
    res.status(500).json({ message: "Failed to mark as read", error: err.message });
  }
};
