const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get all tasks (with filters)
router.get("/", async (req, res) => {
  try {
    const { status, category, buyer, page = 1, limit = 10 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (category) query.category = category;
    if (buyer) {
      // Validate ObjectId format
      if (!ObjectId.isValid(buyer)) {
        return res.status(400).json({
          success: false,
          message: "Invalid buyer ID format",
        });
      }
      query.buyer = new ObjectId(buyer);
    }

    const db = getDb();
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get tasks with buyer info using aggregation
    const tasks = await db.collection("tasks").aggregate([
      { $match: query },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "users",
          localField: "buyer",
          foreignField: "_id",
          as: "buyerInfo"
        }
      },
      {
        $addFields: {
          buyer: {
            $let: {
              vars: { buyerData: { $arrayElemAt: ["$buyerInfo", 0] } },
              in: {
                _id: "$$buyerData._id",
                name: "$$buyerData.name",
                email: "$$buyerData.email",
                image: "$$buyerData.image"
              }
            }
          }
        }
      },
      { $project: { buyerInfo: 0 } }
    ]).toArray();

    const total = await db.collection("tasks").countDocuments(query);

    res.json({
      success: true,
      count: tasks.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      tasks,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch tasks. Please try again.",
    });
  }
});

// Get available tasks for workers
router.get("/available", async (req, res) => {
  try {
    const db = getDb();
    const now = new Date();

    // Find tasks where:
    // - status is active
    // - quantity > completedCount (workers still needed)
    // - deadline hasn't passed (or no deadline)
    const tasks = await db.collection("tasks").aggregate([
      {
        $match: {
          status: "active",
          $expr: { $gt: ["$quantity", "$completedCount"] },
          $or: [
            { deadline: null },
            { deadline: { $gt: now } }
          ]
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "buyer",
          foreignField: "_id",
          as: "buyerInfo"
        }
      },
      {
        $addFields: {
          buyer: {
            $let: {
              vars: { buyerData: { $arrayElemAt: ["$buyerInfo", 0] } },
              in: {
                _id: "$$buyerData._id",
                name: "$$buyerData.name",
                email: "$$buyerData.email",
                image: "$$buyerData.image"
              }
            }
          },
          requiredWorkers: { $subtract: ["$quantity", "$completedCount"] }
        }
      },
      { $project: { buyerInfo: 0 } }
    ]).toArray();

    res.json({
      success: true,
      count: tasks.length,
      tasks,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch available tasks. Please try again.",
    });
  }
});

// Get single task
router.get("/:id", async (req, res) => {
  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task ID format",
      });
    }

    const db = getDb();
    
    const tasks = await db.collection("tasks").aggregate([
      { $match: { _id: new ObjectId(req.params.id) } },
      {
        $lookup: {
          from: "users",
          localField: "buyer",
          foreignField: "_id",
          as: "buyerInfo"
        }
      },
      {
        $addFields: {
          buyer: {
            $let: {
              vars: { buyerData: { $arrayElemAt: ["$buyerInfo", 0] } },
              in: {
                _id: "$$buyerData._id",
                name: "$$buyerData.name",
                email: "$$buyerData.email",
                image: "$$buyerData.image"
              }
            }
          }
        }
      },
      { $project: { buyerInfo: 0 } }
    ]).toArray();

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    res.json({
      success: true,
      task: tasks[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch task. Please try again.",
    });
  }
});

// Create task (Buyer only)
router.post("/", protect, restrictTo("Buyer", "Admin"), async (req, res) => {
  try {
    const { title, description, category, reward, quantity, requirements, submissionInfo, deadline, imageUrl } = req.body;

    // Validate required fields
    if (!title || !description || !reward || !quantity) {
      return res.status(400).json({
        success: false,
        message: "Title, description, reward, and quantity are required",
      });
    }

    // VALIDATION FIX: Validate title and description length
    if (title.trim().length < 3 || title.trim().length > 200) {
      return res.status(400).json({
        success: false,
        message: "Title must be between 3 and 200 characters",
      });
    }

    if (description.trim().length < 10 || description.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Description must be between 10 and 2000 characters",
      });
    }

    // VALIDATION FIX: Validate numeric inputs properly
    const rewardNum = parseInt(reward);
    const quantityNum = parseInt(quantity);

    if (isNaN(rewardNum) || rewardNum <= 0 || rewardNum > 1000) {
      return res.status(400).json({
        success: false,
        message: "Reward must be a positive number between 1 and 1000 coins",
      });
    }

    if (isNaN(quantityNum) || quantityNum <= 0 || quantityNum > 1000) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive number between 1 and 1000",
      });
    }

    // VALIDATION FIX: Prevent task creation with past deadline
    let deadlineDate = null;
    if (deadline) {
      deadlineDate = new Date(deadline);
      const now = new Date();
      
      if (isNaN(deadlineDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid deadline format",
        });
      }

      if (deadlineDate <= now) {
        return res.status(400).json({
          success: false,
          message: "Deadline must be in the future",
        });
      }

      // Ensure deadline is not too far in the future (max 1 year)
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
      
      if (deadlineDate > oneYearFromNow) {
        return res.status(400).json({
          success: false,
          message: "Deadline cannot be more than 1 year in the future",
        });
      }
    }

    const totalCost = rewardNum * quantityNum;

    // Get fresh user data to check current coin balance
    const db = getDb();
    const currentUser = await db.collection("users").findOne({ _id: req.user._id });

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // SAFETY CHECK: Prevent negative coin balance
    if (currentUser.coin < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. You need ${totalCost} coins but have ${currentUser.coin}`,
        insufficientCoins: true,
        required: totalCost,
        available: currentUser.coin,
      });
    }

    // SAFETY CHECK: Use atomic operation to prevent race conditions
    const updateResult = await db.collection("users").updateOne(
      { 
        _id: req.user._id,
        coin: { $gte: totalCost } // Only deduct if sufficient balance
      },
      { $inc: { coin: -totalCost } }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Insufficient coins or balance changed. Please try again.",
        insufficientCoins: true,
      });
    }

    const newTask = {
      title: title.trim(),
      description: description.trim(),
      buyer: req.user._id,
      category: category ? category.trim() : "",
      reward: rewardNum,
      quantity: quantityNum,
      completedCount: 0,
      requirements: requirements ? requirements.trim() : "",
      submissionInfo: submissionInfo ? submissionInfo.trim() : "",
      imageUrl: imageUrl ? imageUrl.trim() : "",
      deadline: deadlineDate,
      status: "active",
      createdAt: new Date(),
    };

    const result = await db.collection("tasks").insertOne(newTask);

    res.status(201).json({
      success: true,
      task: { ...newTask, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Task creation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create task. Please try again.",
    });
  }
});

// Update task (Owner or Admin)
router.patch("/:id", protect, async (req, res) => {
  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task ID format",
      });
    }

    const db = getDb();
    const task = await db.collection("tasks").findOne({ 
      _id: new ObjectId(req.params.id) 
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // SAFETY CHECK: Validate ownership - buyer can only update their own tasks
    if (task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this task. You can only update your own tasks.",
      });
    }

    // SAFETY CHECK: Prevent update if task is completed
    if (task.completedCount >= task.quantity) {
      return res.status(400).json({
        success: false,
        message: "Cannot update a completed task",
      });
    }

    // Only allow specific fields to be updated
    const allowedUpdates = ["title", "description", "submissionInfo"];
    const updates = {};

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update. Allowed fields: title, description, submissionInfo",
      });
    }

    const result = await db.collection("tasks").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updates },
      { returnDocument: "after" }
    );

    res.json({
      success: true,
      task: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update task. Please try again.",
    });
  }
});

// Delete task (Owner or Admin)
router.delete("/:id", protect, async (req, res) => {
  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task ID format",
      });
    }

    const db = getDb();
    const task = await db.collection("tasks").findOne({ 
      _id: new ObjectId(req.params.id) 
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // SAFETY CHECK: Validate ownership - buyer can only delete their own tasks, admin can delete any
    if (task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this task. You can only delete your own tasks.",
      });
    }

    // For regular buyers (non-admin), prevent delete if task is completed
    if (req.user.role !== "Admin" && task.completedCount >= task.quantity) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a completed task",
      });
    }

    // Admin override: Do NOT refund coins (as per requirement)
    if (req.user.role === "Admin") {
      // Delete the task without refunding
      await db.collection("tasks").deleteOne({ _id: new ObjectId(req.params.id) });

      // Delete all related submissions (both pending and completed)
      const deletedSubmissions = await db.collection("submissions").deleteMany({ 
        task: new ObjectId(req.params.id)
      });

      res.json({
        success: true,
        message: "Task deleted successfully (admin override)",
        deletedSubmissions: deletedSubmissions.deletedCount,
        refunded: 0, // No refund for admin deletion
      });
    } else {
      // Regular buyer deletion logic (with refund)
      const remainingSlots = task.quantity - task.completedCount;
      const refund = remainingSlots * task.reward;

      // Refund coins to buyer
      if (refund > 0) {
        await db.collection("users").updateOne(
          { _id: task.buyer },
          { $inc: { coin: refund } }
        );
      }

      // Delete the task
      await db.collection("tasks").deleteOne({ _id: new ObjectId(req.params.id) });

      // Delete only pending submissions for regular deletion
      const deletedSubmissions = await db.collection("submissions").deleteMany({ 
        task: new ObjectId(req.params.id),
        status: "pending"
      });

      res.json({
        success: true,
        message: "Task deleted successfully",
        deletedSubmissions: deletedSubmissions.deletedCount,
        refunded: refund,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete task. Please try again.",
    });
  }
});

module.exports = router;
