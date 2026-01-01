require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const adminEmail = "admin@microearn.com";
    
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      console.log("Admin user already exists");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash("admin123456", 12);

    await User.create({
      name: "Admin",
      email: adminEmail,
      password: hashedPassword,
      role: "Admin",
      coin: 0,
      provider: "credentials",
    });

    console.log("Admin user created successfully");
    console.log("Email: admin@microearn.com");
    console.log("Password: admin123456");
    
    process.exit(0);
  } catch (error) {
    console.error("Error seeding admin:", error);
    process.exit(1);
  }
};

seedAdmin();