// src/index.js
import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import configService from "./services/configService.js";
import databaseService from "./services/databaseService.js";
import TopupSystem from "./components/topupSystem.js";
import ScoreboardManager from "./components/scoreboardManager.js";
import logService from "./services/logService.js";

class DiscordBot {
  constructor() {
    this.client = null;
    this.topupSystem = null;
    this.scoreboardManager = null;
  }

  async init() {
    try {
      // Load configuration first
      await configService.loadConfig();
      console.log('✅ Configuration loaded');

      // Validate configuration
      const validation = configService.validateConfig();
      if (!validation.isValid) {
        console.error('❌ Configuration validation failed:');
        validation.errors.forEach(error => console.error(`  - ${error}`));
        process.exit(1);
      }

      // Show debug info
      console.log('🔍 Configuration:', configService.getDebugInfo());

      // Initialize Discord client
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.DirectMessages,
        ],
      });

      // Initialize systems
      this.topupSystem = new TopupSystem(this.client);
      this.scoreboardManager = new ScoreboardManager(this.client);

      // Connect to database
      await databaseService.connect();
      await databaseService.createTables();

      // Setup event listeners
      this.setupEventListeners();

      // Login bot
      const token = configService.getDiscordToken();
      await this.client.login(token);

      logService.info("Bot started successfully");
    } catch (error) {
      logService.error("Failed to start bot:", error);
      process.exit(1);
    }
  }

  setupEventListeners() {
    this.client.once("ready", () => {
      console.log(`✅ Bot is ready! Logged in as ${this.client.user.tag}`);

      // Initialize systems
      this.topupSystem.init();
      this.scoreboardManager.init();
    });

    // Enhanced interaction handler
    this.client.on('interactionCreate', async (interaction) => {
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
        }
      } catch (error) {
        logService.error('Interaction error:', error);
        
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
              content: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง', 
              flags: MessageFlags.Ephemeral
            });
          }
        } catch (replyError) {
          console.error('Failed to send error reply:', replyError);
        }
      }
    });

    this.client.on("messageCreate", async (message) => {
      if (message.author.bot) return;

      try {
        // Handle slip verification in ticket channels
        if (message.channel.name && (message.channel.name.startsWith("topup-") || message.channel.name.startsWith("support-"))) {
          await this.topupSystem.handleSlipSubmission(message);
        }
      } catch (error) {
        logService.error("Message handling error:", error);
      }
    });
  }
}

// Start the bot
const bot = new DiscordBot();
bot.init();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down bot...");
  if (bot.client) {
    bot.client.destroy();
  }
  if (bot.scoreboardManager) {
    bot.scoreboardManager.shutdown();
  }
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  logService.error("Unhandled promise rejection:", error);
});

export default DiscordBot;