// src/components/topupSystem.js (แก้ไขส่วนสำคัญ)

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

  // ✅ แก้ไข handleButtonInteraction
  async handleButtonInteraction(interaction) {
    const { customId, user } = interaction;
    
    try {
      console.log(`🔘 Button clicked: ${customId} by ${user.tag}`);

      // ✅ ตรวจสอบ cooldown ก่อน defer
      if (this.userCooldowns.has(user.id)) {
        const lastUsed = this.userCooldowns.get(user.id);
        if (Date.now() - lastUsed < 3000) { // 3 วินาที cooldown
          return await interaction.reply({
            content: '⏰ กรุณารอสักครู่ก่อนทำรายการใหม่',
            ephemeral: true
          });
        }
      }

      // ✅ Set cooldown ทันที
      this.userCooldowns.set(user.id, Date.now());

      switch (customId) {
        case 'donate_points':
          await interaction.deferReply({ ephemeral: true });
          await this.showDonationCategory(interaction, 'points');
          break;
          
        case 'donate_ranks':
          await interaction.deferReply({ ephemeral: true });
          await this.showDonationCategory(interaction, 'ranks');
          break;
          
        case 'donate_items':
          await interaction.deferReply({ ephemeral: true });
          await this.showDonationCategory(interaction, 'items');
          break;
          
        case 'support_ticket':
          await interaction.deferReply({ ephemeral: true });
          await this.createSupportTicket(interaction);
          break;

        case 'cancel_donation':
          await interaction.deferReply();
          await this.cancelDonation(interaction);
          break;
          
        default:
          if (customId.startsWith('select_donation_')) {
            await interaction.deferReply({ ephemeral: true });
            await this.handleDonationSelection(interaction);
          } else if (customId.startsWith('close_ticket_')) {
            await interaction.deferReply();
            await this.closeSupportTicket(interaction);
          } else {
            // ปุ่มที่ไม่รู้จัก
            await interaction.reply({
              content: '❌ ปุ่มนี้ไม่รองรับหรือหมดอายุแล้ว',
              ephemeral: true
            });
          }
          break;
      }
    } catch (error) {
      logService.error('Button interaction error:', error);
      
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
            ephemeral: true
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
          });
        }
      } catch (replyError) {
        console.error('Failed to handle button interaction error:', replyError);
      }
    }
  }

  // ✅ แก้ไข handleSelectMenuInteraction
  async handleSelectMenuInteraction(interaction) {
    try {
      console.log(`📋 Select menu: ${interaction.customId} by ${interaction.user.tag}`);
      
      if (interaction.customId.startsWith("select_donation_")) {
        // ตรวจสอบ cooldown
        if (this.userCooldowns.has(interaction.user.id)) {
          const lastUsed = this.userCooldowns.get(interaction.user.id);
          if (Date.now() - lastUsed < 3000) {
            return await interaction.reply({
              content: '⏰ กรุณารอสักครู่ก่อนทำรายการใหม่',
              ephemeral: true
            });
          }
        }

        this.userCooldowns.set(interaction.user.id, Date.now());
        await interaction.deferReply({ ephemeral: true });
        await this.handleDonationSelection(interaction);
      } else {
        await interaction.reply({
          content: '❌ เมนูนี้ไม่รองรับหรือหมดอายุแล้ว',
          ephemeral: true
        });
      }
    } catch (error) {
      logService.error('Select menu interaction error:', error);
      
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
            ephemeral: true
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
          });
        }
      } catch (replyError) {
        console.error('Failed to handle select menu error:', replyError);
      }
    }
  }

  // ✅ เพิ่ม handleModalSubmit
  async handleModalSubmit(interaction) {
    try {
      console.log(`📝 Modal submit: ${interaction.customId} by ${interaction.user.tag}`);
      
      await interaction.deferReply({ ephemeral: true });
      
      // Handle different modal types here
      if (interaction.customId.startsWith('steam64_input_')) {
        await this.handleSteam64Input(interaction);
      } else {
        await interaction.editReply({
          content: '❌ Modal นี้ไม่รองรับหรือหมดอายุแล้ว'
        });
      }
    } catch (error) {
      logService.error('Modal submit error:', error);
      
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error('Failed to handle modal error:', replyError);
      }
    }
  }

  // ✅ เพิ่ม handleSlashCommands
  async handleSlashCommands(interaction) {
    try {
      const { commandName } = interaction;
      
      switch (commandName) {
        case 'setup_menu':
          await this.handleSetupMenuCommand(interaction);
          break;
        case 'setup_scoreboard':
          await this.handleSetupScoreboardCommand(interaction);
          break;
        default:
          await interaction.reply({
            content: '❌ คำสั่งนี้ไม่รองรับ',
            ephemeral: true
          });
      }
    } catch (error) {
      logService.error('Slash command error:', error);
      
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error('Failed to handle command error:', replyError);
      }
    }
  }

  async showDonationCategory(interaction, category) {
    const userId = interaction.user.id;
    
    try {
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

      const config = configService.getConfig();
      const donations = config.donation_categories?.[category];

      if (!donations || donations.length === 0) {
        return await interaction.editReply({
          content: `❌ ไม่พบรายการ${BrandUtils.getCategoryName(category)}ในระบบ`
        });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_donation_${category}`)
        .setPlaceholder(`🔥 เลือก${BrandUtils.categoryDisplayNames[category]}ที่ต้องการ ${BrandUtils.categoryIcons[category]}`)
        .addOptions(
          donations.slice(0, 25).map(item => ({ // จำกัด 25 items ต่อ menu
            label: item.name.substring(0, 100), // จำกัดความยาว label
            description: `💰 ${Helpers.formatCurrency(item.price)} | ${item.description?.substring(0, 100) || 'ไม่มีรายละเอียด'}`,
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

    } catch (error) {
      logService.error('Error showing donation category:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง'
      });
    }
  }

  async handleDonationSelection(interaction) {
    try {
      const [, , category] = interaction.customId.split('_');
      const selectedId = interaction.values[0];
      const userId = interaction.user.id;

      console.log(`💰 Donation selection: ${category}/${selectedId} by ${interaction.user.tag}`);

      // Get donation item
      const config = configService.getConfig();
      const donations = config.donation_categories?.[category];
      const donationItem = donations?.find(item => item.id === selectedId);

      if (!donationItem) {
        return await interaction.editReply({
          content: '❌ ไม่พบรายการที่เลือก'
        });
      }

      // Get user game info
      const userGameInfo = await databaseService.getUserGameInfo(userId);
      if (!Validators.validateUserGameInfo(userGameInfo, category)) {
        const embed = EmbedBuilders.createNoLinkEmbed();
        return await interaction.editReply({ embeds: [embed] });
      }

      // Create donation ticket
      await this.createDonationTicket(interaction, donationItem, category, userGameInfo);

    } catch (error) {
      logService.error('Error handling donation selection:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในการดำเนินการ'
      });
    }
  }

  async createDonationTicket(interaction, donationItem, category, userGameInfo) {
    try {
      const user = interaction.user;
      const guild = interaction.guild;
      const ticketId = Helpers.generateTicketId();

      console.log(`🎫 Creating donation ticket: ${ticketId} for ${user.tag}`);

      // Create ticket channel
      const ticketChannel = await TicketManager.createDonationTicketChannel(guild, user, ticketId);
      
      if (!ticketChannel) {
        return await interaction.editReply({
          content: '❌ ไม่สามารถสร้าง Ticket ได้ กรุณาติดต่อแอดมิน'
        });
      }

      // Store ticket data
      const ticketData = {
        ticketId,
        userId: user.id,
        channelId: ticketChannel.id,
        donationItem,
        category,
        userGameInfo,
        createdAt: new Date(),
        status: 'pending'
      };

      this.activeTickets.set(ticketChannel.id, ticketData);

      // Save to database
      await databaseService.createActiveTicket(user.id, ticketChannel.id, ticketId, 'donation');
      
      const logId = await databaseService.logDonationTransaction({
        discordId: user.id,
        discordUsername: user.username,
        steam64: userGameInfo.steam64,
        characterId: userGameInfo.characterId,
        category: category,
        itemId: donationItem.id,
        itemName: donationItem.name,
        amount: donationItem.price,
        ticketChannelId: ticketChannel.id,
        ticketId: ticketId,
        status: 'pending'
      });

      // Create payment QR and embed
      const config = configService.getConfig();
      const qrUrl = qrCodeService.getPromptPayUrl(donationItem.price, config.qr_code.payment_info.account_number);
      
      const embed = EmbedBuilders.createDonationTicketEmbed(ticketId, donationItem, category, userGameInfo, config);
      embed.setImage(qrUrl);

      const cancelButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`cancel_donation_${ticketId}`)
            .setLabel('❌ ยกเลิก')
            .setStyle(ButtonStyle.Danger)
        );

      await ticketChannel.send({
        content: `${user} ยินดีต้อนรับสู่ระบบโดเนท NEXArk! 🎉`,
        embeds: [embed],
        components: [cancelButton]
      });

      // Reply to user
      await interaction.editReply({
        content: `✅ สร้าง Donation Ticket สำเร็จ!\n📍 กรุณาไปที่ ${ticketChannel} เพื่อดำเนินการต่อ`
      });

      logService.logTopupEvent('ticket_created', user.id, {
        ticketId,
        category,
        itemName: donationItem.name,
        amount: donationItem.price
      });

    } catch (error) {
      logService.error('Error creating donation ticket:', error);
      await interaction.editReply({
        content: '❌ ไม่สามารถสร้าง Ticket ได้ กรุณาลองใหม่อีกครั้ง'
      });
    }
  }

  async createSupportTicket(interaction) {
    try {
      const user = interaction.user;
      const guild = interaction.guild;
      
      // Check active support tickets
      const activeSupportTickets = await databaseService.getActiveSupportTickets(user.id);
      if (activeSupportTickets.length >= CONSTANTS.TICKET.MAX_SUPPORT_TICKETS_PER_USER) {
        return await interaction.editReply({
          content: `❌ คุณมี Support Ticket ที่เปิดอยู่เกินจำนวนที่อนุญาต (${activeSupportTickets.length}/${CONSTANTS.TICKET.MAX_SUPPORT_TICKETS_PER_USER})\nกรุณาปิด Ticket เก่าก่อนสร้างใหม่`
        });
      }

      const ticketId = Helpers.generateTicketId();
      
      console.log(`🆘 Creating support ticket: ${ticketId} for ${user.tag}`);

      // Create ticket channel
      const ticketChannel = await TicketManager.createSupportTicketChannel(guild, user, ticketId);
      
      if (!ticketChannel) {
        return await interaction.editReply({
          content: '❌ ไม่สามารถสร้าง Support Ticket ได้ กรุณาติดต่อแอดมิน'
        });
      }

      // Save to database
      await databaseService.createActiveTicket(user.id, ticketChannel.id, ticketId, 'support');

      const embed = EmbedBuilders.createSupportTicketEmbed(ticketId, user, activeSupportTickets, CONSTANTS.TICKET.MAX_SUPPORT_TICKETS_PER_USER);

      const closeButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`close_ticket_${ticketId}`)
            .setLabel('🔒 ปิด Ticket')
            .setStyle(ButtonStyle.Secondary)
        );

      await ticketChannel.send({
        content: `${user} ยินดีต้อนรับสู่ระบบช่วยเหลือ NEXArk! 🆘`,
        embeds: [embed],
        components: [closeButton]
      });

      await interaction.editReply({
        content: `✅ สร้าง Support Ticket สำเร็จ!\n📍 กรุณาไปที่ ${ticketChannel} เพื่อแจ้งปัญหาของคุณ`
      });

      logService.info('Support ticket created', {
        ticketId,
        userId: user.id,
        username: user.tag,
        channelId: ticketChannel.id
      });

    } catch (error) {
      logService.error('Error creating support ticket:', error);
      await interaction.editReply({
        content: '❌ ไม่สามารถสร้าง Support Ticket ได้ กรุณาลองใหม่อีกครั้ง'
      });
    }
  }

  async handleSlipSubmission(message) {
    try {
      const channelName = message.channel.name;
      const ticketData = this.activeTickets.get(message.channel.id);
      
      if (!ticketData) {
        console.warn(`No ticket data found for channel: ${message.channel.id}`);
        return;
      }

      // ตรวจสอบว่าเป็นเจ้าของ ticket หรือไม่
      if (!Validators.validateTicketOwnership(ticketData, message.author.id)) {
        return;
      }

      // ตรวจสอบว่ามี attachment หรือไม่
      if (!message.attachments.size) {
        return;
      }

      const attachment = message.attachments.first();
      
      // Validate file
      if (!Validators.validateFileType(attachment)) {
        return await message.reply('❌ ประเภทไฟล์ไม่ถูกต้อง กรุณาส่งไฟล์รูปภาพ (.jpg, .jpeg, .png)');
      }

      if (!Validators.validateFileSize(attachment)) {
        return await message.reply('❌ ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)');
      }

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
          const successEmbed = EmbedBuilders.createSlipVerificationSuccessEmbed(verificationResult.data, ticketData);
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
        logService.error('Slip processing error:', error);
        await processingMessage.edit({
          embeds: [EmbedBuilders.createErrorEmbed(
            '❌ เกิดข้อผิดพลาดในการประมวลผล',
            'กรุณาลองส่งสลิปใหม่อีกครั้ง หรือติดต่อแอดมิน'
          )]
        });
      }

    } catch (error) {
      logService.error('Error handling slip submission:', error);
    }
  }

  // แก้ไขใน TopupSystem class method executeDonation

async executeDonation(message, ticketData, verificationResult) {
  try {
    // Send executing message
    const executingEmbed = EmbedBuilders.createExecutingDonationEmbed(ticketData);
    const executingMessage = await message.channel.send({ embeds: [executingEmbed] });

    // ตรวจสอบสถานะผู้เล่นและเซิร์ฟเวอร์ที่ online อยู่
    const { category, donationItem, userGameInfo } = ticketData;
    
    // เช็คสถานะผู้เล่นล่าสุด
    const playerStatus = await databaseService.getPlayerOnlineStatus(userGameInfo.steam64);
    
    console.log('🎮 Player status check:', {
      steam64: userGameInfo.steam64,
      isOnline: playerStatus.isOnline,
      serverKey: playerStatus.serverKey,
      playerName: playerStatus.playerName
    });

    let success = false;
    let errorMessage = null;
    let targetServer = null;

    // Execute based on category
    switch (category) {
      case 'points':
        if (playerStatus.isOnline && playerStatus.serverKey) {
          // ส่งพ้อยไปที่เซิร์ฟเวอร์ที่ผู้เล่น online อยู่
          targetServer = playerStatus.serverKey;
          const pointsResult = await rconManager.givePointsToServer(
            targetServer, 
            userGameInfo.steam64, 
            donationItem.points
          );
          success = pointsResult.success;
          errorMessage = pointsResult.error;
        } else {
          // ถ้าผู้เล่น offline ให้ส่งไปเซิร์ฟเวอร์หลัก (หรือทุกเซิร์ฟเวอร์)
          const servers = rconManager.getAllServers().filter(s => s.isAvailable);
          if (servers.length > 0) {
            targetServer = servers[0].serverKey; // เซิร์ฟเวอร์แรกที่ใช้งานได้
            const pointsResult = await rconManager.givePointsToServer(
              targetServer,
              userGameInfo.steam64,
              donationItem.points
            );
            success = pointsResult.success;
            errorMessage = pointsResult.error;
          } else {
            errorMessage = 'ไม่มีเซิร์ฟเวอร์ที่ใช้งานได้';
          }
        }
        break;

      case 'ranks':
        // Add rank logic here - similar to points
        success = true; // Placeholder
        targetServer = playerStatus.serverKey || 'main';
        break;

      case 'items':
        if (donationItem.items && donationItem.items.length > 0) {
          if (playerStatus.isOnline && playerStatus.serverKey) {
            // ส่งไอเทมไปที่เซิร์ฟเวอร์ที่ผู้เล่น online อยู่
            targetServer = playerStatus.serverKey;
            let allSuccess = true;
            
            for (const item of donationItem.items) {
              const itemResult = await rconManager.giveItemToServer(
                targetServer,
                userGameInfo.steam64,
                item.path,
                item.quantity || 1,
                item.quality || 0,
                item.blueprintType || 0
              );
              
              if (!itemResult.success) {
                allSuccess = false;
                errorMessage = itemResult.error;
                break;
              }
            }
            success = allSuccess;
          } else {
            // ผู้เล่น offline - ไม่สามารถส่งไอเทมได้
            errorMessage = 'ผู้เล่นต้อง online ในเกมจึงจะสามารถรับไอเทมได้ กรุณาเข้าเกมแล้วติดต่อแอดมิน';
            success = false;
          }
        }
        break;

      default:
        errorMessage = 'หมวดหมู่ไม่รองรับ';
    }

    // Update database and send result
    const topupLog = await databaseService.getTopupByTicketId(ticketData.ticketId);
    
    if (success) {
      // Success - ส่ง webhook notification
      if (topupLog) {
        await databaseService.updateTopupStatus(topupLog.id, 'completed', {
          rconExecuted: true
        });
      }

      // ส่งข้อมูลไป Discord webhook
      await this.sendDonationWebhook({
        discordId: message.author.id,
        discordUsername: message.author.username,
        steam64: userGameInfo.steam64,
        characterId: userGameInfo.characterId,
        category: category,
        itemName: donationItem.name,
        amount: donationItem.price,
        server: targetServer,
        status: 'completed',
        ticketId: ticketData.ticketId,
        playerName: playerStatus.playerName,
        points: donationItem.points,
        items: donationItem.items,
        timestamp: new Date().toISOString()
      });

      const successEmbed = EmbedBuilders.createDonationCompletedEmbed(ticketData, category, donationItem);
      
      // เพิ่มข้อมูลเซิร์ฟเวอร์ในข้อความ
      if (targetServer) {
        successEmbed.addFields({
          name: '🎮 เซิร์ฟเวอร์',
          value: `**เซิร์ฟเวอร์:** ${targetServer}\n**สถานะผู้เล่น:** ${playerStatus.isOnline ? '🟢 Online' : '🔴 Offline'}`,
          inline: false
        });
      }
      
      await executingMessage.edit({ embeds: [successEmbed] });

      // Schedule channel deletion
      await databaseService.updateTicketStatus(ticketData.ticketId, 'completed');
      this.activeTickets.delete(message.channel.id);
      
      setTimeout(async () => {
        try {
          await message.channel.delete();
        } catch (error) {
          console.error('Error deleting completed ticket channel:', error);
        }
      }, 300000); // 5 minutes

    } else {
      // Failed
      if (topupLog) {
        await databaseService.updateTopupStatus(topupLog.id, 'failed', {
          errorMessage: errorMessage,
          rconExecuted: false
        });
      }

      // ส่ง webhook สำหรับ failed donation
      await this.sendDonationWebhook({
        discordId: message.author.id,
        discordUsername: message.author.username,
        steam64: userGameInfo.steam64,
        characterId: userGameInfo.characterId,
        category: category,
        itemName: donationItem.name,
        amount: donationItem.price,
        server: targetServer || 'unknown',
        status: 'failed',
        ticketId: ticketData.ticketId,
        playerName: playerStatus.playerName,
        error: errorMessage,
        timestamp: new Date().toISOString()
      });

      const failedEmbed = EmbedBuilders.createDonationFailedEmbed(ticketData, errorMessage);
      await executingMessage.edit({ embeds: [failedEmbed] });
    }

    logService.logTopupEvent(success ? 'completed' : 'failed', message.author.id, {
      ticketId: ticketData.ticketId,
      category,
      success,
      errorMessage,
      targetServer,
      playerOnline: playerStatus.isOnline
    });

  } catch (error) {
    logService.error('Error executing donation:', error);
    
    try {
      const errorEmbed = EmbedBuilders.createDonationFailedEmbed(ticketData, error.message);
      await message.channel.send({ embeds: [errorEmbed] });
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }
  }
}

// เพิ่ม method ใหม่สำหรับส่ง webhook
async sendDonationWebhook(donationData) {
  try {
    const webhookService = (await import('../services/webhookService.js')).default;
    const result = await webhookService.sendDonationNotification(donationData);
    
    if (result.success) {
      console.log('✅ Donation webhook sent successfully');
    } else {
      console.warn('⚠️ Donation webhook failed:', result.error || result.reason);
    }
  } catch (error) {
    console.error('❌ Error sending donation webhook:', error);
  }
}

  async cancelDonation(interaction) {
    try {
      const ticketData = this.activeTickets.get(interaction.channel.id);
      
      if (!ticketData) {
        return await interaction.editReply({
          content: '❌ ไม่พบข้อมูล Ticket'
        });
      }

      if (!Validators.validateTicketOwnership(ticketData, interaction.user.id)) {
        return await interaction.editReply({
          content: '❌ คุณไม่มีสิทธิ์ยกเลิก Ticket นี้'
        });
      }

      // Update database
      await databaseService.updateTicketStatus(ticketData.ticketId, 'cancelled');
      this.activeTickets.delete(interaction.channel.id);

      const cancelEmbed = EmbedBuilders.createCancelDonationEmbed(ticketData.ticketId);
      await interaction.editReply({ embeds: [cancelEmbed] });

      // Schedule deletion
      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (error) {
          console.error('Error deleting cancelled ticket channel:', error);
        }
      }, 10000);

      logService.logTopupEvent('cancelled', interaction.user.id, {
        ticketId: ticketData.ticketId
      });

    } catch (error) {
      logService.error('Error cancelling donation:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในการยกเลิก'
      });
    }
  }

  async closeSupportTicket(interaction) {
    try {
      const [, , ticketId] = interaction.customId.split('_');
      
      // Update database
      await databaseService.updateTicketStatus(ticketId, 'completed');

      const closeEmbed = EmbedBuilders.createCloseSupportTicketEmbed(ticketId);
      await interaction.editReply({ embeds: [closeEmbed] });

      // Schedule deletion
      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (error) {
          console.error('Error deleting support ticket channel:', error);
        }
      }, 10000);

      logService.info('Support ticket closed', {
        ticketId,
        userId: interaction.user.id
      });

    } catch (error) {
      logService.error('Error closing support ticket:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในการปิด Ticket'
      });
    }
  }

  // เพิ่ม method สำหรับ slash commands
  async handleSetupMenuCommand(interaction) {
    try {
      if (!interaction.member.permissions.has('Administrator')) {
        return await interaction.reply({
          content: '❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });
      await this.sendMainMenu(interaction.channel);
      
      await interaction.editReply({
        content: '✅ ตั้งค่าเมนูหลักเรียบร้อยแล้ว'
      });
    } catch (error) {
      logService.error('Error in setup menu command:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในการตั้งค่าเมนู'
      });
    }
  }

  async handleSetupScoreboardCommand(interaction) {
    try {
      if (!interaction.member.permissions.has('Administrator')) {
        return await interaction.reply({
          content: '❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้',
          ephemeral: true
        });
      }

      await interaction.reply({
        content: '✅ ตั้งค่า Scoreboard เรียบร้อยแล้ว',
        ephemeral: true
      });
    } catch (error) {
      logService.error('Error in setup scoreboard command:', error);
      await interaction.reply({
        content: '❌ เกิดข้อผิดพลาดในการตั้งค่า Scoreboard',
        ephemeral: true
      });
    }
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