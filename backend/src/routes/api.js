'use strict';

const express = require('express');
const router  = express.Router();

const {
  getAllModels,
  getModelStats,
  getRecentRequests,
  getAggregatedMetrics,
  getPerModelDetailedStats,
  insertRequest,
} = require('../database');

const alertManager = require('../services/alertManager');
const simulator    = require('../services/simulator');

// GET /api/models
router.get('/models', (req, res) => {
  const models = getAllModels();
  const profiles = simulator.getModelProfiles();
  const windowMs = 60 * 1000;

  const result = models.map(m => {
    const stats = getModelStats(m.name, windowMs) || {};
    const totalReq = stats.total_requests || 0;
    const errCount = stats.error_count    || 0;
    const avgResp  = stats.avg_response_time || 0;

    const profile = profiles[m.name] || {};
    let health = 'healthy';
    if (totalReq > 0) {
      const errorRate = errCount / totalReq;
      if (errorRate > 0.1 || avgResp > 3000) health = 'degraded';
      if (errorRate > 0.2) health = 'unhealthy';
    }

    return {
      ...m,
      emoji: profile.emoji || '🤖',
      stats: {
        total_requests:    totalReq,
        error_count:       errCount,
        avg_response_time: Math.round(avgResp),
        avg_ttft:          Math.round(stats.avg_ttft || 0),        // 新增
        avg_tpot:          +(stats.avg_tpot || 0).toFixed(1),      // 新增
        error_rate:        totalReq > 0 ? +((errCount / totalReq) * 100).toFixed(2) : 0,
        requests_per_min:  +(totalReq / (windowMs / 60000)).toFixed(2),
        total_tokens_in:   stats.total_tokens_in  || 0,
        total_tokens_out:  stats.total_tokens_out || 0,
      },
      health,
    };
  });

  res.json({ models: result, timestamp: Date.now() });
});

// GET /api/metrics
router.get('/metrics', (req, res) => {
  const windowMs = parseInt(req.query.window, 10) || 60 * 1000;
  const { global: g, perModel } = getAggregatedMetrics(windowMs);

  const totalReq = g.total_requests  || 0;
  const errCount = g.error_count     || 0;

  res.json({
    total_requests:    totalReq,
    avg_response_time: g.avg_response_time ? Math.round(g.avg_response_time) : 0,
    error_rate:        totalReq > 0 ? +((errCount / totalReq) * 100).toFixed(2) : 0,
    total_tokens_in:   g.total_tokens_in  || 0,
    total_tokens_out:  g.total_tokens_out || 0,
    active_models:     perModel.filter(m => m.total_requests > 0).length,
    window_ms:         windowMs,
    timestamp:         Date.now(),
  });
});

// GET /api/metrics/:modelName
router.get('/metrics/:modelName', (req, res) => {
  const { modelName } = req.params;
  const windowMs = parseInt(req.query.window, 10) || 60 * 1000;
  const stats = getPerModelDetailedStats(modelName, windowMs);

  if (!stats) {
    return res.status(404).json({ error: `Model '${modelName}' not found` });
  }

  res.json({
    model_name:        modelName,
    total_requests:    stats.total_requests    || 0,
    avg_response_time: stats.avg_response_time ? Math.round(stats.avg_response_time) : 0,
    p95_response_time: stats.p95_response_time || 0,
    error_rate:        +(stats.error_rate || 0).toFixed(2),
    requests_per_min:  +(stats.requests_per_minute || 0).toFixed(2),
    tokens_per_min:    +(stats.tokens_per_minute   || 0).toFixed(2),
    total_tokens_in:   stats.total_tokens_in  || 0,
    total_tokens_out:  stats.total_tokens_out || 0,
    rpm_history:       stats.rpm_history || [],
    window_ms:         windowMs,
    timestamp:         Date.now(),
  });
});

// GET /api/history/:modelName
router.get('/history/:modelName', (req, res) => {
  const { modelName } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = getRecentRequests(modelName, limit);
  res.json({ model_name: modelName, requests: rows, count: rows.length });
});

// GET /api/alerts
router.get('/alerts', (req, res) => {
  res.json({ alerts: alertManager.getActiveAlerts(), timestamp: Date.now() });
});

// POST /api/simulate  { model?: string }
router.post('/simulate', (req, res) => {
  const profiles = simulator.getModelProfiles();
  const names = Object.keys(profiles);
  const modelName = req.body.model && profiles[req.body.model]
    ? req.body.model
    : names[Math.floor(Math.random() * names.length)];

  const profile = profiles[modelName];
  const isError = Math.random() < profile.errorRate;

  function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

  const record = {
    model_name:       modelName,
    timestamp:        Date.now(),
    response_time_ms: isError ? randInt(50, 300) : randInt(profile.minResponseMs, profile.maxResponseMs),
    tokens_input:     isError ? 0 : randInt(profile.minTokensIn,  profile.maxTokensIn),
    tokens_output:    isError ? 0 : randInt(profile.minTokensOut, profile.maxTokensOut),
    status:           isError ? 'error' : 'success',
    error_message:    isError ? 'Manual simulation error' : null,
  };

  insertRequest(record);
  res.json({ message: 'Simulation triggered', record });
});

module.exports = router;
