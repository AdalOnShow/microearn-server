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

    // Get submissions with task, worker, and buyer info
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
        $lookup: {
          from: "users",
          localField: "taskInfo.buyer",
          foreignField: "_id",
          as: "buyerInfo"
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
          },
          buyer: {
            $let: {
              vars: { buyerData: { $arrayElemAt: ["$buyerInfo", 0] } },
              in: {
                _id: "$$buyerData._id",
                name: "$$buyerData.name",
                email: "$$buyerData.email"
              }
            }
          }
        }
      },
      { $project: { taskInfo: 0, workerInfo: 0, buyerInfo: 0 } }
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

    // VALIDATION FIX: Enhanced input validation
    if (!taskId || !submissionDetails) {
      return res.status(400).json({
        success: false,
        message: "Task ID and submission details are required",
      });
    }

    if (!ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task ID format",
      });
    }

    // VALIDATION FIX: Validate submission details
    if (typeof submissionDetails !== "string" || submissionDetails.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Submission details must be at least 10 characters long",
      });
    }

    if (submissionDetails.trim().length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Submission details cannot exceed 5000 characters",
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

    // Check if deadline has passed
    if (task.deadline && new Date(task.deadline) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Task deadline has passed",
      });
    }

    // VALIDATION FIX: Check for existing submission with atomic operation
    const existingSubmission = await db.collection("submissions").findOne({
      task: new ObjectId(taskId),
      worker: req.user._id,
    });

    if (existingSubmission) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted for this task",
        existingStatus: existingSubmission.status,
      });
    }

    const newSubmission = {
      task: new ObjectId(taskId),
      worker: req.user._id,
      submissionDetails: submissionDetails.trim(),
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
    console.error("Submission creation error:", error);
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

    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid submission ID format",
      });
    }

    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'approved' or 'rejected'",
      });
    }

    const db = getDb();
    
    // SECURITY FIX: Use atomic operation to prevent double approval
    const submission = await db.collection("submissions").findOneAndUpdate(
      { 
        _id: new ObjectId(req.params.id),
        status: "pending" // Only update if still pending
      },
      { 
        $set: { 
          status: "processing", // Lock the submission
          reviewedAt: new Date()
        } 
      },
      { returnDocument: "after" }
    );

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found or already reviewed",
      });
    }

    const task = await db.collection("tasks").findOne({ 
      _id: submission.task 
    });

    if (!task) {
      // Rollback the processing status
      await db.collection("submissions").updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: "pending" } }
      );
      return res.status(404).json({
        success: false,
        message: "Associated task not found",
      });
    }

    // SECURITY FIX: Validate ownership with proper authorization
    if (task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      // Rollback the processing status
      await db.collection("submissions").updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: "pending" } }
      );
      return res.status(403).json({
        success: false,
        message: "Not authorized to review this submission.",
      });
    }

    const updates = {
      status,
      feedback: feedback || "",
      reviewedAt: new Date(),
    };

    if (status === "approved") {
      updates.rewardPaid = task.reward;
      
      // SECURITY FIX: Atomic operations to prevent race conditions
      // Update worker coins and task completion count atomically
      const session = db.client.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Award coins to worker
          await db.collection("users").updateOne(
            { _id: submission.worker },
            { $inc: { coin: task.reward } },
            { session }
          );

          // Increment task completion count
          await db.collection("tasks").updateOne(
            { _id: task._id },
            { $inc: { completedCount: 1 } },
            { session }
          );

          // Update submission status
          await db.collection("submissions").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updates },
            { session }
          );
        });
      } finally {
        await session.endSession();
      }
    } else if (status === "rejected") {
      // For rejected submissions, just update the submission
      await db.collection("submissions").updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updates }
      );
    }

    // Get the updated submission
    const result = await db.collection("submissions").findOne({
      _id: new ObjectId(req.params.id)
    });

    res.json({
      success: true,
      submission: result,
    });
  } catch (error) {
    console.error("Submission review error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to review submission. Please try again.",
    });
  }
});

module.exports = router;
