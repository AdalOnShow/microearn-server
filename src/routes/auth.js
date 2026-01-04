const express = require("express");
const bcrypt = require("bcryptjs");
const { getDb } = require("../config/db");
const { generateToken, protect } = require("../middleware/auth");

const router = express.Router();

// Register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, image, role } = req.body;

    // VALIDATION FIX: Enhanced input validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and role are required",
      });
    }

    // VALIDATION FIX: Validate name
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Name must be between 2 and 50 characters",
      });
    }

    if (!/^[a-zA-Z\s'-]+$/.test(cleanName)) {
      return res.status(400).json({
        success: false,
        message: "Name can only contain letters, spaces, hyphens, and apostrophes",
      });
    }

    // VALIDATION FIX: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.toLowerCase().trim();
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // VALIDATION FIX: Enhanced password validation
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password cannot exceed 128 characters",
      });
    }

    // VALIDATION FIX: Validate role
    if (!["Worker", "Buyer"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be either 'Worker' or 'Buyer'",
      });
    }

    const db = getDb();
    
    const existingUser = await db.collection("users").findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Set coins based on role (only on first registration)
    const coin = role === "Worker" ? 10 : 50;

    const newUser = {
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      image: image ? image.trim() : "",
      role,
      coin,
      provider: "credentials",
      createdAt: new Date(),
    };

    const result = await db.collection("users").insertOne(newUser);
    const token = generateToken(result.insertedId.toString());

    res.status(201).json({
      success: true,
      token,
      user: {
        id: result.insertedId,
        name: newUser.name,
        email: newUser.email,
        image: newUser.image,
        role: newUser.role,
        coin: newUser.coin,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // VALIDATION FIX: Enhanced input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // VALIDATION FIX: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.toLowerCase().trim();
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // VALIDATION FIX: Basic password validation
    if (typeof password !== "string" || password.length < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid password",
      });
    }

    const db = getDb();
    const user = await db.collection("users").findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (user.provider === "google") {
      return res.status(401).json({
        success: false,
        message: "Please login with Google",
      });
    }

    if (!user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = generateToken(user._id.toString());

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        coin: user.coin,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
});

// Google OAuth - create or get user
router.post("/google", async (req, res) => {
  try {
    const { name, email, image } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const db = getDb();
    let user = await db.collection("users").findOne({ email: email.toLowerCase() });

    if (!user) {
      // Create new user with default Worker role
      const newUser = {
        name,
        email: email.toLowerCase(),
        image,
        role: "Worker",
        coin: 10,
        provider: "google",
        createdAt: new Date(),
      };

      const result = await db.collection("users").insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    }

    const token = generateToken(user._id.toString());

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        coin: user.coin,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get current user
router.get("/me", protect, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      image: req.user.image,
      role: req.user.role,
      coin: req.user.coin,
      createdAt: req.user.createdAt,
    },
  });
});

module.exports = router;
