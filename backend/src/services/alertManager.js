'use strict';

const EventEmitter = require('events');
const { getAggregatedMetrics, getModelStats } = require('../database');

const CHECK_INTERVAL_MS = 10000; // Check every 10 seconds
const WINDOW_MS = 60 * 1000;     // 1-minute rolling window

const THRESHOLDS = {
  ERROR_RATE_PCT:    10,   // > 10% errors → alert
  SLOW_RESPONSE_MS:  3000, // > 3000ms avg → alert
  SPIKE_MULTIPLIER:  2.5,  // > 2.5× baseline requests → alert
};

class AlertManager extends EventEmitter {
  constructor() {
    super();
    this._activeAlerts = new Map(); // key: `${modelName}:${type}`
    this._timer = null;
    this._running = false;
    this._baselineRpm = new Map(); // model → baseline requests/min
  }

  _alertKey(modelName, type) {
    return `${modelName}:${type}`;
  }

  _createAlert(modelName, type, severity, message, value) {
    const key = this._alertKey(modelName, type);
    if (this._activeAlerts.has(key)) return; // deduplicate

    const alert = {
      id:        `${key}:${Date.now()}`,
      modelName,
      type,
      severity,
      message,
      value,
      createdAt: Date.now(),
    };

    this._activeAlerts.set(key, alert);
    console.log(`[AlertManager] ALERT CREATED: ${message}`);
    this.emit('alert_created', alert);
  }

  _resolveAlert(modelName, type) {
    const key = this._alertKey(modelName, type);
    if (!this._activeAlerts.has(key)) return;

    const alert = this._activeAlerts.get(key);
    this._activeAlerts.delete(key);
    console.log(`[AlertManager] ALERT RESOLVED: ${alert.message}`);
    this.emit('alert_resolved', { ...alert, resolvedAt: Date.now() });
  }

  _checkModel(modelName, stats) {
    if (!stats || stats.total_requests === 0) return;

    const errorRate = (stats.error_count / stats.total_requests) * 100;
    const avgResponse = stats.avg_response_time || 0;
    const rpm = stats.total_requests / (WINDOW_MS / 60000);

    // ── Error rate check ──────────────────────────────────────
    if (errorRate > THRESHOLDS.ERROR_RATE_PCT) {
      this._createAlert(
        modelName, 'high_error_rate', 'error',
        `${modelName} 错误率过高: ${errorRate.toFixed(1)}%`,
        errorRate
      );
    } else {
      this._resolveAlert(modelName, 'high_error_rate');
    }

    // ── Slow response check ───────────────────────────────────
    if (avgResponse > THRESHOLDS.SLOW_RESPONSE_MS) {
      this._createAlert(
        modelName, 'slow_response', 'warning',
        `${modelName} 响应时间过慢: ${Math.round(avgResponse)}ms`,
        avgResponse
      );
    } else {
      this._resolveAlert(modelName, 'slow_response');
    }

    // ── Traffic spike check ───────────────────────────────────
    const baseline = this._baselineRpm.get(modelName);
    if (baseline && rpm > baseline * THRESHOLDS.SPIKE_MULTIPLIER) {
      this._createAlert(
        modelName, 'traffic_spike', 'warning',
        `${modelName} 流量突增: ${rpm.toFixed(1)} req/min (基线: ${baseline.toFixed(1)})`,
        rpm
      );
    } else {
      this._resolveAlert(modelName, 'traffic_spike');
    }

    // Update rolling baseline (exponential moving average)
    const alpha = 0.1;
    const prev = this._baselineRpm.get(modelName) || rpm;
    this._baselineRpm.set(modelName, alpha * rpm + (1 - alpha) * prev);
  }

  async _check() {
    try {
      const { perModel } = getAggregatedMetrics(WINDOW_MS);
      for (const stats of perModel) {
        this._checkModel(stats.model_name, stats);
      }
    } catch (err) {
      console.error('[AlertManager] Check error:', err.message);
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._timer = setInterval(() => this._check(), CHECK_INTERVAL_MS);
    console.log('[AlertManager] Started');
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[AlertManager] Stopped');
  }

  getActiveAlerts() {
    return Array.from(this._activeAlerts.values());
  }
}

module.exports = new AlertManager();
