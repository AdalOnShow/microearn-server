const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../config/db");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get reports
router.get("/", protect, async (req, res) => {
  try {
    const { status, type, page = 1, limit = 10 } = req.query;
    const db = getDb();
    const query = {};

    // Non-admins only see their own reports
    if (req.user.role !== "Admin") {
      query.reporter = req.user._id;
    }

    if (status) query.status = status;
    if (type) query.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get reports with related info
    const reports = await db.collection("reports").aggregate([
      { $match: query },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "users",
          localField: "reporter",
          foreignField: "_id",
          as: "reporterInfo"
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "reportedUser",
          foreignField: "_id",
          as: "reportedUserInfo"
        }
      },
      {
        $lookup: {
          from: "tasks",
          localField: "reportedTask",
          foreignField: "_id",
          as: "reportedTaskInfo"
        }
      },
      {
        $addFields: {
          reporter: {
            $let: {
              vars: { data: { $arrayElemAt: ["$reporterInfo", 0] } },
              in: {
                _id: "$$data._id",
                name: "$$data.name",
                email: "$$data.email"
              }
            }
          },
          reportedUser: {
            $cond: {
              if: { $gt: [{ $size: "$reportedUserInfo" }, 0] },
              then: {
                $let: {
                  vars: { data: { $arrayElemAt: ["$reportedUserInfo", 0] } },
                  in: {
                    _id: "$$data._id",
                    name: "$$data.name",
                    email: "$$data.email"
                  }
                }
              },
              else: null
            }
          },
          reportedTask: {
            $cond: {
              if: { $gt: [{ $size: "$reportedTaskInfo" }, 0] },
              then: {
                $let: {
                  vars: { data: { $arrayElemAt: ["$reportedTaskInfo", 0] } },
                  in: {
                    _id: "$$data._id",
                    title: "$$data.title"
                  }
                }
              },
              else: null
            }
          }
        }
      },
      { $project: { reporterInfo: 0, reportedUserInfo: 0, reportedTaskInfo: 0 } }
    ]).toArray();

    const total = await db.collection("reports").countDocuments(query);

    res.json({
      success: true,
      count: reports.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      reports,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Create report
router.post("/", protect, async (req, res) => {
  try {
    const { type, reason, description, reportedUser, reportedTask, reportedSubmission } = req.body;
    const db = getDb();

    const newReport = {
      reporter: req.user._id,
      type,
      reason,
      description,
      reportedUser: reportedUser ? new ObjectId(reportedUser) : null,
      reportedTask: reportedTask ? new ObjectId(reportedTask) : null,
      reportedSubmission: reportedSubmission ? new ObjectId(reportedSubmission) : null,
      status: "pending",
      adminResponse: "",
      createdAt: new Date(),
      resolvedAt: null,
    };

    const result = await db.collection("reports").insertOne(newReport);

    res.status(201).json({
      success: true,
      report: { ...newReport, _id: result.insertedId },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update report status (Admin only)
router.patch("/:id", protect, restrictTo("Admin"), async (req, res) => {
  try {
    const { status, adminResponse } = req.body;

    if (!["reviewed", "resolved", "dismissed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const db = getDb();
    const updates = {
      status,
      adminResponse: adminResponse || "",
    };

    if (["resolved", "dismissed"].includes(status)) {
      updates.resolvedAt = new Date();
    }

    const result = await db.collection("reports").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updates },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    res.json({
      success: true,
      report: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
