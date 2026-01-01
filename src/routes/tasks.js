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
    if (buyer) query.buyer = new ObjectId(buyer);

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
      message: error.message,
    });
  }
});

// Get single task
router.get("/:id", async (req, res) => {
  try {
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
      message: error.message,
    });
  }
});

// Create task (Buyer only)
router.post("/", protect, restrictTo("Buyer", "Admin"), async (req, res) => {
  try {
    const { title, description, category, reward, quantity, requirements, submissionInfo, deadline } = req.body;

    // Check if buyer has enough coins
    const totalCost = reward * quantity;
    if (req.user.coin < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. You need ${totalCost} coins but have ${req.user.coin}`,
      });
    }

    const db = getDb();

    // Deduct coins from buyer
    await db.collection("users").updateOne(
      { _id: req.user._id },
      { $inc: { coin: -totalCost } }
    );

    const newTask = {
      title,
      description,
      buyer: req.user._id,
      category,
      reward,
      quantity,
      completedCount: 0,
      requirements: requirements || "",
      submissionInfo: submissionInfo || "",
      deadline: deadline ? new Date(deadline) : null,
      status: "active",
      createdAt: new Date(),
    };

    const result = await db.collection("tasks").insertOne(newTask);

    res.status(201).json({
      success: true,
      task: { ...newTask, _id: result.insertedId },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update task (Owner or Admin)
router.patch("/:id", protect, async (req, res) => {
  try {
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

    // Check ownership
    if (task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this task",
      });
    }

    const allowedUpdates = ["title", "description", "requirements", "submissionInfo", "status", "deadline"];
    const updates = {};

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = field === "deadline" && req.body[field] 
          ? new Date(req.body[field]) 
          : req.body[field];
      }
    });

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
      message: error.message,
    });
  }
});

// Delete task (Owner or Admin)
router.delete("/:id", protect, async (req, res) => {
  try {
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

    // Check ownership
    if (task.buyer.toString() !== req.user._id.toString() && req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this task",
      });
    }

    // Refund remaining coins
    const remainingSlots = task.quantity - task.completedCount;
    const refund = remainingSlots * task.reward;

    if (refund > 0) {
      await db.collection("users").updateOne(
        { _id: task.buyer },
        { $inc: { coin: refund } }
      );
    }

    await db.collection("tasks").deleteOne({ _id: new ObjectId(req.params.id) });

    res.json({
      success: true,
      message: "Task deleted successfully",
      refunded: refund,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
