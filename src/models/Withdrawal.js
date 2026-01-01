const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  amount: {
    type: Number,
    required: [true, "Amount is required"],
    min: [1, "Minimum withdrawal is 1 coin"],
  },
  paymentMethod: {
    type: String,
    enum: ["paypal", "bank", "crypto"],
    required: [true, "Payment method is required"],
  },
  paymentDetails: {
    type: String,
    required: [true, "Payment details are required"],
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "completed"],
    default: "pending",
  },
  adminNote: {
    type: String,
    default: "",
  },
  requestedAt: {
    type: Date,
    default: Date.now,
  },
  processedAt: {
    type: Date,
  },
});

module.exports = mongoose.model("Withdrawal", withdrawalSchema);