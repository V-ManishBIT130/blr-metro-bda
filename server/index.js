/**
 * Bengaluru Metro Analytics — Express Server
 * =============================================
 * Serves the REST API and static frontend files.
 * 
 * API Routes:
 *   /api/stations         — Station data & stats
 *   /api/routes           — Route search (from→to)
 *   /api/analytics        — Dashboard analytics
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const { connectDB } = require('./db');
const stationsRouter = require('./routes/stations');
const routesRouter = require('./routes/routes');
const analyticsRouter = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/stations', stationsRouter);
app.use('/api/routes', routesRouter);
app.use('/api/analytics', analyticsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
async function start() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`\n🚀 Server running at http://localhost:${PORT}`);
      console.log(`   📊 API:       http://localhost:${PORT}/api/stations`);
      console.log(`   🗺️  Frontend:  http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
