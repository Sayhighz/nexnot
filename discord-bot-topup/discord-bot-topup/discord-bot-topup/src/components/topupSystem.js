import { 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  MessageFlags
} from 'discord.js';
import databaseService from "../services/databaseService.js";
import qrCodeService from "../services/qrCodeService.js";
import slipVerification from "./slipVerification.js";
import rconManager from "./rconManager.js";
import logService from "../services/logService.js";
import Helpers from "../utils/helpers.js";
import CONSTANTS from "../utils/constants.js";
import configService from "../services/configService.js";

// Import utilities
import BrandUtils from "../utils/brandUtils.js";
import EmbedBuilders from "../utils/embedBuilders.js";
import Validators from "../utils/validators.js";
import TicketManager from "../utils/ticketManager.js";

class TopupSystem {
  constructor(client) {
    this.client = client;
    this.activeTickets = new Map();
    this.userCooldowns = new Map();
  }

  async init() {
    console.log("🎮 NEXArk Topup System initialized");
    await this.registerCommands();
    this.setupEventListeners();
    await this.setupMenuChannel();
    await this.startPeriodicTasks();
    
    // Cleanup old temp files periodically
    setInterval(() => {
      Helpers.cleanupTempFiles();
    }, 3600000);
  }

  async registerCommands() {
    const commands = [
      {
        name: "setup_menu",
        description: "ตั้งค่าเมนูหลัก (Admin only)",
      },
      {
        name: "setup_scoreboard",
        description: "ตั้งค่า scoreboard (Admin only)",
      },
    ];

    try {
      await this.client.application.commands.set(commands);
      console.log("✅ NEXArk commands registered successfully");
    } catch (error) {
      console.error("❌ Error registering commands:", error);
    }
  }

  setupEventListeners() {
    this.client.on("interactionCreate", async (interaction) => {
      try {
        if (interaction.isCommand()) {
          await this.handleSlashCommands(interaction);
        }
      } catch (error) {
        logService.error("Command interaction error:", error);
      }
    });
  }

  async setupMenuChannel() {
    try {
      const config = configService.getConfig();
      const menuChannelId = config.channels?.menu_channel_id;
      
      if (!menuChannelId) {
        console.warn('⚠️ No menu channel configured');
        return;
      }

      const channel = this.client.channels.cache.get(menuChannelId);
      if (!channel) {
        console.error('❌ Menu channel not found:', menuChannelId);
        return;
      }

      // Clear old messages
      try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(m => m.author.id === this.client.user.id);
        if (botMessages.size > 0) {
          await channel.bulkDelete(botMessages);
        }
      } catch (error) {
        console.warn('⚠️ Could not clear old messages:', error.message);
      }

      await this.sendMainMenu(channel);
      console.log('✅ NEXArk main menu sent to channel:', menuChannelId);

    } catch (error) {
      console.error('❌ Error setting up menu channel:', error);
    }
  }

  async sendMainMenu(channel) {
    const embed = EmbedBuilders.createMainMenuEmbed();
    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('donate_points')
          .setLabel('💰 โดเนทพ้อย')
          .setStyle(ButtonStyle.Success)
          .setEmoji('💎'),
        new ButtonBuilder()
          .setCustomId('donate_ranks')
          .setLabel('👑 โดเนทยศ')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⭐'),
        new ButtonBuilder()
          .setCustomId('donate_items')
          .setLabel('🎁 โดเนทไอเทม')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🎪'),
        new ButtonBuilder()
          .setCustomId('support_ticket')
          .setLabel('🎫 แจ้งปัญหา')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🆘')
      );

    await channel.send({
      embeds: [embed],
      components: [buttons]
    });
  }

  async handleButtonInteraction(interaction) {
    const { customId, user } = interaction;
  
    try {
      switch (customId) {
        case 'donate_points':
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.showDonationCategory(interaction, 'points');
          break;
          
        case 'donate_ranks':
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.showDonationCategory(interaction, 'ranks');
          break;
          
        case 'donate_items':
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.showDonationCategory(interaction, 'items');
          break;
          
        case 'support_ticket':
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.createSupportTicket(interaction);
          break;
  
        case 'cancel_donation':
          await interaction.deferReply();
          await this.cancelDonation(interaction);
          break;
          
        default:
          if (customId.startsWith('select_donation_')) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await this.handleDonationSelection(interaction);
          } else if (customId.startsWith('close_ticket_')) {
            await interaction.deferReply();
            await this.closeSupportTicket(interaction);
          }
          break;
      }
    } catch (error) {
      logService.error('Button interaction error:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.editReply({
          content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
        });
      }
    }
  }

  async showDonationCategory(interaction, category) {
    const userId = interaction.user.id;
    
    // Check cooldown
    if (!Validators.validateCooldown(this.userCooldowns, userId)) {
      return await interaction.editReply({
        content: '⏰ กรุณารอสักครู่ก่อนทำรายการใหม่'
      });
    }
  
    // Check user link status
    const userGameInfo = await databaseService.getUserGameInfo(userId);
    if (!Validators.validateUserGameInfo(userGameInfo, category)) {
      if (!userGameInfo.isLinked) {
        const embed = EmbedBuilders.createNoLinkEmbed();
        return await interaction.editReply({ embeds: [embed] });
      }
      
      if (category === 'items' && !userGameInfo.characterId) {
        const embed = EmbedBuilders.createErrorEmbed(
          '❌ ไม่พบข้อมูลตัวละคร',
          'ไม่พบข้อมูลตัวละครในเกม กรุณาเข้าเกมอย่างน้อย 1 ครั้งแล้วลองใหม่'
        );
        return await interaction.editReply({ embeds: [embed] });
      }
    }
  
    // Check active donation tickets
    const activeDonationTickets = await databaseService.getActiveDonationTickets(userId);
    if (activeDonationTickets.length >= CONSTANTS.TICKET.MAX_TICKETS_PER_USER) {
      const embed = EmbedBuilders.createMaxTicketEmbed(
        activeDonationTickets, 
        CONSTANTS.TICKET.MAX_TICKETS_PER_USER
      );
      return await interaction.editReply({ embeds: [embed] });
    }
  
    try {
      const config = configService.getConfig();
      const donations = config.donation_categories[category];
  
      if (!donations || donations.length === 0) {
        return await interaction.editReply({
          content: '❌ ไม่พบรายการในหมวดนี้'
        });
      }
  
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_donation_${category}`)
        .setPlaceholder(`🔥 เลือก${BrandUtils.categoryDisplayNames[category]}ที่ต้องการ ${BrandUtils.categoryIcons[category]}`)
        .addOptions(
          donations.map(item => ({
            label: `${item.name}`,
            description: `💰 ${Helpers.formatCurrency(item.price)} | ${item.description}`,
            value: item.id,
            emoji: BrandUtils.categoryIcons[category]
          }))
        );
  
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = EmbedBuilders.createCategorySelectionEmbed(
        category, 
        userGameInfo, 
        activeDonationTickets, 
        CONSTANTS.TICKET.MAX_TICKETS_PER_USER, 
        donations
      );
  
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
  
      // Set cooldown
      this.userCooldowns.set(userId, Date.now());
  
    } catch (error) {
      logService.error('Error showing donation category:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง'
      });
    }
  }

  // เหลือ methods อื่นๆ ที่ถูกย่อขนาดลงโดยใช้ utilities...
  
  async handleSelectMenuInteraction(interaction) {
    if (interaction.customId.startsWith("select_donation_")) {
      await this.handleDonationSelection(interaction);
    }
  }

  async handleSlashCommands(interaction) {
    // Implementation...
  }

  async handleDonationSelection(interaction) {
    // Implementation ที่ใช้ EmbedBuilders...
  }

  async createDonationTicket(interaction, donationItem, category, userGameInfo) {
    // Implementation ที่ใช้ TicketManager...
  }

  async createSupportTicket(interaction) {
    // Implementation ที่ใช้ EmbedBuilders และ TicketManager...
  }

  async handleSlipSubmission(message) {
    // Implementation ที่ใช้ Validators...
  }

  async cancelDonation(interaction) {
    // Implementation...
  }

  async closeSupportTicket(interaction) {
    // Implementation...
  }

  async startPeriodicTasks() {
    // Cleanup expired tickets every 30 minutes
    setInterval(() => {
      TicketManager.cleanupExpiredTickets(this.activeTickets, this.client);
    }, 1800000);
    
    console.log('🔄 NEXArk periodic tasks started');
  }

  async shutdown() {
    console.log('🛑 NEXArk Topup System shutting down...');
    this.activeTickets.clear();
    this.userCooldowns.clear();
    console.log('✅ NEXArk Topup System shutdown complete');
  }
}

export default TopupSystem;