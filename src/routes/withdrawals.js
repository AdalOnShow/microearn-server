const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get withdrawals
router.get("/", protect, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const db = getDb();
    const query = {};

    // Non-admins only see their own withdrawals
    if (req.user.role !== "Admin") {
      query.user = req.user._id;
    }

    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get withdrawals with user info
    const withdrawals = await db.collection("withdrawals").aggregate([
      { $match: query },
      { $sort: { requestedAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      {
        $addFields: {
          user: {
            $let: {
              vars: { userData: { $arrayElemAt: ["$userInfo", 0] } },
              in: {
                _id: "$$userData._id",
                name: "$$userData.name",
                email: "$$userData.email"
              }
            }
          }
        }
      },
      { $project: { userInfo: 0 } }
    ]).toArray();

    const total = await db.collection("withdrawals").countDocuments(query);

    res.json({
      success: true,
      count: withdrawals.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
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

    // SAFETY CHECK: Validate input types
    if (!amount || !paymentMethod || !paymentDetails) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // SAFETY CHECK: Validate numeric input
    const withdrawalAmount = parseInt(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid withdrawal amount",
      });
    }

    // SAFETY CHECK: Minimum withdrawal validation
    if (withdrawalAmount < 200) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal is 200 coins (10 dollars)",
      });
    }

    // SAFETY CHECK: Get fresh user data to prevent race conditions
    const db = getDb();
    const currentUser = await db.collection("users").findOne({ _id: req.user._id });
    
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // SAFETY CHECK: Validate sufficient balance
    if (currentUser.coin < withdrawalAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient coins",
        availableCoins: currentUser.coin,
        requestedCoins: withdrawalAmount,
      });
    }

    // SAFETY CHECK: Prevent multiple pending withdrawals
    const existingPendingWithdrawal = await db.collection("withdrawals").findOne({
      user: req.user._id,
      status: "pending"
    });

    if (existingPendingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: "You already have a pending withdrawal request. Please wait for admin approval.",
        pendingWithdrawal: {
          amount: existingPendingWithdrawal.withdrawal_coin || existingPendingWithdrawal.amount,
          requestedAt: existingPendingWithdrawal.withdraw_date || existingPendingWithdrawal.requestedAt
        }
      });
    }

    // SAFETY CHECK: Validate payment method
    const validPaymentMethods = ["stripe", "bkash", "rocket", "nagad"];
    if (!validPaymentMethods.includes(paymentMethod.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    // SAFETY CHECK: Validate account number format
    if (!paymentDetails.trim() || paymentDetails.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Invalid account number",
      });
    }

    // DO NOT deduct coins immediately - wait for admin approval
    const newWithdrawal = {
      worker_email: currentUser.email,
      worker_name: currentUser.name,
      withdrawal_coin: withdrawalAmount,
      withdrawal_amount: (withdrawalAmount / 20).toFixed(2), // Convert to USD
      payment_system: paymentMethod.toLowerCase(),
      account_number: paymentDetails.trim(),
      withdraw_date: new Date(),
      status: "pending",
      // Keep original fields for compatibility
      user: req.user._id,
      amount: withdrawalAmount,
      paymentMethod: paymentMethod.toLowerCase(),
      paymentDetails: paymentDetails.trim(),
      adminNote: "",
      requestedAt: new Date(),
      processedAt: null,
    };

    const result = await db.collection("withdrawals").insertOne(newWithdrawal);

    res.status(201).json({
      success: true,
      withdrawal: { ...newWithdrawal, _id: result.insertedId },
      message: "Withdrawal request submitted successfully. Awaiting admin approval."
    });
  } catch (error) {
    console.error("Withdrawal creation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process withdrawal request. Please try again.",
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

    const db = getDb();
    const withdrawal = await db.collection("withdrawals").findOne({ 
      _id: new ObjectId(req.params.id) 
    });

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal not found",
      });
    }

    // Handle coin deduction based on status
    if (status === "approved" && withdrawal.status === "pending") {
      // Deduct coins when approved (not when initially requested)
      await db.collection("users").updateOne(
        { _id: withdrawal.user },
        { $inc: { coin: -withdrawal.amount } }
      );
    } else if (status === "rejected" && withdrawal.status === "approved") {
      // Refund coins if previously approved withdrawal is now rejected
      await db.collection("users").updateOne(
        { _id: withdrawal.user },
        { $inc: { coin: withdrawal.amount } }
      );
    }

    const result = await db.collection("withdrawals").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          status, 
          adminNote: adminNote || "",
          processedAt: new Date()
        } 
      },
      { returnDocument: "after" }
    );

    res.json({
      success: true,
      withdrawal: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
