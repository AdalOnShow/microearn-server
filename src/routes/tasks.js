const express = require("express");
const Task = require("../models/Task");
const User = require("../models/User");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get all tasks (with filters)
router.get("/", async (req, res) => {
  try {
    const { status, category, buyer, page = 1, limit = 10 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (category) query.category = category;
    if (buyer) query.buyer = buyer;

    const tasks = await Task.find(query)
      .populate("buyer", "name email image")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Task.countDocuments(query);

    res.json({
      success: true,
      count: tasks.length,
      total,
      pages: Math.ceil(total / limit),
      tasks,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get single task
router.get("/:id", async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).populate(
      "buyer",
      "name email image"
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    res.json({
      success: true,
      task,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Create task (Buyer only)
router.post("/", protect, restrictTo("Buyer", "Admin"), async (req, res) => {
  try {
    const { title, description, category, reward, quantity, requirements, submissionInfo, deadline } = req.body;

    // Check if buyer has enough coins
    const totalCost = reward * quantity;
    if (req.user.coin < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. You need ${totalCost} coins but have ${req.user.coin}`,
      });
    }

    // Deduct coins from buyer
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { coin: -totalCost },
    });

    const task = await Task.create({
      title,
      description,
      buyer: req.user._id,
      category,
      reward,
      quantity,
      requirements,
      submissionInfo,
      deadline,
    });

    res.status(201).json({
      success: true,
      task,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update task (Owner or Admin)
router.patch("/:id", protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Check ownership
    if (task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this task",
      });
    }

    const allowedUpdates = ["title", "description", "requirements", "submissionInfo", "status", "deadline"];
    const updates = {};

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const updatedTask = await Task.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      task: updatedTask,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Delete task (Owner or Admin)
router.delete("/:id", protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Check ownership
    if (task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this task",
      });
    }

    // Refund remaining coins
    const remainingSlots = task.quantity - task.completedCount;
    const refund = remainingSlots * task.reward;

    if (refund > 0) {
      await User.findByIdAndUpdate(task.buyer, {
        $inc: { coin: refund },
      });
    }

    await Task.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Task deleted successfully",
      refunded: refund,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;