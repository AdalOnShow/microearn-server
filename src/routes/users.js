const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get all users (Admin only)
router.get("/", protect, restrictTo("Admin"), async (req, res) => {
  try {
    const db = getDb();
    const users = await db
      .collection("users")
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
      message: "Failed to fetch users. Please try again.",
    });
  }
});

// Get worker stats - SAFETY: Only returns stats for the authenticated worker
router.get(
  "/worker/stats",
  protect,
  restrictTo("Worker", "Admin"),
  async (req, res) => {
    try {
      const db = getDb();
      // SAFETY CHECK: Always use authenticated user's ID
      const workerId = req.user._id;

      // Total submissions count
      const totalSubmissions = await db
        .collection("submissions")
        .countDocuments({ worker: workerId });

      // Pending submissions count
      const pendingSubmissions = await db
        .collection("submissions")
        .countDocuments({ worker: workerId, status: "pending" });

      // Total earnings (sum of rewardPaid where status = approved)
      const earningsResult = await db
        .collection("submissions")
        .aggregate([
          { $match: { worker: workerId, status: "approved" } },
          { $group: { _id: null, total: { $sum: "$rewardPaid" } } },
        ])
        .toArray();

      const totalEarnings = earningsResult[0]?.total || 0;

      res.json({
        success: true,
        stats: {
          totalSubmissions,
          pendingSubmissions,
          totalEarnings,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch stats. Please try again.",
      });
    }
  }
);

// Get buyer stats - SAFETY: Only returns stats for the authenticated buyer
router.get(
  "/buyer/stats",
  protect,
  restrictTo("Buyer", "Admin"),
  async (req, res) => {
    try {
      const db = getDb();
      // SAFETY CHECK: Always use authenticated user's ID, never from query params
      const buyerId = req.user._id;

      // Get all tasks by this buyer only
      const tasks = await db
        .collection("tasks")
        .find({ buyer: buyerId })
        .toArray();

      const totalTasks = tasks.length;

      // Pending tasks = sum of remaining workers needed (quantity - completedCount)
      const pendingTasks = tasks.reduce((sum, task) => {
        const remaining = (task.quantity || 0) - (task.completedCount || 0);
        return sum + Math.max(0, remaining); // Ensure non-negative
      }, 0);

      // Total payment paid = sum of (reward * completedCount) for all tasks
      const totalPaymentPaid = tasks.reduce((sum, task) => {
        return sum + (task.reward || 0) * (task.completedCount || 0);
      }, 0);

      res.json({
        success: true,
        stats: {
          totalTasks,
          pendingTasks,
          totalPaymentPaid,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch stats. Please try again.",
      });
    }
  }
);

// Get top workers by coin
router.get("/top-workers", async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 6));
    const db = getDb();

    const workers = await db
      .collection("users")
      .find({ role: "Worker" }, { projection: { name: 1, image: 1, coin: 1 } })
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
      message: "Failed to fetch workers. Please try again.",
    });
  }
});

// Get user by ID
router.get("/:id", protect, async (req, res) => {
  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const db = getDb();
    const user = await db
      .collection("users")
      .findOne(
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
      message: "Failed to fetch user. Please try again.",
    });
  }
});

// Update user profile - SAFETY: Users can only update their own profile
router.patch("/profile", protect, async (req, res) => {
  try {
    const { name, image } = req.body;
    const updates = {};

    // Only allow specific fields
    if (name && typeof name === "string" && name.trim().length > 0) {
      updates.name = name.trim();
    }
    if (image !== undefined) {
      updates.image = image;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    const db = getDb();
    // SAFETY CHECK: Always use authenticated user's ID
    const result = await db
      .collection("users")
      .findOneAndUpdate(
        { _id: req.user._id },
        { $set: updates },
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
      message: "Failed to update profile. Please try again.",
    });
  }
});

// Update user role (Admin only)
router.patch("/:id/role", protect, restrictTo("Admin"), async (req, res) => {
  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const { role } = req.body;

    if (!role || !["Worker", "Buyer", "Admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be Worker, Buyer, or Admin",
      });
    }

    // SAFETY CHECK: Prevent admin from changing their own role
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot change your own role",
      });
    }

    const db = getDb();
    const result = await db
      .collection("users")
      .findOneAndUpdate(
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
      message: "Failed to update role. Please try again.",
    });
  }
});

// Delete user (Admin only)
router.delete("/:id", protect, restrictTo("Admin"), async (req, res) => {
  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // SAFETY CHECK: Prevent admin from deleting themselves
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete your own account",
      });
    }

    const db = getDb();
    const result = await db.collection("users").deleteOne({
      _id: new ObjectId(req.params.id),
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
      message: "Failed to delete user. Please try again.",
    });
  }
});

module.exports = router;
