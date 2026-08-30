/**
 * MongoDB connection helper
 * Provides a singleton connection to MongoDB using the official driver.
 */
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'blr_metro';

let client = null;
let db = null;

/**
 * Connect to MongoDB and return the database instance.
 * Reuses existing connection if already established.
 */
async function connectDB() {
  if (db) return db;

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`✅ Connected to MongoDB: ${dbName}`);
  return db;
}

/**
 * Get the database instance (must call connectDB first).
 */
function getDB() {
  if (!db) throw new Error('Database not connected. Call connectDB() first.');
  return db;
}

/**
 * Close the MongoDB connection.
 */
async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('🔌 MongoDB connection closed.');
  }
}

module.exports = { connectDB, getDB, closeDB };
