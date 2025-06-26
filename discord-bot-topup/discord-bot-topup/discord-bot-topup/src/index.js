// src/index.js
const { Client, GatewayIntentBits } = require("discord.js");
const configService = require("./services/configService");
const databaseService = require("./services/databaseService");
const logService = require("./services/logService"); // ย้ายมาไว้ด้านบน

// Import utilities first (ไม่ต้องใช้ config)
const ErrorHandler = require("./utils/errorHandler");
const DebugHelper = require("./utils/debugHelper");
const ResponseHelper = require("./utils/responseHelper");

class DiscordBot {
  constructor() {
    this.client = null;
    this.topupSystem = null;
    this.isShuttingDown = false;
    
    // Initialize dependent services after config is loaded
    this.webhookService = null;
    this.slipVerification = null; 
    this.rconManager = null;
    this.TopupSystem = null;
  }

  async init() {
    try {
      await logService.info("Starting NEXArk Discord Bot..."); // ใช้ logService ตรงๆ

      // Test and load configuration FIRST
      await this.initializeConfiguration();

      // THEN initialize services that need config
      await this.initializeDependentServices();

      // Initialize Discord client
      await this.initializeDiscordClient();

      // Initialize database
      await this.initializeDatabase();

      // Test services
      await this.testServices();

      // Setup event listeners
      this.setupEventListeners();

      // Login bot
      await this.loginBot();

      await logService.info("NEXArk Discord Bot started successfully");
    } catch (error) {
      await logService.error("Bot startup failed:", error);
      process.exit(1);
    }
  }

  async initializeConfiguration() {
    console.log("Testing configuration file...");
    const configTest = await configService.testConfigFile();
    if (!configTest.success) {
      throw new Error(`Config file test failed: ${configTest.error}`);
    }

    console.log("Loading configuration...");
    await configService.loadConfig();

    // Validate configuration
    const validation = configService.validateConfig();
    if (!validation.isValid) {
      const criticalErrors = validation.errors.filter(
        (error) =>
          !error.includes("RCON") &&
          !error.includes("webhook") &&
          !error.includes("EasySlip")
      );

      if (criticalErrors.length > 0) {
        throw new Error(
          `Critical configuration errors: ${criticalErrors.join(", ")}`
        );
      } else {
        await logService.warn("Non-critical configuration warnings detected", validation.errors);
      }
    }

    console.log("Configuration loaded successfully");
  }

  async initializeDependentServices() {
    console.log("Initializing dependent services...");
    
    // Set configService for databaseService
    databaseService.setConfigService(configService);
    
    // Now require services that need config (after config is loaded)
    this.webhookService = require("./services/webhookService");
    this.slipVerification = require("./components/slipVerification");
    this.rconManager = require("./components/rconManager");
    this.TopupSystem = require("./components/topupSystem");
    
    // Reload configurations for services
    this.webhookService.reloadConfig();
    this.rconManager.reloadConfig();
    
    console.log("Dependent services initialized");
  }

  async initializeDiscordClient() {
    await logService.info("Initializing Discord client...");

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
      ],
      allowedMentions: {
        parse: ["users", "roles"],
        repliedUser: false,
      },
    });

    // Initialize systems
    this.topupSystem = new this.TopupSystem(this.client);
  }

  async initializeDatabase() {
    await logService.info("Connecting to database...");
    await databaseService.connect();
    await databaseService.createTables();
    await logService.info("Database connected and tables created");
  }

  async testServices() {
    await logService.info("Testing services...");

    // Test Slip Verification Service
    const slipVerificationStatus = this.slipVerification.getServiceStatus();
    await logService.info("Slip Verification Status:", slipVerificationStatus);
    
    if (!slipVerificationStatus.enabled) {
      await logService.warn("EasySlip API is DISABLED - using basic validation mode");
    } else {
      await logService.info("EasySlip API is ENABLED and configured properly");
    }

    // Test webhook
    const webhookStatus = this.webhookService.getServiceStatus();
    if (webhookStatus.enabled && webhookStatus.webhookUrlValid) {
      const webhookTest = await this.webhookService.testWebhook();
      if (webhookTest.success) {
        await logService.info("Discord webhook test successful");
      } else {
        await logService.warn("Discord webhook test failed:", webhookTest.error);
      }
    }

    // Test RCON
    const rconConfig = this.rconManager.getConfiguration();
    if (rconConfig.totalServers > 0) {
      const testResults = await this.rconManager.testAllServers();
      await logService.info(
        `RCON test results: ${testResults.successful}/${testResults.total} servers responding`
      );
    }
  }

  setupEventListeners() {
    // Bot ready event
    this.client.once("ready", async () => {
      await logService.info(`Bot ready! Logged in as ${this.client.user.tag}`);
      await logService.info(`Connected to ${this.client.guilds.cache.size} guild(s)`);

      // Set bot status
      this.client.user.setActivity("NEXArk Donation System", {
        type: "WATCHING",
      });

      try {
        await this.topupSystem.init();
        await logService.info("All systems initialized successfully!");

        // Send startup notification
        if (this.webhookService.getServiceStatus().enabled) {
          await this.sendStartupNotification();
        }
      } catch (error) {
        await logService.error("System initialization failed:", error);
      }
    });

    // Interaction handler
    this.client.on("interactionCreate", async (interaction) => {
      if (this.isShuttingDown) {
        await ResponseHelper.safeReply(
          interaction,
          "🔄 ระบบกำลังรีสตาร์ท กรุณารอสักครู่"
        );
        return;
      }

      try {
        if (interaction.isButton()) {
          await this.topupSystem.handleButtonInteraction(interaction);
        } else if (interaction.isStringSelectMenu()) {
          await this.topupSystem.handleSelectMenuInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
          await this.topupSystem.handleModalSubmit(interaction);
        } else if (interaction.isChatInputCommand()) {
          await this.handleSlashCommands(interaction);
        }
      } catch (error) {
        await ErrorHandler.handleInteractionError(
          error,
          interaction,
          "General Interaction"
        );
      }
    });

    // Message handler
    this.client.on("messageCreate", async (message) => {
      if (message.author.bot || this.isShuttingDown) return;

      try {
        if (
          message.channel.name &&
          (message.channel.name.startsWith("topup-") ||
            message.channel.name.startsWith("support-"))
        ) {
          await this.topupSystem.handleSlipSubmission(message);
        }
      } catch (error) {
        await logService.error("Message handling error:", error);
      }
    });

    // Guild events
    this.client.on("guildCreate", async (guild) => {
      await logService.info(`Joined new guild: ${guild.name} (${guild.id})`);
    });

    this.client.on("guildDelete", async (guild) => {
      await logService.info(`Left guild: ${guild.name} (${guild.id})`);
    });

    // Error handling
    this.client.on("error", async (error) => {
      await logService.error("Discord.js error:", error);
    });

    this.client.on("warn", async (warning) => {
      await logService.warn("Discord.js warning:", warning);
    });

    this.client.rest.on("rateLimited", async (rateLimitInfo) => {
      await logService.warn("Rate limited:", rateLimitInfo);
    });
  }

  async handleSlashCommands(interaction) {
    try {
      const { commandName } = interaction;

      await logService.info(`Slash command: /${commandName} by ${interaction.user.tag}`);

      switch (commandName) {
        case "setup_menu":
          await this.handleSetupMenuCommand(interaction);
          break;
        case "test_webhook":
          await this.handleTestWebhookCommand(interaction);
          break;
        case "test_rcon":
          await this.handleTestRconCommand(interaction);
          break;
        case "test_easyslip":
          await this.handleTestEasySlipCommand(interaction);
          break;
        case "bot_status":
          await this.handleBotStatusCommand(interaction);
          break;
        default:
          await ResponseHelper.safeReply(interaction, "❌ คำสั่งนี้ไม่รองรับ");
      }
    } catch (error) {
      await ErrorHandler.handleInteractionError(
        error,
        interaction,
        "Slash Command"
      );
    }
  }

  async handleSetupMenuCommand(interaction) {
    if (!interaction.member.permissions.has("Administrator")) {
      return await ResponseHelper.safeReply(
        interaction,
        "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้"
      );
    }

    await ResponseHelper.safeDefer(interaction);

    try {
      await this.topupSystem.sendMainMenu(interaction.channel);
      await interaction.editReply("✅ ตั้งค่าเมนูหลักเรียบร้อยแล้ว");
    } catch (error) {
      await interaction.editReply("❌ เกิดข้อผิดพลาดในการตั้งค่าเมนู");
    }
  }

  async handleTestWebhookCommand(interaction) {
    if (!interaction.member.permissions.has("Administrator")) {
      return await ResponseHelper.safeReply(
        interaction,
        "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้"
      );
    }

    await ResponseHelper.safeDefer(interaction);

    try {
      const result = await this.webhookService.testWebhook();
      const message = result.success
        ? "✅ ทดสอบ webhook สำเร็จ"
        : `❌ ทดสอบ webhook ล้มเหลว: ${result.error}`;

      await interaction.editReply(message);
    } catch (error) {
      await interaction.editReply("❌ เกิดข้อผิดพลาดในการทดสอบ webhook");
    }
  }

  async handleTestRconCommand(interaction) {
    if (!interaction.member.permissions.has("Administrator")) {
      return await ResponseHelper.safeReply(
        interaction,
        "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้"
      );
    }

    await ResponseHelper.safeDefer(interaction);

    try {
      const rconConfig = this.rconManager.getConfiguration();

      if (rconConfig.totalServers === 0) {
        return await interaction.editReply(
          "❌ ไม่มีเซิร์ฟเวอร์ RCON ที่ตั้งค่าไว้"
        );
      }

      const testResults = await this.rconManager.testAllServers();
      const results = Object.entries(testResults.results).map(
        ([serverKey, result]) =>
          `**${serverKey}**: ${
            result.success ? "✅ สำเร็จ" : `❌ ล้มเหลว (${result.error})`
          }`
      );

      await interaction.editReply(
        `**ผลการทดสอบ RCON:**\n${results.join("\n")}`
      );
    } catch (error) {
      await interaction.editReply("❌ เกิดข้อผิดพลาดในการทดสอบ RCON");
    }
  }

  async handleTestEasySlipCommand(interaction) {
    if (!interaction.member.permissions.has("Administrator")) {
      return await ResponseHelper.safeReply(
        interaction,
        "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้"
      );
    }

    await ResponseHelper.safeDefer(interaction);

    try {
      const slipStatus = this.slipVerification.getServiceStatus();
      const config = configService.get('easyslip', {});
      
      const statusMessage = `
**🔍 EasySlip API Status Report:**

📊 **Current Status:** ${slipStatus.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}
🔑 **API Key Status:** ${slipStatus.apiKeyValid ? '✅ Valid' : '❌ Invalid/Missing'}
⚙️ **Validation Mode:** \`${slipStatus.validationMode}\`
🌐 **API URL:** ${slipStatus.apiUrl || 'Not set'}

**🔧 Status Explanation:**
${slipStatus.enabled 
  ? '✅ **EasySlip API Active:** ใช้การตรวจสอบสลิปแบบแม่นยำผ่าน API' 
  : '⚠️ **Basic Validation Mode:** ใช้การตรวจสอบไฟล์พื้นฐาน (ไม่แม่นยำ)'}
      `;

      await interaction.editReply(statusMessage);
    } catch (error) {
      await interaction.editReply("❌ เกิดข้อผิดพลาดในการตรวจสอบสถานะ EasySlip");
    }
  }

  async handleBotStatusCommand(interaction) {
    if (!interaction.member.permissions.has("Administrator")) {
      return await ResponseHelper.safeReply(
        interaction,
        "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้"
      );
    }

    await ResponseHelper.safeDefer(interaction);

    try {
      const uptime = process.uptime();
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      const memoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const rconConfig = this.rconManager.getConfiguration();
      const webhookStatus = this.webhookService.getServiceStatus();
      const dbHealth = await databaseService.healthCheck();
      const slipStatus = this.slipVerification.getServiceStatus();

      const statusMessage = `
**🤖 สถานะบอท NEXArk**

⏱️ **เวลาทำงาน:** ${days}d ${hours}h ${minutes}m
💾 **หน่วยความจำ:** ${memoryMB} MB
🏠 **เซิร์ฟเวอร์ Discord:** ${this.client.guilds.cache.size} เซิร์ฟเวอร์
🗄️ **ฐานข้อมูล:** ${dbHealth.connected ? "✅ เชื่อมต่อ" : "❌ ขาดการเชื่อมต่อ"}
🎮 **RCON เซิร์ฟเวอร์:** ${rconConfig.totalServers} เซิร์ฟเวอร์
📢 **Discord Webhook:** ${
        webhookStatus.enabled ? "✅ เปิดใช้งาน" : "❌ ปิดใช้งาน"
      }
🧾 **Slip Verification:** ${
        slipStatus.enabled ? "✅ EasySlip API" : "⚠️ Basic Mode"
      }
      `;

      await interaction.editReply(statusMessage);
    } catch (error) {
      await interaction.editReply("❌ เกิดข้อผิดพลาดในการดึงสถานะบอท");
    }
  }

  async loginBot() {
    const token = configService.getDiscordToken();
    await logService.info("Logging in to Discord...");
    await this.client.login(token);
  }

  async sendStartupNotification() {
    try {
      const rconConfig = this.rconManager.getConfiguration();
      const dbHealth = await databaseService.healthCheck();
      const slipStatus = this.slipVerification.getServiceStatus();

      const notificationData = {
        discordId: this.client.user.id,
        discordUsername: "System",
        steam64: "SYSTEM",
        characterId: "SYSTEM",
        category: "system",
        itemName: "Bot Startup",
        amount: 0,
        server: "ALL",
        status: "completed",
        ticketId: "STARTUP",
        playerName: "System",
        timestamp: new Date().toISOString(),
      };

      await this.webhookService.sendDonationNotification(notificationData);
    } catch (error) {
      await logService.error("Error sending startup notification:", error);
    }
  }

  async gracefulShutdown() {
    if (this.isShuttingDown) return;

    await logService.info("Initiating graceful shutdown...");
    this.isShuttingDown = true;

    try {
      // Send shutdown notification
      if (this.webhookService?.getServiceStatus().enabled) {
        await this.sendShutdownNotification();
      }

      // Shutdown systems
      if (this.topupSystem) {
        await this.topupSystem.shutdown();
      }

      if (this.rconManager) {
        await this.rconManager.shutdown();
      }

      // Close database connection
      if (databaseService) {
        await databaseService.close();
      }

      // Destroy Discord client
      if (this.client) {
        this.client.destroy();
      }

      await logService.info("Graceful shutdown completed");
    } catch (error) {
      await logService.error("Error during shutdown:", error);
    }
  }

  async sendShutdownNotification() {
    try {
      const notificationData = {
        discordId: this.client.user.id,
        discordUsername: "System",
        steam64: "SYSTEM",
        characterId: "SYSTEM",
        category: "system",
        itemName: "Bot Shutdown",
        amount: 0,
        server: "ALL",
        status: "cancelled",
        ticketId: "SHUTDOWN",
        playerName: "System",
        timestamp: new Date().toISOString(),
      };

      await this.webhookService.sendDonationNotification(notificationData);
    } catch (error) {
      await logService.error("Error sending shutdown notification:", error);
    }
  }
}

// Start the bot
const bot = new DiscordBot();
bot.init();

// Graceful shutdown handlers
process.on("SIGINT", async () => {
  await logService.info("Received SIGINT, shutting down gracefully...");
  await bot.gracefulShutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await logService.info("Received SIGTERM, shutting down gracefully...");
  await bot.gracefulShutdown();
  process.exit(0);
});

process.on("unhandledRejection", async (error) => {
  await logService.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", async (error) => {
  await logService.error("Uncaught exception:", error);
  setTimeout(() => process.exit(1), 1000);
});

module.exports = DiscordBot;