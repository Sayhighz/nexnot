import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
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

class TopupSystem {
  constructor(client) {
    this.client = client;
    this.activeTickets = new Map(); // channelId -> ticketData
    this.userCooldowns = new Map(); // userId -> timestamp
  }

  async init() {
    console.log("🎮 Topup System initialized");

    // Register slash commands
    await this.registerCommands();

    // Setup event listeners
    this.setupEventListeners();

    // Setup menu channel
    await this.setupMenuChannel();

    // Cleanup old temp files periodically
    setInterval(() => {
      Helpers.cleanupTempFiles();
    }, 3600000); // Every hour
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

      // Clear old messages in channel
      try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(m => m.author.id === this.client.user.id);
        if (botMessages.size > 0) {
          await channel.bulkDelete(botMessages);
        }
      } catch (error) {
        console.warn('⚠️ Could not clear old messages:', error.message);
      }

      // Send main menu
      await this.sendMainMenu(channel);
      console.log('✅ Main menu sent to channel:', menuChannelId);

    } catch (error) {
      console.error('❌ Error setting up menu channel:', error);
    }
  }

  async sendMainMenu(channel) {
    const embed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.PRIMARY)
      .setTitle('🎮 ระบบโดเนทและบริการ')
      .setDescription(`
        **ยินดีต้อนรับสู่ระบบโดเนทอัตโนมัติ!**
        
        🔹 **โดเนทพ้อย** - เติมพ้อยสำหรับใช้ในเกม
        🔹 **โดเนทยศ** - อัพเกรดยศของคุณ
        🔹 **โดเนทไอเทม** - รับไอเทมพิเศษ
        🔹 **แจ้งปัญหา** - เปิด ticket สำหรับขอความช่วยเหลือ
        
        กรุณาเลือกบริการที่ต้องการจากปุ่มด้านล่าง
      `)
      .setFooter({ text: 'ระบบโดเนทอัตโนมัติ | Powered by NGC' })
      .setTimestamp();

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
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('support_ticket')
          .setLabel('🎫 แจ้งปัญหา')
          .setStyle(ButtonStyle.Danger)
      );

    await channel.send({
      embeds: [embed],
      components: [buttons]
    });
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
      console.log("✅ Topup commands registered");
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

  async handleSlashCommands(interaction) {
    const { commandName } = interaction;

    switch (commandName) {
      case "setup_menu":
        await this.handleSetupMenuCommand(interaction);
        break;
      case "setup_scoreboard":
        await this.handleSetupScoreboardCommand(interaction);
        break;
    }
  }

  async handleSetupMenuCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้",
        ephemeral: true,
      });
    }

    try {
      await this.sendMainMenu(interaction.channel);
      await interaction.reply({
        content: "✅ ตั้งค่าเมนูหลักเรียบร้อยแล้ว!",
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content: "❌ เกิดข้อผิดพลาดในการตั้งค่าเมนู",
        ephemeral: true,
      });
    }
  }

  async handleSetupScoreboardCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้",
        ephemeral: true,
      });
    }

    try {
      const { default: ScoreboardManager } = await import('./scoreboardManager.js');
      const scoreboardManager = new ScoreboardManager(this.client);
      await scoreboardManager.setupPermanentScoreboard(interaction.channel);
      
      await interaction.reply({
        content: "✅ ตั้งค่า scoreboard เรียบร้อยแล้ว!",
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content: "❌ เกิดข้อผิดพลาดในการตั้งค่า scoreboard",
        ephemeral: true,
      });
    }
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
          } else if (customId.startsWith('verify_slip_')) {
            await interaction.deferReply();
            await this.handleSlipVerification(interaction);
          } else if (customId.startsWith('close_ticket_')) {
            // Handle support ticket close
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
    if (this.isUserOnCooldown(userId)) {
      return await interaction.editReply({
        content: '⏰ กรุณารอสักครู่ก่อนทำรายการใหม่'
      });
    }
  
    // Check user link status
    const userGameInfo = await databaseService.getUserGameInfo(userId);
    if (!userGameInfo.isLinked) {
      return await interaction.editReply({
        content: '❌ คุณยังไม่ได้เชื่อมต่อบัญชี Discord กับเกม กรุณาติดต่อแอดมินเพื่อทำการเชื่อมต่อ'
      });
    }
  
    // Check active donation tickets only
    const activeDonationTickets = await databaseService.getActiveDonationTickets(userId);
    if (activeDonationTickets.length >= CONSTANTS.TICKET.MAX_TICKETS_PER_USER) {
      return await interaction.editReply({
        content: `❌ คุณมี Donation Ticket ที่เปิดอยู่เกินจำนวนที่อนุญาต (สูงสุด ${CONSTANTS.TICKET.MAX_TICKETS_PER_USER} ticket) กรุณาปิด ticket เก่าก่อน`
      });
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
        .setPlaceholder(`เลือก${this.getCategoryName(category)}ที่ต้องการ`)
        .addOptions(
          donations.map(item => ({
            label: item.name,
            description: `${Helpers.formatCurrency(item.price)} - ${item.description}`,
            value: item.id
          }))
        );
  
      const row = new ActionRowBuilder().addComponents(selectMenu);
  
      const embed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.INFO)
        .setTitle(`📦 เลือก${this.getCategoryName(category)}`)
        .setDescription(`กรุณาเลือก${this.getCategoryName(category)}ที่ต้องการซื้อ`)
        .addFields(
          {
            name: '🔗 สถานะการเชื่อมต่อ',
            value: `Steam64: \`${userGameInfo.steam64}\`\nCharacter ID: \`${userGameInfo.characterId || 'ไม่พบ'}\``,
            inline: false
          },
          {
            name: '🎫 Ticket Status',
            value: `Active Donation Tickets: ${activeDonationTickets.length}/${CONSTANTS.TICKET.MAX_TICKETS_PER_USER}`,
            inline: false
          }
        )
        .setTimestamp();
  
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
  
      // Set cooldown
      this.setUserCooldown(userId);
  
    } catch (error) {
      logService.error('Error showing donation category:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง'
      });
    }
  }

  getCategoryName(category) {
    const names = {
      'points': 'พ้อย',
      'ranks': 'ยศ',
      'items': 'ไอเทม'
    };
    return names[category] || category;
  }

  async handleSelectMenuInteraction(interaction) {
    if (interaction.customId.startsWith("select_donation_")) {
      await this.handleDonationSelection(interaction);
    }
  }

  async handleDonationSelection(interaction) {
    const [, , category] = interaction.customId.split('_');
    const selectedItemId = interaction.values[0];

    try {
      const config = configService.getConfig();
      const selectedItem = config.donation_categories[category].find(
        (item) => item.id === selectedItemId
      );

      if (!selectedItem) {
        return await interaction.reply({
          content: "❌ ไม่พบรายการที่เลือก",
          ephemeral: true,
        });
      }

      // Get user game info
      const userGameInfo = await databaseService.getUserGameInfo(interaction.user.id);
      if (!userGameInfo.isLinked) {
        return await interaction.reply({
          content: "❌ ไม่พบข้อมูลการเชื่อมต่อ กรุณาติดต่อแอดมิน",
          ephemeral: true,
        });
      }

      // สำหรับไอเทม ต้องมี character ID
      if (category === 'items' && !userGameInfo.characterId) {
        return await interaction.reply({
          content: "❌ ไม่พบข้อมูลตัวละครในเกม กรุณาเข้าเกมอย่างน้อย 1 ครั้งแล้วลองใหม่",
          ephemeral: true,
        });
      }

      // Update status
      await interaction.deferReply({ ephemeral: true });
      
      await interaction.editReply({
        content: "⏳ กำลังสร้าง ticket... กรุณารอสักครู่",
      });

      // Create ticket channel
      const ticketData = await this.createDonationTicket(
        interaction,
        selectedItem,
        category,
        userGameInfo
      );

      if (!ticketData) {
        return await interaction.editReply({
          content: "❌ ไม่สามารถสร้าง ticket ได้",
        });
      }

      await interaction.editReply({
        content: `✅ สร้าง ticket เรียบร้อยแล้ว! กรุณาไปที่ ${ticketData.channel} เพื่อดำเนินการต่อ`,
      });
    } catch (error) {
      logService.error("Error handling donation selection:", error);
      
      if (!interaction.replied) {
        await interaction.reply({
          content: "❌ เกิดข้อผิดพลาดในระบบ",
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: "❌ เกิดข้อผิดพลาดในระบบ",
        });
      }
    }
  }

  async createDonationTicket(interaction, donationItem, category, userGameInfo) {
    try {
      const guild = interaction.guild;
      const user = interaction.user;
      const ticketId = Helpers.generateTicketId();
  
      // Find or create category
      let ticketCategory = guild.channels.cache.find(
        (c) =>
          c.name === CONSTANTS.CHANNELS.TICKET_CATEGORY &&
          c.type === ChannelType.GuildCategory
      );
  
      if (!ticketCategory) {
        ticketCategory = await guild.channels.create({
          name: CONSTANTS.CHANNELS.TICKET_CATEGORY,
          type: ChannelType.GuildCategory,
        });
      }
  
      // Create ticket channel
      const ticketChannel = await guild.channels.create({
        name: `${CONSTANTS.TICKET.PREFIX}${ticketId}`,
        type: ChannelType.GuildText,
        parent: ticketCategory.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });
  
      // Get config and generate PromptPay URL
      const config = configService.getConfig();
      const promptPayUrl = qrCodeService.getPromptPayUrl(
        donationItem.price, 
        config.qr_code.payment_info.account_number
      );
  
      // Create ticket embed
      const embed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.INFO)
        .setTitle(`🎫 Ticket #${ticketId}`)
        .setDescription(
          `
          **รายการ:** ${donationItem.name}
          **หมวดหมู่:** ${this.getCategoryName(category)}
          **ราคา:** ${Helpers.formatCurrency(donationItem.price)}
          **Steam64:** \`${userGameInfo.steam64}\`
          ${userGameInfo.characterId ? `**Character ID:** \`${userGameInfo.characterId}\`` : ''}
          **สถานะ:** รอการชำระเงิน
          
          **ข้อมูลการโอน:**
          🏦 ธนาคาร: ${config.qr_code.payment_info.bank_name}
          💳 เลขบัญชี: ${config.qr_code.payment_info.account_number}
          👤 ชื่อบัญชี: ${config.qr_code.payment_info.account_name}
          💰 จำนวนเงิน: ${Helpers.formatCurrency(donationItem.price)}
          
          **วิธีการชำระเงิน:**
          1. สแกน QR Code ด้านล่าง หรือโอนเงินตามข้อมูลด้านบน
          2. ส่งรูปสลิปการโอนเงินในแชทนี้
          3. รอระบบตรวจสอบ (ประมาณ 1-5 นาที)
          4. ระบบจะดำเนินการให้อัตโนมัติ
        `
        )
        .setImage(promptPayUrl)
        .setTimestamp();
  
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("cancel_donation")
          .setLabel("❌ ยกเลิก")
          .setStyle(ButtonStyle.Danger)
      );
  
      await ticketChannel.send({
        content: `${user}, ยินดีต้อนรับสู่ระบบโดเนท!`,
        embeds: [embed],
        components: [buttons],
      });
  
      // เหลือส่วนอื่นเหมือนเดิม...
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
        status: "pending",
      });
  
      // Create active ticket record
      await databaseService.createActiveTicket(
        user.id,
        ticketChannel.id,
        ticketId,
        'donation'
      );
  
      // Store ticket data
      this.activeTickets.set(ticketChannel.id, {
        ticketId,
        userId: user.id,
        donationItem,
        category,
        userGameInfo,
        logId,
        status: "waiting_slip",
      });
  
      logService.logTopupEvent("ticket_created", user.id, {
        ticketId,
        category,
        itemId: donationItem.id,
        amount: donationItem.price,
      });
  
      return {
        channel: ticketChannel,
        ticketId,
      };
    } catch (error) {
      logService.error("Error creating donation ticket:", error);
      return null;
    }
  }

  async createSupportTicket(interaction) {
    const userId = interaction.user.id;
    
    // Check support ticket limit
    const activeSupportTickets = await databaseService.getActiveSupportTickets(userId);
    if (activeSupportTickets.length >= CONSTANTS.TICKET.MAX_SUPPORT_TICKETS_PER_USER) {
      return await interaction.editReply({
        content: `❌ คุณมี Support Ticket ที่เปิดอยู่เกินจำนวนที่อนุญาต (สูงสุด ${CONSTANTS.TICKET.MAX_SUPPORT_TICKETS_PER_USER} ticket) กรุณาปิด ticket เก่าก่อน`
      });
    }
  
    try {
      const guild = interaction.guild;
      const user = interaction.user;
      const ticketId = Helpers.generateTicketId();
  
      // Find or create category
      let ticketCategory = guild.channels.cache.find(
        (c) =>
          c.name === 'SUPPORT_TICKETS' &&
          c.type === ChannelType.GuildCategory
      );
  
      if (!ticketCategory) {
        ticketCategory = await guild.channels.create({
          name: 'SUPPORT_TICKETS',
          type: ChannelType.GuildCategory,
        });
      }
  
      // Create ticket channel
      const ticketChannel = await guild.channels.create({
        name: `support-${ticketId}`,
        type: ChannelType.GuildText,
        parent: ticketCategory.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });
  
      const embed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.WARNING)
        .setTitle(`🎫 Support Ticket #${ticketId}`)
        .setDescription(
          `
          สวัสดี ${user}! 
          
          ขอบคุณที่ติดต่อทีมงาน กรุณาอธิบายปัญหาหรือข้อสอบถามของคุณ
          ทีมงานจะตอบกลับโดยเร็วที่สุด
          
          **หมายเหตุ:**
          - กรุณาอธิบายปัญหาให้ชัดเจน
          - แนบภาพหน้าจอหากจำเป็น
          - ระบุเวลาที่เกิดปัญหา
          
          **Ticket Limit:** ${activeSupportTickets.length + 1}/${CONSTANTS.TICKET.MAX_SUPPORT_TICKETS_PER_USER}
        `
        )
        .setTimestamp();
  
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`close_ticket_${ticketId}`)
          .setLabel("🔒 ปิด Ticket")
          .setStyle(ButtonStyle.Danger)
      );
  
      await ticketChannel.send({
        content: `${user}, ยินดีต้อนรับสู่ระบบ Support!`,
        embeds: [embed],
        components: [buttons],
      });
  
      // Create active ticket record
      await databaseService.createActiveTicket(
        user.id,
        ticketChannel.id,
        ticketId,
        'support'
      );
  
      await interaction.editReply({
        content: `✅ สร้าง Support Ticket เรียบร้อยแล้ว! กรุณาไปที่ ${ticketChannel} เพื่อแจ้งปัญหา`,
      });
  
      logService.logTopupEvent("support_ticket_created", user.id, {
        ticketId,
      });
  
    } catch (error) {
      logService.error("Error creating support ticket:", error);
      await interaction.editReply({
        content: "❌ ไม่สามารถสร้าง Support Ticket ได้",
      });
    }
  }

  async handleSlipSubmission(message) {
    if (!message.attachments.size) return;

    const channelId = message.channel.id;
    const ticketData = this.activeTickets.get(channelId);

    if (!ticketData || ticketData.userId !== message.author.id) {
      return;
    }

    if (ticketData.status !== 'waiting_slip') {
      return await message.reply('❌ ไม่สามารถส่งสลิปได้ในขณะนี้');
    }

    const attachment = message.attachments.first();
    
    // Validate file type
    const validExtensions = CONSTANTS.SLIP.ALLOWED_EXTENSIONS;
    const fileExt = attachment.name.toLowerCase().substring(attachment.name.lastIndexOf('.'));
    
    if (!validExtensions.includes(fileExt)) {
      return await message.reply('❌ ไฟล์ต้องเป็นรูปภาพ (.jpg, .jpeg, .png) เท่านั้น');
    }

    // Validate file size
    if (attachment.size > CONSTANTS.SLIP.MAX_FILE_SIZE) {
      return await message.reply('❌ ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)');
    }

    // Update ticket status
    ticketData.status = 'processing_slip';
    this.activeTickets.set(channelId, ticketData);

    const processingEmbed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.WARNING)
      .setTitle('⏳ กำลังตรวจสอบสลิป')
      .setDescription('กรุณารอสักครู่ ระบบกำลังตรวจสอบสลิปของคุณ...')
      .setTimestamp();

    const processingMessage = await message.reply({ embeds: [processingEmbed] });

    try {
      const config = configService.getConfig();
      
      console.log('🔍 Processing slip with data:', {
        expectedAmount: ticketData.donationItem.price,
        configBankInfo: config.qr_code.payment_info,
        itemName: ticketData.donationItem.name
      });

      // Process slip verification
      const verificationResult = await slipVerification.processSlipImage(
        attachment, 
        message.author.id, 
        ticketData.donationItem.price,
        config.qr_code.payment_info
      );

      if (!verificationResult.success) {
        ticketData.status = 'waiting_slip';
        this.activeTickets.set(channelId, ticketData);

        const errorEmbed = new EmbedBuilder()
          .setColor(CONSTANTS.COLORS.ERROR)
          .setTitle('❌ การตรวจสอบสลิปล้มเหลว')
          .setDescription(`เหตุผล: ${verificationResult.error}`)
          .setTimestamp();

        await processingMessage.edit({ embeds: [errorEmbed] });
        return;
      }

      // Display verification success
      const successEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.SUCCESS)
        .setTitle('✅ การตรวจสอบสลิปสำเร็จ!')
        .setDescription(`
          **ข้อมูลการโอนเงิน:**
          • จำนวนเงิน: ${Helpers.formatCurrency(verificationResult.data.amount)}
          • วันที่: ${new Date(verificationResult.data.date).toLocaleString('th-TH')}
          • ธนาคารผู้รับ: ${verificationResult.data.receiverBank || verificationResult.data.bank}
          • ชื่อผู้รับ: ${verificationResult.data.receiver}
          • เลขบัญชีผู้รับ: ${verificationResult.data.receiverAccount}
          
          กำลังดำเนินการ...
        `)
        .setTimestamp();

      await processingMessage.edit({ embeds: [successEmbed] });

      // Update database
      await databaseService.updateTopupStatus(ticketData.logId, 'verified', {
        verificationData: verificationResult.data,
        slipImageUrl: attachment.url
      });

      // Execute donation
      await this.executeDonation(ticketData, processingMessage);

    } catch (error) {
      logService.error('Error processing slip:', error);
      
      ticketData.status = 'waiting_slip';
      this.activeTickets.set(channelId, ticketData);

      const systemErrorEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.ERROR)
        .setTitle('❌ เกิดข้อผิดพลาดในระบบ')
        .setDescription('กรุณาลองส่งสลิปใหม่อีกครั้ง')
        .setTimestamp();

      await processingMessage.edit({ embeds: [systemErrorEmbed] });
    }
  }

  async executeDonation(ticketData, processingMessage) {
    try {
      const { donationItem, category, userGameInfo } = ticketData;

      // Update processing message
      const executingEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.WARNING)
        .setTitle("⚙️ กำลังดำเนินการ")
        .setDescription("กรุณารอสักครู่ ระบบกำลังดำเนินการให้คุณ...")
        .setTimestamp();

      await processingMessage.edit({ embeds: [executingEmbed] });

      let rconResults = [];
      let allSucceeded = false;

      // Execute based on category
      switch (category) {
        case 'points':
          const pointResult = await rconManager.givePoints(userGameInfo.steam64, donationItem.points);
          rconResults.push({ command: `givepoints ${userGameInfo.steam64} ${donationItem.points}`, result: pointResult });
          allSucceeded = pointResult.success;
          break;

        case 'ranks':
          // Add rank logic here - depends on your rank system
          const rankResult = await rconManager.executeCommand(`addrank ${userGameInfo.steam64} ${donationItem.rank}`);
          rconResults.push({ command: `addrank ${userGameInfo.steam64} ${donationItem.rank}`, result: rankResult });
          allSucceeded = rankResult.success;
          break;

        case 'items':
          if (donationItem.items) {
            // Multiple items
            for (const item of donationItem.items) {
              const itemResult = await rconManager.giveItem(
                userGameInfo.characterId, 
                item.item_path, 
                item.quantity
              );
              rconResults.push({ 
                command: `giveitem ${userGameInfo.characterId} ${item.item_path} ${item.quantity}`, 
                result: itemResult 
              });
            }
          } else {
            // Single item
            const itemResult = await rconManager.giveItem(
              userGameInfo.characterId, 
              donationItem.item_path, 
              donationItem.quantity
            );
            rconResults.push({ 
              command: `giveitem ${userGameInfo.characterId} ${donationItem.item_path} ${donationItem.quantity}`, 
              result: itemResult 
            });
          }
          allSucceeded = rconResults.every((r) => r.result.success);
          break;
      }

      if (allSucceeded) {
        // Success
        await databaseService.updateTopupStatus(ticketData.logId, "completed", {
          rconExecuted: true,
        });

        await databaseService.updateTicketStatus(
          ticketData.ticketId,
          "completed"
        );

        const successEmbed = new EmbedBuilder()
          .setColor(CONSTANTS.COLORS.SUCCESS)
          .setTitle("✅ การโดเนทสำเร็จ!")
          .setDescription(
            `
            **รายการ:** ${donationItem.name}
            **หมวดหมู่:** ${this.getCategoryName(category)}
            **สถานะ:** สำเร็จ
            
            ${this.getSuccessMessage(category, donationItem)}
            
            ticket นี้จะถูกปิดใน 5 นาที
          `
          )
          .setTimestamp();

        await processingMessage.edit({ embeds: [successEmbed] });

        // Schedule channel cleanup
        setTimeout(async () => {
          try {
            await processingMessage.channel.delete();
            this.activeTickets.delete(ticketData.channelId);
          } catch (error) {
            console.error("Error deleting ticket channel:", error);
          }
        }, 300000); // 5 minutes

        logService.logTopupEvent("donation_completed", ticketData.userId, {
          ticketId: ticketData.ticketId,
          category,
          itemId: donationItem.id,
        });
      } else {
        // Some commands failed
        await databaseService.updateTopupStatus(ticketData.logId, "failed", {
          rconExecuted: false,
          errorMessage: "RCON command execution failed",
        });

        const failedEmbed = new EmbedBuilder()
          .setColor(CONSTANTS.COLORS.ERROR)
          .setTitle("❌ เกิดข้อผิดพลาดในการดำเนินการ")
          .setDescription(
            `
            ระบบไม่สามารถดำเนินการได้ในขณะนี้
            
            กรุณาติดต่อแอดมินพร้อมแจ้ง Ticket ID: \`${ticketData.ticketId}\`
          `
          )
          .setTimestamp();

        await processingMessage.edit({ embeds: [failedEmbed] });

        logService.logTopupEvent("donation_failed", ticketData.userId, {
          ticketId: ticketData.ticketId,
          category,
          error: "RCON execution failed",
          rconResults,
        });
      }
    } catch (error) {
      logService.error("Error executing donation:", error);

      await databaseService.updateTopupStatus(ticketData.logId, "failed", {
        rconExecuted: false,
        errorMessage: error.message,
      });

      const systemErrorEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.ERROR)
        .setTitle("❌ เกิดข้อผิดพลาดในระบบ")
        .setDescription(
          `
          ระบบเกิดข้อผิดพลาด กรุณาติดต่อแอดมิน
          
          Ticket ID: \`${ticketData.ticketId}\`
        `
        )
        .setTimestamp();

      await processingMessage.edit({ embeds: [systemErrorEmbed] });
    }
  }

  getSuccessMessage(category, donationItem) {
    switch (category) {
      case 'points':
        return `ได้รับ ${donationItem.points} พ้อยแล้ว กรุณาตรวจสอบในเกม`;
      case 'ranks':
        return `ได้รับยศ ${donationItem.rank} แล้ว กรุณาตรวจสอบในเกม`;
      case 'items':
        return `ได้รับไอเทมแล้ว กรุณาตรวจสอบในเกม`;
      default:
        return 'การดำเนินการเสร็จสิ้น กรุณาตรวจสอบในเกม';
    }
  }

  async cancelDonation(interaction) {
    const channelId = interaction.channel.id;
    const ticketData = this.activeTickets.get(channelId);
  
    // Debug log
    console.log('🔍 Cancel Debug:', {
      channelId,
      hasTicketData: !!ticketData,
      ticketUserId: ticketData?.userId,
      interactionUserId: interaction.user.id,
      userIdMatch: ticketData?.userId === interaction.user.id
    });
  
    if (!ticketData) {
      return await interaction.editReply({
        content: '❌ ไม่พบข้อมูล ticket นี้ อาจจะหมดอายุแล้ว'
      });
    }
  
    // แปลงเป็น string เพื่อเปรียบเทียบ
    if (String(ticketData.userId) !== String(interaction.user.id)) {
      return await interaction.editReply({
        content: `❌ คุณไม่มีสิทธิ์ยกเลิก ticket นี้ (Owner: ${ticketData.userId}, You: ${interaction.user.id})`
      });
    }
  
    try {
      // Update database
      await databaseService.updateTopupStatus(ticketData.logId, 'cancelled');
      await databaseService.updateTicketStatus(ticketData.ticketId, 'cancelled');
  
      const cancelEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.WARNING)
        .setTitle('❌ ยกเลิกการโดเนท')
        .setDescription('การโดเนทถูกยกเลิกแล้ว ticket นี้จะถูกปิดใน 10 วินาที')
        .setTimestamp();
  
      await interaction.editReply({ embeds: [cancelEmbed] });
  
      // Remove from active tickets
      this.activeTickets.delete(channelId);
  
      // Schedule channel deletion
      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (error) {
          console.error('Error deleting cancelled ticket:', error);
        }
      }, 10000);
  
      logService.logTopupEvent('donation_cancelled', ticketData.userId, {
        ticketId: ticketData.ticketId,
        category: ticketData.category
      });
  
    } catch (error) {
      logService.error('Error cancelling donation:', error);
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในการยกเลิก'
      });
    }
  }

  // เพิ่ม method นี้ลงไปใน class TopupSystem
async closeSupportTicket(interaction) {
  const ticketId = interaction.customId.replace('close_ticket_', '');
  
  try {
    // Update database
    await databaseService.updateTicketStatus(ticketId, 'cancelled');

    const closeEmbed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.WARNING)
      .setTitle('🔒 ปิด Support Ticket')
      .setDescription('Support Ticket ถูกปิดแล้ว channel นี้จะถูกลบใน 10 วินาที')
      .setTimestamp();

    await interaction.editReply({ embeds: [closeEmbed] });

    // Schedule channel deletion
    setTimeout(async () => {
      try {
        await interaction.channel.delete();
      } catch (error) {
        console.error('Error deleting support ticket:', error);
      }
    }, 10000);

    logService.logTopupEvent('support_ticket_closed', interaction.user.id, {
      ticketId
    });

  } catch (error) {
    logService.error('Error closing support ticket:', error);
    await interaction.editReply({
      content: '❌ เกิดข้อผิดพลาดในการปิด ticket'
    });
  }
}

  isUserOnCooldown(userId) {
    const cooldownTime = this.userCooldowns.get(userId);
    if (!cooldownTime) return false;

    return Date.now() - cooldownTime < 5000; // 5 seconds cooldown
  }

  setUserCooldown(userId) {
    this.userCooldowns.set(userId, Date.now());
  }
}

export default TopupSystem;