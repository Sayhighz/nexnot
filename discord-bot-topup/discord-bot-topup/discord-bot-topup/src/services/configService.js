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
      console.log('📁 Loading config from:', this.configPath);
      
      // ตรวจสอบว่าไฟล์มีอยู่หรือไม่
      try {
        await fs.access(this.configPath);
        console.log('✅ Config file exists');
        
        // ตรวจสอบขนาดไฟล์
        const stats = await fs.stat(this.configPath);
        console.log('📊 File size:', stats.size, 'bytes');
        
      } catch (error) {
        console.error('❌ Config file not found:', this.configPath);
        throw new Error(`Configuration file not found at: ${this.configPath}`);
      }
  
      const configData = await fs.readFile(this.configPath, 'utf8');
      console.log('📄 Config file read successfully, size:', configData.length, 'bytes');
      console.log('🔍 First 200 chars:', configData.substring(0, 200));
      
      this.config = JSON.parse(configData);
      this.loadedAt = new Date();
      
      console.log('✅ Configuration loaded successfully');
      console.log('📊 Config sections found:', Object.keys(this.config));
      
      // 🚨 เพิ่ม debug เฉพาะ sections ที่มีปัญหา
      console.log('🔍 RCON servers debug:');
      console.log('  - rcon_servers exists:', !!this.config.rcon_servers);
      console.log('  - rcon_servers keys:', this.config.rcon_servers ? Object.keys(this.config.rcon_servers) : 'NULL');
      console.log('  - rcon_servers content:', JSON.stringify(this.config.rcon_servers, null, 2));
      
      console.log('🔍 Discord webhook debug:');
      console.log('  - discord_webhook exists:', !!this.config.discord_webhook);
      console.log('  - webhook enabled:', this.config.discord_webhook?.enabled);
      console.log('  - webhook URL exists:', !!this.config.discord_webhook?.donation_webhook_url);
      console.log('  - webhook content:', JSON.stringify(this.config.discord_webhook, null, 2));
      
      return this.config;
    } catch (error) {
      console.error('❌ Error loading configuration:', error);
      if (error.name === 'SyntaxError') {
        console.error('❌ JSON Syntax Error in config file. Please check your config.json syntax.');
        console.error('❌ Error details:', error.message);
      }
      throw new Error('Cannot load configuration file: ' + error.message);
    }
  }

  async reloadConfig() {
    console.log('🔄 Reloading configuration...');
    return await this.loadConfig();
  }

  getConfig() {
    if (!this.config) {
      console.error('❌ Configuration not loaded. Call loadConfig() first.');
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

  // RCON Servers configuration - เพิ่มใหม่
  getRconServersConfig() {
    const config = this.getConfig();
    const rconServers = config.rcon_servers || {};
    console.log('🎮 Getting RCON servers config:', Object.keys(rconServers));
    return rconServers;
  }

  // Discord Webhook configuration - เพิ่มใหม่  
  getDiscordWebhookConfig() {
    const config = this.getConfig();
    const webhookConfig = config.discord_webhook || {};
    console.log('📢 Getting webhook config:', {
      enabled: webhookConfig.enabled,
      hasUrl: !!webhookConfig.donation_webhook_url
    });
    return webhookConfig;
  }

  // RCON configuration (legacy)
  getRconConfig() {
    const config = this.getConfig();
    return config.rcon || {};
  }

  // EasySlip configuration
  getEasySlipConfig() {
  const config = this.getConfig();
  const easyslipConfig = config.easyslip || {};
  
  console.log('🔍 ConfigService getEasySlipConfig debug:', {
    fullConfig: !!config,
    hasEasyslipSection: !!config.easyslip,
    easyslipConfig: easyslipConfig,
    enabled: easyslipConfig.enabled,
    hasApiKey: !!easyslipConfig.api_key,
    apiKeyLength: easyslipConfig.api_key ? easyslipConfig.api_key.length : 0
  });
  
  return easyslipConfig;
}

  // Packages configuration
  getPackages() {
    const config = this.getConfig();
    return config.packages || [];
  }

  // Donation categories - เพิ่มใหม่
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

  // Channels configuration - เพิ่มใหม่
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
          console.warn(`⚠️ Config path not found: ${path}, using default:`, defaultValue);
          return defaultValue;
        }
      }
      
      return value;
    } catch (error) {
      console.warn(`⚠️ Error getting config path ${path}:`, error.message);
      return defaultValue;
    }
  }

  isEnabled(service) {
    return this.get(`${service}.enabled`, false);
  }

  // Check if RCON server exists - เพิ่มใหม่
  hasRconServer(serverKey) {
    const servers = this.getRconServersConfig();
    return servers.hasOwnProperty(serverKey);
  }

  // Get specific RCON server config - เพิ่มใหม่
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
        console.warn('⚠️ No RCON servers enabled');
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
      console.log('🧪 Testing config file access...');
      
      // Test file existence
      await fs.access(this.configPath);
      console.log('✅ Config file exists');
      
      // Test file readability
      const stats = await fs.stat(this.configPath);
      console.log('📊 Config file stats:', {
        size: stats.size,
        modified: stats.mtime
      });
      
      // Test JSON parsing
      const configData = await fs.readFile(this.configPath, 'utf8');
      const parsedConfig = JSON.parse(configData);
      console.log('✅ Config file is valid JSON');
      
      return {
        success: true,
        stats: {
          size: stats.size,
          modified: stats.mtime,
          sections: Object.keys(parsedConfig)
        }
      };
      
    } catch (error) {
      console.error('❌ Config file test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  

}

export default new ConfigService();