const { MongoClient } = require("mongodb");

let db = null;
let client = null;

const connectDB = async () => {
  try {
    // SECURITY FIX: Ensure MONGODB_URI is set
    if (!process.env.MONGODB_URI) {
      console.error("CRITICAL: MONGODB_URI environment variable is not set");
      process.exit(1);
    }

    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db();
    console.log(`MongoDB Connected: ${client.options.hosts[0]}`);
    
    // Create indexes for better performance
    await createIndexes();
    
    return db;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

const createIndexes = async () => {
  try {
    // Users collection indexes
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    
    // Submissions collection indexes
    await db.collection("submissions").createIndex(
      { task: 1, worker: 1 }, 
      { unique: true }
    );
    
    // Tasks collection indexes
    await db.collection("tasks").createIndex({ buyer: 1 });
    await db.collection("tasks").createIndex({ status: 1 });
    
    console.log("Database indexes created");
  } catch (error) {
    // Indexes might already exist, that's okay
    if (error.code !== 85) {
      console.error("Error creating indexes:", error.message);
    }
  }
};

const getDb = () => {
  if (!db) {
    throw new Error("Database not initialized. Call connectDB first.");
  }
  return db;
};

const getClient = () => {
  if (!client) {
    throw new Error("Client not initialized. Call connectDB first.");
  }
  return client;
};

module.exports = { connectDB, getDb, getClient };
