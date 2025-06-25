// src/utils/debugHelper.js
import configService from '../services/configService.js';

class DebugHelper {
  static isDebugEnabled() {
    try {
      const settings = configService.getSettings();
      return settings.debug === true;
    } catch {
      return false;
    }
  }

  static log(message, data = null) {
    if (!this.isDebugEnabled()) return;
    
    const timestamp = new Date().toISOString();
    if (data) {
      console.log(`[DEBUG ${timestamp}] ${message}`, data);
    } else {
      console.log(`[DEBUG ${timestamp}] ${message}`);
    }
  }

  static warn(message, data = null) {
    if (!this.isDebugEnabled()) return;
    
    const timestamp = new Date().toISOString();
    if (data) {
      console.warn(`[DEBUG-WARN ${timestamp}] ${message}`, data);
    } else {
      console.warn(`[DEBUG-WARN ${timestamp}] ${message}`);
    }
  }

  static error(message, error = null) {
    // Error จะแสดงเสมอไม่ว่า debug จะเปิดหรือปิด
    const timestamp = new Date().toISOString();
    if (error) {
      console.error(`[ERROR ${timestamp}] ${message}`, error);
    } else {
      console.error(`[ERROR ${timestamp}] ${message}`);
    }
  }

  static info(message, data = null) {
    // Info จะแสดงเสมอ
    const timestamp = new Date().toISOString();
    if (data) {
      console.log(`[INFO ${timestamp}] ${message}`, data);
    } else {
      console.log(`[INFO ${timestamp}] ${message}`);
    }
  }

  static trace(functionName, data = null) {
    if (!this.isDebugEnabled()) return;
    
    const timestamp = new Date().toISOString();
    if (data) {
      console.log(`[TRACE ${timestamp}] ${functionName}`, data);
    } else {
      console.log(`[TRACE ${timestamp}] Entering ${functionName}`);
    }
  }
}

export default DebugHelper;