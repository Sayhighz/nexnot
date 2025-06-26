// src/services/configService.js
const fs = require('fs').promises;
const path = require('path');

class ConfigService {
  constructor() {
    this.config = null;
    this.configPath = path.join(__dirname, '../../config/config.json');
    this.loadedAt = null;
  }

  async loadConfig() {
    try {
      // ตรวจสอบว่าไฟล์มีอยู่หรือไม่
      try {
        await fs.access(this.configPath);
        const stats = await fs.stat(this.configPath);
        
        if (process.env.NODE_ENV === 'development') {
          console.log('✅ Config file exists, size:', stats.size, 'bytes');
        }
      } catch (error) {
        throw new Error(`Configuration file not found at: ${this.configPath}`);
      }
  
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      this.loadedAt = new Date();
      
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ Configuration loaded successfully');
        console.log('📊 Config sections found:', Object.keys(this.config));
      }
      
      return this.config;
    } catch (error) {
      if (error.name === 'SyntaxError') {
        throw new Error('JSON Syntax Error in config file: ' + error.message);
      }
      throw new Error('Cannot load configuration file: ' + error.message);
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

  // RCON Servers configuration
  getRconServersConfig() {
    const config = this.getConfig();
    return config.rcon_servers || {};
  }

  // Discord Webhook configuration
  getDiscordWebhookConfig() {
    const config = this.getConfig();
    return config.discord_webhook || {};
  }

  // EasySlip configuration
  getEasySlipConfig() {
    const config = this.getConfig();
    
    if (!config.easyslip) {
      return {};
    }
    
    return config.easyslip;
  }

  // Packages configuration
  getPackages() {
    const config = this.getConfig();
    return config.packages || [];
  }

  // Donation categories
  getDonationCategories() {
    const config = this.getConfig();
    return config.donation_categories || {};
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

  // Channels configuration
  getChannelsConfig() {
    const config = this.getConfig();
    return config.channels || {};
  }

  // Utility methods
  get(path, defaultValue = null) {
    try {
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
    } catch (error) {
      return defaultValue;
    }
  }

  isEnabled(service) {
    return this.get(`${service}.enabled`, false);
  }

  // Check if RCON server exists
  hasRconServer(serverKey) {
    const servers = this.getRconServersConfig();
    return servers.hasOwnProperty(serverKey);
  }

  // Get specific RCON server config
  getRconServerConfig(serverKey) {
    const servers = this.getRconServersConfig();
    return servers[serverKey] || null;
  }

  // Validation methods
  validateConfig() {
    const errors = [];
    
    try {
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

      // Check RCON servers config
      const rconServers = config.rcon_servers || {};
      const enabledServers = Object.values(rconServers).filter(s => s && s.enabled);
      if (enabledServers.length === 0) {
        // Note: This is warning, not error
      } else {
        for (const [key, server] of Object.entries(rconServers)) {
          if (server && server.enabled) {
            if (!server.host || !server.password) {
              errors.push(`RCON server ${key} is missing host or password`);
            }
          }
        }
      }

      // Check Discord webhook config
      const webhookConfig = config.discord_webhook || {};
      if (webhookConfig.enabled) {
        if (!webhookConfig.donation_webhook_url || webhookConfig.donation_webhook_url.includes('YOUR_WEBHOOK')) {
          errors.push('Discord webhook is enabled but URL is not configured');
        }
      }

      // Check EasySlip config if enabled
      if (config.easyslip?.enabled) {
        if (!config.easyslip.api_key || config.easyslip.api_key === 'YOUR_EASYSLIP_API_KEY') {
          errors.push('EasySlip API key is required when enabled');
        }
      }

    } catch (error) {
      errors.push(`Config validation error: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Debug information
  getDebugInfo() {
    try {
      const config = this.getConfig();
      
      return {
        loadedAt: this.loadedAt,
        configPath: this.configPath,
        configSize: JSON.stringify(config).length,
        services: {
          bot: !!config.bot?.token,
          database: !!(config.database?.host && config.database?.user),
          rcon_servers: Object.keys(config.rcon_servers || {}).length,
          discord_webhook: config.discord_webhook?.enabled || false,
          easyslip: config.easyslip?.enabled || false
        },
        donation_categories: Object.keys(config.donation_categories || {}),
        settings: config.settings || {}
      };
    } catch (error) {
      return {
        error: error.message,
        loadedAt: this.loadedAt,
        configPath: this.configPath
      };
    }
  }

  // Test config file accessibility
  async testConfigFile() {
    try {
      // Test file existence
      await fs.access(this.configPath);
      
      // Test file readability
      const stats = await fs.stat(this.configPath);
      
      // Test JSON parsing
      const configData = await fs.readFile(this.configPath, 'utf8');
      const parsedConfig = JSON.parse(configData);
      
      return {
        success: true,
        stats: {
          size: stats.size,
          modified: stats.mtime,
          sections: Object.keys(parsedConfig)
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new ConfigService();