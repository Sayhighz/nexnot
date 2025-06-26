// src/utils/debugHelper.js
const logService = require('../services/logService');

class DebugHelper {
  static isDebugEnabled() {
    return process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';
  }

  static log(message, data = null) {
    if (!this.isDebugEnabled()) return;
    logService.debug(message, data);
  }

  static warn(message, data = null) {
    logService.warn(message, data);
  }

  static error(message, error = null) {
    logService.error(message, error);
  }

  static info(message, data = null) {
    logService.info(message, data);
  }

  static trace(functionName, data = null) {
    if (!this.isDebugEnabled()) return;
    logService.debug(`TRACE: ${functionName}`, data);
  }

  // Production safe logging
  static production(level, message, data = null) {
    logService.silentLog(level, message, data);
  }
}

module.exports = DebugHelper;