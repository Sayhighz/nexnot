import { Rcon } from 'rcon-client';
import logService from '../services/logService.js';
import configService from '../services/configService.js';
import Helpers from '../utils/helpers.js';
import CONSTANTS from '../utils/constants.js';

class RconManager {
  constructor() {
    this.servers = new Map();
    this.activeConnections = new Set();
    this.connectionTimeout = 8000;
    this.commandTimeout = 10000;
    this.maxRetries = 2;
    this.isInitialized = false;
    this.initializeServers();
  }

  initializeServers() {
    try {
      // ล้างข้อมูลเก่า
      this.servers.clear();
      
      console.log('🖥️ Initializing RCON servers...');
      
      // ดึง config ใหม่
      const config = configService.getConfig();
      const rconServers = config.rcon_servers || {};

      console.log('📊 Raw RCON config:', JSON.stringify(rconServers, null, 2));

      if (!rconServers || Object.keys(rconServers).length === 0) {
        console.warn('⚠️ No RCON servers found in configuration');
        console.warn('⚠️ Please check your config.json file for rcon_servers section');
        this.isInitialized = false;
        return;
      }

      let configuredCount = 0;
      let enabledCount = 0;

      for (const [serverKey, serverConfig] of Object.entries(rconServers)) {
        console.log(`🔍 Processing server: ${serverKey}`);
        console.log(`   Config:`, JSON.stringify(serverConfig, null, 2));
        
        if (!serverConfig) {
          console.warn(`⚠️ No config found for server: ${serverKey}`);
          continue;
        }

        // ตรวจสอบค่าที่จำเป็น
        const hasHost = !!serverConfig.host;
        const hasPort = !!serverConfig.port;
        const hasPassword = !!serverConfig.password;
        const isEnabled = serverConfig.enabled === true;
        
        console.log(`📋 Server ${serverKey} validation:`, {
          hasHost,
          hasPort,
          hasPassword,
          isEnabled,
          host: serverConfig.host || 'NOT SET',
          port: serverConfig.port || 'NOT SET'
        });

        if (hasHost && hasPort && hasPassword) {
          this.servers.set(serverKey, {
            ...serverConfig,
            serverKey: serverKey,
            consecutiveFailures: 0,
            lastConnection: null,
            isAvailable: isEnabled,
            lastError: null,
            totalCommands: 0,
            successfulCommands: 0
          });

          configuredCount++;
          if (isEnabled) {
            enabledCount++;
          }

          const status = isEnabled ? '🟢 ENABLED' : '🔴 DISABLED';
          console.log(`✅ RCON server configured: ${serverKey} (${serverConfig.display_name || 'No display name'}) ${status}`);
          console.log(`   📍 Address: ${serverConfig.host}:${serverConfig.port}`);
        } else {
          console.warn(`⚠️ RCON server ${serverKey} is missing required fields:`);
          console.warn(`   - Host: ${hasHost ? '✅' : '❌'} (${serverConfig.host || 'NOT SET'})`);
          console.warn(`   - Port: ${hasPort ? '✅' : '❌'} (${serverConfig.port || 'NOT SET'})`);
          console.warn(`   - Password: ${hasPassword ? '✅' : '❌'}`);
        }
      }

      console.log(`📊 RCON Initialization Summary:`);
      console.log(`   📦 Total in config: ${Object.keys(rconServers).length}`);
      console.log(`   ⚙️ Configured: ${configuredCount}`);
      console.log(`   🟢 Enabled: ${enabledCount}`);
      console.log(`   💾 In memory: ${this.servers.size}`);

      if (this.servers.size === 0) {
        console.warn('⚠️ No valid RCON servers configured');
        console.warn('⚠️ Please check your configuration and ensure:');
        console.warn('   1. rcon_servers section exists in config.json');
        console.warn('   2. Each server has host, port, and password');
        console.warn('   3. At least one server is enabled: true');
        this.isInitialized = false;
      } else {
        console.log(`✅ ${this.servers.size} RCON server(s) initialized successfully`);
        console.log(`🖥️ Available servers: ${Array.from(this.servers.keys()).join(', ')}`);
        this.isInitialized = true;
      }

    } catch (error) {
      console.error('❌ Error initializing RCON servers:', error);
      console.error('❌ Stack trace:', error.stack);
      this.isInitialized = false;
    }
  }

  // เพิ่ม method สำหรับ reload configuration
  reloadConfig() {
    console.log('🔄 Reloading RCON server configuration...');
    this.initializeServers();
    
    const status = this.getConfiguration();
    console.log('🔄 Reload complete:', status);
    return status;
  }

  // เพิ่ม method สำหรับ debug configuration
  debugConfiguration() {
    console.log('🔍 RCON Manager Debug Information:');
    console.log('=' * 50);
    console.log(`📊 Initialization Status: ${this.isInitialized ? '✅ Success' : '❌ Failed'}`);
    console.log(`💾 Total servers in memory: ${this.servers.size}`);
    console.log(`🔗 Active connections: ${this.activeConnections.size}`);
    console.log(`⏱️ Connection timeout: ${this.connectionTimeout}ms`);
    console.log(`⏱️ Command timeout: ${this.commandTimeout}ms`);
    
    if (this.servers.size > 0) {
      console.log('\n🖥️ Server Details:');
      for (const [key, config] of this.servers.entries()) {
        console.log(`\n   Server: ${key}`);
        console.log(`   ├─ Display Name: ${config.display_name || 'N/A'}`);
        console.log(`   ├─ Address: ${config.host}:${config.port}`);
        console.log(`   ├─ Enabled: ${config.enabled ? '✅' : '❌'}`);
        console.log(`   ├─ Available: ${config.isAvailable ? '✅' : '❌'}`);
        console.log(`   ├─ Consecutive Failures: ${config.consecutiveFailures}`);
        console.log(`   ├─ Last Connection: ${config.lastConnection || 'Never'}`);
        console.log(`   ├─ Last Error: ${config.lastError || 'None'}`);
        console.log(`   ├─ Total Commands: ${config.totalCommands}`);
        console.log(`   └─ Successful Commands: ${config.successfulCommands}`);
      }
    } else {
      console.log('\n❌ No servers configured');
    }
    
    // ตรวจสอบ config file
    try {
      const rawConfig = configService.getConfig();
      const rconServers = rawConfig.rcon_servers || {};
      console.log('\n📋 Raw Config Check:');
      console.log(`   Config loaded: ${!!rawConfig ? '✅' : '❌'}`);
      console.log(`   rcon_servers section: ${!!rconServers ? '✅' : '❌'}`);
      console.log(`   Servers in config: ${Object.keys(rconServers).length}`);
      
      if (Object.keys(rconServers).length > 0) {
        console.log('   Server list in config:');
        for (const [key, server] of Object.entries(rconServers)) {
          console.log(`     - ${key}: enabled=${server.enabled}, host=${server.host}, port=${server.port}`);
        }
      }
    } catch (error) {
      console.error('   ❌ Error reading config:', error.message);
    }
    
    console.log('=' * 50);
  }

  getServerConfig(serverKey) {
    const config = this.servers.get(serverKey);
    if (!config) {
      console.warn(`⚠️ Server ${serverKey} not found in RCON manager`);
      console.warn(`Available servers: ${Array.from(this.servers.keys()).join(', ')}`);
    }
    return config;
  }

  getAllServers() {
    return Array.from(this.servers.entries()).map(([key, config]) => ({
      serverKey: key,
      displayName: config.display_name || key,
      host: config.host,
      port: config.port,
      enabled: config.enabled,
      isAvailable: config.isAvailable,
      consecutiveFailures: config.consecutiveFailures,
      lastConnection: config.lastConnection,
      lastError: config.lastError,
      totalCommands: config.totalCommands || 0,
      successfulCommands: config.successfulCommands || 0,
      successRate: config.totalCommands > 0 ? 
        ((config.successfulCommands || 0) / config.totalCommands * 100).toFixed(1) + '%' : 'N/A'
    }));
  }

  getAvailableServers() {
    return this.getAllServers().filter(server => server.enabled && server.isAvailable);
  }

  getServerByKey(serverKey) {
    return this.getAllServers().find(server => server.serverKey === serverKey);
  }

  async executeCommandOnServer(serverKey, command) {
    // ตรวจสอบว่า manager ถูก initialize แล้วหรือไม่
    if (!this.isInitialized) {
      console.error('❌ RCON Manager not properly initialized');
      return {
        success: false,
        error: 'RCON Manager not initialized. Please check configuration.',
        response: null,
        serverKey: serverKey
      };
    }

    const serverConfig = this.servers.get(serverKey);
    
    if (!serverConfig) {
      console.error(`❌ Server ${serverKey} not found in configuration`);
      console.error(`Available servers: ${Array.from(this.servers.keys()).join(', ')}`);
      this.debugConfiguration(); // แสดง debug info เมื่อไม่เจอ server
      
      return {
        success: false,
        error: `Server ${serverKey} not configured. Available servers: ${Array.from(this.servers.keys()).join(', ')}`,
        response: null,
        serverKey: serverKey
      };
    }

    if (!serverConfig.isAvailable) {
      console.error(`❌ Server ${serverKey} is marked as unavailable`);
      return {
        success: false,
        error: `Server ${serverKey} is unavailable (disabled or too many failures)`,
        response: null,
        serverKey: serverKey
      };
    }

    // เพิ่มตัวนับคำสั่ง
    serverConfig.totalCommands = (serverConfig.totalCommands || 0) + 1;

    // Check if too many failures
    if (serverConfig.consecutiveFailures >= 3) {
      console.error(`❌ Server ${serverKey} has too many failures (${serverConfig.consecutiveFailures})`);
      return {
        success: false,
        error: `Server ${serverKey} has too many consecutive failures (${serverConfig.consecutiveFailures}/3)`,
        response: null,
        serverKey: serverKey
      };
    }

    try {
      console.log(`🎮 Executing command on ${serverKey}: ${command}`);
      const result = await this.executeCommandInternal(serverConfig, command);
      
      if (result.success) {
        serverConfig.successfulCommands = (serverConfig.successfulCommands || 0) + 1;
      }
      
      return result;
    } catch (error) {
      console.error(`❌ RCON command failed on ${serverKey}:`, error.message);
      serverConfig.consecutiveFailures++;
      serverConfig.lastError = error.message;
      
      return {
        success: false,
        error: error.message,
        response: null,
        serverKey: serverKey
      };
    }
  }

  async executeCommandInternal(serverConfig, command) {
    let rcon = null;
    const connectionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`🔗 [${connectionId}] Connecting to ${serverConfig.serverKey}...`);
      console.log(`🎯 [${connectionId}] Target: ${serverConfig.host}:${serverConfig.port}`);
      
      // Create RCON client with enhanced options
      rcon = new Rcon({
        host: serverConfig.host,
        port: parseInt(serverConfig.port),
        password: serverConfig.password,
        timeout: this.connectionTimeout,
        encoding: 'utf8'
      });
      
      // Track this connection
      this.activeConnections.add(connectionId);
      
      // Connect with timeout and retry logic
      console.log(`⏱️ [${connectionId}] Connecting with ${this.connectionTimeout}ms timeout...`);
      
      let connected = false;
      let lastError = null;
      
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          await Promise.race([
            rcon.connect(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Connection timeout')), this.connectionTimeout)
            )
          ]);
          connected = true;
          break;
        } catch (error) {
          lastError = error;
          console.warn(`⚠️ [${connectionId}] Connection attempt ${attempt}/${this.maxRetries} failed: ${error.message}`);
          
          if (attempt < this.maxRetries) {
            const delay = 1000 * attempt; // Exponential backoff
            console.log(`⏳ [${connectionId}] Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      if (!connected) {
        throw lastError || new Error('Failed to connect after retries');
      }
      
      console.log(`🔗 [${connectionId}] RCON connected to ${serverConfig.serverKey} successfully`);

      // Execute command with timeout
      console.log(`📤 [${connectionId}] Executing: ${command}`);
      const response = await Promise.race([
        rcon.send(command),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Command execution timeout')), this.commandTimeout)
        )
      ]);
      
      console.log(`✅ [${connectionId}] Command executed successfully on ${serverConfig.serverKey}`);
      
      // Process response
      let responseText = this.extractResponseText(response);
      console.log(`📨 [${connectionId}] Response:`, responseText.substring(0, 200) + (responseText.length > 200 ? '...' : ''));

      // Reset failure counter on success
      serverConfig.consecutiveFailures = 0;
      serverConfig.lastConnection = new Date();
      serverConfig.lastError = null;

      // Log successful command
      logService.logRconCommand(command, 'success', {
        response: responseText.substring(0, 500), // ลดขนาด log
        host: serverConfig.host,
        port: serverConfig.port,
        serverKey: serverConfig.serverKey,
        connectionId: connectionId,
        executionTime: Date.now() - parseInt(connectionId.split('_')[0])
      });

      return {
        success: true,
        error: null,
        response: responseText,
        serverKey: serverConfig.serverKey
      };

    } catch (error) {
      console.error(`❌ [${connectionId}] RCON Error on ${serverConfig.serverKey}:`, error.message);
      serverConfig.consecutiveFailures++;
      serverConfig.lastError = error.message;

      // Log failed command
      logService.logRconCommand(command, 'failed', {
        error: error.message,
        host: serverConfig.host,
        port: serverConfig.port,
        serverKey: serverConfig.serverKey,
        connectionId: connectionId,
        consecutiveFailures: serverConfig.consecutiveFailures
      });

      return {
        success: false,
        error: error.message,
        response: null,
        serverKey: serverConfig.serverKey
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
    const closeTimeout = 3000;
    
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

  // Enhanced utility methods
  async giveItemToServer(serverKey, steam64, itemPath, quantity = 1, quality = 0, blueprintType = 0) {
    console.log(`🎁 Giving item to ${steam64} on ${serverKey}: ${this.extractItemName(itemPath)} x${quantity}`);
    
    if (!steam64 || !itemPath) {
      console.error('❌ Missing required parameters for giveItem');
      return {
        success: false,
        error: 'Missing required parameters: steam64 or itemPath',
        response: null,
        serverKey: serverKey
      };
    }

    // Validate server exists
    if (!this.servers.has(serverKey)) {
      console.error(`❌ Server ${serverKey} not found for item giving`);
      return {
        success: false,
        error: `Server ${serverKey} not found`,
        response: null,
        serverKey: serverKey
      };
    }

    const command = `giveitem ${steam64} "${itemPath}" ${quantity} ${quality} ${blueprintType}`;
    const result = await this.executeCommandOnServer(serverKey, command);
    
    if (result.success) {
      console.log(`✅ Successfully gave ${quantity}x ${this.extractItemName(itemPath)} to ${steam64} on ${serverKey}`);
    } else {
      console.error(`❌ Failed to give item to ${steam64} on ${serverKey}:`, result.error);
    }
    
    return result;
  }

  async givePointsToServer(serverKey, steam64, amount) {
    console.log(`💰 Adding ${amount} points to ${steam64} on ${serverKey}`);
    
    if (!steam64 || !amount) {
      return {
        success: false,
        error: 'Missing required parameters: steam64 or amount',
        response: null,
        serverKey: serverKey
      };
    }

    // Validate server exists
    if (!this.servers.has(serverKey)) {
      console.error(`❌ Server ${serverKey} not found for points giving`);
      return {
        success: false,
        error: `Server ${serverKey} not found`,
        response: null,
        serverKey: serverKey
      };
    }

    const command = `AddPoints ${steam64} ${amount}`;
    const result = await this.executeCommandOnServer(serverKey, command);
    
    if (result.success) {
      console.log(`✅ Successfully gave ${amount} points to ${steam64} on ${serverKey}`);
    } else {
      console.error(`❌ Failed to give points to ${steam64} on ${serverKey}:`, result.error);
    }
    
    return result;
  }

  async executeRankCommands(serverKey, steam64, rankCommands) {
    console.log(`👑 Executing rank commands for ${steam64} on ${serverKey}`);
    
    if (!rankCommands || !Array.isArray(rankCommands)) {
      return {
        success: false,
        error: 'No rank commands provided',
        response: null,
        serverKey: serverKey
      };
    }

    const results = [];
    let allSuccess = true;

    for (const command of rankCommands) {
      const processedCommand = command.replace('{steam64}', steam64);
      console.log(`👑 Executing rank command: ${processedCommand}`);
      
      const result = await this.executeCommandOnServer(serverKey, processedCommand);
      results.push(result);
      
      if (!result.success) {
        allSuccess = false;
        console.error(`❌ Rank command failed: ${processedCommand}`);
        break;
      }
    }

    return {
      success: allSuccess,
      error: allSuccess ? null : 'One or more rank commands failed',
      response: results.map(r => r.response).join('\n'),
      serverKey: serverKey,
      commandResults: results
    };
  }

  async testServerConnection(serverKey) {
    const serverConfig = this.servers.get(serverKey);
    
    if (!serverConfig) {
      return {
        success: false,
        error: `Server ${serverKey} not found`,
        response: null,
        serverKey: serverKey,
        target: 'unknown'
      };
    }

    console.log(`🧪 Testing RCON connection to ${serverKey} (${serverConfig.host}:${serverConfig.port})`);
    
    try {
      const testCommand = 'echo "RCON Connection Test"';
      const result = await this.executeCommandOnServer(serverKey, testCommand);
      
      console.log(`🧪 Test result for ${serverKey}:`, result.success ? 'SUCCESS ✅' : 'FAILED ❌');
      
      return {
        ...result,
        target: `${serverConfig.host}:${serverConfig.port}`,
        testCommand: testCommand
      };
    } catch (error) {
      console.error(`🧪 Test failed for ${serverKey}:`, error.message);
      return {
        success: false,
        error: error.message,
        serverKey: serverKey,
        target: `${serverConfig.host}:${serverConfig.port}`
      };
    }
  }

  async testAllServers() {
    console.log('🧪 Testing all RCON servers...');
    
    const results = {};
    const servers = this.getAllServers();
    
    for (const server of servers) {
      if (server.enabled) {
        results[server.serverKey] = await this.testServerConnection(server.serverKey);
      } else {
        results[server.serverKey] = {
          success: false,
          error: 'Server disabled',
          serverKey: server.serverKey,
          target: `${server.host}:${server.port}`
        };
      }
    }
    
    const summary = {
      total: Object.keys(results).length,
      successful: Object.values(results).filter(r => r.success).length,
      failed: Object.values(results).filter(r => !r.success).length,
      results: results
    };
    
    console.log(`🧪 Test Summary: ${summary.successful}/${summary.total} servers responding`);
    
    return summary;
  }

  getConfiguration() {
    const servers = this.getAllServers();
    
    return {
      isInitialized: this.isInitialized,
      totalServers: this.servers.size,
      enabledServers: servers.filter(s => s.enabled).length,
      availableServers: servers.filter(s => s.enabled && s.isAvailable).length,
      servers: servers,
      activeConnections: this.activeConnections.size,
      connectionTimeout: this.connectionTimeout,
      commandTimeout: this.commandTimeout,
      maxRetries: this.maxRetries
    };
  }

  getServerStatus(serverKey) {
    const server = this.getServerByKey(serverKey);
    if (!server) {
      return null;
    }

    return {
      ...server,
      status: server.enabled && server.isAvailable ? 'online' : 'offline',
      healthScore: this.calculateHealthScore(server)
    };
  }

  calculateHealthScore(server) {
    if (server.totalCommands === 0) return 100;
    
    const successRate = (server.successfulCommands / server.totalCommands) * 100;
    const failurePenalty = server.consecutiveFailures * 10;
    
    return Math.max(0, Math.min(100, successRate - failurePenalty));
  }

  resetServerFailures(serverKey) {
    const serverConfig = this.servers.get(serverKey);
    if (serverConfig) {
      serverConfig.consecutiveFailures = 0;
      serverConfig.isAvailable = serverConfig.enabled;
      serverConfig.lastError = null;
      console.log(`🔄 Reset failures for server ${serverKey}`);
      return true;
    }
    console.warn(`⚠️ Server ${serverKey} not found for failure reset`);
    return false;
  }

  resetAllFailures() {
    let resetCount = 0;
    for (const [serverKey, serverConfig] of this.servers.entries()) {
      serverConfig.consecutiveFailures = 0;
      serverConfig.isAvailable = serverConfig.enabled;
      serverConfig.lastError = null;
      resetCount++;
    }
    console.log(`🔄 Reset failures for ${resetCount} servers`);
    return resetCount;
  }

  setServerAvailability(serverKey, isAvailable) {
    const serverConfig = this.servers.get(serverKey);
    if (serverConfig) {
      serverConfig.isAvailable = isAvailable && serverConfig.enabled;
      console.log(`⚙️ Set server ${serverKey} availability to ${isAvailable}`);
      return true;
    }
    return false;
  }

  extractItemName(itemPath) {
    if (!itemPath) return 'Unknown Item';
    
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

  // Utility method สำหรับหา server ที่ดีที่สุด
  getBestAvailableServer() {
    const availableServers = this.getAvailableServers();
    
    if (availableServers.length === 0) {
      return null;
    }

    // หา server ที่มี health score ดีที่สุด
    return availableServers.reduce((best, current) => {
      const currentHealth = this.calculateHealthScore(current);
      const bestHealth = this.calculateHealthScore(best);
      
      return currentHealth > bestHealth ? current : best;
    });
  }

  // Method สำหรับส่งคำสั่งไปหลาย server
  async executeCommandOnMultipleServers(serverKeys, command) {
    const results = {};
    
    for (const serverKey of serverKeys) {
      results[serverKey] = await this.executeCommandOnServer(serverKey, command);
    }
    
    return results;
  }

  async shutdown() {
    console.log('🛑 RCON Manager shutting down...');
    console.log(`🔌 Closing ${this.activeConnections.size} active connections...`);
    
    // Force close any remaining connections
    this.activeConnections.clear();
    
    // Clear server configurations
    this.servers.clear();
    this.isInitialized = false;
    
    console.log('✅ RCON Manager shutdown complete');
  }

  // Method สำหรับ health check
  async healthCheck() {
    const config = this.getConfiguration();
    const testResults = await this.testAllServers();
    
    return {
      status: config.isInitialized && testResults.successful > 0 ? 'healthy' : 'unhealthy',
      initialized: config.isInitialized,
      totalServers: config.totalServers,
      availableServers: config.availableServers,
      activeConnections: config.activeConnections,
      testResults: testResults,
      timestamp: new Date().toISOString()
    };
  }
}

export default new RconManager();