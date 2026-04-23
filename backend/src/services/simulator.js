'use strict';

const EventEmitter = require('events');
const { insertRequest } = require('../database');

// Interval range (ms) between simulated requests.
// Keeps the simulator from running too fast or too slow for demo purposes.
const MIN_REQUEST_DELAY_MS = 200;
const MAX_REQUEST_DELAY_MS = 800;

// Model personality profiles
const MODEL_PROFILES = {
  'llama2-7b': {
    displayName: 'LLaMA2 7B',
    minResponseMs: 800,  maxResponseMs: 2000,
    minTokensIn: 50,     maxTokensIn: 512,
    minTokensOut: 100,   maxTokensOut: 800,
    errorRate: 0.03,
    emoji: '🦙',
  },
  'llama2-13b': {
    displayName: 'LLaMA2 13B',
    minResponseMs: 1500, maxResponseMs: 4000,
    minTokensIn: 80,     maxTokensIn: 600,
    minTokensOut: 150,   maxTokensOut: 1200,
    errorRate: 0.04,
    emoji: '🦙',
  },
  'mistral-7b': {
    displayName: 'Mistral 7B',
    minResponseMs: 400,  maxResponseMs: 1200,
    minTokensIn: 60,     maxTokensIn: 450,
    minTokensOut: 80,    maxTokensOut: 700,
    errorRate: 0.02,
    emoji: '🌪️',
  },
  'codellama-7b': {
    displayName: 'CodeLlama 7B',
    minResponseMs: 600,  maxResponseMs: 1800,
    minTokensIn: 100,    maxTokensIn: 800,
    minTokensOut: 200,   maxTokensOut: 1500,
    errorRate: 0.05,
    emoji: '💻',
  },
  'phi-2': {
    displayName: 'Phi-2',
    minResponseMs: 300,  maxResponseMs: 900,
    minTokensIn: 30,     maxTokensIn: 300,
    minTokensOut: 50,    maxTokensOut: 500,
    errorRate: 0.02,
    emoji: '⚡',
  },
  'gemma-7b': {
    displayName: 'Gemma 7B',
    minResponseMs: 500,  maxResponseMs: 1500,
    minTokensIn: 60,     maxTokensIn: 480,
    minTokensOut: 90,    maxTokensOut: 750,
    errorRate: 0.03,
    emoji: '💎',
  },
  'qwen-7b': {
    displayName: 'Qwen 7B',
    minResponseMs: 400,  maxResponseMs: 1100,
    minTokensIn: 70,     maxTokensIn: 500,
    minTokensOut: 100,   maxTokensOut: 800,
    errorRate: 0.03,
    emoji: '🌏',
  },
  'deepseek-7b': {
    displayName: 'DeepSeek 7B',
    minResponseMs: 600,  maxResponseMs: 1600,
    minTokensIn: 80,     maxTokensIn: 550,
    minTokensOut: 120,   maxTokensOut: 900,
    errorRate: 0.04,
    emoji: '🔍',
  },
};

const MODEL_NAMES = Object.keys(MODEL_PROFILES);

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

class Simulator extends EventEmitter {
  constructor() {
    super();
    this._timer = null;
    this._running = false;
  }

  _simulateOne() {
    const modelName = MODEL_NAMES[Math.floor(Math.random() * MODEL_NAMES.length)];
    const profile = MODEL_PROFILES[modelName];

    const isError = Math.random() < profile.errorRate;
    const responseTime = isError
      ? randInt(50, 300)
      : randInt(profile.minResponseMs, profile.maxResponseMs);

    const tokensIn  = isError ? 0 : randInt(profile.minTokensIn,  profile.maxTokensIn);
    const tokensOut = isError ? 0 : randInt(profile.minTokensOut, profile.maxTokensOut);
    const ttft_ms = isError ? 0 : randInt(100, 400);
    const tpot_ms = (isError || tokensOut === 0) ? 0 : Math.max(1, (responseTime - ttft_ms) / tokensOut);
    const errorMessages = [
      'Rate limit exceeded',
      'Context length exceeded',
      'Out of memory',
      'Model loading timeout',
      'Invalid request format',
    ];

    const record = {
      model_name:       modelName,
      timestamp:        Date.now(),
      response_time_ms: responseTime,
      ttft_ms:          ttft_ms,      // 新增
      tpot_ms:          tpot_ms,      // 新增
      tokens_input:     tokensIn,
      tokens_output:    tokensOut,
      status:           isError ? 'error' : 'success',
      error_message:    isError ? errorMessages[Math.floor(Math.random() * errorMessages.length)] : null,
    };

    try {
      insertRequest(record);
    } catch (err) {
      // Non-fatal: log and continue
      console.error('[Simulator] DB insert error:', err.message);
    }

    this.emit('request_completed', {
      model:        modelName,
      displayName:  profile.displayName,
      emoji:        profile.emoji,
      responseTime,
      ttft:         ttft_ms,            // 新增给前端 Socket 用的数据
      tpot:         tpot_ms.toFixed(1), // 新增
      tokensIn,
      tokensOut,
      status:       record.status,
      errorMessage: record.error_message,
      timestamp:    record.timestamp,
    });

  _scheduleNext() {
    if (!this._running) return;
    const delay = randInt(MIN_REQUEST_DELAY_MS, MAX_REQUEST_DELAY_MS);
    this._timer = setTimeout(() => {
      this._simulateOne();
      this._scheduleNext();
    }, delay);
  }

  start() {
    if (this._running) return;
    this._running = true;
    console.log('[Simulator] Started');
    this._scheduleNext();
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    console.log('[Simulator] Stopped');
  }

  getModelProfiles() {
    return MODEL_PROFILES;
  }
}

module.exports = new Simulator();
