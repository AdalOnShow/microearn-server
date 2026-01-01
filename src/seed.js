require("dotenv").config();
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

const seedAdmin = async () => {
  let client;
  
  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db();
    
    console.log("Connected to MongoDB");

    const adminEmail = "admin@microearn.com";
    
    const existingAdmin = await db.collection("users").findOne({ email: adminEmail });
    
    if (existingAdmin) {
      console.log("Admin user already exists");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash("admin123456", 12);

    await db.collection("users").insertOne({
      name: "Admin",
      email: adminEmail,
      password: hashedPassword,
      image: "",
      role: "Admin",
      coin: 0,
      provider: "credentials",
      createdAt: new Date(),
    });

    console.log("Admin user created successfully");
    console.log("Email: admin@microearn.com");
    console.log("Password: admin123456");
    
    process.exit(0);
  } catch (error) {
    console.error("Error seeding admin:", error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
};

seedAdmin();
