// src/services/configService.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ConfigService {
  constructor() {
    this.config = null;
    this.configPath = path.join(__dirname, '../../config/config.json');
    this.loadedAt = null;
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      this.loadedAt = new Date();
      console.log('✅ Configuration loaded successfully');
      return this.config;
    } catch (error) {
      console.error('❌ Error loading configuration:', error);
      throw new Error('Cannot load configuration file');
    }
  }

  async reloadConfig() {
    return await this.loadConfig();
  }

  getConfig() {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  // Bot configuration
  getBotConfig() {
    const config = this.getConfig();
    return config.bot || {};
  }

  getDiscordToken() {
    const botConfig = this.getBotConfig();
    if (!botConfig.token) {
      throw new Error('Discord bot token not configured');
    }
    return botConfig.token;
  }

  // Database configuration
  getDatabaseConfig() {
    const config = this.getConfig();
    return config.database || {};
  }

  // RCON configuration
  getRconConfig() {
    const config = this.getConfig();
    return config.rcon || {};
  }

  // EasySlip configuration
  getEasySlipConfig() {
    const config = this.getConfig();
    return config.easyslip || {};
  }

  // Packages configuration
  getPackages() {
    const config = this.getConfig();
    return config.packages || [];
  }

  // QR Code configuration
  getQRCodeConfig() {
    const config = this.getConfig();
    return config.qr_code || {};
  }

  // Settings configuration
  getSettings() {
    const config = this.getConfig();
    return config.settings || {};
  }

  // Utility methods
  get(path, defaultValue = null) {
    const config = this.getConfig();
    const keys = path.split('.');
    let value = config;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }
    
    return value;
  }

  isEnabled(service) {
    return this.get(`${service}.enabled`, false);
  }

  // Validation methods
  validateConfig() {
    const errors = [];
    const config = this.getConfig();

    // Check required bot config
    if (!config.bot?.token) {
      errors.push('Bot token is required');
    }

    // Check database config
    const dbConfig = config.database || {};
    if (!dbConfig.host || !dbConfig.user || !dbConfig.database) {
      errors.push('Database configuration is incomplete');
    }

    // Check RCON config if enabled
    if (config.rcon?.enabled) {
      if (!config.rcon.host || !config.rcon.password) {
        errors.push('RCON configuration is incomplete');
      }
    }

    // Check EasySlip config if enabled
    if (config.easyslip?.enabled) {
      if (!config.easyslip.api_key) {
        errors.push('EasySlip API key is required when enabled');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Debug information
  getDebugInfo() {
    const config = this.getConfig();
    
    return {
      loadedAt: this.loadedAt,
      configPath: this.configPath,
      services: {
        bot: !!config.bot?.token,
        database: !!(config.database?.host && config.database?.user),
        rcon: config.rcon?.enabled || false,
        easyslip: config.easyslip?.enabled || false
      },
      packages: config.packages?.length || 0,
      settings: config.settings || {}
    };
  }
}

export default new ConfigService();