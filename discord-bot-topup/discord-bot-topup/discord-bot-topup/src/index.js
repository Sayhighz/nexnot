// src/index.js
import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import configService from "./services/configService.js";
import databaseService from "./services/databaseService.js";
import webhookService from "./services/webhookService.js";
import TopupSystem from "./components/topupSystem.js";
import ScoreboardManager from "./components/scoreboardManager.js";
import rconManager from "./components/rconManager.js";
import logService from "./services/logService.js";

class DiscordBot {
  constructor() {
    this.client = null;
    this.topupSystem = null;
    this.scoreboardManager = null;
    this.webhookService = null;
    this.rconManager = null;
    this.isShuttingDown = false;
  }

  // ส่วนของ init() method ใน src/index.js

async init() {
  try {
    console.log('🚀 Starting NEXArk Discord Bot...');
    
    // Test config file first
    console.log('🧪 Testing configuration file...');
    const configTest = await configService.testConfigFile();
    if (!configTest.success) {
      console.error('❌ Config file test failed:', configTest.error);
      process.exit(1);
    }
    console.log('✅ Config file test passed');
    
    // Load configuration
    console.log('📁 Loading configuration...');
    await configService.loadConfig();
    console.log('✅ Configuration loaded successfully');

    // Validate configuration
    console.log('🔍 Validating configuration...');
    const validation = configService.validateConfig();
    if (!validation.isValid) {
      console.error('❌ Configuration validation failed:');
      validation.errors.forEach(error => console.error(`  - ${error}`));
      
      // ไม่ exit หาก error เป็นเรื่อง RCON หรือ webhook
      const criticalErrors = validation.errors.filter(error => 
        !error.includes('RCON') && 
        !error.includes('webhook') &&
        !error.includes('EasySlip')
      );
      
      if (criticalErrors.length > 0) {
        console.error('❌ Critical configuration errors found');
        process.exit(1);
      } else {
        console.warn('⚠️ Non-critical configuration warnings (continuing...)');
      }
    } else {
      console.log('✅ Configuration validation passed');
    }

    // Show debug info
    console.log('🔍 Configuration debug info:');
    const debugInfo = configService.getDebugInfo();
    console.log(JSON.stringify(debugInfo, null, 2));

    // Initialize Discord client
    console.log('🤖 Initializing Discord client...');
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
      ],
      allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: false
      }
    });

    // Initialize services แต่อย่า fail ถ้า config ไม่ครบ
    console.log('⚙️ Initializing services...');
    this.webhookService = webhookService;
    this.rconManager = rconManager;
    
    // Initialize systems
    this.topupSystem = new TopupSystem(this.client);
    this.scoreboardManager = new ScoreboardManager(this.client);

    // Connect to database
    console.log('🔌 Connecting to database...');
    await databaseService.connect();
    await databaseService.createTables();
    console.log('✅ Database connected and tables created');

    // Test services (don't fail if they're not configured)
    await this.testServices();

    // Setup event listeners
    this.setupEventListeners();

    // Login bot
    const token = configService.getDiscordToken();
    console.log('🔐 Logging in to Discord...');
    await this.client.login(token);

    logService.info("NEXArk Discord Bot started successfully");

  } catch (error) {
    logService.error("Failed to start NEXArk Discord Bot:", error);
    console.error('❌ Bot startup failed:', error);
    process.exit(1);
  }
}

// เพิ่ม method ใหม่
async testServices() {
  console.log('🧪 Testing services...');
  
  // Test webhook
  try {
    const webhookStatus = this.webhookService.getServiceStatus();
    if (webhookStatus.enabled && webhookStatus.webhookUrlValid) {
      console.log('📢 Testing Discord webhook...');
      const webhookTest = await this.webhookService.testWebhook();
      if (webhookTest.success) {
        console.log('✅ Discord webhook test successful');
      } else {
        console.warn('⚠️ Discord webhook test failed:', webhookTest.error);
      }
    } else {
      console.log('📢 Discord webhook disabled or not configured properly');
    }
  } catch (error) {
    console.warn('⚠️ Webhook service error:', error.message);
  }

  // Test RCON
  try {
    const rconConfig = this.rconManager.getConfiguration();
    if (rconConfig.totalServers > 0) {
      console.log(`🎮 Testing ${rconConfig.totalServers} RCON server(s)...`);
      const testResults = await this.rconManager.testAllServers();
      console.log(`🎮 RCON test results: ${testResults.successful}/${testResults.total} servers responding`);
    } else {
      console.log('🎮 No RCON servers configured');
    }
  } catch (error) {
    console.warn('⚠️ RCON service error:', error.message);
  }
}

  setupEventListeners() {
    // Bot ready event
    this.client.once("ready", async () => {
      console.log(`✅ NEXArk Bot is ready! Logged in as ${this.client.user.tag}`);
      console.log(`🏠 Connected to ${this.client.guilds.cache.size} guild(s)`);
      console.log(`👥 Serving ${this.client.users.cache.size} user(s)`);

      // Set bot status
      this.client.user.setActivity('NEXArk Donation System', { 
        type: 'WATCHING' 
      });

      try {
        // Initialize systems
        console.log('🔧 Initializing systems...');
        await this.topupSystem.init();
        await this.scoreboardManager.init();
        
        console.log('🎉 All systems initialized successfully!');
        
        // Send startup notification via webhook
        if (this.webhookService.getServiceStatus().enabled) {
          await this.sendStartupNotification();
        }

      } catch (error) {
        logService.error('Error initializing systems:', error);
        console.error('❌ System initialization failed:', error);
      }
    });

    // Enhanced interaction handler
    this.client.on('interactionCreate', async (interaction) => {
      if (this.isShuttingDown) {
        await this.safeReply(interaction, '🔄 ระบบกำลังรีสตาร์ท กรุณารอสักครู่');
        return;
      }

      try {
        if (interaction.isButton()) {
          // Handle scoreboard navigation
          if (interaction.customId.startsWith('scoreboard_')) {
            await this.scoreboardManager.handleScoreboardNavigation(interaction);
          } else {
            // Handle other buttons
            await this.topupSystem.handleButtonInteraction(interaction);
          }
        } else if (interaction.isStringSelectMenu()) {
          await this.topupSystem.handleSelectMenuInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
          await this.topupSystem.handleModalSubmit(interaction);
        } else if (interaction.isChatInputCommand()) {
          await this.handleSlashCommands(interaction);
        }
      } catch (error) {
        logService.error('Interaction error:', {
          error: error.message,
          stack: error.stack,
          userId: interaction.user?.id,
          guildId: interaction.guild?.id,
          customId: interaction.customId,
          commandName: interaction.commandName
        });
        
        try {
          await this.safeReply(interaction, '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
        } catch (replyError) {
          console.error('Failed to send error reply:', replyError);
        }
      }
    });

    // Message handler for slip verification
    this.client.on("messageCreate", async (message) => {
      if (message.author.bot) return;
      if (this.isShuttingDown) return;

      try {
        // Handle slip verification in ticket channels
        if (message.channel.name && 
           (message.channel.name.startsWith("topup-") || 
            message.channel.name.startsWith("support-"))) {
          await this.topupSystem.handleSlipSubmission(message);
        }
      } catch (error) {
        logService.error("Message handling error:", {
          error: error.message,
          userId: message.author.id,
          channelId: message.channel.id,
          guildId: message.guild?.id
        });
      }
    });

    // Guild events
    this.client.on('guildCreate', (guild) => {
      console.log(`➕ Joined new guild: ${guild.name} (${guild.id})`);
      logService.info('Joined new guild', {
        guildId: guild.id,
        guildName: guild.name,
        memberCount: guild.memberCount
      });
    });

    this.client.on('guildDelete', (guild) => {
      console.log(`➖ Left guild: ${guild.name} (${guild.id})`);
      logService.info('Left guild', {
        guildId: guild.id,
        guildName: guild.name
      });
    });

    // Error handling
    this.client.on('error', (error) => {
      console.error('❌ Discord.js error:', error);
      logService.error('Discord client error:', error);
    });

    this.client.on('warn', (warning) => {
      console.warn('⚠️ Discord.js warning:', warning);
      logService.warn('Discord client warning:', { warning });
    });

    // Rate limit handler
    this.client.rest.on('rateLimited', (rateLimitInfo) => {
      console.warn('⚠️ Rate limited:', rateLimitInfo);
      logService.warn('Rate limited', rateLimitInfo);
    });

    // Disconnection handler
    this.client.on('disconnect', () => {
      console.warn('⚠️ Discord client disconnected');
      logService.warn('Discord client disconnected');
    });

    this.client.on('reconnecting', () => {
      console.log('🔄 Discord client reconnecting...');
      logService.info('Discord client reconnecting');
    });
  }

  async handleSlashCommands(interaction) {
    try {
      const { commandName } = interaction;
      
      console.log(`📝 Slash command: /${commandName} by ${interaction.user.tag}`);
      
      switch (commandName) {
        case 'setup_menu':
          await this.handleSetupMenuCommand(interaction);
          break;
        case 'setup_scoreboard':
          await this.handleSetupScoreboardCommand(interaction);
          break;
        case 'test_webhook':
          await this.handleTestWebhookCommand(interaction);
          break;
        case 'test_rcon':
          await this.handleTestRconCommand(interaction);
          break;
        case 'bot_status':
          await this.handleBotStatusCommand(interaction);
          break;
        default:
          await this.safeReply(interaction, '❌ คำสั่งนี้ไม่รองรับ');
      }
    } catch (error) {
      logService.error('Slash command error:', error);
      
      try {
        await this.safeReply(interaction, '❌ เกิดข้อผิดพลาดในการดำเนินการ');
      } catch (replyError) {
        console.error('Failed to handle command error:', replyError);
      }
    }
  }

  async handleSetupMenuCommand(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return await this.safeReply(interaction, '❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้');
    }

    await interaction.deferReply({ ephemeral: true });
    
    try {
      await this.topupSystem.sendMainMenu(interaction.channel);
      await interaction.editReply('✅ ตั้งค่าเมนูหลักเรียบร้อยแล้ว');
      
      logService.info('Main menu setup', {
        userId: interaction.user.id,
        channelId: interaction.channel.id,
        guildId: interaction.guild.id
      });
    } catch (error) {
      logService.error('Error in setup menu command:', error);
      await interaction.editReply('❌ เกิดข้อผิดพลาดในการตั้งค่าเมนู');
    }
  }

  async handleSetupScoreboardCommand(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return await this.safeReply(interaction, '❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้');
    }

    await interaction.deferReply({ ephemeral: true });
    
    try {
      await this.scoreboardManager.setupPermanentScoreboard(interaction.channel);
      await interaction.editReply('✅ ตั้งค่า Scoreboard เรียบร้อยแล้ว');
      
      logService.info('Scoreboard setup', {
        userId: interaction.user.id,
        channelId: interaction.channel.id,
        guildId: interaction.guild.id
      });
    } catch (error) {
      logService.error('Error in setup scoreboard command:', error);
      await interaction.editReply('❌ เกิดข้อผิดพลาดในการตั้งค่า Scoreboard');
    }
  }

  async handleTestWebhookCommand(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return await this.safeReply(interaction, '❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้');
    }

    await interaction.deferReply({ ephemeral: true });
    
    try {
      const result = await this.webhookService.testWebhook();
      
      if (result.success) {
        await interaction.editReply('✅ ทดสอบ webhook สำเร็จ');
      } else {
        await interaction.editReply(`❌ ทดสอบ webhook ล้มเหลว: ${result.error}`);
      }
      
      logService.info('Webhook test', {
        userId: interaction.user.id,
        success: result.success,
        error: result.error
      });
    } catch (error) {
      logService.error('Error in test webhook command:', error);
      await interaction.editReply('❌ เกิดข้อผิดพลาดในการทดสอบ webhook');
    }
  }

  async handleTestRconCommand(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return await this.safeReply(interaction, '❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้');
    }

    await interaction.deferReply({ ephemeral: true });
    
    try {
      const rconConfig = this.rconManager.getConfiguration();
      
      if (rconConfig.totalServers === 0) {
        return await interaction.editReply('❌ ไม่มีเซิร์ฟเวอร์ RCON ที่ตั้งค่าไว้');
      }

      let results = [];
      
      for (const server of rconConfig.servers) {
        const testResult = await this.rconManager.testServerConnection(server.serverKey);
        results.push(`**${server.serverKey}**: ${testResult.success ? '✅ สำเร็จ' : `❌ ล้มเหลว (${testResult.error})`}`);
      }
      
      await interaction.editReply(`**ผลการทดสอบ RCON:**\n${results.join('\n')}`);
      
      logService.info('RCON test', {
        userId: interaction.user.id,
        totalServers: rconConfig.totalServers,
        results: results
      });
    } catch (error) {
      logService.error('Error in test RCON command:', error);
      await interaction.editReply('❌ เกิดข้อผิดพลาดในการทดสอบ RCON');
    }
  }

  async handleBotStatusCommand(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return await this.safeReply(interaction, '❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้');
    }

    await interaction.deferReply({ ephemeral: true });
    
    try {
      const uptime = process.uptime();
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);
      
      const memoryUsage = process.memoryUsage();
      const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      
      const rconConfig = this.rconManager.getConfiguration();
      const webhookStatus = this.webhookService.getServiceStatus();
      const dbHealth = await databaseService.healthCheck();
      
      const statusEmbed = {
        title: '🤖 สถานะบอท NEXArk',
        color: 0x00FF00,
        fields: [
          {
            name: '⏱️ เวลาทำงาน',
            value: `${days}d ${hours}h ${minutes}m ${seconds}s`,
            inline: true
          },
          {
            name: '💾 หน่วยความจำ',
            value: `${memoryMB} MB`,
            inline: true
          },
          {
            name: '🏠 เซิร์ฟเวอร์ Discord',
            value: `${this.client.guilds.cache.size} เซิร์ฟเวอร์`,
            inline: true
          },
          {
            name: '🗄️ ฐานข้อมูล',
            value: dbHealth.connected ? '✅ เชื่อมต่อ' : '❌ ขาดการเชื่อมต่อ',
            inline: true
          },
          {
            name: '🎮 RCON เซิร์ฟเวอร์',
            value: `${rconConfig.totalServers} เซิร์ฟเวอร์`,
            inline: true
          },
          {
            name: '📢 Discord Webhook',
            value: webhookStatus.enabled ? '✅ เปิดใช้งาน' : '❌ ปิดใช้งาน',
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'NEXArk System Status'
        }
      };
      
      await interaction.editReply({ embeds: [statusEmbed] });
      
      logService.info('Bot status check', {
        userId: interaction.user.id,
        uptime: uptime,
        memoryMB: memoryMB,
        guilds: this.client.guilds.cache.size
      });
    } catch (error) {
      logService.error('Error in bot status command:', error);
      await interaction.editReply('❌ เกิดข้อผิดพลาดในการดึงสถานะบอท');
    }
  }

  async sendStartupNotification() {
    try {
      const rconConfig = this.rconManager.getConfiguration();
      const dbHealth = await databaseService.healthCheck();
      
      const startupEmbed = {
        title: '🚀 NEXArk Bot เริ่มทำงาน',
        description: 'ระบบโดเนทอัตโนมัติพร้อมให้บริการแล้ว!',
        color: 0x00FF00,
        fields: [
          {
            name: '🏠 เซิร์ฟเวอร์ Discord',
            value: `${this.client.guilds.cache.size} เซิร์ฟเวอร์`,
            inline: true
          },
          {
            name: '🎮 RCON เซิร์ฟเวอร์',
            value: `${rconConfig.totalServers} เซิร์ฟเวอร์`,
            inline: true
          },
          {
            name: '🗄️ ฐานข้อมูล',
            value: dbHealth.connected ? '✅ เชื่อมต่อ' : '❌ ขาดการเชื่อมต่อ',
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'NEXArk Donation System',
          icon_url: this.client.user.displayAvatarURL()
        }
      };

      const payload = {
        username: 'NEXArk System',
        avatar_url: this.client.user.displayAvatarURL(),
        embeds: [startupEmbed]
      };

      await this.webhookService.sendDonationNotification({
        discordId: this.client.user.id,
        discordUsername: 'System',
        steam64: 'SYSTEM',
        characterId: 'SYSTEM',
        category: 'system',
        itemName: 'Bot Startup',
        amount: 0,
        server: 'ALL',
        status: 'completed',
        ticketId: 'STARTUP',
        playerName: 'System',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Error sending startup notification:', error);
    }
  }

  async safeReply(interaction, content, options = {}) {
    try {
      const replyOptions = {
        content,
        ephemeral: true,
        ...options
      };

      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply(replyOptions);
      } else if (interaction.deferred) {
        return await interaction.editReply(replyOptions);
      } else {
        return await interaction.followUp(replyOptions);
      }
    } catch (error) {
      console.error('Failed to send safe reply:', error);
    }
  }

  async gracefulShutdown() {
    if (this.isShuttingDown) return;
    
    console.log('🛑 Initiating graceful shutdown...');
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

      if (this.scoreboardManager) {
        this.scoreboardManager.shutdown();
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

      console.log('✅ Graceful shutdown completed');
      logService.info('Bot shutdown completed');

    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      logService.error('Shutdown error:', error);
    }
  }

  async sendShutdownNotification() {
    try {
      const shutdownEmbed = {
        title: '🛑 NEXArk Bot หยุดทำงาน',
        description: 'ระบบโดเนทอัตโนมัติหยุดการทำงานชั่วคราว',
        color: 0xFF0000,
        fields: [
          {
            name: '📊 สถิติการทำงาน',
            value: `⏱️ เวลาทำงาน: ${Math.floor(process.uptime() / 60)} นาที\n💾 หน่วยความจำ: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
            inline: false
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'NEXArk System Shutdown',
          icon_url: this.client.user.displayAvatarURL()
        }
      };

      await this.webhookService.sendDonationNotification({
        discordId: this.client.user.id,
        discordUsername: 'System',
        steam64: 'SYSTEM',
        characterId: 'SYSTEM',
        category: 'system',
        itemName: 'Bot Shutdown',
        amount: 0,
        server: 'ALL',
        status: 'cancelled',
        ticketId: 'SHUTDOWN',
        playerName: 'System',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Error sending shutdown notification:', error);
    }
  }
}

// Start the bot
const bot = new DiscordBot();
bot.init();

// Graceful shutdown handlers
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  await bot.gracefulShutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  await bot.gracefulShutdown();
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled promise rejection:", error);
  logService.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught exception:", error);
  logService.error("Uncaught exception:", error);
  
  // Force shutdown on uncaught exception
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle process warnings
process.on('warning', (warning) => {
  console.warn('⚠️ Process warning:', warning);
  logService.warn('Process warning:', { warning: warning.message, stack: warning.stack });
});

export default DiscordBot;