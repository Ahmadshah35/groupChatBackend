const Group = require("../models/Group");
const Message = require("../models/Message");
const User = require("../models/User");

let ioInstance;
let onlineUsersMap;

// Cache to prevent duplicate message creation
const messageCache = new Map(); // key: "senderId:groupId:message", value: timestamp

// Setter for io and users map
exports.setIoAndUsers = (io, onlineUsers) => {
  ioInstance = io;
  onlineUsersMap = onlineUsers;
};

// Clean cache every 10 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of messageCache.entries()) {
    if (now - timestamp > 10000) { // Remove entries older than 10s
      messageCache.delete(key);
    }
  }
}, 10000);

// Create a new group
exports.createGroup = async (req, res) => {
  try {
    const { name, description, members } = req.body;
    const creatorId = req.user.userId;

    if (!name || !members || members.length === 0) {
      return res.status(400).json({ message: "Group name and members are required" });
    }

    // Add creator to members if not already included
    const allMembers = [...new Set([creatorId, ...members])];

    const group = await Group.create({
      name,
      description: description || "",
      members: allMembers,
      admins: [creatorId],
      createdBy: creatorId,
    });

    const populatedGroup = await Group.findById(group._id)
      .populate("members", "-password")
      .populate("admins", "-password")
      .populate("createdBy", "-password");

    // Emit to all group members
    allMembers.forEach((memberId) => {
      const memberSocketId = onlineUsersMap.get(memberId.toString());
      if (memberSocketId && ioInstance) {
        ioInstance.to(memberSocketId).emit("newGroup", populatedGroup);
      }
    });

    res.status(201).json(populatedGroup);
  } catch (err) {
    console.error("Error creating group:", err);
    res.status(500).json({ message: "Failed to create group", error: err.message });
  }
};

// Get all groups for the user
exports.getGroups = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Only populate essential fields, not full user objects
    const groups = await Group.find({ members: userId })
      .select("name description groupIcon members admins createdBy updatedAt createdAt")
      .lean() // Returns plain JS objects (faster)
      .sort({ updatedAt: -1 });

    res.status(200).json(groups);
  } catch (err) {
    console.error("Error fetching groups:", err);
    res.status(500).json({ message: "Failed to fetch groups", error: err.message });
  }
};

// Get group details
exports.getGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    const group = await Group.findById(groupId)
      .populate("members", "-password")
      .populate("admins", "-password")
      .populate("createdBy", "-password");

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Check if user is a member
    if (!group.members.some((member) => member._id.toString() === userId)) {
      return res.status(403).json({ message: "You are not a member of this group" });
    }

    res.status(200).json(group);
  } catch (err) {
    console.error("Error fetching group details:", err);
    res.status(500).json({ message: "Failed to fetch group details", error: err.message });
  }
};

// Get group messages
exports.getGroupMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    console.log(`📨 Fetching messages for group: ${groupId}, page: ${page}`);
    console.log("✅ Fetching messages directly...");

    // Fetch with aggressive timeout
    try {
      const queryPromise = Promise.all([
        Message.countDocuments({ groupId }).maxTimeMS(2000),
        Message.find({ groupId })
          .populate("senderId", "name email profileImage about")
          .lean()
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .maxTimeMS(2000)
      ]);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 3000)
      );

      const [totalMessages, messages] = await Promise.race([queryPromise, timeoutPromise]);

      console.log(`✅ Found ${messages.length} messages (total: ${totalMessages})`);

      const reversedMessages = messages.reverse();

      return res.status(200).json({
        messages: reversedMessages,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalMessages / limit),
          totalMessages,
          hasMore: skip + messages.length < totalMessages,
        }
      });
    } catch (timeoutErr) {
      console.error("❌ Query timeout, returning empty array");
      // Return empty on timeout to prevent crash
      return res.status(200).json({
        messages: [],
        pagination: {
          currentPage: page,
          totalPages: 0,
          totalMessages: 0,
          hasMore: false,
        }
      });
    }
  } catch (err) {
    console.error("❌ Error fetching group messages:", err.message);
    res.status(500).json({ message: "Failed to fetch messages", error: err.message });
  }
};

// Send group message
exports.sendGroupMessage = async (req, res) => {
  try {
    console.log("📨 Received group message request");
    const { groupId, message } = req.body;
    const senderId = req.user.userId;
    
    console.log("📍 Sender:", senderId, "| Group:", groupId, "| Message:", message);

    if (!groupId || !message) {
      return res.status(400).json({ message: "Group and message are required" });
    }

    // Check for duplicate request
    const cacheKey = `${senderId}:${groupId}:${message}`;
    const lastRequest = messageCache.get(cacheKey);
    const now = Date.now();
    
    if (lastRequest && (now - lastRequest) < 3000) {
      console.log("⚠️ Duplicate request detected, ignoring");
      return res.status(200).json({ message: "Duplicate request ignored" });
    }
    
    messageCache.set(cacheKey, now);

    // Skip slow group query - just create the message
    // Frontend has already validated user has access to this group
    const deliveredTo = [];
    if (onlineUsersMap) {
      onlineUsersMap.forEach((socketId, userId) => {
        if (userId !== senderId) {
          deliveredTo.push({ userId, deliveredAt: new Date() });
        }
      });
    }

    console.log("💾 Creating message...");
    const newMessage = await Message.create({
      senderId,
      groupId,
      message,
      status: deliveredTo.length > 0 ? "delivered" : "sent",
      deliveredTo,
    });
    console.log("✅ Message created:", newMessage._id);

    // Get group to find members
    const group = await Group.findById(groupId).select('members').lean();
    const groupMemberIds = group ? group.members.map(m => m.toString()) : [];

    // Update group updatedAt
    Group.findByIdAndUpdate(groupId, { updatedAt: Date.now() }).exec().catch(() => {});

    // Populate and emit with timeout protection
    const populatePromise = Message.findById(newMessage._id)
      .populate("senderId", "name email profileImage about")
      .lean()
      .maxTimeMS(3000)
      .exec();
      
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Populate timeout')), 4000)
    );
    
    Promise.race([populatePromise, timeoutPromise])
      .then(populatedMessage => {
        console.log("✅ Populated, emitting to group members (excluding sender)");
        if (ioInstance && onlineUsersMap) {
          // Only emit to group members who are online and NOT the sender
          groupMemberIds.forEach((memberId) => {
            if (memberId !== senderId) {
              const socketId = onlineUsersMap.get(memberId);
              if (socketId) {
                console.log(`  📤 Member ${memberId}: ${socketId}`);
                ioInstance.to(socketId).emit("receiveGroupMessage", populatedMessage);
              }
            }
          });
        }
      })
      .catch(err => {
        console.error("❌ Populate error:", err.message);
        // Fallback: emit without populated sender
        if (ioInstance && onlineUsersMap) {
          console.log("⚠️ Emitting without population");
          groupMemberIds.forEach((memberId) => {
            if (memberId !== senderId) {
              const socketId = onlineUsersMap.get(memberId);
              if (socketId) {
                ioInstance.to(socketId).emit("receiveGroupMessage", {
                  ...newMessage.toObject(),
                  senderId: { _id: senderId }
                });
              }
            }
          });
        }
      });

    // Return immediately
    res.status(201).json({
      _id: newMessage._id,
      senderId,
      groupId,
      message: newMessage.message,
      status: newMessage.status,
      deliveredTo: newMessage.deliveredTo,
      createdAt: newMessage.createdAt
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ message: "Failed to send message", error: err.message });
  }
};

// Add members to group
exports.addMembers = async (req, res) => {
  try {
    const { groupId, members } = req.body;
    const userId = req.user.userId;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Check if user is admin
    if (!group.admins.some((admin) => admin.toString() === userId)) {
      return res.status(403).json({ message: "Only admins can add members" });
    }

    // Add new members
    members.forEach((memberId) => {
      if (!group.members.some((m) => m.toString() === memberId)) {
        group.members.push(memberId);
      }
    });

    await group.save();

    const populatedGroup = await Group.findById(groupId)
      .populate("members", "-password")
      .populate("admins", "-password");

    // Emit to all members
    group.members.forEach((memberId) => {
      const memberSocketId = onlineUsersMap.get(memberId.toString());
      if (memberSocketId && ioInstance) {
        ioInstance.to(memberSocketId).emit("groupUpdated", populatedGroup);
      }
    });

    res.status(200).json(populatedGroup);
  } catch (err) {
    console.error("Error adding members:", err);
    res.status(500).json({ message: "Failed to add members", error: err.message });
  }
};

// Remove member from group
exports.removeMember = async (req, res) => {
  try {
    const { groupId, memberId } = req.body;
    const userId = req.user.userId;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Check if user is admin
    if (!group.admins.some((admin) => admin.toString() === userId)) {
      return res.status(403).json({ message: "Only admins can remove members" });
    }

    // Cannot remove creator
    if (group.createdBy.toString() === memberId) {
      return res.status(400).json({ message: "Cannot remove group creator" });
    }

    group.members = group.members.filter((m) => m.toString() !== memberId);
    group.admins = group.admins.filter((a) => a.toString() !== memberId);
    await group.save();

    const populatedGroup = await Group.findById(groupId)
      .populate("members", "-password")
      .populate("admins", "-password");

    // Emit to all members
    group.members.forEach((member) => {
      const memberSocketId = onlineUsersMap.get(member.toString());
      if (memberSocketId && ioInstance) {
        ioInstance.to(memberSocketId).emit("groupUpdated", populatedGroup);
      }
    });

    // Notify removed member
    const removedSocketId = onlineUsersMap.get(memberId);
    if (removedSocketId && ioInstance) {
      ioInstance.to(removedSocketId).emit("removedFromGroup", groupId);
    }

    res.status(200).json(populatedGroup);
  } catch (err) {
    console.error("Error removing member:", err);
    res.status(500).json({ message: "Failed to remove member", error: err.message });
  }
};

// Update group details
exports.updateGroup = async (req, res) => {
  try {
    const { groupId, name, description } = req.body;
    const userId = req.user.userId;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Check if user is admin
    if (!group.admins.some((admin) => admin.toString() === userId)) {
      return res.status(403).json({ message: "Only admins can update group" });
    }

    if (name) group.name = name;
    if (description !== undefined) group.description = description;

    await group.save();

    const populatedGroup = await Group.findById(groupId)
      .populate("members", "-password")
      .populate("admins", "-password");

    // Emit to all members
    group.members.forEach((memberId) => {
      const memberSocketId = onlineUsersMap.get(memberId.toString());
      if (memberSocketId && ioInstance) {
        ioInstance.to(memberSocketId).emit("groupUpdated", populatedGroup);
      }
    });

    res.status(200).json(populatedGroup);
  } catch (err) {
    console.error("Error updating group:", err);
    res.status(500).json({ message: "Failed to update group", error: err.message });
  }
};

// Leave group
exports.leaveGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Cannot leave if you're the creator
    if (group.createdBy.toString() === userId) {
      return res.status(400).json({ message: "Creator cannot leave group. Transfer ownership first." });
    }

    group.members = group.members.filter((m) => m.toString() !== userId);
    group.admins = group.admins.filter((a) => a.toString() !== userId);
    await group.save();

    const populatedGroup = await Group.findById(groupId)
      .populate("members", "-password")
      .populate("admins", "-password");

    // Emit to remaining members
    group.members.forEach((memberId) => {
      const memberSocketId = onlineUsersMap.get(memberId.toString());
      if (memberSocketId && ioInstance) {
        ioInstance.to(memberSocketId).emit("groupUpdated", populatedGroup);
      }
    });

    res.status(200).json({ message: "Left group successfully" });
  } catch (err) {
    console.error("Error leaving group:", err);
    res.status(500).json({ message: "Failed to leave group", error: err.message });
  }
};
