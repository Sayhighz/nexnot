import { Rcon } from 'rcon-client';
import logService from '../services/logService.js';
import Helpers from '../utils/helpers.js';
import CONSTANTS from '../utils/constants.js';

class RconManager {
  constructor() {
    this.host = process.env.RCON_HOST || 'localhost';
    this.port = parseInt(process.env.RCON_PORT) || 27015;
    this.password = process.env.RCON_PASSWORD || '';
    this.isEnabled = this.host && this.password && this.host !== 'localhost';
    this.consecutiveFailures = 0;
    this.connectionTimeout = 8000; // ลด timeout
    this.commandTimeout = 10000; // ลด timeout
    this.activeConnections = new Set(); // Track active connections
    
    if (!this.isEnabled) {
      console.warn('⚠️ RCON is disabled - missing host or password');
      console.warn('⚠️ Please set RCON_HOST, RCON_PORT, and RCON_PASSWORD environment variables');
    } else {
      console.log('✅ RCON configured:', { 
        host: this.host, 
        port: this.port,
        hasPassword: !!this.password
      });
    }
  }

  async executeCommand(command) {
    if (!this.isEnabled) {
      console.error('❌ RCON is not enabled. Please configure RCON_HOST and RCON_PASSWORD');
      return {
        success: false,
        error: 'RCON is not enabled',
        response: null
      };
    }

    // Check if too many failures
    if (this.consecutiveFailures >= 3) { // ลดจาก 5 เป็น 3
      console.error('❌ Too many RCON failures. Please check server connection');
      return {
        success: false,
        error: 'Too many consecutive failures',
        response: null
      };
    }

    try {
      // ไม่ใช้ retry ให้ทำครั้งเดียว
      return await this.executeCommandInternal(command);
    } catch (error) {
      console.error('❌ RCON command failed:', error.message);
      this.consecutiveFailures++;
      
      return {
        success: false,
        error: error.message,
        response: null
      };
    }
  }

  async executeCommandInternal(command) {
    let rcon = null;
    const connectionId = Date.now() + Math.random();
    
    try {
      console.log(`🔗 [${connectionId}] Connecting to RCON...`);
      console.log(`🎯 [${connectionId}] Target: ${this.host}:${this.port}`);
      
      // Create RCON client with shorter timeout
      rcon = new Rcon({
        host: this.host,
        port: this.port,
        password: this.password,
        timeout: this.connectionTimeout
      });
      
      // Track this connection
      this.activeConnections.add(connectionId);
      
      // Connect with strict timeout
      console.log(`⏱️ [${connectionId}] Connecting with ${this.connectionTimeout}ms timeout...`);
      await Promise.race([
        rcon.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), this.connectionTimeout)
        )
      ]);
      
      console.log(`🔗 [${connectionId}] RCON connected successfully`);

      // Execute command with strict timeout
      console.log(`📤 [${connectionId}] Executing command: ${command}`);
      const response = await Promise.race([
        rcon.send(command),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Command execution timeout')), this.commandTimeout)
        )
      ]);
      
      console.log(`✅ [${connectionId}] Command executed successfully`);
      
      // Process response
      let responseText = this.extractResponseText(response);
      console.log(`📨 [${connectionId}] Response:`, responseText);

      // Reset failure counter on success
      this.consecutiveFailures = 0;

      // Log successful command
      logService.logRconCommand(command, 'success', {
        response: responseText,
        host: this.host,
        port: this.port,
        connectionId: connectionId
      });

      return {
        success: true,
        error: null,
        response: responseText
      };

    } catch (error) {
      console.error(`❌ [${connectionId}] RCON Error:`, error.message);
      this.consecutiveFailures++;

      // Log failed command
      logService.logRconCommand(command, 'failed', {
        error: error.message,
        host: this.host,
        port: this.port,
        connectionId: connectionId,
        consecutiveFailures: this.consecutiveFailures
      });

      return {
        success: false,
        error: error.message,
        response: null
      };

    } finally {
      // Clean up connection
      if (rcon) {
        console.log(`🔌 [${connectionId}] Cleaning up connection...`);
        await this.forceCloseConnection(rcon, connectionId);
      }
      
      // Remove from active connections
      this.activeConnections.delete(connectionId);
      console.log(`🗑️ [${connectionId}] Connection cleanup complete`);
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
      return JSON.stringify(response, null, 2);
    }
    
    return 'Command executed successfully';
  }

  // Utility methods - เพิ่ม logging และ validation
  async giveItem(steam64, itemPath, quantity = 1, quality = 0, blueprintType = 0) {
    console.log(`🎁 Attempting to give item to ${steam64}: ${this.extractItemName(itemPath)} x${quantity}`);
    
    if (!steam64 || !itemPath) {
      console.error('❌ Missing required parameters for giveItem');
      return {
        success: false,
        error: 'Missing required parameters: steam64 or itemPath',
        response: null
      };
    }

    const command = `giveitem ${steam64} "${itemPath}" ${quantity} ${quality} ${blueprintType}`;
    const result = await this.executeCommand(command);
    
    if (result.success) {
      console.log(`✅ Successfully gave ${quantity}x ${this.extractItemName(itemPath)} to ${steam64}`);
    } else {
      console.error(`❌ Failed to give item to ${steam64}:`, result.error);
    }
    
    return result;
  }

  async addExperience(steam64, amount) {
    console.log(`📈 Adding ${amount} XP to ${steam64}`);
    
    if (!steam64 || !amount) {
      return {
        success: false,
        error: 'Missing required parameters: steam64 or amount',
        response: null
      };
    }

    const command = `addexperience ${steam64} ${amount}`;
    return await this.executeCommand(command);
  }

  async givePoints(steam64, amount) {
    console.log(`💰 Adding ${amount} points to ${steam64}`);
    
    if (!steam64 || !amount) {
      return {
        success: false,
        error: 'Missing required parameters: steam64 or amount',
        response: null
      };
    }

    const command = `givepoints ${steam64} ${amount}`;
    return await this.executeCommand(command);
  }

  async broadcastMessage(message) {
    console.log(`📢 Broadcasting message: ${message}`);
    
    if (!message) {
      return {
        success: false,
        error: 'Missing required parameter: message',
        response: null
      };
    }

    const command = `broadcast ${message}`;
    return await this.executeCommand(command);
  }

  async getOnlinePlayers() {
    console.log('👥 Getting online players list');
    const command = 'listplayers';
    return await this.executeCommand(command);
  }

  async testConnection() {
    if (!this.isEnabled) {
      return {
        success: false,
        error: 'RCON is not enabled',
        response: null,
        target: `${this.host}:${this.port}`
      };
    }

    console.log(`🧪 Testing RCON connection to ${this.host}:${this.port}`);
    
    try {
      const result = await this.executeCommand('echo "RCON Test"');
      console.log(`🧪 Test result:`, result.success ? 'SUCCESS' : 'FAILED');
      return {
        success: result.success,
        error: result.error,
        response: result.response,
        target: `${this.host}:${this.port}`
      };
    } catch (error) {
      console.error('🧪 Test failed:', error.message);
      return {
        success: false,
        error: error.message,
        target: `${this.host}:${this.port}`
      };
    }
  }

  getConfiguration() {
    return {
      host: this.host,
      port: this.port,
      isEnabled: this.isEnabled,
      hasPassword: !!this.password,
      consecutiveFailures: this.consecutiveFailures,
      activeConnections: this.activeConnections.size,
      status: this.isEnabled ? 'ENABLED' : 'DISABLED',
      connectionString: `${this.host}:${this.port}`,
      connectionTimeout: this.connectionTimeout,
      commandTimeout: this.commandTimeout
    };
  }

  resetFailures() {
    this.consecutiveFailures = 0;
    console.log('🔄 RCON failure count reset');
  }

  debugConnection() {
    console.log('🔍 RCON Debug Info:', {
      ...this.getConfiguration(),
      env: {
        RCON_HOST: process.env.RCON_HOST || '[NOT SET]',
        RCON_PORT: process.env.RCON_PORT || '[NOT SET]',
        RCON_PASSWORD: process.env.RCON_PASSWORD ? '[SET]' : '[NOT SET]'
      }
    });
  }

  // Helper method to extract item name
  extractItemName(itemPath) {
    const pathParts = itemPath.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    
    let itemName = lastPart;
    
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
    
    itemName = itemName.replace(/['"]/g, '');
    itemName = itemName.replace(/([A-Z])/g, ' $1').trim();
    
    return itemName || 'Unknown Item';
  }

  async shutdown() {
    console.log('🛑 RCON Manager shutting down...');
    console.log(`🔌 Closing ${this.activeConnections.size} active connections...`);
    
    // Force close any remaining connections
    this.activeConnections.clear();
    this.consecutiveFailures = 0;
    
    console.log('✅ RCON Manager shutdown complete');
  }
}

export default new RconManager();