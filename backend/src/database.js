'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/watch.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS models (
    name        TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    category    TEXT
  );

  CREATE TABLE IF NOT EXISTS requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name       TEXT NOT NULL,
    timestamp        INTEGER NOT NULL,
    response_time_ms INTEGER,
    ttft_ms          INTEGER,   /* 新增：首字延迟 */
    tpot_ms          REAL,      /* 新增：单Token延迟 */
    tokens_input     INTEGER,
    tokens_output    INTEGER,
    status           TEXT NOT NULL DEFAULT 'success',
    error_message    TEXT,
    FOREIGN KEY (model_name) REFERENCES models(name)
  );

  CREATE INDEX IF NOT EXISTS idx_requests_model_ts ON requests(model_name, timestamp);
  CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(timestamp);
`);

// Seed model definitions
const seedModels = db.prepare(`
  INSERT OR IGNORE INTO models (name, display_name, description, category)
  VALUES (?, ?, ?, ?)
`);

const modelSeeds = [
  ['llama2-7b',    'LLaMA2 7B',     'Meta 通用对话模型，7B 参数',        'chat'],
  ['llama2-13b',   'LLaMA2 13B',    'Meta 通用对话模型，13B 参数',       'chat'],
  ['mistral-7b',   'Mistral 7B',    'Mistral AI 快速推理模型',            'chat'],
  ['codellama-7b', 'CodeLlama 7B',  'Meta 代码生成专用模型',              'code'],
  ['phi-2',        'Phi-2',         'Microsoft 轻量高效小模型',           'chat'],
  ['gemma-7b',     'Gemma 7B',      'Google DeepMind 开源模型',           'chat'],
  ['qwen-7b',      'Qwen 7B',       '阿里云通义千问多语言模型',           'multilingual'],
  ['deepseek-7b',  'DeepSeek 7B',   'DeepSeek 深度推理模型',              'chat'],
];

const seedTx = db.transaction(() => {
  for (const seed of modelSeeds) seedModels.run(...seed);
});
seedTx();

// ─── Prepared Statements ─────────────────────────────────────────────────────

const stmtInsertRequest = db.prepare(`
  INSERT INTO requests (model_name, timestamp, response_time_ms, ttft_ms, tpot_ms, tokens_input, tokens_output, status, error_message)
  VALUES (@model_name, @timestamp, @response_time_ms, @ttft_ms, @tpot_ms, @tokens_input, @tokens_output, @status, @error_message)
`);

const stmtGetAllModels = db.prepare(`SELECT * FROM models ORDER BY name`);

const stmtGetModelStats = db.prepare(`
  SELECT
    model_name,
    COUNT(*)                                        AS total_requests,
    AVG(response_time_ms)                           AS avg_response_time,
    AVG(ttft_ms)                                    AS avg_ttft,     /* 新增 */
    AVG(tpot_ms)                                    AS avg_tpot,     /* 新增 */
    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
    SUM(tokens_input)                               AS total_tokens_in,
    SUM(tokens_output)                              AS total_tokens_out
  FROM requests
  WHERE model_name = @model_name
    AND timestamp  >= @since
`);

const stmtGetRecentRequests = db.prepare(`
  SELECT id, model_name, timestamp, response_time_ms, tokens_input, tokens_output, status, error_message
  FROM requests
  WHERE model_name = @model_name
  ORDER BY timestamp DESC
  LIMIT @limit
`);

const stmtGetGlobalStats = db.prepare(`
  SELECT
    COUNT(*)                                          AS total_requests,
    AVG(response_time_ms)                             AS avg_response_time,
    AVG(ttft_ms)                                      AS avg_ttft,   /* 新增 */
    AVG(tpot_ms)                                      AS avg_tpot,   /* 新增 */
    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
    SUM(tokens_input)                                 AS total_tokens_in,
    SUM(tokens_output)                                AS total_tokens_out
  FROM requests
  WHERE timestamp >= @since
`);

const stmtGetPercentile = db.prepare(`
  SELECT response_time_ms
  FROM requests
  WHERE model_name = @model_name
    AND timestamp  >= @since
    AND status = 'success'
  ORDER BY response_time_ms
`);

const stmtGetRequestsPerMinute = db.prepare(`
  SELECT
    (timestamp / 60000) * 60000 AS minute_bucket,
    COUNT(*) AS count
  FROM requests
  WHERE model_name = @model_name
    AND timestamp  >= @since
  GROUP BY minute_bucket
  ORDER BY minute_bucket ASC
`);

const stmtGetAllModelStatsRange = db.prepare(`
  SELECT
    model_name,
    COUNT(*)                                          AS total_requests,
    AVG(response_time_ms)                             AS avg_response_time,
    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
    SUM(tokens_input)                                 AS total_tokens_in,
    SUM(tokens_output)                                AS total_tokens_out,
    AVG(ttft_ms)                                      AS avg_ttft,
    AVG(tpot_ms)                                      AS avg_tpot
  FROM requests
  WHERE timestamp >= @since
  GROUP BY model_name
`);

// ─── Helper Functions ─────────────────────────────────────────────────────────

function insertRequest(data) {
  return stmtInsertRequest.run({
    model_name:       data.model_name,
    timestamp:        data.timestamp || Date.now(),
    response_time_ms: data.response_time_ms,
    ttft_ms:          data.ttft_ms || 0,        // 新增入库映射
    tpot_ms:          data.tpot_ms || 0.0,      // 新增入库映射
    tokens_input:     data.tokens_input,
    tokens_output:    data.tokens_output,
    status:           data.status || 'success',
    error_message:    data.error_message || null,
  });
}

function getAllModels() {
  return stmtGetAllModels.all();
}

function getModelStats(modelName, windowMs = 60 * 1000) {
  const since = Date.now() - windowMs;
  return stmtGetModelStats.get({ model_name: modelName, since });
}

function getRecentRequests(modelName, limit = 100) {
  return stmtGetRecentRequests.all({ model_name: modelName, limit });
}

function getAggregatedMetrics(windowMs = 60 * 1000) {
  const since = Date.now() - windowMs;
  const global = stmtGetGlobalStats.get({ since });
  const perModel = stmtGetAllModelStatsRange.all({ since });
  return { global, perModel };
}

function getPerModelDetailedStats(modelName, windowMs = 60 * 1000) {
  const since = Date.now() - windowMs;
  const stats = stmtGetModelStats.get({ model_name: modelName, since });
  if (!stats || stats.total_requests === 0) return stats;

  // Calculate P95 latency
  const rows = stmtGetPercentile.all({ model_name: modelName, since });
  let p95 = null;
  if (rows.length > 0) {
    const idx = Math.ceil(rows.length * 0.95) - 1;
    p95 = rows[Math.min(idx, rows.length - 1)].response_time_ms;
  }

  const rpmRows = stmtGetRequestsPerMinute.all({ model_name: modelName, since: Date.now() - 10 * 60 * 1000 });

  return {
    ...stats,
    p95_response_time: p95,
    error_rate: stats.total_requests > 0 ? (stats.error_count / stats.total_requests) * 100 : 0,
    requests_per_minute: stats.total_requests / (windowMs / 60000),
    tokens_per_minute: (stats.total_tokens_in + stats.total_tokens_out) / (windowMs / 60000),
    rpm_history: rpmRows,
  };
}

module.exports = {
  db,
  insertRequest,
  getAllModels,
  getModelStats,
  getRecentRequests,
  getAggregatedMetrics,
  getPerModelDetailedStats,
};
