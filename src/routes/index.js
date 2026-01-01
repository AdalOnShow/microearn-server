const express = require("express");
const authRoutes = require("./auth");
const userRoutes = require("./users");
const taskRoutes = require("./tasks");
const submissionRoutes = require("./submissions");
const withdrawalRoutes = require("./withdrawals");
const reportRoutes = require("./reports");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/tasks", taskRoutes);
router.use("/submissions", submissionRoutes);
router.use("/withdrawals", withdrawalRoutes);
router.use("/reports", reportRoutes);

module.exports = router;