// src/index.js (Full Code - เอา ScoreboardManager ออกทั้งหมด)
import { Client, GatewayIntentBits } from "discord.js";
import configService from "./services/configService.js";
import databaseService from "./services/databaseService.js";
import webhookService from "./services/webhookService.js";
import TopupSystem from "./components/topupSystem.js";
// ❌ เอาบรรทัดนี้ออก: import ScoreboardManager from "./components/scoreboardManager.js";
import rconManager from "./components/rconManager.js";
import logService from "./services/logService.js";
import slipVerification from "./components/slipVerification.js";

// Import new utilities
import ErrorHandler from "./utils/errorHandler.js";
import DebugHelper from "./utils/debugHelper.js";
import ResponseHelper from "./utils/responseHelper.js";

class DiscordBot {
  constructor() {
    this.client = null;
    this.topupSystem = null;
    // ❌ เอาบรรทัดนี้ออก: this.scoreboardManager = null;
    this.isShuttingDown = false;
  }

  async init() {
    try {
      DebugHelper.info("Starting NEXArk Discord Bot...");

      // Test and load configuration
      await this.initializeConfiguration();

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

      logService.info("NEXArk Discord Bot started successfully");
    } catch (error) {
      DebugHelper.error("Bot startup failed:", error);
      logService.error("Failed to start NEXArk Discord Bot:", error);
      process.exit(1);
    }
  }

  async initializeConfiguration() {
    DebugHelper.info("Testing configuration file...");
    const configTest = await configService.testConfigFile();
    if (!configTest.success) {
      throw new Error(`Config file test failed: ${configTest.error}`);
    }

    DebugHelper.info("Loading configuration...");
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
        DebugHelper.warn("Non-critical configuration warnings detected");
      }
    }

    // Reinitialize services with new config
    webhookService.reloadConfig();
    rconManager.reloadConfig();

    DebugHelper.info("Configuration loaded and services reinitialized");
  }

  async testServices() {
    DebugHelper.info("Testing services...");

    // Test Slip Verification Service
    console.log("\n🔍 Testing Slip Verification Service...");
    const slipVerificationStatus = slipVerification.getServiceStatus();
    console.log("Slip Verification Status:", slipVerificationStatus);
    
    if (!slipVerificationStatus.enabled) {
      DebugHelper.warn("⚠️ EasySlip API is DISABLED - using basic validation mode");
      DebugHelper.warn("⚠️ This will use basic file validation instead of real slip verification!");
    } else {
      DebugHelper.info("✅ EasySlip API is ENABLED and configured properly");
    }

    // Test webhook
    const webhookStatus = webhookService.getServiceStatus();
    if (webhookStatus.enabled && webhookStatus.webhookUrlValid) {
      const webhookTest = await webhookService.testWebhook();
      if (webhookTest.success) {
        DebugHelper.info("Discord webhook test successful");
      } else {
        DebugHelper.warn("Discord webhook test failed:", webhookTest.error);
      }
    }

    // Test RCON
    const rconConfig = rconManager.getConfiguration();
    if (rconConfig.totalServers > 0) {
      const testResults = await rconManager.testAllServers();
      DebugHelper.info(
        `RCON test results: ${testResults.successful}/${testResults.total} servers responding`
      );
    }
  }

  async initializeDiscordClient() {
    DebugHelper.info("Initializing Discord client...");

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
    this.topupSystem = new TopupSystem(this.client);
    // ❌ เอาบรรทัดนี้ออก: this.scoreboardManager = new ScoreboardManager(this.client);
  }

  async initializeDatabase() {
    DebugHelper.info("Connecting to database...");
    await databaseService.connect();
    await databaseService.createTables();
    DebugHelper.info("Database connected and tables created");
  }

  setupEventListeners() {
    // Bot ready event
    this.client.once("ready", async () => {
      DebugHelper.info(`Bot ready! Logged in as ${this.client.user.tag}`);
      DebugHelper.info(
        `Connected to ${this.client.guilds.cache.size} guild(s)`
      );

      // Set bot status
      this.client.user.setActivity("NEXArk Donation System", {
        type: "WATCHING",
      });

      try {
        await this.topupSystem.init();
        // ❌ เอาบรรทัดนี้ออก: await this.scoreboardManager.init();

        DebugHelper.info("All systems initialized successfully!");

        // Send startup notification
        if (webhookService.getServiceStatus().enabled) {
          await this.sendStartupNotification();
        }
      } catch (error) {
        DebugHelper.error("System initialization failed:", error);
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
          DebugHelper.log("Button interaction received in main handler", {
            customId: interaction.customId,
            userId: interaction.user.id,
          });

          // ❌ เอาส่วนนี้ออก:
          // if (interaction.customId.startsWith("scoreboard_")) {
          //   await this.scoreboardManager.handleScoreboardNavigation(
          //     interaction
          //   );
          // } else {
          //   await this.topupSystem.handleButtonInteraction(interaction);
          // }

          // ✅ แก้เป็น:
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
        DebugHelper.error("Message handling error:", error);
      }
    });

    // Guild events
    this.client.on("guildCreate", (guild) => {
      DebugHelper.info(`Joined new guild: ${guild.name} (${guild.id})`);
    });

    this.client.on("guildDelete", (guild) => {
      DebugHelper.info(`Left guild: ${guild.name} (${guild.id})`);
    });

    // Error handling
    this.client.on("error", (error) => {
      DebugHelper.error("Discord.js error:", error);
    });

    this.client.on("warn", (warning) => {
      DebugHelper.warn("Discord.js warning:", warning);
    });

    this.client.rest.on("rateLimited", (rateLimitInfo) => {
      DebugHelper.warn("Rate limited:", rateLimitInfo);
    });
  }

  async handleSlashCommands(interaction) {
    try {
      const { commandName } = interaction;

      DebugHelper.log(
        `Slash command: /${commandName} by ${interaction.user.tag}`
      );

      switch (commandName) {
        case "setup_menu":
          await this.handleSetupMenuCommand(interaction);
          break;
        // ❌ เอา case นี้ออก:
        // case "setup_scoreboard":
        //   await this.handleSetupScoreboardCommand(interaction);
        //   break;
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

  // ❌ เอา method นี้ออกทั้งหมด:
  // async handleSetupScoreboardCommand(interaction) {
  //   if (!interaction.member.permissions.has("Administrator")) {
  //     return await ResponseHelper.safeReply(
  //       interaction,
  //       "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้"
  //     );
  //   }
  //
  //   await ResponseHelper.safeDefer(interaction);
  //
  //   try {
  //     await this.scoreboardManager.setupPermanentScoreboard(
  //       interaction.channel
  //     );
  //     await interaction.editReply("✅ ตั้งค่า Scoreboard เรียบร้อยแล้ว");
  //   } catch (error) {
  //     await interaction.editReply("❌ เกิดข้อผิดพลาดในการตั้งค่า Scoreboard");
  //   }
  // }

  async handleTestWebhookCommand(interaction) {
    if (!interaction.member.permissions.has("Administrator")) {
      return await ResponseHelper.safeReply(
        interaction,
        "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้"
      );
    }

    await ResponseHelper.safeDefer(interaction);

    try {
      const result = await webhookService.testWebhook();
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
      const rconConfig = rconManager.getConfiguration();

      if (rconConfig.totalServers === 0) {
        return await interaction.editReply(
          "❌ ไม่มีเซิร์ฟเวอร์ RCON ที่ตั้งค่าไว้"
        );
      }

      const testResults = await rconManager.testAllServers();
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
      const slipStatus = slipVerification.getServiceStatus();
      const config = configService.get('easyslip', {});
      
      const statusMessage = `
**🔍 EasySlip API Status Report:**

📊 **Current Status:** ${slipStatus.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}
🔑 **API Key Status:** ${slipStatus.apiKeyValid ? '✅ Valid' : '❌ Invalid/Missing'}
⚙️ **Validation Mode:** \`${slipStatus.validationMode}\`
🌐 **API URL:** ${slipStatus.apiUrl || 'Not set'}

**📋 Configuration Details:**
\`\`\`json
{
  "enabled": ${config.enabled || false},
  "api_key": "${config.api_key ? config.api_key.substring(0, 10) + '...' : 'NOT_SET'}",
  "api_url": "${config.api_url || 'NOT_SET'}"
}
\`\`\`

**🔧 Status Explanation:**
${slipStatus.enabled 
  ? '✅ **EasySlip API Active:** ใช้การตรวจสอบสลิปแบบแม่นยำผ่าน API' 
  : '⚠️ **Basic Validation Mode:** ใช้การตรวจสอบไฟล์พื้นฐาน (ไม่แม่นยำ)'}

${!slipStatus.enabled ? 
`**📝 วิธีแก้ไข:**
1. ตรวจสอบ \`config/config.json\` ในส่วน \`easyslip\`
2. ตั้งค่า \`"enabled": true\`
3. ใส่ API Key จริงใน \`"api_key"\`
4. รีสตาร์ท bot` : ''}
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
      const rconConfig = rconManager.getConfiguration();
      const webhookStatus = webhookService.getServiceStatus();
      const dbHealth = await databaseService.healthCheck();
      const slipStatus = slipVerification.getServiceStatus();

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
    DebugHelper.info("Logging in to Discord...");
    await this.client.login(token);
  }

  async sendStartupNotification() {
    try {
      const rconConfig = rconManager.getConfiguration();
      const dbHealth = await databaseService.healthCheck();
      const slipStatus = slipVerification.getServiceStatus();

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

      await webhookService.sendDonationNotification(notificationData);
    } catch (error) {
      DebugHelper.error("Error sending startup notification:", error);
    }
  }

  async gracefulShutdown() {
    if (this.isShuttingDown) return;

    DebugHelper.info("Initiating graceful shutdown...");
    this.isShuttingDown = true;

    try {
      // Send shutdown notification
      if (webhookService?.getServiceStatus().enabled) {
        await this.sendShutdownNotification();
      }

      // Shutdown systems
      if (this.topupSystem) {
        await this.topupSystem.shutdown();
      }

      // ❌ เอาส่วนนี้ออก:
      // if (this.scoreboardManager) {
      //   this.scoreboardManager.shutdown();
      // }

      if (rconManager) {
        await rconManager.shutdown();
      }

      // Close database connection
      if (databaseService) {
        await databaseService.close();
      }

      // Destroy Discord client
      if (this.client) {
        this.client.destroy();
      }

      DebugHelper.info("Graceful shutdown completed");
    } catch (error) {
      DebugHelper.error("Error during shutdown:", error);
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

      await webhookService.sendDonationNotification(notificationData);
    } catch (error) {
      DebugHelper.error("Error sending shutdown notification:", error);
    }
  }
}

// Start the bot
const bot = new DiscordBot();
bot.init();

// Graceful shutdown handlers
process.on("SIGINT", async () => {
  DebugHelper.info("Received SIGINT, shutting down gracefully...");
  await bot.gracefulShutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  DebugHelper.info("Received SIGTERM, shutting down gracefully...");
  await bot.gracefulShutdown();
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  DebugHelper.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  DebugHelper.error("Uncaught exception:", error);
  setTimeout(() => process.exit(1), 1000);
});

export default DiscordBot;