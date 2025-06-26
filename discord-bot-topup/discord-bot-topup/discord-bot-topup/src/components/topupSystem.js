// src/components/topupSystem.js
const { 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const databaseService = require("../services/databaseService");
const slipVerification = require("./slipVerification");
const logService = require("../services/logService");
const configService = require("../services/configService");

const donationHandler = require("../handlers/donationHandler");
const ticketHandler = require("../handlers/ticketHandler");
const BrandUtils = require("../utils/brandUtils");
const EmbedBuilders = require("../utils/embedBuilders");
const ValidationHelper = require("../utils/validationHelper");
const ResponseHelper = require("../utils/responseHelper");
const ErrorHandler = require("../utils/errorHandler");
const DebugHelper = require("../utils/debugHelper");

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
        name: "test_easyslip",
        description: "ทดสอบสถานะ EasySlip API (Admin only)",
      },
      {
        name: "test_webhook",
        description: "ทดสอบ Discord Webhook (Admin only)",
      },
      {
        name: "test_rcon",
        description: "ทดสอบ RCON เซิร์ฟเวอร์ (Admin only)",
      },
      {
        name: "bot_status",
        description: "ดูสถานะบอท (Admin only)",
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
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('donate_ranks')
          .setLabel('👑 โดเนทยศ')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('donate_items')
          .setLabel('🎁 โดเนทไอเทม')
          .setStyle(ButtonStyle.Secondary)
      );

    await channel.send({
      embeds: [embed],
      components: [buttons]
    });
  }

  async handleButtonInteraction(interaction) {
    try {
      if (!ValidationHelper.checkCooldown(this.userCooldowns, interaction.user.id)) {
        return await ResponseHelper.safeReply(
          interaction, 
          '⏰ กรุณารอสักครู่ก่อนทำรายการใหม่'
        );
      }

      ValidationHelper.setCooldown(this.userCooldowns, interaction.user.id);
      const { customId } = interaction;

      // Handle cancel donation
      if (customId.startsWith('cancel_donation')) {
        await ResponseHelper.safeDefer(interaction);
        await this.cancelDonation(interaction);
        return;
      }

      // เพิ่ม case สำหรับ input_steam_id
      if (customId === 'input_steam_id') {
        await this.showSteamIdModal(interaction);
        return;
      }

      // Handle main category buttons
      if (customId.startsWith('donate_')) {
        await ResponseHelper.safeDefer(interaction);
        const category = customId.replace('donate_', '');
        await this.handleCategorySelection(interaction, category);
        return;
      }

      // Handle method selection buttons
      if (customId.startsWith('use_linked_')) {
        await ResponseHelper.safeDefer(interaction);
        const category = customId.replace('use_linked_', '');
        await this.showDonationCategoryLinked(interaction, category);
        return;
      }

      if (customId.startsWith('use_manual_')) {
        const category = customId.replace('use_manual_', '');
        await this.showSteamIdModal(interaction, category);
        return;
      }

      // Handle donation selection
      if (customId.startsWith('select_donation_')) {
        await ResponseHelper.safeDefer(interaction);
        await this.handleDonationSelection(interaction);
        return;
      }

      // Handle temporary donation (after manual Steam ID input)
      if (customId.startsWith('temp_donate_')) {
        await ResponseHelper.safeDefer(interaction);
        const tempCategory = customId.replace('temp_donate_', '');
        await this.showDonationCategoryTemporary(interaction, tempCategory);
        return;
      }

      // Default case
      await ResponseHelper.safeReply(
        interaction, 
        '❌ ปุ่มนี้ไม่รองรับหรือหมดอายุแล้ว'
      );

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Button Interaction');
    }
  }

  // ฟังก์ชันใหม่: จัดการการเลือก category
  async handleCategorySelection(interaction, category) {
    try {
      const userId = interaction.user.id;
      
      // ตรวจสอบว่า user มี link หรือไม่
      const userGameInfo = await databaseService.getUserGameInfo(userId);
      
      if (userGameInfo.isLinked) {
        // ถ้ามี link แล้ว ให้เลือกว่าจะใช้ link หรือกรอกใหม่
        await this.showInputMethodChoice(interaction, category);
      } else {
        // ถ้าไม่มี link ให้กรอก Steam ID
        await this.showNoLinkEmbed(interaction);
      }

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Category Selection');
    }
  }

  // ฟังก์ชันใหม่: แสดงตัวเลือกวิธีการกรอกข้อมูล
  async showInputMethodChoice(interaction, category) {
    const embed = EmbedBuilders.createChooseInputMethodEmbed(category);
    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`use_linked_${category}`)
          .setLabel('🔗 ใช้ข้อมูลที่เชื่อมต่อไว้')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`use_manual_${category}`)
          .setLabel('🆔 กรอก Steam64 ID ใหม่')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.editReply({
      embeds: [embed],
      components: [buttons]
    });
  }

  // ฟังก์ชันใหม่: แสดง category โดยใช้ข้อมูลที่ link ไว้
  async showDonationCategoryLinked(interaction, category) {
    try {
      const userId = interaction.user.id;
      const userGameInfo = await databaseService.getUserGameInfo(userId);
      
      if (!userGameInfo.isLinked) {
        return await interaction.editReply({
          content: '❌ ไม่พบข้อมูลการเชื่อมต่อ'
        });
      }

      await this.showDonationCategory(interaction, category, userGameInfo, false);

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Show Linked Category');
    }
  }

  // ฟังก์ชันใหม่: แสดง category โดยใช้ Steam ID ชั่วคราว
  async showDonationCategoryTemporary(interaction, category) {
    try {
      const userId = interaction.user.id;
      const tempData = this.temporarySteamIds.get(userId);
      
      if (!tempData) {
        return await interaction.editReply({
          content: '❌ ไม่พบข้อมูล Steam ID ชั่วคราว กรุณากรอกใหม่'
        });
      }

      const userGameInfo = {
        isLinked: false,
        steam64: tempData.steamId,
        characterId: null,
        userData: null,
        playerData: null,
        isTemporary: true
      };

      await this.showDonationCategory(interaction, category, userGameInfo, true);

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Show Temporary Category');
    }
  }

  async showSteamIdModal(interaction, category = null) {
    const modal = new ModalBuilder()
      .setCustomId(category ? `steam_id_modal_${category}` : 'steam_id_modal')
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

  async handleModalSubmit(interaction) {
    try {
      if (interaction.customId.startsWith('steam_id_modal')) {
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

      // ตรวจสอบว่ามี category ใน customId หรือไม่
      const customIdParts = interaction.customId.split('_');
      const category = customIdParts.length >= 4 ? customIdParts[3] : null;

      if (category) {
        // ถ้ามี category ไปต่อเลย
        await this.showDonationCategoryTemporary(interaction, category);
      } else {
        // ถ้าไม่มี category ให้เลือก
        await interaction.editReply({
          content: `✅ บันทึก Steam64 ID เรียบร้อยแล้ว: \`${steamId}\`\n\n🎯 กรุณาเลือกหมวดหมู่ที่ต้องการ:`,
          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId('temp_donate_points')
                  .setLabel('💰 โดเนทพ้อย')
                  .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                  .setCustomId('temp_donate_ranks')
                  .setLabel('👑 โดเนทยศ')
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId('temp_donate_items')
                  .setLabel('🎁 โดเนทไอเทม')
                  .setStyle(ButtonStyle.Secondary)
              )
          ]
        });
      }

      DebugHelper.log('Temporary Steam ID saved', { userId, steamId, category });

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Steam ID Submit');
    }
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
          .setStyle(ButtonStyle.Primary)
      );

    return await interaction.editReply({ 
      embeds: [embed],
      components: [linkButtons]
    });
  }

  // ปรับ showDonationCategory
  async showDonationCategory(interaction, category, userGameInfo, isTemporary) {
    try {
      // ตรวจสอบ ticket limit
      const activeDonationTickets = await databaseService.getActiveDonationTickets(interaction.user.id);
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

      // สร้าง embed และ select menu
      const embed = isTemporary ? 
        EmbedBuilders.createTemporarySteamIdEmbed(category, userGameInfo.steam64, activeDonationTickets, 3, donations) :
        EmbedBuilders.createCategorySelectionEmbed(category, userGameInfo, activeDonationTickets, 3, donations);

      const selectMenu = this.createDonationSelectMenu(category, donations, isTemporary);

      await interaction.editReply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(selectMenu)]
      });

    } catch (error) {
      await ErrorHandler.handleInteractionError(error, interaction, 'Show Donation Category');
    }
  }

  createDonationSelectMenu(category, donations, isTemporary = false) {
    const suffix = isTemporary ? '_temp' : '';
    
    return new StringSelectMenuBuilder()
      .setCustomId(`select_donation_${category}${suffix}`)
      .setPlaceholder(`🔥 เลือก${BrandUtils.categoryDisplayNames[category]}ที่ต้องการ`)
      .addOptions(
        donations.slice(0, 25).map(item => ({ 
          label: item.name.substring(0, 100),
          description: `💰 ${item.price} บาท | ${item.description?.substring(0, 100) || 'ไม่มีรายละเอียด'}`,
          value: item.id,
          emoji: BrandUtils.categoryIcons[category]
        }))
      );
  }

  // ส่วนที่เหลือของ class ยังเหมือนเดิม...
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
      const userGameInfo = await this.getUserGameInfo(userId, isTemporary);
      
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

        await logService.logTopupEvent('ticket_created', userId, {
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

  async getUserGameInfo(userId, isTemporary) {
    if (isTemporary) {
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

    return await databaseService.getUserGameInfo(userId);
  }

  parseDonationInteraction(interaction) {
    const customIdParts = interaction.customId.split('_');
    const isTemporary = customIdParts.length === 4 && customIdParts[3] === 'temp';
    const category = isTemporary ? customIdParts[2] : customIdParts[2];
    
    return { category, isTemporary };
  }

  // ส่วนที่เหลือของ class (handleSlipSubmission, cancelDonation, etc.) ยังเหมือนเดิม
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
        verificationResult.slipImageUrl = attachment.url;

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

      await logService.logTopupEvent(result.success ? 'completed' : 'failed', message.author.id, {
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
      await ticketHandler.cancelTicket(interaction);
      
      // ลบ temporary steam id ถ้ามี
      const ticketData = ticketHandler.getTicketData(interaction.channel.id);
      if (ticketData?.userGameInfo.isTemporary) {
        this.temporarySteamIds.delete(interaction.user.id);
      }

      let ticketId = 'unknown';
      if (interaction.customId && interaction.customId.includes('_')) {
        const parts = interaction.customId.split('_');
        if (parts.length >= 3) {
          ticketId = parts[2];
        }
      } else if (ticketData) {
        ticketId = ticketData.ticketId;
      }

      await logService.logTopupEvent('cancelled', interaction.user.id, {
        ticketId: ticketId,
        customId: interaction.customId
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

module.exports = TopupSystem;