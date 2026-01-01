const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get submissions (filtered by user role)
router.get("/", protect, async (req, res) => {
  try {
    const { task, status, page = 1, limit = 10 } = req.query;
    const db = getDb();
    const query = {};

    // Workers see their own submissions, Buyers see submissions for their tasks
    if (req.user.role === "Worker") {
      query.worker = req.user._id;
    } else if (req.user.role === "Buyer") {
      const buyerTasks = await db.collection("tasks")
        .find({ buyer: req.user._id }, { projection: { _id: 1 } })
        .toArray();
      query.task = { $in: buyerTasks.map((t) => t._id) };
    }

    if (task) {
      // Validate ObjectId format
      if (!ObjectId.isValid(task)) {
        return res.status(400).json({
          success: false,
          message: "Invalid task ID format",
        });
      }
      query.task = new ObjectId(task);
    }
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get submissions with task and worker info
    const submissions = await db.collection("submissions").aggregate([
      { $match: query },
      { $sort: { submittedAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "tasks",
          localField: "task",
          foreignField: "_id",
          as: "taskInfo"
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "worker",
          foreignField: "_id",
          as: "workerInfo"
        }
      },
      {
        $addFields: {
          task: {
            $let: {
              vars: { taskData: { $arrayElemAt: ["$taskInfo", 0] } },
              in: {
                _id: "$$taskData._id",
                title: "$$taskData.title",
                reward: "$$taskData.reward"
              }
            }
          },
          worker: {
            $let: {
              vars: { workerData: { $arrayElemAt: ["$workerInfo", 0] } },
              in: {
                _id: "$$workerData._id",
                name: "$$workerData.name",
                email: "$$workerData.email",
                image: "$$workerData.image"
              }
            }
          }
        }
      },
      { $project: { taskInfo: 0, workerInfo: 0 } }
    ]).toArray();

    const total = await db.collection("submissions").countDocuments(query);

    res.json({
      success: true,
      count: submissions.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      submissions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch submissions. Please try again.",
    });
  }
});

// Create submission (Worker only)
router.post("/", protect, restrictTo("Worker"), async (req, res) => {
  try {
    const { taskId, submissionDetails } = req.body;

    // Validate required fields
    if (!taskId || !submissionDetails) {
      return res.status(400).json({
        success: false,
        message: "Task ID and submission details are required",
      });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task ID format",
      });
    }

    const db = getDb();

    const task = await db.collection("tasks").findOne({ 
      _id: new ObjectId(taskId) 
    });

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
    const existingSubmission = await db.collection("submissions").findOne({
      task: new ObjectId(taskId),
      worker: req.user._id,
    });

    if (existingSubmission) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted for this task",
      });
    }

    const newSubmission = {
      task: new ObjectId(taskId),
      worker: req.user._id,
      submissionDetails,
      status: "pending",
      feedback: "",
      rewardPaid: 0,
      submittedAt: new Date(),
      reviewedAt: null,
    };

    const result = await db.collection("submissions").insertOne(newSubmission);

    res.status(201).json({
      success: true,
      submission: { ...newSubmission, _id: result.insertedId },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create submission. Please try again.",
    });
  }
});

// Review submission (Buyer - task owner)
router.patch("/:id/review", protect, restrictTo("Buyer", "Admin"), async (req, res) => {
  try {
    const { status, feedback } = req.body;

    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid submission ID format",
      });
    }

    // Validate status
    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'approved' or 'rejected'",
      });
    }

    const db = getDb();
    
    // Use findOne to get current state before any updates
    const submission = await db.collection("submissions").findOne({ 
      _id: new ObjectId(req.params.id) 
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    // SAFETY CHECK: Prevent double approval/rejection
    if (submission.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Submission has already been ${submission.status}. Cannot review again.`,
      });
    }

    const task = await db.collection("tasks").findOne({ 
      _id: submission.task 
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Associated task not found",
      });
    }

    // SAFETY CHECK: Validate ownership - buyer can only review their own tasks
    if (task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to review this submission. You can only review submissions for your own tasks.",
      });
    }

    const updates = {
      status,
      feedback: feedback || "",
      reviewedAt: new Date(),
    };

    if (status === "approved") {
      // Pay the worker
      updates.rewardPaid = task.reward;
      
      // Update worker coins
      await db.collection("users").updateOne(
        { _id: submission.worker },
        { $inc: { coin: task.reward } }
      );

      // Update task completed count
      await db.collection("tasks").updateOne(
        { _id: task._id },
        { $inc: { completedCount: 1 } }
      );
    } else if (status === "rejected") {
      // Increase quantity by 1 to allow another worker to take the slot
      await db.collection("tasks").updateOne(
        { _id: task._id },
        { $inc: { quantity: 1 } }
      );
    }

    // Use findOneAndUpdate with condition to prevent race conditions
    const result = await db.collection("submissions").findOneAndUpdate(
      { 
        _id: new ObjectId(req.params.id),
        status: "pending" // Only update if still pending
      },
      { $set: updates },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(400).json({
        success: false,
        message: "Submission was already reviewed by another process",
      });
    }

    res.json({
      success: true,
      submission: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to review submission. Please try again.",
    });
  }
});

module.exports = router;
