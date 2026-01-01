const express = require("express");
const Withdrawal = require("../models/Withdrawal");
const User = require("../models/User");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get withdrawals
router.get("/", protect, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = {};

    // Non-admins only see their own withdrawals
    if (req.user.role !== "Admin") {
      query.user = req.user._id;
    }

    if (status) query.status = status;

    const withdrawals = await Withdrawal.find(query)
      .populate("user", "name email")
      .sort({ requestedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Withdrawal.countDocuments(query);

    res.json({
      success: true,
      count: withdrawals.length,
      total,
      pages: Math.ceil(total / limit),
      withdrawals,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Create withdrawal request
router.post("/", protect, async (req, res) => {
  try {
    const { amount, paymentMethod, paymentDetails } = req.body;

    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal is 100 coins",
      });
    }

    if (req.user.coin < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient coins",
      });
    }

    // Deduct coins immediately
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { coin: -amount },
    });

    const withdrawal = await Withdrawal.create({
      user: req.user._id,
      amount,
      paymentMethod,
      paymentDetails,
    });

    res.status(201).json({
      success: true,
      withdrawal,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Process withdrawal (Admin only)
router.patch("/:id", protect, restrictTo("Admin"), async (req, res) => {
  try {
    const { status, adminNote } = req.body;

    if (!["approved", "rejected", "completed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const withdrawal = await Withdrawal.findById(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal not found",
      });
    }

    // If rejected, refund coins
    if (status === "rejected" && withdrawal.status === "pending") {
      await User.findByIdAndUpdate(withdrawal.user, {
        $inc: { coin: withdrawal.amount },
      });
    }

    withdrawal.status = status;
    withdrawal.adminNote = adminNote || "";
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    res.json({
      success: true,
      withdrawal,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;