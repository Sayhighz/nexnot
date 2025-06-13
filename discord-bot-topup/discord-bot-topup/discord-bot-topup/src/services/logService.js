import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class LogService {
  constructor() {
    this.logDir = path.join(__dirname, '../../logs');
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
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    const logString = JSON.stringify(logEntry) + '\n';
    const dateStr = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `${dateStr}.log`);

    try {
      await fs.appendFile(logFile, logString);
    } catch (error) {
      console.error('❌ Error writing to log file:', error);
    }

    // Also log to console
    const consoleMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    if (data) {
      console.log(consoleMessage, data);
    } else {
      console.log(consoleMessage);
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
    const logData = {
      event,
      userId,
      ...data
    };

    await this.info(`Topup Event: ${event}`, logData);
  }

  async logSlipVerification(userId, result, data = {}) {
    const logData = {
      userId,
      result,
      ...data
    };

    if (result === 'success') {
      await this.info('Slip verification successful', logData);
    } else {
      await this.warn('Slip verification failed', logData);
    }
  }

  async logRconCommand(command, result, data = {}) {
    const logData = {
      command,
      result,
      ...data
    };

    if (result === 'success') {
      await this.info('RCON command executed', logData);
    } else {
      await this.error('RCON command failed', logData);
    }
  }

  async cleanupOldLogs(daysToKeep = 30) {
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
            console.log(`🗑️ Deleted old log file: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error cleaning up old logs:', error);
    }
  }
}

export default new LogService();