const express = require("express");
const User = require("../models/User");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get all users (Admin only)
router.get("/", protect, restrictTo("Admin"), async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get top workers by coin
router.get("/top-workers", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const workers = await User.find({ role: "Worker" })
      .select("name image coin")
      .sort({ coin: -1 })
      .limit(limit);

    res.json({
      success: true,
      workers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get user by ID
router.get("/:id", protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update user profile
router.patch("/profile", protect, async (req, res) => {
  try {
    const { name, image } = req.body;
    const updates = {};

    if (name) updates.name = name;
    if (image !== undefined) updates.image = image;

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update user role (Admin only)
router.patch("/:id/role", protect, restrictTo("Admin"), async (req, res) => {
  try {
    const { role } = req.body;

    if (!["Worker", "Buyer", "Admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Delete user (Admin only)
router.delete("/:id", protect, restrictTo("Admin"), async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;