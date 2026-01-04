const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Coin packages - immutable pricing
const COIN_PACKAGES = [
  { id: "pkg_10", coins: 10, price: 1 },
  { id: "pkg_150", coins: 150, price: 10 },
  { id: "pkg_500", coins: 500, price: 20 },
  { id: "pkg_1000", coins: 1000, price: 35 },
];

// Get available packages
router.get("/packages", (req, res) => {
  res.json({
    success: true,
    packages: COIN_PACKAGES,
  });
});

// Process payment (Buyer only)
router.post(
  "/purchase",
  protect,
  restrictTo("Buyer", "Admin"),
  async (req, res) => {
    try {
      const { packageId, paymentMethod = "dummy" } = req.body;

      // Validate required fields
      if (!packageId) {
        return res.status(400).json({
          success: false,
          message: "Package ID is required",
        });
      }

      // SAFETY CHECK: Validate package exists (prevent tampering)
      const coinPackage = COIN_PACKAGES.find((p) => p.id === packageId);
      if (!coinPackage) {
        return res.status(400).json({
          success: false,
          message: "Invalid package selected",
        });
      }

      const db = getDb();

      // Verify user exists
      const user = await db.collection("users").findOne({ _id: req.user._id });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Generate unique transaction ID
      const transactionId = `TXN_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // SAFETY CHECK: Check for duplicate transaction (idempotency)
      const existingPayment = await db.collection("payments").findOne({
        user: req.user._id,
        createdAt: { $gte: new Date(Date.now() - 5000) }, // Within last 5 seconds
        packageId: coinPackage.id,
        status: "completed",
      });

      if (existingPayment) {
        return res.status(400).json({
          success: false,
          message:
            "A similar payment was just processed. Please wait before trying again.",
        });
      }

      // Simulate payment processing
      // In production, integrate with Stripe here
      const paymentSuccess = true; // Dummy payment always succeeds

      if (!paymentSuccess) {
        // Log failed payment attempt
        await db.collection("payments").insertOne({
          user: req.user._id,
          packageId: coinPackage.id,
          coins: coinPackage.coins,
          amount: coinPackage.price,
          currency: "USD",
          paymentMethod,
          status: "failed",
          transactionId,
          createdAt: new Date(),
        });

        return res.status(400).json({
          success: false,
          message: "Payment failed. Please try again.",
        });
      }

      // Create payment record first
      const payment = {
        user: req.user._id,
        packageId: coinPackage.id,
        coins: coinPackage.coins,
        amount: coinPackage.price,
        currency: "USD",
        paymentMethod,
        status: "completed",
        transactionId,
        createdAt: new Date(),
      };

      await db.collection("payments").insertOne(payment);

      // Update user coins (coins can only increase from purchases, no negative check needed)
      await db
        .collection("users")
        .updateOne(
          { _id: req.user._id },
          { $inc: { coin: coinPackage.coins } }
        );

      res.json({
        success: true,
        message: `Successfully purchased ${coinPackage.coins} coins`,
        payment: {
          transactionId: payment.transactionId,
          coins: coinPackage.coins,
          amount: coinPackage.price,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Payment processing failed. Please try again.",
      });
    }
  }
);

// Get payment history (for current user)
router.get("/history", protect, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const db = getDb();

    // Validate pagination params
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    // SAFETY CHECK: Users can only see their own payment history
    const query = { user: req.user._id };

    const payments = await db
      .collection("payments")
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const total = await db.collection("payments").countDocuments(query);

    res.json({
      success: true,
      count: payments.length,
      total,
      pages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      payments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment history. Please try again.",
    });
  }
});

module.exports = router;
