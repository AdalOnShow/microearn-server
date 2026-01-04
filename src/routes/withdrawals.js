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

    // VALIDATION FIX: Enhanced input validation
    if (!amount || !paymentMethod || !paymentDetails) {
      return res.status(400).json({
        success: false,
        message: "Amount, payment method, and payment details are required",
      });
    }

    // VALIDATION FIX: Validate numeric input properly
    const withdrawalAmount = parseInt(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid withdrawal amount. Must be a positive number.",
      });
    }

    // VALIDATION FIX: Enhanced minimum/maximum validation
    if (withdrawalAmount < 200) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal is 200 coins ($10)",
      });
    }

    if (withdrawalAmount > 10000) {
      return res.status(400).json({
        success: false,
        message: "Maximum withdrawal is 10,000 coins ($500) per request",
      });
    }

    // VALIDATION FIX: Validate payment method
    const validPaymentMethods = ["stripe", "bkash", "rocket", "nagad"];
    if (!validPaymentMethods.includes(paymentMethod.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method. Must be one of: " + validPaymentMethods.join(", "),
      });
    }

    // VALIDATION FIX: Enhanced payment details validation
    const cleanPaymentDetails = paymentDetails.trim();
    if (cleanPaymentDetails.length < 3 || cleanPaymentDetails.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Payment details must be between 3 and 100 characters",
      });
    }

    // VALIDATION FIX: Basic format validation for payment details
    if (!/^[a-zA-Z0-9@._-]+$/.test(cleanPaymentDetails)) {
      return res.status(400).json({
        success: false,
        message: "Payment details contain invalid characters. Only letters, numbers, @, ., _, and - are allowed",
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

    // DO NOT deduct coins immediately - wait for admin approval
    const newWithdrawal = {
      worker_email: currentUser.email,
      worker_name: currentUser.name,
      withdrawal_coin: withdrawalAmount,
      withdrawal_amount: (withdrawalAmount / 20).toFixed(2), // Convert to USD
      payment_system: paymentMethod.toLowerCase(),
      account_number: cleanPaymentDetails,
      withdraw_date: new Date(),
      status: "pending",
      // Keep original fields for compatibility
      user: req.user._id,
      amount: withdrawalAmount,
      paymentMethod: paymentMethod.toLowerCase(),
      paymentDetails: cleanPaymentDetails,
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
        message: "Invalid status. Must be 'approved', 'rejected', or 'completed'",
      });
    }

    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid withdrawal ID format",
      });
    }

    const db = getDb();
    
    // ADMIN FIX: Get current withdrawal to check status
    const currentWithdrawal = await db.collection("withdrawals").findOne({
      _id: new ObjectId(req.params.id)
    });

    if (!currentWithdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal not found",
      });
    }

    // ADMIN FIX: Prevent processing already processed withdrawals
    if (currentWithdrawal.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Withdrawal has already been ${currentWithdrawal.status}. Cannot process again.`,
        currentStatus: currentWithdrawal.status,
      });
    }

    // ADMIN FIX: Handle approval vs rejection logic
    if (status === "approved") {
      // Get fresh user data to check current balance
      const user = await db.collection("users").findOne({ _id: currentWithdrawal.user });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // SECURITY FIX: Atomic coin deduction with balance check
      const coinDeductionResult = await db.collection("users").updateOne(
        { 
          _id: currentWithdrawal.user,
          coin: { $gte: currentWithdrawal.amount } // Only deduct if sufficient balance
        },
        { $inc: { coin: -currentWithdrawal.amount } }
      );

      if (coinDeductionResult.modifiedCount === 0) {
        return res.status(400).json({
          success: false,
          message: "Insufficient coins for withdrawal",
          availableCoins: user.coin,
          requestedCoins: currentWithdrawal.amount,
        });
      }
    }
    // ADMIN FIX: For rejection, do NOT deduct coins (coins remain with worker)

    // Update withdrawal with final status
    const result = await db.collection("withdrawals").findOneAndUpdate(
      { 
        _id: new ObjectId(req.params.id),
        status: "pending" // Double-check it's still pending
      },
      { 
        $set: { 
          status, 
          adminNote: adminNote || "",
          processedAt: new Date()
        } 
      },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(400).json({
        success: false,
        message: "Withdrawal was already processed by another admin",
      });
    }

    res.json({
      success: true,
      withdrawal: result,
      message: status === "approved" 
        ? `Withdrawal approved. ${currentWithdrawal.amount} coins deducted from worker.`
        : status === "rejected"
        ? `Withdrawal rejected. Worker keeps their ${currentWithdrawal.amount} coins.`
        : "Withdrawal status updated successfully",
    });
  } catch (error) {
    console.error("Withdrawal processing error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process withdrawal. Please try again.",
    });
  }
});

module.exports = router;
