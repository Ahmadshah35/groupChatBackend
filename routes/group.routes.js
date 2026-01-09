const express = require("express");
const router = express.Router();
const groupController = require("../controllers/group.controller");
const { auth } = require("../middleware/auth.middleware");

// All routes require authentication
router.use(auth);

// Create group
router.post("/create", groupController.createGroup);

// Get all groups for user
router.get("/", groupController.getGroups);

// Get group details
router.get("/:groupId", groupController.getGroupDetails);

// Get group messages
router.get("/:groupId/messages", groupController.getGroupMessages);

// Send group message
router.post("/message", groupController.sendGroupMessage);

// Add members
router.post("/add-members", groupController.addMembers);

// Remove member
router.post("/remove-member", groupController.removeMember);

// Update group
router.put("/update", groupController.updateGroup);

// Leave group
router.post("/:groupId/leave", groupController.leaveGroup);

module.exports = router;
