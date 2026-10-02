/**
 * WebAudioBalance P0 Feasibility Harness
 * Structured logging and environment detection
 */

import { MessageTargets, MessageTypes, createMessage } from './messages.js';

const MAX_LOG_ENTRIES = 200;
const memoryLogs = [];

/**
 * Detect browser environment details (Chrome vs Edge, versions, platform)
 */
export function getBrowserInfo() {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  let version = 'Unknown';

  if (ua.includes('Edg/')) {
    browser = 'Microsoft Edge';
    const match = ua.match(/Edg\/([\d.]+)/);
    if (match) version = match[1];
  } else if (ua.includes('Chrome/')) {
    browser = 'Google Chrome';
    const match = ua.match(/Chrome\/([\d.]+)/);
    if (match) version = match[1];
  }

  return {
    browser,
    version,
    platform: navigator.platform || 'Unknown',
    userAgent: ua
  };
}

export class StructuredLogger {
  constructor(contextName) {
    this.context = contextName;
  }

  log(level, message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      context: this.context,
      level,
      message,
      data: data ? (typeof data === 'object' ? JSON.parse(JSON.stringify(data, getCircularReplacer())) : data) : null
    };

    memoryLogs.push(entry);
    if (memoryLogs.length > MAX_LOG_ENTRIES) {
      memoryLogs.shift();
    }

    const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    consoleFn(`[${entry.timestamp}] [${entry.context}] [${entry.level}] ${message}`, data || '');

    // Attempt broadcast to popup for live UI viewing if available
    try {
      chrome.runtime.sendMessage(createMessage(MessageTypes.LOG_ENTRY, MessageTargets.POPUP, { entry })).catch(() => {});
    } catch (_) {
      // Ignore when no listener is available
    }

    return entry;
  }

  info(msg, data) {
    return this.log('INFO', msg, data);
  }

  warn(msg, data) {
    return this.log('WARN', msg, data);
  }

  error(msg, data) {
    return this.log('ERROR', msg, data);
  }

  debug(msg, data) {
    return this.log('DEBUG', msg, data);
  }
}

export function getStoredLogs() {
  return [...memoryLogs];
}

export function clearStoredLogs() {
  memoryLogs.length = 0;
}

function getCircularReplacer() {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };
}
