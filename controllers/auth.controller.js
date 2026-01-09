const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

let ioInstance;
let onlineUsersMap;

// Setter for io and users map
exports.setIoAndUsers = (io, onlineUsers) => {
  ioInstance = io;
  onlineUsersMap = onlineUsers;
};

// Signup
exports.signup = async (req, res) => {
  try {
    const { name, email, password, about } = req.body;
    const profileImage = req.file ? `/uploads/profiles/${req.file.filename}` : "";

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser)
      return res.status(400).json({ message: "User already exists" });

    // Reduced from 8 to 6 rounds for faster hashing
    const hashedPassword = await bcrypt.hash(password, 6);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      profileImage,
      about: about || "Hey there! I am using Ahmad's ChatApp.",
    });

    // Get user without password to broadcast
    const newUser = await User.findById(user._id).select("-password").lean();

    // Broadcast new user to all online users
    if (ioInstance && onlineUsersMap) {
      onlineUsersMap.forEach((socketId) => {
        ioInstance.to(socketId).emit("newUser", newUser);
      });
    }

    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Find user with indexed email field
    const user = await User.findOne({ email })
      .select('+password')
      .lean()
      .maxTimeMS(3000); // Max 3 seconds for query
    
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Verify password - this is the bottleneck, so we minimize other operations
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate token immediately (don't wait for DB update)
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Update online status asynchronously (fire and forget)
    setImmediate(() => {
      User.findByIdAndUpdate(user._id, { 
        isOnline: true, 
        lastSeen: new Date() 
      }).exec().catch(() => {});
    });

    // Return response immediately
    res.json({ 
      token, 
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage,
        about: user.about,
        lastSeen: new Date(),
        isOnline: true,
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error during login", error: err.message });
  }
};

// Get all users
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId } })
      .select("-password")
      .lean()
      .sort({ isOnline: -1, lastSeen: -1 }); // Online users first

    res.json(users);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get User
exports.getUser = async (req, res) => {
  const userId = req.user.userId;
  try {
    const user = await User.findById(userId).select("-password"); // exclude password
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, about } = req.body;
    const profileImage = req.file ? `/uploads/profiles/${req.file.filename}` : undefined;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name;
    if (about !== undefined) user.about = about;
    if (profileImage) user.profileImage = profileImage;

    await user.save();

    const userResponse = await User.findById(userId).select("-password");
    res.status(200).json(userResponse);
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
