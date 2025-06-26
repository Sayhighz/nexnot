// src/services/databaseService.js (Full Code - ปรับปรุง Connection Handling)
import mysql from "mysql2/promise";
import configService from "./configService.js";

class DatabaseService {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    this.connectionRetries = 0;
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
  }

  async connect() {
    try {
      const dbConfig = configService.getDatabaseConfig();

      // สร้าง connection pool แทน single connection
      this.pool = mysql.createPool({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        port: dbConfig.port || 3306,
        charset: dbConfig.charset || "utf8mb4",
        connectionLimit: dbConfig.connectionLimit || 10,
        acquireTimeout: dbConfig.acquireTimeout || 60000,
        timeout: dbConfig.timeout || 60000,
        reconnect: dbConfig.reconnect !== false,
        idleTimeout: 300000, // 5 minutes
        maxIdle: 5,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        // ✅ เพิ่ม settings สำหรับ connection stability
        supportBigNumbers: true,
        bigNumberStrings: true,
        multipleStatements: false,
        trace: false,
        stringifyObjects: false
      });

      // ทดสอบ connection
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();

      this.isConnected = true;
      this.connectionRetries = 0;
      console.log("✅ Database pool created successfully");
    } catch (error) {
      console.error("❌ Database connection failed:", error);
      this.isConnected = false;
      throw error;
    }
  }

  async getConnection() {
    if (!this.pool) {
      await this.connect();
    }

    try {
      const connection = await this.pool.getConnection();
      return connection;
    } catch (error) {
      console.error("❌ Failed to get connection from pool:", error);

      // ลองสร้าง pool ใหม่
      try {
        await this.reconnect();
        return await this.pool.getConnection();
      } catch (retryError) {
        console.error("❌ Retry connection failed:", retryError);
        throw retryError;
      }
    }
  }

  // ✅ เพิ่ม method สำหรับ reconnect
  async reconnect() {
    console.log("🔄 Attempting to reconnect to database...");
    
    if (this.pool) {
      try {
        await this.pool.end();
      } catch (error) {
        console.warn("Warning during pool cleanup:", error.message);
      }
    }
    
    this.pool = null;
    this.isConnected = false;
    
    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
    await this.connect();
  }

  // ✅ ปรับปรุง executeQuery ให้มี retry mechanism
  async executeQuery(query, params = [], maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let connection;
      
      try {
        connection = await this.getConnection();
        const [result] = await connection.execute(query, params);
        return result;
      } catch (error) {
        lastError = error;
        console.error(`❌ Database query error (attempt ${attempt}/${maxRetries}):`, error.message);
        
        // ตรวจสอบว่าเป็น connection error หรือไม่
        if (this.isConnectionError(error) && attempt < maxRetries) {
          console.log(`🔄 Retrying query in ${this.retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          
          // พยายาม reconnect
          try {
            await this.reconnect();
          } catch (reconnectError) {
            console.error("Failed to reconnect:", reconnectError.message);
          }
        } else {
          // ถ้าไม่ใช่ connection error หรือหมด retry แล้ว ให้ throw error
          break;
        }
      } finally {
        if (connection) {
          connection.release();
        }
      }
    }
    
    throw lastError;
  }

  // ✅ เพิ่ม method ตรวจสอบ connection error
  isConnectionError(error) {
    const connectionErrorCodes = [
      'ECONNRESET',
      'ECONNREFUSED', 
      'ETIMEDOUT',
      'ENOTFOUND',
      'ER_SERVER_GONE_ERROR',
      'PROTOCOL_CONNECTION_LOST',
      'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
    ];
    
    return connectionErrorCodes.some(code => 
      error.code === code || 
      error.errno === code ||
      error.message.includes(code)
    );
  }

  // เดิมที่มีอยู่แล้ว (ไม่ต้องแก้ไข)
  safeParseJSON(data) {
    try {
      if (typeof data === "string") {
        return JSON.parse(data);
      } else if (typeof data === "object" && data !== null) {
        return data;
      } else {
        return {};
      }
    } catch (error) {
      console.warn("⚠️ Failed to parse JSON data:", error);
      return {};
    }
  }

  async getDiscordUserData(discordId) {
    const query = "SELECT * FROM ngc_discord_users WHERE guid = ?";
    try {
      const rows = await this.executeQuery(query, [discordId]);
      if (rows.length > 0) {
        const userData = rows[0];
        userData.parsedData = this.safeParseJSON(userData.data);
        return userData;
      }
      return null;
    } catch (error) {
      console.error("❌ Error getting discord user data:", error);
      throw error;
    }
  }

  async getPlayerData(steam64) {
    const query = "SELECT * FROM ngc_players WHERE guid = ?";
    try {
      const rows = await this.executeQuery(query, [steam64]);
      if (rows.length > 0) {
        const playerData = rows[0];
        playerData.parsedData = this.safeParseJSON(playerData.data);
        return playerData;
      }
      return null;
    } catch (error) {
      console.error("❌ Error getting player data:", error);
      throw error;
    }
  }

  async getSteam64FromDiscord(discordId) {
    try {
      const userData = await this.getDiscordUserData(discordId);
      if (userData && userData.parsedData?.entityInfo?.LinkedId_ASE) {
        return userData.parsedData.entityInfo.LinkedId_ASE;
      }
      return null;
    } catch (error) {
      console.error("❌ Error getting Steam64 from Discord ID:", error);
      throw error;
    }
  }

  async getCharacterIdFromSteam64(steam64) {
    try {
      const playerData = await this.getPlayerData(steam64);
      if (
        playerData &&
        playerData.parsedData?.entityInfo?.MostRecentCharacterId
      ) {
        return playerData.parsedData.entityInfo.MostRecentCharacterId;
      }
      return null;
    } catch (error) {
      console.error("❌ Error getting Character ID from Steam64:", error);
      throw error;
    }
  }

  async getUserGameInfo(discordId) {
    try {
      const steam64 = await this.getSteam64FromDiscord(discordId);
      if (!steam64) {
        return {
          isLinked: false,
          steam64: null,
          characterId: null,
          userData: null,
          playerData: null,
        };
      }

      const characterId = await this.getCharacterIdFromSteam64(steam64);
      const userData = await this.getDiscordUserData(discordId);
      const playerData = await this.getPlayerData(steam64);

      return {
        isLinked: true,
        steam64: steam64,
        characterId: characterId,
        userData: userData,
        playerData: playerData,
      };
    } catch (error) {
      console.error("❌ Error getting user game info:", error);
      throw error;
    }
  }

  async createTables() {
    const createTopupLogsTable = `
      CREATE TABLE IF NOT EXISTS topup_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(20) NOT NULL,
        discord_username VARCHAR(100) NOT NULL,
        steam64 VARCHAR(20),
        character_id VARCHAR(20),
        category VARCHAR(20) NOT NULL,
        item_id VARCHAR(50) NOT NULL,
        item_name VARCHAR(100) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        slip_image_url TEXT,
        verification_data JSON,
        status ENUM('pending', 'verified', 'failed', 'completed', 'cancelled') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        ticket_channel_id VARCHAR(20),
        ticket_id VARCHAR(20),
        rcon_executed BOOLEAN DEFAULT FALSE,
        error_message TEXT,
        INDEX idx_discord_id (discord_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        INDEX idx_ticket_id (ticket_id),
        INDEX idx_category (category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    const createSlipHashTable = `
      CREATE TABLE IF NOT EXISTS slip_hashes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slip_hash VARCHAR(64) UNIQUE NOT NULL,
        discord_id VARCHAR(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_slip_hash (slip_hash),
        INDEX idx_discord_id (discord_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    const createActiveTicketsTable = `
      CREATE TABLE IF NOT EXISTS active_tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(20) NOT NULL,
        channel_id VARCHAR(20) NOT NULL,
        ticket_id VARCHAR(20) NOT NULL,
        ticket_type ENUM('donation', 'support') DEFAULT 'donation',
        status ENUM('active', 'processing', 'completed', 'cancelled') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_discord_id (discord_id),
        INDEX idx_channel_id (channel_id),
        INDEX idx_ticket_id (ticket_id),
        INDEX idx_ticket_type (ticket_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    try {
      await this.executeQuery(createTopupLogsTable);
      await this.executeQuery(createSlipHashTable);
      await this.executeQuery(createActiveTicketsTable);
      console.log("✅ Database tables created/verified");
    } catch (error) {
      console.error("❌ Error creating tables:", error);
      throw error;
    }
  }


  // ส่วนอื่นๆ ยังเหมือนเดิม (logDonationTransaction, updateTopupStatus, etc.)
  async logDonationTransaction(data) {
    const query = `
      INSERT INTO topup_logs 
      (discord_id, discord_username, steam64, character_id, category, item_id, item_name, amount, 
       ticket_channel_id, ticket_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
      const result = await this.executeQuery(query, [
        data.discordId,
        data.discordUsername,
        data.steam64,
        data.characterId,
        data.category,
        data.itemId,
        data.itemName,
        data.amount,
        data.ticketChannelId,
        data.ticketId,
        data.status || "pending",
      ]);
      return result.insertId;
    } catch (error) {
      console.error("❌ Error logging donation transaction:", error);
      throw error;
    }
  }

  async updateTopupStatus(id, status, additionalData = {}) {
    const fields = ["status = ?"];
    const values = [status];

    if (status === "verified") {
      fields.push("verified_at = NOW()");
    }
    if (status === "completed") {
      fields.push("completed_at = NOW()");
    }
    if (additionalData.verificationData) {
      fields.push("verification_data = ?");
      values.push(JSON.stringify(additionalData.verificationData));
    }
    if (additionalData.slipImageUrl) {
      fields.push("slip_image_url = ?");
      values.push(additionalData.slipImageUrl);
    }
    if (additionalData.errorMessage) {
      fields.push("error_message = ?");
      values.push(additionalData.errorMessage);
    }
    if (additionalData.rconExecuted !== undefined) {
      fields.push("rcon_executed = ?");
      values.push(additionalData.rconExecuted);
    }

    const query = `UPDATE topup_logs SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    try {
      await this.executeQuery(query, values);
    } catch (error) {
      console.error("❌ Error updating topup status:", error);
      throw error;
    }
  }

  async checkSlipHash(slipHash) {
    const query = "SELECT * FROM slip_hashes WHERE slip_hash = ?";
    try {
      const rows = await this.executeQuery(query, [slipHash]);
      return rows.length > 0;
    } catch (error) {
      console.error("❌ Error checking slip hash:", error);
      throw error;
    }
  }

  async saveSlipHash(slipHash, discordId, amount) {
    const query =
      "INSERT INTO slip_hashes (slip_hash, discord_id, amount) VALUES (?, ?, ?)";
    try {
      await this.executeQuery(query, [slipHash, discordId, amount]);
    } catch (error) {
      console.error("❌ Error saving slip hash:", error);
      throw error;
    }
  }

  async getActiveTickets(discordId) {
    const query = `
      SELECT * FROM active_tickets 
      WHERE discord_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `;

    try {
      const rows = await this.executeQuery(query, [discordId]);
      return rows;
    } catch (error) {
      console.error("❌ Error getting active tickets:", error);
      throw error;
    }
  }

  async createActiveTicket(
    discordId,
    channelId,
    ticketId,
    ticketType = "donation"
  ) {
    const query = `
      INSERT INTO active_tickets (discord_id, channel_id, ticket_id, ticket_type)
      VALUES (?, ?, ?, ?)
    `;

    try {
      const result = await this.executeQuery(query, [
        discordId,
        channelId,
        ticketId,
        ticketType,
      ]);
      return result.insertId;
    } catch (error) {
      console.error("❌ Error creating active ticket:", error);
      throw error;
    }
  }

  async updateTicketStatus(ticketId, status) {
    const query = "UPDATE active_tickets SET status = ? WHERE ticket_id = ?";

    try {
      await this.executeQuery(query, [status, ticketId]);
    } catch (error) {
      console.error("❌ Error updating ticket status:", error);
      throw error;
    }
  }

  async getTopupByTicketId(ticketId) {
    const query = "SELECT * FROM topup_logs WHERE ticket_id = ?";

    try {
      const rows = await this.executeQuery(query, [ticketId]);
      return rows[0] || null;
    } catch (error) {
      console.error("❌ Error getting topup by ticket ID:", error);
      throw error;
    }
  }

  async getActiveSupportTickets(discordId) {
    const query = `
    SELECT * FROM active_tickets 
    WHERE discord_id = ? AND status = 'active' AND ticket_type = 'support'
    ORDER BY created_at DESC
  `;

    try {
      const rows = await this.executeQuery(query, [discordId]);
      return rows;
    } catch (error) {
      console.error("❌ Error getting active support tickets:", error);
      throw error;
    }
  }

  async getActiveDonationTickets(discordId) {
    const query = `
    SELECT * FROM active_tickets 
    WHERE discord_id = ? AND status = 'active' AND ticket_type = 'donation'
    ORDER BY created_at DESC
  `;

    try {
      const rows = await this.executeQuery(query, [discordId]);
      return rows;
    } catch (error) {
      console.error("❌ Error getting active donation tickets:", error);
      throw error;
    }
  }

  async getPlayerOnlineStatus(steam64) {
    const query = "SELECT * FROM ngc_players WHERE guid = ?";
    try {
      const rows = await this.executeQuery(query, [steam64]);
      if (rows.length > 0) {
        const playerData = rows[0];
        const parsedData = this.safeParseJSON(playerData.data);

        if (parsedData.entityInfo) {
          return {
            isOnline: parsedData.entityInfo.Status === "ONLINE",
            serverKey: parsedData.entityInfo.ServerKey,
            playerName: parsedData.entityInfo.Name,
            lastJoinTime: parsedData.entityInfo.LastJoinTime,
            lastLogoutTime: parsedData.entityInfo.LastLogoutTime,
            totalPlayTime: parsedData.entityInfo.TotalTimePlayedSecs,
            ipAddress: parsedData.entityInfo.IpAddress,
            characterId: parsedData.entityInfo.MostRecentCharacterId,
          };
        }
      }
      return {
        isOnline: false,
        serverKey: null,
        playerName: null,
        lastJoinTime: null,
        lastLogoutTime: null,
        totalPlayTime: 0,
        ipAddress: null,
        characterId: null,
      };
    } catch (error) {
      console.error("❌ Error getting player online status:", error);
      throw error;
    }
  }

  async getOnlinePlayersInServer(serverKey) {
    const query = `
    SELECT guid, data 
    FROM ngc_players 
    WHERE JSON_EXTRACT(data, '$.entityInfo.Status') = 'ONLINE'
    AND JSON_EXTRACT(data, '$.entityInfo.ServerKey') = ?
  `;

    try {
      const rows = await this.executeQuery(query, [serverKey]);
      return rows.map((row) => {
        const parsedData = this.safeParseJSON(row.data);
        return {
          steam64: row.guid,
          playerName: parsedData.entityInfo?.Name,
          characterId: parsedData.entityInfo?.MostRecentCharacterId,
          lastJoinTime: parsedData.entityInfo?.LastJoinTime,
          ipAddress: parsedData.entityInfo?.IpAddress,
          totalPlayTime: parsedData.entityInfo?.TotalTimePlayedSecs,
        };
      });
    } catch (error) {
      console.error("❌ Error getting online players in server:", error);
      throw error;
    }
  }

  async getServerPlayerCounts() {
    const query = `
    SELECT 
      JSON_EXTRACT(data, '$.entityInfo.ServerKey') as serverKey,
      COUNT(*) as playerCount
    FROM ngc_players 
    WHERE JSON_EXTRACT(data, '$.entityInfo.Status') = 'ONLINE'
    GROUP BY JSON_EXTRACT(data, '$.entityInfo.ServerKey')
  `;

    try {
      const rows = await this.executeQuery(query);
      const result = {};
      rows.forEach((row) => {
        const serverKey = row.serverKey?.replace(/"/g, "");
        if (serverKey) {
          result[serverKey] = parseInt(row.playerCount);
        }
      });
      return result;
    } catch (error) {
      console.error("❌ Error getting server player counts:", error);
      throw error;
    }
  }

  async getPlayerServerHistory(steam64, limit = 10) {
    const query = "SELECT * FROM ngc_players WHERE guid = ?";
    try {
      const rows = await this.executeQuery(query, [steam64]);
      if (rows.length > 0) {
        const playerData = rows[0];
        const parsedData = this.safeParseJSON(playerData.data);

        return {
          currentServer: parsedData.entityInfo?.ServerKey,
          previousServer: parsedData.entityInfo?.PreviousServerKey,
          lastJoinTime: parsedData.entityInfo?.LastJoinTime,
          lastLogoutTime: parsedData.entityInfo?.LastLogoutTime,
          totalPlayTime: parsedData.entityInfo?.TotalTimePlayedSecs,
          isOnline: parsedData.entityInfo?.Status === "ONLINE",
        };
      }
      return null;
    } catch (error) {
      console.error("❌ Error getting player server history:", error);
      throw error;
    }
  }

  // ✅ ปรับปรุง healthCheck ให้ดีขึ้น
  async healthCheck() {
    try {
      const connection = await this.getConnection();
      await connection.ping();
      connection.release();
      return { 
        status: "healthy", 
        connected: true,
        connectionRetries: this.connectionRetries,
        lastError: null
      };
    } catch (error) {
      return { 
        status: "unhealthy", 
        connected: false, 
        error: error.message,
        connectionRetries: this.connectionRetries
      };
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      console.log("✅ Database pool closed");
    }
  }
}

export default new DatabaseService();