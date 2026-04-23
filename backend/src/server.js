'use strict';

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');

const apiRouter    = require('./routes/api');
const simulator    = require('./services/simulator');
const alertManager = require('./services/alertManager');
const { getAggregatedMetrics, getAllModels, getModelStats } = require('./database');

const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// In production the frontend is served from the same origin, so CORS is not needed.
// In development, restrict to localhost only (no wildcard).
const DEV_ORIGINS = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(',').map(s => s.trim())
  : [`http://localhost:3000`, `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];

const corsOptions = {
  origin: isProduction ? false : DEV_ORIGINS,
  methods: ['GET', 'POST'],
};

// ─── App Setup ────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: corsOptions });

app.use(cors(corsOptions));
app.use(express.json());

// Serve static frontend in production
if (isProduction) {
  app.use(express.static(path.join(__dirname, '../../frontend')));
}

app.use('/api', apiRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Send current state on connect
  try {
    const { global: g, perModel } = getAggregatedMetrics(60 * 1000);
    const models = getAllModels();
    socket.emit('init', { global: g, perModel, models });
  } catch (err) {
    console.error('[Socket.IO] Init error:', err.message);
  }

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// Forward simulator events to all connected clients
simulator.on('request_completed', payload => {
  io.emit('request_completed', payload);
});

// Broadcast full metrics every 5 seconds
setInterval(() => {
  try {
    const windowMs = 60 * 1000;
    const { global: g, perModel } = getAggregatedMetrics(windowMs);

    const profiles = simulator.getModelProfiles();
    const models = getAllModels();

    const modelMetrics = models.map(m => {
      const stats = perModel.find(p => p.model_name === m.name) || {};
      const profile = profiles[m.name] || {};
      const totalReq = stats.total_requests || 0;
      const errCount = stats.error_count    || 0;
      const avgResp  = stats.avg_response_time || 0;

      let health = 'healthy';
      if (totalReq > 0) {
        const errorRate = errCount / totalReq;
        if (errorRate > 0.1 || avgResp > 3000) health = 'degraded';
        if (errorRate > 0.2) health = 'unhealthy';
      }

      return {
        name:        m.name,
        displayName: m.display_name,
        emoji:       profile.emoji || '🤖',
        category:    m.category,
        health,
        stats: {
          total_requests:    totalReq,
          error_count:       errCount,
          avg_response_time: Math.round(avgResp),
          error_rate:        totalReq > 0 ? +((errCount / totalReq) * 100).toFixed(2) : 0,
          requests_per_min:  +(totalReq / (windowMs / 60000)).toFixed(2),
          total_tokens_in:   stats.total_tokens_in  || 0,
          total_tokens_out:  stats.total_tokens_out || 0,
          avg_ttft:          Math.round(stats.avg_ttft || 0),
          avg_tpot:          +(stats.avg_tpot || 0).toFixed(1),
        },
      };

    const totalReq = g.total_requests || 0;
    const errCount = g.error_count    || 0;

    io.emit('metrics_update', {
      global: {
        total_requests:    totalReq,
        avg_response_time: g.avg_response_time ? Math.round(g.avg_response_time) : 0,
        error_rate:        totalReq > 0 ? +((errCount / totalReq) * 100).toFixed(2) : 0,
        total_tokens_in:   g.total_tokens_in  || 0,
        total_tokens_out:  g.total_tokens_out || 0,
        active_models:     modelMetrics.filter(m => m.stats.total_requests > 0).length,
      },
      models: modelMetrics,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[Metrics] Broadcast error:', err.message);
  }
}, 5000);

// Forward alert events
alertManager.on('alert_created',  alert => io.emit('alert_created',  alert));
alertManager.on('alert_resolved', alert => io.emit('alert_resolved', alert));

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[Server] Watch-System backend running on http://localhost:${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);

  simulator.start();
  alertManager.start();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  simulator.stop();
  alertManager.stop();
  server.close(() => {
    console.log('[Server] Gracefully shut down');
    process.exit(0);
  });
});

module.exports = { app, server, io };
