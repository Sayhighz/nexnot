// src/components/topupSystem.js
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
    this.temporarySteamIds = new Map(); // ✅ เพิ่ม Map สำหรับเก็บ Steam ID ชั่วคราว
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
          .setEmoji('🎪')
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

        case 'input_steam_id': // ✅ เพิ่ม case สำหรับปุ่มกรอก Steam ID
          await this.showSteamIdModal(interaction);
          break;

        case 'cancel_donation':
          await interaction.deferReply();
          await this.cancelDonation(interaction);
          break;
          
        default:
          if (customId.startsWith('select_donation_')) {
            await interaction.deferReply({ ephemeral: true });
            await this.handleDonationSelection(interaction);
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

  // ✅ แก้ไข handleModalSubmit
  async handleModalSubmit(interaction) {
    try {
      console.log(`📝 Modal submit: ${interaction.customId} by ${interaction.user.tag}`);
      
      if (interaction.customId === 'steam_id_modal') {
        await this.handleSteamIdSubmit(interaction);
      } else {
        await interaction.reply({
          content: '❌ Modal นี้ไม่รองรับหรือหมดอายุแล้ว',
          ephemeral: true
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

  // ✅ เพิ่ม method สำหรับแสดง Steam ID Modal
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

  // ✅ เพิ่ม method สำหรับ handle Steam ID Submit
  async handleSteamIdSubmit(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const steamId = interaction.fields.getTextInputValue('steam_id_input');
      const userId = interaction.user.id;

      // ตรวจสอบ Steam64 ID format
      if (!Helpers.validateSteam64(steamId)) {
        return await interaction.editReply({
          content: '❌ Steam64 ID ไม่ถูกต้อง กรุณากรอกเลข 17 หลักที่ขึ้นต้นด้วย 7656119'
        });
      }

      // บันทึก Steam ID ชั่วคราว (จะหายไปเมื่อบอทรีสตาร์ท)
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

      console.log(`🆔 Temporary Steam ID saved for ${interaction.user.tag}: ${steamId}`);

    } catch (error) {
      logService.error('Error handling Steam ID submit:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในการบันทึก Steam ID'
      });
    }
  }

  // ✅ แก้ไข showDonationCategory
  async showDonationCategory(interaction, category) {
    const userId = interaction.user.id;
    
    try {
      // ตรวจสอบว่าเป็นการใช้ temporary steam id หรือไม่
      let userGameInfo = null;
      let isTemporary = false;

      // ตรวจสอบว่ามี custom id ที่ขึ้นต้นด้วย temp_ หรือไม่
      if (interaction.customId && interaction.customId.startsWith('temp_')) {
        // ใช้ temporary steam id
        const tempData = this.temporarySteamIds.get(userId);
        if (tempData) {
          userGameInfo = {
            isLinked: false,
            steam64: tempData.steamId,
            characterId: null,
            userData: null,
            playerData: null,
            isTemporary: true
          };
          isTemporary = true;
        }
      }

      // ถ้าไม่ใช่ temporary หรือไม่มี temp data ให้ตรวจสอบ link ปกติ
      if (!userGameInfo) {
        userGameInfo = await databaseService.getUserGameInfo(userId);
      }

      // ถ้าไม่มีข้อมูลเลย ให้แสดง no link embed
      if (!userGameInfo || (!userGameInfo.isLinked && !userGameInfo.isTemporary)) {
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

      // ตรวจสอบ active donation tickets
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
        .setCustomId(`select_donation_${category}${isTemporary ? '_temp' : ''}`) // เพิ่ม _temp ถ้าเป็น temporary
        .setPlaceholder(`🔥 เลือก${BrandUtils.categoryDisplayNames[category]}ที่ต้องการ ${BrandUtils.categoryIcons[category]}`)
        .addOptions(
          donations.slice(0, 25).map(item => ({ 
            label: item.name.substring(0, 100),
            description: `💰 ${Helpers.formatCurrency(item.price)} | ${item.description?.substring(0, 100) || 'ไม่มีรายละเอียด'}`,
            value: item.id,
            emoji: BrandUtils.categoryIcons[category]
          }))
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);
      
      // เลือก embed ที่เหมาะสม
      let embed;
      if (isTemporary) {
        embed = EmbedBuilders.createTemporarySteamIdEmbed(
          category, 
          userGameInfo.steam64, 
          activeDonationTickets, 
          CONSTANTS.TICKET.MAX_TICKETS_PER_USER, 
          donations
        );
      } else {
        embed = EmbedBuilders.createCategorySelectionEmbed(
          category, 
          userGameInfo, 
          activeDonationTickets, 
          CONSTANTS.TICKET.MAX_TICKETS_PER_USER, 
          donations
        );
      }

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

  // ✅ แก้ไข handleDonationSelection
  async handleDonationSelection(interaction) {
    try {
      let category, isTemporary = false;
      const customIdParts = interaction.customId.split('_');
      
      if (customIdParts.length === 4 && customIdParts[3] === 'temp') {
        // temporary donation selection
        category = customIdParts[2];
        isTemporary = true;
      } else {
        // normal donation selection
        category = customIdParts[2];
      }

      const selectedId = interaction.values[0];
      const userId = interaction.user.id;

      console.log(`💰 Donation selection: ${category}/${selectedId} by ${interaction.user.tag} (temporary: ${isTemporary})`);

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
      let userGameInfo;
      if (isTemporary) {
        const tempData = this.temporarySteamIds.get(userId);
        if (!tempData) {
          return await interaction.editReply({
            content: '❌ ไม่พบข้อมูล Steam ID ชั่วคราว กรุณากรอกใหม่'
          });
        }
        userGameInfo = {
          isLinked: false,
          steam64: tempData.steamId,
          characterId: null,
          userData: null,
          playerData: null,
          isTemporary: true
        };
      } else {
        userGameInfo = await databaseService.getUserGameInfo(userId);
        if (!Validators.validateUserGameInfo(userGameInfo, category)) {
          const config = configService.getConfig();
          const linkChannelId = config.channels?.link_discord_channel_id;
          const embed = EmbedBuilders.createNoLinkEmbed(linkChannelId);
          return await interaction.editReply({ embeds: [embed] });
        }
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
        amount: donationItem.price,
        isTemporary: userGameInfo.isTemporary || false
      });

    } catch (error) {
      logService.error('Error creating donation ticket:', error);
      await interaction.editReply({
        content: '❌ ไม่สามารถสร้าง Ticket ได้ กรุณาลองใหม่อีกครั้ง'
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

  // ✅ แก้ไข executeDonation ให้ใช้เซิร์ฟเวอร์เดียว
  async executeDonation(message, ticketData, verificationResult) {
    try {
      // Send executing message
      const executingEmbed = EmbedBuilders.createExecutingDonationEmbed(ticketData);
      const executingMessage = await message.channel.send({ embeds: [executingEmbed] });

      const { category, donationItem, userGameInfo } = ticketData;
      
      console.log('🎮 Executing donation for Steam64:', userGameInfo.steam64);

      let success = false;
      let errorMessage = null;
      const targetServer = 'main'; // ✅ ใช้เซิร์ฟเวอร์เดียวเสมอ

      // Execute based on category
      switch (category) {
        case 'points':
          console.log(`💰 Giving ${donationItem.points} points to ${userGameInfo.steam64} on ${targetServer}`);
          const pointsResult = await rconManager.givePointsToServer(
            targetServer, 
            userGameInfo.steam64, 
            donationItem.points
          );
          success = pointsResult.success;
          errorMessage = pointsResult.error;
          break;

        case 'ranks':
          console.log(`👑 Giving rank ${donationItem.rank} to ${userGameInfo.steam64} on ${targetServer}`);
          if (donationItem.rcon_commands && donationItem.rcon_commands.length > 0) {
            const rankResult = await rconManager.executeRankCommands(
              targetServer,
              userGameInfo.steam64,
              donationItem.rcon_commands
            );
            success = rankResult.success;
            errorMessage = rankResult.error;
          } else {
            errorMessage = 'ไม่พบคำสั่ง RCON สำหรับยศนี้';
          }
          break;

        case 'items':
          console.log(`🎁 Giving items to ${userGameInfo.steam64} on ${targetServer}`);
          if (donationItem.items && donationItem.items.length > 0) {
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
                console.error(`❌ Failed to give item ${item.path}:`, itemResult.error);
                break;
              }
            }
            success = allSuccess;
          } else {
            errorMessage = 'ไม่พบรายการไอเทมที่ต้องส่ง';
          }
          break;

        default:
          errorMessage = 'หมวดหมู่ไม่รองรับ';
      }

      // Update database and send result
      const topupLog = await databaseService.getTopupByTicketId(ticketData.ticketId);
      
      if (success) {
        console.log(`✅ Donation executed successfully for ${userGameInfo.steam64}`);
        
        // Success - อัพเดทฐานข้อมูล
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
          playerName: message.author.username,
          points: donationItem.points,
          items: donationItem.items,
          timestamp: new Date().toISOString()
        });

        const successEmbed = EmbedBuilders.createDonationCompletedEmbed(ticketData, category, donationItem);
        
        // เพิ่มข้อมูลเซิร์ฟเวอร์ในข้อความ
        successEmbed.addFields({
          name: '🎮 เซิร์ฟเวอร์',
          value: `**เซิร์ฟเวอร์:** ${targetServer}\n**Steam64 ID:** \`${userGameInfo.steam64}\``,
          inline: false
        });
        
        await executingMessage.edit({ embeds: [successEmbed] });

        // Schedule channel deletion
        await databaseService.updateTicketStatus(ticketData.ticketId, 'completed');
        this.activeTickets.delete(message.channel.id);
        
        // ลบ temporary steam id ถ้ามี
        if (userGameInfo.isTemporary) {
          this.temporarySteamIds.delete(message.author.id);
        }
        
        setTimeout(async () => {
          try {
            await message.channel.delete();
          } catch (error) {
            console.error('Error deleting completed ticket channel:', error);
          }
        }, 300000); // 5 minutes

      } else {
        console.error(`❌ Donation failed for ${userGameInfo.steam64}:`, errorMessage);
        
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
          server: targetServer,
          status: 'failed',
          ticketId: ticketData.ticketId,
          playerName: message.author.username,
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
        isTemporary: userGameInfo.isTemporary || false
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

      // ลบ temporary steam id ถ้ามี
      if (ticketData.userGameInfo.isTemporary) {
        this.temporarySteamIds.delete(interaction.user.id);
      }

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

  // ✅ เพิ่ม handler สำหรับปุ่ม temp_donate_*
  async handleTempDonateButtons(interaction) {
    const { customId } = interaction;
    const category = customId.replace('temp_donate_', '');
    
    await interaction.deferReply({ ephemeral: true });
    await this.showDonationCategory(interaction, category);
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
    
    // ✅ เพิ่มการทำความสะอาด temporary steam IDs ทุก 1 ชั่วโมง
    setInterval(() => {
      this.cleanupTemporarySteamIds();
    }, 3600000);
    
    console.log('🔄 NEXArk periodic tasks started');
  }

  // ✅ เพิ่ม method สำหรับทำความสะอาด temporary steam IDs
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
      console.log(`🧹 Cleaned up ${cleanedCount} expired temporary Steam IDs`);
    }
  }

  async shutdown() {
    console.log('🛑 NEXArk Topup System shutting down...');
    this.activeTickets.clear();
    this.userCooldowns.clear();
    this.temporarySteamIds.clear(); // ✅ เพิ่มการล้าง temporary steam IDs
    console.log('✅ NEXArk Topup System shutdown complete');
  }
}

export default TopupSystem;