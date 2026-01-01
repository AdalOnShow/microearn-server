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

    const db = getDb();

    // Deduct coins immediately
    await db.collection("users").updateOne(
      { _id: req.user._id },
      { $inc: { coin: -amount } }
    );

    const newWithdrawal = {
      user: req.user._id,
      amount,
      paymentMethod,
      paymentDetails,
      status: "pending",
      adminNote: "",
      requestedAt: new Date(),
      processedAt: null,
    };

    const result = await db.collection("withdrawals").insertOne(newWithdrawal);

    res.status(201).json({
      success: true,
      withdrawal: { ...newWithdrawal, _id: result.insertedId },
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

    // If rejected, refund coins
    if (status === "rejected" && withdrawal.status === "pending") {
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
