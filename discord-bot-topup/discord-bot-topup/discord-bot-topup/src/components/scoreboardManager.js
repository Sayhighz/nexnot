// src/components/rconManager.js
import { Rcon } from 'rcon-client';
import configService from '../services/configService.js';
import logService from '../services/logService.js';
import Helpers from '../utils/helpers.js';

class RconManager {
  constructor() {
    this.config = null;
    this.isEnabled = false;
    this.consecutiveFailures = 0;
    this.connectionTimeout = 8000;
    this.commandTimeout = 10000;
    this.activeConnections = new Set();
    this.maxRetries = 3;
    this.maxFailures = 5;
    
    this.initializeConfig();
  }

  initializeConfig() {
    try {
      this.config = configService.getRconConfig();
      this.isEnabled = this.config.enabled && 
                       this.config.host && 
                       this.config.password && 
                       this.config.host !== 'localhost';
      
      if (!this.isEnabled) {
        console.warn('⚠️ RCON is disabled - check configuration in config.json');
        console.warn('⚠️ Please configure RCON settings: enabled, host, port, and password');
      } else {
        console.log('✅ RCON configured:', { 
          host: this.config.host, 
          port: this.config.port || 27015,
          hasPassword: !!this.config.password,
          enabled: this.config.enabled
        });
      }
    } catch (error) {
      console.error('❌ Error initializing RCON config:', error);
      this.isEnabled = false;
    }
  }

  async executeCommand(command) {
    if (!this.isEnabled) {
      console.error('❌ RCON is not enabled. Please configure RCON settings in config.json');
      return {
        success: false,
        error: 'RCON is not enabled',
        response: null,
        details: {
          enabled: this.config?.enabled || false,
          hasHost: !!(this.config?.host),
          hasPassword: !!(this.config?.password)
        }
      };
    }

    // Check if too many consecutive failures
    if (this.consecutiveFailures >= this.maxFailures) {
      console.error(`❌ Too many RCON failures (${this.consecutiveFailures}). Please check server connection`);
      return {
        success: false,
        error: `Too many consecutive failures (${this.consecutiveFailures}/${this.maxFailures})`,
        response: null,
        canRetry: false
      };
    }

    // Validate command
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return {
        success: false,
        error: 'Invalid command provided',
        response: null
      };
    }

    try {
      console.log(`🎮 Executing RCON command: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`);
      return await this.executeCommandInternal(command.trim());
    } catch (error) {
      console.error('❌ RCON command failed:', error.message);
      this.consecutiveFailures++;
      
      return {
        success: false,
        error: error.message,
        response: null,
        consecutiveFailures: this.consecutiveFailures
      };
    }
  }

  async executeCommandInternal(command) {
    let rcon = null;
    const connectionId = Date.now() + Math.random();
    const startTime = Date.now();
    
    try {
      console.log(`🔗 [${connectionId}] Connecting to RCON...`);
      console.log(`🎯 [${connectionId}] Target: ${this.config.host}:${this.config.port || 27015}`);
      
      // Create RCON client
      rcon = new Rcon({
        host: this.config.host,
        port: this.config.port || 27015,
        password: this.config.password,
        timeout: this.connectionTimeout
      });
      
      // Track this connection
      this.activeConnections.add(connectionId);
      
      // Connect with timeout
      console.log(`⏱️ [${connectionId}] Connecting with ${this.connectionTimeout}ms timeout...`);
      await Promise.race([
        rcon.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), this.connectionTimeout)
        )
      ]);
      
      console.log(`🔗 [${connectionId}] RCON connected successfully`);

      // Execute command with timeout
      console.log(`📤 [${connectionId}] Executing command: ${command}`);
      const commandStartTime = Date.now();
      
      const response = await Promise.race([
        rcon.send(command),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Command execution timeout')), this.commandTimeout)
        )
      ]);
      
      const commandDuration = Date.now() - commandStartTime;
      console.log(`✅ [${connectionId}] Command executed successfully in ${commandDuration}ms`);
      
      // Process response
      const responseText = this.extractResponseText(response);
      console.log(`📨 [${connectionId}] Response:`, responseText);

      // Reset failure counter on success
      this.consecutiveFailures = 0;

      const totalDuration = Date.now() - startTime;

      // Log successful command
      logService.logRconCommand(command, 'success', {
        response: responseText,
        host: this.config.host,
        port: this.config.port || 27015,
        connectionId: connectionId,
        duration: totalDuration,
        commandDuration: commandDuration
      });

      return {
        success: true,
        error: null,
        response: responseText,
        duration: totalDuration,
        connectionId: connectionId
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [${connectionId}] RCON Error after ${duration}ms:`, error.message);
      this.consecutiveFailures++;

      // Categorize error for better user feedback
      const errorCategory = this.categorizeError(error);

      // Log failed command
      logService.logRconCommand(command, 'failed', {
        error: error.message,
        errorCategory: errorCategory,
        host: this.config.host,
        port: this.config.port || 27015,
        connectionId: connectionId,
        duration: duration,
        consecutiveFailures: this.consecutiveFailures
      });

      return {
        success: false,
        error: this.getReadableErrorMessage(error, errorCategory),
        response: null,
        errorCategory: errorCategory,
        duration: duration,
        consecutiveFailures: this.consecutiveFailures
      };

    } finally {
      // Clean up connection
      if (rcon) {
        console.log(`🔌 [${connectionId}] Cleaning up connection...`);
        await this.forceCloseConnection(rcon, connectionId);
      }
      
      // Remove from active connections
      this.activeConnections.delete(connectionId);
      const totalDuration = Date.now() - startTime;
      console.log(`🗑️ [${connectionId}] Connection cleanup complete after ${totalDuration}ms`);
    }
  }

  categorizeError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout') || message.includes('etimedout')) {
      return 'timeout';
    } else if (message.includes('econnrefused') || message.includes('enotfound')) {
      return 'connection';
    } else if (message.includes('authentication') || message.includes('invalid password')) {
      return 'authentication';
    } else if (message.includes('permission') || message.includes('access denied')) {
      return 'permission';
    } else {
      return 'unknown';
    }
  }

  getReadableErrorMessage(error, category) {
    const baseMessage = error.message;
    
    switch (category) {
      case 'timeout':
        return 'การเชื่อมต่อ RCON หมดเวลา เซิร์ฟเวอร์อาจไม่ตอบสนอง';
      case 'connection':
        return 'ไม่สามารถเชื่อมต่อ RCON ได้ กรุณาตรวจสอบ IP และ Port';
      case 'authentication':
        return 'รหัสผ่าน RCON ไม่ถูกต้อง';
      case 'permission':
        return 'ไม่มีสิทธิ์ในการใช้คำสั่งนี้';
      default:
        return `เกิดข้อผิดพลาด RCON: ${baseMessage}`;
    }
  }

  async forceCloseConnection(rcon, connectionId) {
    const closeTimeout = 3000; // 3 seconds max for closing
    
    try {
      await Promise.race([
        this.closeRconConnection(rcon, connectionId),
        new Promise((resolve) => 
          setTimeout(() => {
            console.warn(`⏰ [${connectionId}] Force closing connection after timeout`);
            resolve();
          }, closeTimeout)
        )
      ]);
    } catch (error) {
      console.warn(`⚠️ [${connectionId}] Error during force close:`, error.message);
    }
  }

  async closeRconConnection(rcon, connectionId) {
    try {
      if (typeof rcon.end === 'function') {
        await rcon.end();
        console.log(`🔌 [${connectionId}] Connection ended successfully`);
      } else if (typeof rcon.disconnect === 'function') {
        await rcon.disconnect();
        console.log(`🔌 [${connectionId}] Connection disconnected successfully`);
      } else if (typeof rcon.close === 'function') {
        await rcon.close();
        console.log(`🔌 [${connectionId}] Connection closed successfully`);
      } else {
        console.warn(`⚠️ [${connectionId}] No close method available`);
      }
    } catch (closeError) {
      console.warn(`⚠️ [${connectionId}] Close error:`, closeError.message);
      
      // Force destroy if normal close fails
      try {
        if (rcon.socket && typeof rcon.socket.destroy === 'function') {
          rcon.socket.destroy();
          console.log(`💥 [${connectionId}] Socket destroyed forcefully`);
        }
      } catch (destroyError) {
        console.warn(`⚠️ [${connectionId}] Destroy error:`, destroyError.message);
      }
    }
  }

  extractResponseText(response) {
    if (typeof response === 'string') {
      return response.trim();
    }
    
    if (response && typeof response === 'object') {
      if (response.body) return response.body.trim();
      if (response.response) return response.response.trim();
      if (response.data) return response.data.trim();
      if (response.message) return response.message.trim();
      
      // Try to stringify object response
      try {
        return JSON.stringify(response, null, 2);
      } catch {
        return 'Object response (could not stringify)';
      }
    }
    
    return 'Command executed successfully';
  }

  // High-level game commands with proper error handling
  async giveItem(steam64, itemPath, quantity = 1, quality = 0, blueprintType = 0) {
    if (!this.validateSteam64(steam64)) {
      return {
        success: false,
        error: 'Invalid Steam64 ID format',
        response: null
      };
    }

    if (!itemPath || typeof itemPath !== 'string') {
      return {
        success: false,
        error: 'Invalid item path provided',
        response: null
      };
    }

    const itemName = this.extractItemName(itemPath);
    console.log(`🎁 Attempting to give item to ${steam64}: ${itemName} x${quantity}`);
    
    const command = `giveitem ${steam64} "${itemPath}" ${quantity} ${quality} ${blueprintType}`;
    const result = await this.executeCommand(command);
    
    if (result.success) {
      console.log(`✅ Successfully gave ${quantity}x ${itemName} to ${steam64}`);
    } else {
      console.error(`❌ Failed to give item to ${steam64}:`, result.error);
    }
    
    return {
      ...result,
      itemName: itemName,
      steam64: steam64,
      quantity: quantity
    };
  }

  async giveItemToPlayer(steam64, itemPath, quantity = 1, quality = 0, blueprintType = 0) {
    if (!this.validateSteam64(steam64)) {
      return {
        success: false,
        error: 'Invalid Steam64 ID format',
        response: null
      };
    }

    if (!itemPath || typeof itemPath !== 'string') {
      return {
        success: false,
        error: 'Invalid item path provided',
        response: null
      };
    }

    const itemName = this.extractItemName(itemPath);
    console.log(`🎁 Attempting to give item to player ${steam64}: ${itemName} x${quantity}`);
    
    const command = `GiveItemToPlayer ${steam64} "${itemPath}" ${quantity} ${quality} ${blueprintType}`;
    const result = await this.executeCommand(command);
    
    if (result.success) {
      console.log(`✅ Successfully gave ${quantity}x ${itemName} to player ${steam64}`);
    } else {
      console.error(`❌ Failed to give item to player ${steam64}:`, result.error);
    }
    
    return {
      ...result,
      itemName: itemName,
      steam64: steam64,
      quantity: quantity
    };
  }

  async addExperience(steam64, amount) {
    if (!this.validateSteam64(steam64)) {
      return {
        success: false,
        error: 'Invalid Steam64 ID format',
        response: null
      };
    }

    if (!amount || amount <= 0) {
      return {
        success: false,
        error: 'Invalid experience amount',
        response: null
      };
    }

    console.log(`📈 Adding ${amount} XP to ${steam64}`);
    
    const command = `addexperience ${steam64} ${amount}`;
    const result = await this.executeCommand(command);
    
    return {
      ...result,
      steam64: steam64,
      amount: amount
    };
  }

  async givePoints(steam64, amount) {
    if (!this.validateSteam64(steam64)) {
      return {
        success: false,
        error: 'Invalid Steam64 ID format',
        response: null
      };
    }

    if (!amount || amount <= 0) {
      return {
        success: false,
        error: 'Invalid points amount',
        response: null
      };
    }

    console.log(`💰 Adding ${amount} points to ${steam64}`);
    
    const command = `givepoints ${steam64} ${amount}`;
    const result = await this.executeCommand(command);
    
    return {
      ...result,
      steam64: steam64,
      amount: amount
    };
  }

  async addHexagons(steam64, amount) {
    if (!this.validateSteam64(steam64)) {
      return {
        success: false,
        error: 'Invalid Steam64 ID format',
        response: null
      };
    }

    if (!amount || amount <= 0) {
      return {
        success: false,
        error: 'Invalid hexagon amount',
        response: null
      };
    }

    console.log(`🔷 Adding ${amount} hexagons to ${steam64}`);
    
    const command = `addhexagons ${steam64} ${amount}`;
    const result = await this.executeCommand(command);
    
    return {
      ...result,
      steam64: steam64,
      amount: amount
    };
  }

  async broadcastMessage(message) {
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return {
        success: false,
        error: 'Invalid message provided',
        response: null
      };
    }

    console.log(`📢 Broadcasting message: ${message}`);
    
    const command = `broadcast ${message}`;
    const result = await this.executeCommand(command);
    
    return {
      ...result,
      message: message
    };
  }

  async serverMessage(message) {
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return {
        success: false,
        error: 'Invalid message provided',
        response: null
      };
    }

    console.log(`📢 Sending server message: ${message}`);
    
    const command = `servermessage ${message}`;
    const result = await this.executeCommand(command);
    
    return {
      ...result,
      message: message
    };
  }

  async getOnlinePlayers() {
    console.log('👥 Getting online players list');
    const command = 'listplayers';
    const result = await this.executeCommand(command);
    
    if (result.success && result.response) {
      // Parse player list from response
      result.players = this.parsePlayerList(result.response);
    }
    
    return result;
  }

  async getServerInfo() {
    console.log('ℹ️ Getting server information');
    const command = 'getgamelog';
    const result = await this.executeCommand(command);
    
    return result;
  }

  async saveWorld() {
    console.log('💾 Saving world');
    const command = 'saveworld';
    const result = await this.executeCommand(command);
    
    return result;
  }

  async destroyWildDinos() {
    console.log('🦕 Destroying wild dinosaurs');
    const command = 'destroywilddinos';
    const result = await this.executeCommand(command);
    
    return result;
  }

  // Utility methods
  validateSteam64(steam64) {
    if (!steam64) return false;
    
    // Steam64 ID should be 17 digits and start with 7656119
    const steam64Pattern = /^7656119\d{10}$/;
    return steam64Pattern.test(steam64.toString());
  }

  parsePlayerList(response) {
    try {
      const lines = response.split('\n');
      const players = [];
      
      for (const line of lines) {
        // Parse player information from response
        // Format might vary depending on server
        if (line.includes('Steam64') || line.includes('ID:')) {
          // Extract player data here
          players.push(line.trim());
        }
      }
      
      return players;
    } catch (error) {
      console.error('Error parsing player list:', error);
      return [];
    }
  }

  extractItemName(itemPath) {
    if (!itemPath) return 'Unknown Item';
    
    const pathParts = itemPath.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    
    let itemName = lastPart;
    
    // Remove common prefixes
    const cleanupPatterns = [
      'PrimalItemArmor_',
      'PrimalItemResource_',
      'PrimalItemWeapon_',
      'PrimalItemConsumable_',
      'PrimalItemStructure_',
      'PrimalItem_'
    ];
    
    cleanupPatterns.forEach(pattern => {
      if (itemName.includes(pattern)) {
        itemName = itemName.replace(pattern, '');
      }
    });
    
    // Remove quotes and clean up
    itemName = itemName.replace(/['"]/g, '');
    
    // Add spaces before capital letters
    itemName = itemName.replace(/([A-Z])/g, ' $1').trim();
    
    return itemName || 'Unknown Item';
  }

  // Test and monitoring methods
  async testConnection() {
    if (!this.isEnabled) {
      return {
        success: false,
        error: 'RCON is not enabled',
        response: null,
        target: `${this.config?.host || 'N/A'}:${this.config?.port || 'N/A'}`,
        configuration: this.getConfiguration()
      };
    }

    console.log(`🧪 Testing RCON connection to ${this.config.host}:${this.config.port || 27015}`);
    
    try {
      const startTime = Date.now();
      const result = await this.executeCommand('echo "RCON Connection Test"');
      const duration = Date.now() - startTime;
      
      console.log(`🧪 Test result:`, result.success ? 'SUCCESS' : 'FAILED');
      
      return {
        success: result.success,
        error: result.error,
        response: result.response,
        target: `${this.config.host}:${this.config.port || 27015}`,
        duration: duration,
        configuration: this.getConfiguration()
      };
    } catch (error) {
      console.error('🧪 Test failed:', error.message);
      return {
        success: false,
        error: error.message,
        target: `${this.config.host}:${this.config.port || 27015}`,
        configuration: this.getConfiguration()
      };
    }
  }

  getConfiguration() {
    return {
      host: this.config?.host || 'not configured',
      port: this.config?.port || 27015,
      isEnabled: this.isEnabled,
      hasPassword: !!(this.config?.password),
      consecutiveFailures: this.consecutiveFailures,
      maxFailures: this.maxFailures,
      activeConnections: this.activeConnections.size,
      status: this.isEnabled ? 'ENABLED' : 'DISABLED',
      connectionString: `${this.config?.host || 'N/A'}:${this.config?.port || 'N/A'}`,
      connectionTimeout: this.connectionTimeout,
      commandTimeout: this.commandTimeout,
      configLoaded: !!this.config
    };
  }

  getStats() {
    return {
      isEnabled: this.isEnabled,
      consecutiveFailures: this.consecutiveFailures,
      maxFailures: this.maxFailures,
      activeConnections: this.activeConnections.size,
      connectionTimeout: this.connectionTimeout,
      commandTimeout: this.commandTimeout,
      uptime: process.uptime()
    };
  }

  resetFailures() {
    this.consecutiveFailures = 0;
    console.log('🔄 RCON failure count reset');
  }

  updateTimeouts(connectionTimeout, commandTimeout) {
    if (connectionTimeout && connectionTimeout > 0) {
      this.connectionTimeout = connectionTimeout;
      console.log(`⏰ Connection timeout updated to ${connectionTimeout}ms`);
    }
    
    if (commandTimeout && commandTimeout > 0) {
      this.commandTimeout = commandTimeout;
      console.log(`⏰ Command timeout updated to ${commandTimeout}ms`);
    }
  }

  debugConnection() {
    const debug = {
      ...this.getConfiguration(),
      config: this.config,
      activeConnectionIds: Array.from(this.activeConnections),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
    
    console.log('🔍 RCON Debug Info:', debug);
    return debug;
  }

  async executeMultipleCommands(commands) {
    if (!Array.isArray(commands) || commands.length === 0) {
      return {
        success: false,
        error: 'No commands provided',
        results: []
      };
    }

    console.log(`🔄 Executing ${commands.length} commands sequentially`);
    const results = [];
    let allSucceeded = true;

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      console.log(`📤 [${i + 1}/${commands.length}] Executing: ${command}`);
      
      const result = await this.executeCommand(command);
      results.push({
        command: command,
        index: i,
        ...result
      });

      if (!result.success) {
        allSucceeded = false;
        console.error(`❌ Command ${i + 1} failed:`, result.error);
      }

      // Small delay between commands
      if (i < commands.length - 1) {
        await Helpers.sleep(500);
      }
    }

    return {
      success: allSucceeded,
      results: results,
      totalCommands: commands.length,
      successfulCommands: results.filter(r => r.success).length,
      failedCommands: results.filter(r => !r.success).length
    };
  }

  async shutdown() {
    console.log('🛑 RCON Manager shutting down...');
    console.log(`🔌 Closing ${this.activeConnections.size} active connections...`);
    
    // Force close any remaining connections
    this.activeConnections.clear();
    this.consecutiveFailures = 0;
    
    console.log('✅ RCON Manager shutdown complete');
  }

  // Reload configuration
  async reloadConfig() {
    try {
      await configService.reloadConfig();
      this.initializeConfig();
      console.log('🔄 RCON configuration reloaded');
      return { success: true };
    } catch (error) {
      console.error('❌ Error reloading RCON config:', error);
      return { success: false, error: error.message };
    }
  }
}

export default new RconManager();