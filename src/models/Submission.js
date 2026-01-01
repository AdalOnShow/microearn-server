const mongoose = require("mongoose");

const submissionSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Task",
    required: true,
  },
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  submissionDetails: {
    type: String,
    required: [true, "Submission details are required"],
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  feedback: {
    type: String,
    default: "",
  },
  rewardPaid: {
    type: Number,
    default: 0,
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  reviewedAt: {
    type: Date,
  },
});

// Prevent duplicate submissions
submissionSchema.index({ task: 1, worker: 1 }, { unique: true });

module.exports = mongoose.model("Submission", submissionSchema);