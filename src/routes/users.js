const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get all users (Admin only)
router.get("/", protect, restrictTo("Admin"), async (req, res) => {
  try {
    const db = getDb();
    const users = await db.collection("users")
      .find({}, { projection: { password: 0 } })
      .toArray();

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
    const db = getDb();
    
    const workers = await db.collection("users")
      .find(
        { role: "Worker" },
        { projection: { name: 1, image: 1, coin: 1 } }
      )
      .sort({ coin: -1 })
      .limit(limit)
      .toArray();

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
    const db = getDb();
    const user = await db.collection("users").findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: { password: 0 } }
    );

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

    const db = getDb();
    const result = await db.collection("users").findOneAndUpdate(
      { _id: req.user._id },
      { $set: updates },
      { returnDocument: "after", projection: { password: 0 } }
    );

    res.json({
      success: true,
      user: result,
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

    const db = getDb();
    const result = await db.collection("users").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { role } },
      { returnDocument: "after", projection: { password: 0 } }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user: result,
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
    const db = getDb();
    const result = await db.collection("users").deleteOne({ 
      _id: new ObjectId(req.params.id) 
    });

    if (result.deletedCount === 0) {
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
