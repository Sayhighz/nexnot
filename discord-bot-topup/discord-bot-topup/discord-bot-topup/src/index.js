import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import databaseService from "./services/databaseService.js";
import TopupSystem from "./components/topupSystem.js";
import ScoreboardManager from "./components/scoreboardManager.js";
import logService from "./services/logService.js";
import dotenv from "dotenv";

dotenv.config();

class DiscordBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.topupSystem = new TopupSystem(this.client);
    this.scoreboardManager = new ScoreboardManager(this.client);
  }

  async init() {
    try {
      // Connect to database
      await databaseService.connect();
      await databaseService.createTables();

      // Setup event listeners
      this.setupEventListeners();

      // Login bot
      await this.client.login(process.env.DISCORD_TOKEN);

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

    // ในส่วน event handler:
this.client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      await this.topupSystem.handleButtonInteraction(interaction);
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
        if (message.channel.name && message.channel.name.startsWith("topup-")) {
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
  bot.client.destroy();
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  logService.error("Unhandled promise rejection:", error);
});

export default DiscordBot;
