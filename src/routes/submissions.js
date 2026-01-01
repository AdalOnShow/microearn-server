const express = require("express");
const Submission = require("../models/Submission");
const Task = require("../models/Task");
const User = require("../models/User");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get submissions (filtered by user role)
router.get("/", protect, async (req, res) => {
  try {
    const { task, status, page = 1, limit = 10 } = req.query;
    const query = {};

    // Workers see their own submissions, Buyers see submissions for their tasks
    if (req.user.role === "Worker") {
      query.worker = req.user._id;
    } else if (req.user.role === "Buyer") {
      const buyerTasks = await Task.find({ buyer: req.user._id }).select("_id");
      query.task = { $in: buyerTasks.map((t) => t._id) };
    }

    if (task) query.task = task;
    if (status) query.status = status;

    const submissions = await Submission.find(query)
      .populate("task", "title reward")
      .populate("worker", "name email image")
      .sort({ submittedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Submission.countDocuments(query);

    res.json({
      success: true,
      count: submissions.length,
      total,
      pages: Math.ceil(total / limit),
      submissions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Create submission (Worker only)
router.post("/", protect, restrictTo("Worker"), async (req, res) => {
  try {
    const { taskId, submissionDetails } = req.body;

    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Task is not active",
      });
    }

    if (task.completedCount >= task.quantity) {
      return res.status(400).json({
        success: false,
        message: "Task has reached maximum submissions",
      });
    }

    // Check for existing submission
    const existingSubmission = await Submission.findOne({
      task: taskId,
      worker: req.user._id,
    });

    if (existingSubmission) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted for this task",
      });
    }

    const submission = await Submission.create({
      task: taskId,
      worker: req.user._id,
      submissionDetails,
    });

    res.status(201).json({
      success: true,
      submission,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Review submission (Buyer - task owner)
router.patch("/:id/review", protect, restrictTo("Buyer", "Admin"), async (req, res) => {
  try {
    const { status, feedback } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be approved or rejected",
      });
    }

    const submission = await Submission.findById(req.params.id).populate("task");

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    // Check if user owns the task
    if (submission.task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to review this submission",
      });
    }

    if (submission.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Submission has already been reviewed",
      });
    }

    submission.status = status;
    submission.feedback = feedback || "";
    submission.reviewedAt = new Date();

    if (status === "approved") {
      // Pay the worker
      submission.rewardPaid = submission.task.reward;
      await User.findByIdAndUpdate(submission.worker, {
        $inc: { coin: submission.task.reward },
      });

      // Update task completed count
      await Task.findByIdAndUpdate(submission.task._id, {
        $inc: { completedCount: 1 },
      });
    }

    await submission.save();

    res.json({
      success: true,
      submission,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;