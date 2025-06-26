// src/utils/helpers.js
const fs = require('fs').promises;
const path = require('path');

class Helpers {
  static async loadConfig() {
    try {
      const configPath = path.join(__dirname, '../../config/config.json');
      const configData = await fs.readFile(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      throw new Error('Cannot load configuration file');
    }
  }

  static async reloadConfig() {
    return await this.loadConfig();
  }

  static validateSteam64(steam64) {
    // Steam64 ID should be 17 digits and start with 7656119
    const steam64Pattern = /^7656119\d{10}$/;
    return steam64Pattern.test(steam64);
  }

  static formatCurrency(amount) {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB'
    }).format(amount);
  }

  static formatDateTime(date) {
    return new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Bangkok'
    }).format(date);
  }

  static generateTicketId() {
    return Math.random().toString(36).substr(2, 9).toUpperCase();
  }

  static async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static sanitizeInput(input) {
    return input.replace(/[<>@#&!]/g, '').trim();
  }

  static async ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  static async cleanupTempFiles(maxAge = 3600000) { // 1 hour
    try {
      const tempDir = path.join(__dirname, '../../temp');
      const files = await fs.readdir(tempDir);
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        
        if (Date.now() - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      // Silent fail for cleanup
    }
  }

  static chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  static async retry(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          await this.sleep(delay);
          delay *= 2; // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }
}

module.exports = Helpers;