// src/components/rconManager.js (Cleaned up)
import { Rcon } from 'rcon-client';
import logService from '../services/logService.js';
import configService from '../services/configService.js';
import DebugHelper from '../utils/debugHelper.js';

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
      this.servers.clear();
      
      const config = configService.getConfig();
      const rconServers = config.rcon_servers || {};

      if (!rconServers || Object.keys(rconServers).length === 0) {
        DebugHelper.warn('No RCON servers found in configuration');
        this.isInitialized = false;
        return;
      }

      let configuredCount = 0;
      let enabledCount = 0;

      for (const [serverKey, serverConfig] of Object.entries(rconServers)) {
        if (!serverConfig) continue;

        const hasHost = !!serverConfig.host;
        const hasPort = !!serverConfig.port;
        const hasPassword = !!serverConfig.password;
        const isEnabled = serverConfig.enabled === true;

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
          if (isEnabled) enabledCount++;

          DebugHelper.log(`RCON server configured: ${serverKey} (${isEnabled ? 'ENABLED' : 'DISABLED'})`);
        } else {
          DebugHelper.warn(`RCON server ${serverKey} missing required fields`);
        }
      }

      if (this.servers.size === 0) {
        DebugHelper.warn('No valid RCON servers configured');
        this.isInitialized = false;
      } else {
        DebugHelper.info(`${this.servers.size} RCON server(s) initialized successfully`);
        this.isInitialized = true;
      }

    } catch (error) {
      DebugHelper.error('Error initializing RCON servers:', error);
      this.isInitialized = false;
    }
  }

  reloadConfig() {
    DebugHelper.info('Reloading RCON server configuration...');
    this.initializeServers();
    return this.getConfiguration();
  }

  getServerConfig(serverKey) {
    const config = this.servers.get(serverKey);
    if (!config) {
      DebugHelper.warn(`Server ${serverKey} not found in RCON manager`);
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

  async executeCommandOnServer(serverKey, command) {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'RCON Manager not initialized',
        response: null,
        serverKey: serverKey
      };
    }

    const serverConfig = this.servers.get(serverKey);
    
    if (!serverConfig) {
      DebugHelper.error(`Server ${serverKey} not found`);
      return {
        success: false,
        error: `Server ${serverKey} not configured`,
        response: null,
        serverKey: serverKey
      };
    }

    if (!serverConfig.isAvailable) {
      return {
        success: false,
        error: `Server ${serverKey} is unavailable`,
        response: null,
        serverKey: serverKey
      };
    }

    serverConfig.totalCommands = (serverConfig.totalCommands || 0) + 1;

    if (serverConfig.consecutiveFailures >= 3) {
      return {
        success: false,
        error: `Server ${serverKey} has too many failures`,
        response: null,
        serverKey: serverKey
      };
    }

    try {
      DebugHelper.log(`Executing command on ${serverKey}: ${command}`);
      const result = await this.executeCommandInternal(serverConfig, command);
      
      if (result.success) {
        serverConfig.successfulCommands = (serverConfig.successfulCommands || 0) + 1;
      }
      
      return result;
    } catch (error) {
      DebugHelper.error(`RCON command failed on ${serverKey}:`, error.message);
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
      rcon = new Rcon({
        host: serverConfig.host,
        port: parseInt(serverConfig.port),
        password: serverConfig.password,
        timeout: this.connectionTimeout,
        encoding: 'utf8'
      });
      
      this.activeConnections.add(connectionId);
      
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
          if (attempt < this.maxRetries) {
            const delay = 1000 * attempt;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      if (!connected) {
        throw lastError || new Error('Failed to connect after retries');
      }

      // Execute command with timeout
      const response = await Promise.race([
        rcon.send(command),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Command execution timeout')), this.commandTimeout)
        )
      ]);
      
      let responseText = this.extractResponseText(response);

      // Reset failure counter on success
      serverConfig.consecutiveFailures = 0;
      serverConfig.lastConnection = new Date();
      serverConfig.lastError = null;

      logService.logRconCommand(command, 'success', {
        response: responseText.substring(0, 500),
        host: serverConfig.host,
        port: serverConfig.port,
        serverKey: serverConfig.serverKey
      });

      return {
        success: true,
        error: null,
        response: responseText,
        serverKey: serverConfig.serverKey
      };

    } catch (error) {
      DebugHelper.error(`RCON Error on ${serverConfig.serverKey}:`, error.message);
      serverConfig.consecutiveFailures++;
      serverConfig.lastError = error.message;

      logService.logRconCommand(command, 'failed', {
        error: error.message,
        host: serverConfig.host,
        port: serverConfig.port,
        serverKey: serverConfig.serverKey
      });

      return {
        success: false,
        error: error.message,
        response: null,
        serverKey: serverConfig.serverKey
      };

    } finally {
      if (rcon) {
        await this.forceCloseConnection(rcon, connectionId);
      }
      
      this.activeConnections.delete(connectionId);
    }
  }

  async forceCloseConnection(rcon, connectionId) {
    const closeTimeout = 3000;
    
    try {
      await Promise.race([
        this.closeRconConnection(rcon, connectionId),
        new Promise((resolve) => 
          setTimeout(() => {
            resolve();
          }, closeTimeout)
        )
      ]);
    } catch (error) {
      DebugHelper.warn(`Error during force close:`, error.message);
    }
  }

  async closeRconConnection(rcon, connectionId) {
    try {
      if (typeof rcon.end === 'function') {
        await rcon.end();
      } else if (typeof rcon.disconnect === 'function') {
        await rcon.disconnect();
      } else if (typeof rcon.close === 'function') {
        await rcon.close();
      }
    } catch (closeError) {
      try {
        if (rcon.socket && typeof rcon.socket.destroy === 'function') {
          rcon.socket.destroy();
        }
      } catch (destroyError) {
        // Silent fail
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

  async giveItemToServer(serverKey, steam64, itemPath, quantity = 1, quality = 0, blueprintType = 0) {
    if (!steam64 || !itemPath) {
      return {
        success: false,
        error: 'Missing required parameters: steam64 or itemPath',
        response: null,
        serverKey: serverKey
      };
    }

    if (!this.servers.has(serverKey)) {
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
      DebugHelper.log(`Successfully gave item to ${steam64} on ${serverKey}`);
    }
    
    return result;
  }

  async givePointsToServer(serverKey, steam64, amount) {
    if (!steam64 || !amount) {
      return {
        success: false,
        error: 'Missing required parameters: steam64 or amount',
        response: null,
        serverKey: serverKey
      };
    }

    if (!this.servers.has(serverKey)) {
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
      DebugHelper.log(`Successfully gave ${amount} points to ${steam64} on ${serverKey}`);
    }
    
    return result;
  }

  async executeRankCommands(serverKey, steam64, rankCommands) {
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
      
      const result = await this.executeCommandOnServer(serverKey, processedCommand);
      results.push(result);
      
      if (!result.success) {
        allSuccess = false;
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

    try {
      const testCommand = 'echo "RCON Connection Test"';
      const result = await this.executeCommandOnServer(serverKey, testCommand);
      
      return {
        ...result,
        target: `${serverConfig.host}:${serverConfig.port}`,
        testCommand: testCommand
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        serverKey: serverKey,
        target: `${serverConfig.host}:${serverConfig.port}`
      };
    }
  }

  async testAllServers() {
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
    
    DebugHelper.log(`RCON test completed: ${summary.successful}/${summary.total} servers responding`);
    
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
    if (!server) return null;

    return {
      ...server,
      status: server.enabled && server.isAvailable ? 'online' : 'offline',
      healthScore: this.calculateHealthScore(server)
    };
  }

  getServerByKey(serverKey) {
    return this.getAllServers().find(server => server.serverKey === serverKey);
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
      DebugHelper.log(`Reset failures for server ${serverKey}`);
      return true;
    }
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
    DebugHelper.log(`Reset failures for ${resetCount} servers`);
    return resetCount;
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

  async shutdown() {
    DebugHelper.info('RCON Manager shutting down...');
    this.activeConnections.clear();
    this.servers.clear();
    this.isInitialized = false;
    DebugHelper.info('RCON Manager shutdown complete');
  }

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