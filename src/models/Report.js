const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  reportedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  reportedTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Task",
  },
  reportedSubmission: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Submission",
  },
  type: {
    type: String,
    enum: ["user", "task", "submission", "other"],
    required: [true, "Report type is required"],
  },
  reason: {
    type: String,
    required: [true, "Reason is required"],
  },
  description: {
    type: String,
    required: [true, "Description is required"],
  },
  status: {
    type: String,
    enum: ["pending", "reviewed", "resolved", "dismissed"],
    default: "pending",
  },
  adminResponse: {
    type: String,
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  resolvedAt: {
    type: Date,
  },
});

module.exports = mongoose.model("Report", reportSchema);