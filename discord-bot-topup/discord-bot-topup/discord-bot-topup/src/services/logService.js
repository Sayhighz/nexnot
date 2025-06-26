// src/services/logService.js
const fs = require('fs').promises;
const path = require('path');

class LogService {
  constructor() {
    this.logDir = path.join(__dirname, '../../logs');
    this.maxLogSizeMB = 10;
    this.maxLogFiles = 30;
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.enableConsole = process.env.NODE_ENV === 'development';
    this.initLogDirectory();
  }

  async initLogDirectory() {
    try {
      await fs.access(this.logDir);
    } catch {
      await fs.mkdir(this.logDir, { recursive: true });
    }
  }

  async writeLog(level, message, data = null) {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      data,
      pid: process.pid,
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    };

    const logString = JSON.stringify(logEntry) + '\n';
    
    // Write to file
    await this.writeToFile(logString, level);
    
    // Write to console only in development or for errors
    if (this.enableConsole || level === 'error') {
      const consoleMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
      if (data && level === 'error') {
        console.error(consoleMessage, data);
      } else if (this.enableConsole) {
        console.log(consoleMessage);
      }
    }
  }

  shouldLog(level) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    return levels[level] <= levels[this.logLevel];
  }

  async writeToFile(logString, level) {
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logDir, `${dateStr}-${level}.log`);
      
      // Check file size and rotate if needed
      await this.rotateLogIfNeeded(logFile);
      await fs.appendFile(logFile, logString);
    } catch (error) {
      // Fallback to console if file writing fails
      if (this.enableConsole) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  async rotateLogIfNeeded(logFile) {
    try {
      const stats = await fs.stat(logFile);
      const maxSize = this.maxLogSizeMB * 1024 * 1024;
      
      if (stats.size > maxSize) {
        const rotatedFile = logFile.replace('.log', `-${Date.now()}.log`);
        await fs.rename(logFile, rotatedFile);
      }
    } catch (error) {
      // File doesn't exist yet, which is fine
    }
  }

  info(message, data = null) {
    return this.writeLog('info', message, data);
  }

  warn(message, data = null) {
    return this.writeLog('warn', message, data);
  }

  error(message, data = null) {
    return this.writeLog('error', message, data);
  }

  debug(message, data = null) {
    return this.writeLog('debug', message, data);
  }

  async logTopupEvent(event, userId, data = {}) {
    const logData = { event, userId, ...data };
    await this.info(`Topup Event: ${event}`, logData);
  }

  async logSlipVerification(userId, result, data = {}) {
    const logData = { userId, result, ...data };
    
    if (result === 'success') {
      await this.info('Slip verification successful', logData);
    } else {
      await this.warn('Slip verification failed', logData);
    }
  }

  async logRconCommand(command, result, data = {}) {
    const logData = { command, result, ...data };
    
    if (result === 'success') {
      await this.info('RCON command executed', logData);
    } else {
      await this.error('RCON command failed', logData);
    }
  }

  async cleanupOldLogs(daysToKeep = this.maxLogFiles) {
    try {
      const files = await fs.readdir(this.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(this.logDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime < cutoffDate) {
            await fs.unlink(filePath);
            await this.info(`Deleted old log file: ${file}`);
          }
        }
      }
    } catch (error) {
      await this.error('Error cleaning up old logs:', error);
    }
  }

  // Silent logging for production (no console output)
  silentLog(level, message, data = null) {
    const originalEnableConsole = this.enableConsole;
    this.enableConsole = false;
    this.writeLog(level, message, data);
    this.enableConsole = originalEnableConsole;
  }
}

module.exports = new LogService();