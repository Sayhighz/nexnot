// src/components/topupSystem.js (Refactored)
import { 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import databaseService from "../services/databaseService.js";
import slipVerification from "./slipVerification.js";
import logService from "../services/logService.js";
import configService from "../services/configService.js";

// Import new handlers and utilities
import donationHandler from "../handlers/donationHandler.js";
import ticketHandler from "../handlers/ticketHandler.js";
import BrandUtils from "../utils/brandUtils.js";
import EmbedBuilders from "../utils/embedBuilders.js";
import ValidationHelper from "../utils/validationHelper.js";
import ResponseHelper from "../utils/responseHelper.js";
import ErrorHandler from "../utils/errorHandler.js";
import DebugHelper from "../utils/debugHelper.js";

class TopupSystem {
  constructor(client) {
    this.client = client;
    this.userCooldowns = new Map();
    this.temporarySteamIds = new Map();
  }

  async init() {
    DebugHelper.info("TopupSystem initializing...");
    await this.registerCommands();
    await this.setupMenuChannel();
    await this.startPeriodicTasks();
    DebugHelper.info("TopupSystem initialized successfully");
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
      DebugHelper.info("Commands registered successfully");
    } catch (error) {
      ErrorHandler.logAndThrow(error, "Command Registration");
    }
  }

  async setupMenuChannel() {
    try {
      const config = configService.getConfig();
      const menuChannelId = config.channels?.menu_channel_id;
      
      if (!menuChannelId) {
        DebugHelper.warn('No menu channel configured');
        return;
      }

      const channel = this.client.channels.cache.get(menuChannelId);
      if (!channel) {
        throw new Error(`Menu channel not found: ${menuChannelId}`);
      }

      // Clear old messages
      await this.clearOldMessages(channel);
      await this.sendMainMenu(channel);
      
      DebugHelper.info('Main menu setup completed', { channelId: menuChannelId });

    } catch (error) {
      DebugHelper.error('Error setting up menu channel:', error);
    }
  }

  async clearOldMessages(channel) {
    try {
      const messages = await channel.messages.fetch({ limit: 10 });
      const botMessages = messages.filter(m => m.author.id === this.client.user.id);
      if (botMessages.size > 0) {
        await channel.bulkDelete(botMessages);
      }
    } catch (error) {
      DebugHelper.warn('Could not clear old messages:', error.message);
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
          .setEmoji('🎪')
      );

    await channel.send({
      embeds: [embed],
      components: [buttons]
    });
  }

  // src/components/topupSystem.js
// แก้ไข method handleButtonInteraction

async handleButtonInteraction(interaction) {
  try {
    // Check cooldown
    if (!ValidationHelper.checkCooldown(this.userCooldowns, interaction.user.id)) {
      return await ResponseHelper.safeReply(
        interaction, 
        '⏰ กรุณารอสักครู่ก่อนทำรายการใหม่'
      );
    }

    ValidationHelper.setCooldown(this.userCooldowns, interaction.user.id);

    const { customId } = interaction;

    // ✅ แก้ไขส่วนนี้ - เพิ่มการ handle cancel_donation ที่มี ticketId
    if (customId.startsWith('cancel_donation')) {
      await ResponseHelper.safeDefer(interaction);
      await this.cancelDonation(interaction);
      return;
    }

    switch (customId) {
      case 'donate_points':
      case 'donate_ranks':
      case 'donate_items':
        await ResponseHelper.safeDefer(interaction);
        const category = customId.replace('donate_', '');
        await this.showDonationCategory(interaction, category);
        break;

      case 'input_steam_id':
        await this.showSteamIdModal(interaction);
        break;
        
      default:
        if (customId.startsWith('select_donation_')) {
          await ResponseHelper.safeDefer(interaction);
          await this.handleDonationSelection(interaction);
        } else if (customId.startsWith('temp_donate_')) {
          await ResponseHelper.safeDefer(interaction);
          const tempCategory = customId.replace('temp_donate_', '');
          await this.showDonationCategory(interaction, tempCategory);
        } else {
          await ResponseHelper.safeReply(
            interaction, 
            '❌ ปุ่มนี้ไม่รองรับหรือหมดอายุแล้ว'
          );
        }
        break;
    }
  } catch (error) {
    await ErrorHandler.handleInteractionError(error, interaction, 'Button Interaction');
  }
}

  async handleSelectMenuInteraction(interaction) {
    try {
      if (!ValidationHelper.checkCooldown(this.userCooldowns, interaction.user.id)) {
        return await ResponseHelper.safeReply(
          interaction, 
          '⏰ กรุณารอสักครู่ก่อนทำรายการใหม่'
        );
      }

      ValidationHelper.setCooldown(this.userCooldowns, interaction.user.id);

      if (interaction.customId.startsWith("select_donation_")) {
        await ResponseHelper.safeDefer(interaction);
        await this.handleDonationSelection(interaction);
      } else {
        await ResponseHelper.safeReply(
          interaction, 
          '❌ เมนูนี้ไม่รองรับหรือหมดอายุแล้ว'
        );
      }
    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Select Menu Interaction');
    }
  }

  async handleModalSubmit(interaction) {
    try {
      if (interaction.customId === 'steam_id_modal') {
        await this.handleSteamIdSubmit(interaction);
      } else {
        await ResponseHelper.safeReply(
          interaction, 
          '❌ Modal นี้ไม่รองรับหรือหมดอายุแล้ว'
        );
      }
    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Modal Submit');
    }
  }

  async showSteamIdModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('steam_id_modal')
      .setTitle('🆔 กรอก Steam64 ID');

    const steamIdInput = new TextInputBuilder()
      .setCustomId('steam_id_input')
      .setLabel('Steam64 ID (17 ตัวเลข)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('76561198000000000')
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(17);

    const firstRow = new ActionRowBuilder().addComponents(steamIdInput);
    modal.addComponents(firstRow);

    await interaction.showModal(modal);
  }

  async handleSteamIdSubmit(interaction) {
    try {
      await ResponseHelper.safeDefer(interaction);

      const steamId = interaction.fields.getTextInputValue('steam_id_input');
      const userId = interaction.user.id;

      if (!ValidationHelper.validateSteam64(steamId)) {
        return await interaction.editReply({
          content: '❌ Steam64 ID ไม่ถูกต้อง กรุณากรอกเลข 17 หลักที่ขึ้นต้นด้วย 7656119'
        });
      }

      // บันทึก Steam ID ชั่วคราว
      this.temporarySteamIds.set(userId, {
        steamId: steamId,
        timestamp: Date.now()
      });

      // แสดงเมนูหมวดหมู่
      await interaction.editReply({
        content: `✅ บันทึก Steam64 ID เรียบร้อยแล้ว: \`${steamId}\`\n\n🎯 กรุณาเลือกหมวดหมู่ที่ต้องการ:`,
        components: [
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('temp_donate_points')
                .setLabel('💰 โดเนทพ้อย')
                .setStyle(ButtonStyle.Success)
                .setEmoji('💎'),
              new ButtonBuilder()
                .setCustomId('temp_donate_ranks')
                .setLabel('👑 โดเนทยศ')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⭐'),
              new ButtonBuilder()
                .setCustomId('temp_donate_items')
                .setLabel('🎁 โดเนทไอเทม')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🎪')
            )
        ]
      });

      DebugHelper.log('Temporary Steam ID saved', { userId, steamId });

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Steam ID Submit');
    }
  }

  async showDonationCategory(interaction, category) {
    try {
      const userId = interaction.user.id;
      
      // ตรวจสอบ user game info
      let userGameInfo = await this.getUserGameInfo(userId, interaction.customId);
      
      if (!userGameInfo || (!userGameInfo.isLinked && !userGameInfo.isTemporary)) {
        return await this.showNoLinkEmbed(interaction);
      }

      // ตรวจสอบ ticket limit
      const activeDonationTickets = await databaseService.getActiveDonationTickets(userId);
      if (!ValidationHelper.validateTicketLimit(activeDonationTickets, 3)) {
        const embed = EmbedBuilders.createMaxTicketEmbed(activeDonationTickets, 3);
        return await interaction.editReply({ embeds: [embed] });
      }

      // ดึงรายการ donations
      const donations = donationHandler.getDonationsByCategory(category);
      if (donations.length === 0) {
        return await interaction.editReply({
          content: `❌ ไม่พบรายการ${BrandUtils.getCategoryName(category)}ในระบบ`
        });
      }

      // สร้าง select menu และ embed
      const selectMenu = this.createDonationSelectMenu(category, donations, userGameInfo.isTemporary);
      const embed = this.createCategoryEmbed(category, userGameInfo, activeDonationTickets, donations);

      await interaction.editReply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(selectMenu)]
      });

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Show Donation Category');
    }
  }

  async getUserGameInfo(userId, customId) {
    // ตรวจสอบว่าเป็น temporary หรือไม่
    if (customId && customId.startsWith('temp_')) {
      const tempData = this.temporarySteamIds.get(userId);
      if (tempData) {
        return {
          isLinked: false,
          steam64: tempData.steamId,
          characterId: null,
          userData: null,
          playerData: null,
          isTemporary: true
        };
      }
    }

    // ถ้าไม่ใช่ temporary ให้ตรวจสอบ link ปกติ
    return await databaseService.getUserGameInfo(userId);
  }

  async showNoLinkEmbed(interaction) {
    const config = configService.getConfig();
    const linkChannelId = config.channels?.link_discord_channel_id;
    const embed = EmbedBuilders.createNoLinkEmbed(linkChannelId);
    
    const linkButtons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('input_steam_id')
          .setLabel('🆔 กรอก Steam64 ID')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚡')
      );

    return await interaction.editReply({ 
      embeds: [embed],
      components: [linkButtons]
    });
  }

  createDonationSelectMenu(category, donations, isTemporary = false) {
    const suffix = isTemporary ? '_temp' : '';
    
    return new StringSelectMenuBuilder()
      .setCustomId(`select_donation_${category}${suffix}`)
      .setPlaceholder(`🔥 เลือก${BrandUtils.categoryDisplayNames[category]}ที่ต้องการ ${BrandUtils.categoryIcons[category]}`)
      .addOptions(
        donations.slice(0, 25).map(item => ({ 
          label: item.name.substring(0, 100),
          description: `💰 ${item.price} บาท | ${item.description?.substring(0, 100) || 'ไม่มีรายละเอียด'}`,
          value: item.id,
          emoji: BrandUtils.categoryIcons[category]
        }))
      );
  }

  createCategoryEmbed(category, userGameInfo, activeDonationTickets, donations) {
    if (userGameInfo.isTemporary) {
      return EmbedBuilders.createTemporarySteamIdEmbed(
        category, 
        userGameInfo.steam64, 
        activeDonationTickets, 
        3, 
        donations
      );
    } else {
      return EmbedBuilders.createCategorySelectionEmbed(
        category, 
        userGameInfo, 
        activeDonationTickets, 
        3, 
        donations
      );
    }
  }

  async handleDonationSelection(interaction) {
    try {
      // Parse interaction data
      const { category, isTemporary } = this.parseDonationInteraction(interaction);
      const selectedId = interaction.values[0];
      const userId = interaction.user.id;

      // Get donation item
      const donationItem = donationHandler.findDonationById(category, selectedId);
      if (!donationItem) {
        return await interaction.editReply({
          content: '❌ ไม่พบรายการที่เลือก'
        });
      }

      // Get user game info
      const userGameInfo = await this.getUserGameInfo(userId, interaction.customId);
      
      // Validate donation data
      const validation = donationHandler.validateDonationData(category, donationItem, userGameInfo);
      if (!validation.isValid) {
        return await interaction.editReply({
          content: `❌ ${validation.errors.join(', ')}`
        });
      }

      // Create donation ticket
      const result = await ticketHandler.createDonationTicket(
        interaction, 
        donationItem, 
        category, 
        userGameInfo
      );

      if (result.success) {
        await interaction.editReply({
          content: `✅ สร้าง Donation Ticket สำเร็จ!\n📍 กรุณาไปที่ ${result.channel} เพื่อดำเนินการต่อ`
        });

        logService.logTopupEvent('ticket_created', userId, {
          ticketId: result.channel.name.replace('topup-', ''),
          category,
          itemName: donationItem.name,
          amount: donationItem.price,
          isTemporary: userGameInfo.isTemporary || false
        });
      } else {
        throw new Error('ไม่สามารถสร้าง Ticket ได้');
      }

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Donation Selection');
    }
  }

  parseDonationInteraction(interaction) {
    const customIdParts = interaction.customId.split('_');
    const isTemporary = customIdParts.length === 4 && customIdParts[3] === 'temp';
    const category = isTemporary ? customIdParts[2] : customIdParts[2];
    
    return { category, isTemporary };
  }

  async handleSlipSubmission(message) {
    try {
      const ticketData = ticketHandler.getTicketData(message.channel.id);
      
      if (!ticketData) {
        DebugHelper.warn(`No ticket data found for channel: ${message.channel.id}`);
        return;
      }

      if (!ValidationHelper.validateTicketOwnership(ticketData, message.author.id)) {
        return;
      }

      if (!message.attachments.size) {
        return;
      }

      const attachment = message.attachments.first();
      
      // Validate file
      const fileValidation = ValidationHelper.validateFile(attachment);
      if (!fileValidation.isValid) {
        return await message.reply(`❌ ${fileValidation.errors.join(', ')}`);
      }

      // Process slip
      await this.processSlipVerification(message, ticketData, attachment);

    } catch (error) {
      DebugHelper.error('Error handling slip submission:', error);
    }
  }

  async processSlipVerification(message, ticketData, attachment) {
    // Send processing message
    const processingEmbed = EmbedBuilders.createProcessingSlipEmbed(ticketData, attachment);
    const processingMessage = await message.reply({ embeds: [processingEmbed] });

    try {
      // Process slip verification
      const config = configService.getConfig();
      const bankInfo = config.qr_code.payment_info;
      
      const verificationResult = await slipVerification.processSlipImage(
        attachment,
        message.author.id,
        ticketData.donationItem.price,
        bankInfo
      );

      if (verificationResult.success) {
        // Update processing message
        const successEmbed = EmbedBuilders.createSlipVerificationSuccessEmbed(
          verificationResult.data, 
          ticketData
        );
        await processingMessage.edit({ embeds: [successEmbed] });

        // Update database
        const topupLog = await databaseService.getTopupByTicketId(ticketData.ticketId);
        if (topupLog) {
          await databaseService.updateTopupStatus(topupLog.id, 'verified', {
            verificationData: verificationResult.data,
            slipImageUrl: attachment.url
          });
        }

        // Execute donation
        await this.executeDonation(message, ticketData, verificationResult);

      } else {
        // Verification failed
        await processingMessage.edit({
          embeds: [EmbedBuilders.createErrorEmbed(
            '❌ การตรวจสอบสลิปล้มเหลว',
            verificationResult.error || 'ไม่สามารถตรวจสอบสลิปได้'
          )]
        });
      }

    } catch (error) {
      DebugHelper.error('Slip processing error:', error);
      await processingMessage.edit({
        embeds: [EmbedBuilders.createErrorEmbed(
          '❌ เกิดข้อผิดพลาดในการประมวลผล',
          'กรุณาลองส่งสลิปใหม่อีกครั้ง หรือติดต่อแอดมิน'
        )]
      });
    }
  }

  async executeDonation(message, ticketData, verificationResult) {
    try {
      // Send executing message
      const executingEmbed = EmbedBuilders.createExecutingDonationEmbed(ticketData);
      const executingMessage = await message.channel.send({ embeds: [executingEmbed] });

      // Execute donation
      const result = await donationHandler.executeDonation(message, ticketData, verificationResult);

      if (result.success) {
        // Success
        const successEmbed = EmbedBuilders.createDonationCompletedEmbed(
          ticketData, 
          ticketData.category, 
          ticketData.donationItem
        );
        
        await executingMessage.edit({ embeds: [successEmbed] });

        // Complete ticket
        await ticketHandler.completeTicket(message.channel.id, ticketData.ticketId);
        
        // ลบ temporary steam id ถ้ามี
        if (ticketData.userGameInfo.isTemporary) {
          this.temporarySteamIds.delete(message.author.id);
        }
        
        // Schedule channel deletion
        setTimeout(async () => {
          try {
            await message.channel.delete();
          } catch (error) {
            DebugHelper.error('Error deleting completed ticket channel:', error);
          }
        }, 300000); // 5 minutes

      } else {
        // Failed
        const failedEmbed = EmbedBuilders.createDonationFailedEmbed(ticketData, result.error);
        await executingMessage.edit({ embeds: [failedEmbed] });
      }

      logService.logTopupEvent(result.success ? 'completed' : 'failed', message.author.id, {
        ticketId: ticketData.ticketId,
        category: ticketData.category,
        success: result.success,
        errorMessage: result.error,
        isTemporary: ticketData.userGameInfo.isTemporary || false
      });

    } catch (error) {
      DebugHelper.error('Error executing donation:', error);
      
      try {
        const errorEmbed = EmbedBuilders.createDonationFailedEmbed(ticketData, error.message);
        await message.channel.send({ embeds: [errorEmbed] });
      } catch (sendError) {
        DebugHelper.error('Failed to send error message:', sendError);
      }
    }
  }

  async cancelDonation(interaction) {
    try {
      await ticketHandler.cancelTicket(interaction, 'manual');
      
      // ลบ temporary steam id ถ้ามี
      const ticketData = ticketHandler.getTicketData(interaction.channel.id);
      if (ticketData?.userGameInfo.isTemporary) {
        this.temporarySteamIds.delete(interaction.user.id);
      }

      logService.logTopupEvent('cancelled', interaction.user.id, {
        ticketId: ticketData?.ticketId
      });

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Cancel Donation');
    }
  }

  async startPeriodicTasks() {
    // Cleanup expired tickets every 30 minutes
    setInterval(() => {
      ticketHandler.cleanupExpiredTickets(this.client);
    }, 1800000);
    
    // Cleanup temporary steam IDs every 1 hour
    setInterval(() => {
      this.cleanupTemporarySteamIds();
    }, 3600000);
    
    DebugHelper.info('Periodic tasks started');
  }

  cleanupTemporarySteamIds() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour
    let cleanedCount = 0;

    for (const [userId, data] of this.temporarySteamIds.entries()) {
      if (now - data.timestamp > maxAge) {
        this.temporarySteamIds.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      DebugHelper.log(`Cleaned up ${cleanedCount} expired temporary Steam IDs`);
    }
  }

  async shutdown() {
    DebugHelper.info('TopupSystem shutting down...');
    this.userCooldowns.clear();
    this.temporarySteamIds.clear();
    ticketHandler.shutdown();
    DebugHelper.info('TopupSystem shutdown complete');
  }
}

export default TopupSystem;