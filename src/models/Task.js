const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, "Title is required"],
    trim: true,
  },
  description: {
    type: String,
    required: [true, "Description is required"],
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  category: {
    type: String,
    required: [true, "Category is required"],
  },
  reward: {
    type: Number,
    required: [true, "Reward is required"],
    min: [1, "Reward must be at least 1 coin"],
  },
  quantity: {
    type: Number,
    required: [true, "Quantity is required"],
    min: [1, "Quantity must be at least 1"],
  },
  completedCount: {
    type: Number,
    default: 0,
  },
  requirements: {
    type: String,
    default: "",
  },
  submissionInfo: {
    type: String,
    default: "",
  },
  deadline: {
    type: Date,
  },
  status: {
    type: String,
    enum: ["active", "paused", "completed", "cancelled"],
    default: "active",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Task", taskSchema);