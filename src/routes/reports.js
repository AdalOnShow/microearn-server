const express = require("express");
const Report = require("../models/Report");
const { protect, restrictTo } = require("../middleware/auth");

const router = express.Router();

// Get reports
router.get("/", protect, async (req, res) => {
  try {
    const { status, type, page = 1, limit = 10 } = req.query;
    const query = {};

    // Non-admins only see their own reports
    if (req.user.role !== "Admin") {
      query.reporter = req.user._id;
    }

    if (status) query.status = status;
    if (type) query.type = type;

    const reports = await Report.find(query)
      .populate("reporter", "name email")
      .populate("reportedUser", "name email")
      .populate("reportedTask", "title")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Report.countDocuments(query);

    res.json({
      success: true,
      count: reports.length,
      total,
      pages: Math.ceil(total / limit),
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

    const report = await Report.create({
      reporter: req.user._id,
      type,
      reason,
      description,
      reportedUser,
      reportedTask,
      reportedSubmission,
    });

    res.status(201).json({
      success: true,
      report,
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

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      {
        status,
        adminResponse: adminResponse || "",
        resolvedAt: ["resolved", "dismissed"].includes(status) ? new Date() : undefined,
      },
      { new: true }
    );

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;