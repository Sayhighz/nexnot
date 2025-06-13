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

    // Cleanup old temp files periodically
    setInterval(() => {
      Helpers.cleanupTempFiles();
    }, 3600000); // Every hour
  }

  async registerCommands() {
    const commands = [
      {
        name: "topup",
        description: "เปิดระบบเติมเงิน",
      },
      {
        name: "setup",
        description: "ตั้งค่าระบบ (Admin only)",
        options: [
          {
            name: "channel",
            description: "Channel สำหรับแสดงปุ่มเติมเงิน",
            type: 7, // CHANNEL
            required: true,
          },
        ],
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
      case "topup":
        await this.handleTopupCommand(interaction);
        break;
      case "setup":
        await this.handleSetupCommand(interaction);
        break;
    }
  }

  async handleTopupCommand(interaction) {
    const embed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.PRIMARY)
      .setTitle("🎮 ระบบเติมเงินอัตโนมัติ")
      .setDescription("กดปุ่มด้านล่างเพื่อเริ่มการเติมเงิน")
      .setTimestamp();

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("start_topup")
        .setLabel("🛒 เติมเงิน")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({
      embeds: [embed],
      components: [button],
      ephemeral: false,
    });
  }

  async handleSetupCommand(interaction) {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return await interaction.reply({
        content: "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้",
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel("channel");

    const embed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.SUCCESS)
      .setTitle("🎮 ระบบเติมเงินอัตโนมัติ")
      .setDescription(
        `
        **วิธีการเติมเงิน:**
        1. กดปุ่ม "เติมเงิน" ด้านล่าง
        2. เลือก Package ที่ต้องการ
        3. กรอก Steam64 ID ของคุณ
        4. ชำระเงินตาม QR Code
        5. ส่งรูปสลิปการโอนเงิน
        6. รอระบบตรวจสอบและส่งของให้อัตโนมัติ
        
        **หมายเหตุ:**
        - สลิปต้องชัดเจนและมีข้อมูลครบถ้วน
        - สลิปที่ใช้แล้วจะไม่สามารถใช้ซ้ำได้
        - ระบบจะตรวจสอบการชำระเงินอัตโนมัติ
      `
      )
      .setFooter({ text: "ระบบเติมเงินอัตโนมัติ" })
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("start_topup")
        .setLabel("🛒 เติมเงิน")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("view_scoreboard")
        .setLabel("🏆 ดู Scoreboard")
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      await channel.send({
        embeds: [embed],
        components: [buttons],
      });

      await interaction.reply({
        content: `✅ ตั้งค่าเรียบร้อยแล้ว! ส่งข้อความไปยัง ${channel} แล้ว`,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content: "❌ เกิดข้อผิดพลาดในการส่งข้อความ",
        ephemeral: true,
      });
    }
  }

  async handleButtonInteraction(interaction) {
  const { customId, user } = interaction;

  try {
    switch (customId) {
      case 'start_topup':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.startTopupProcess(interaction);
        break;
        
      case 'view_scoreboard':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { default: ScoreboardManager } = await import('./scoreboardManager.js');
        const scoreboardManager = new ScoreboardManager(this.client);
        await scoreboardManager.showScoreboard(interaction);
        break;
        
      case 'confirm_package':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.confirmPackageSelection(interaction);
        break;
        
      case 'cancel_topup':
        await interaction.deferReply();
        await this.cancelTopup(interaction);
        break;
        
      default:
        if (customId.startsWith('verify_slip_')) {
          await interaction.deferReply();
          await this.handleSlipVerification(interaction);
        } else if (customId.startsWith('scoreboard_')) {
          await interaction.deferUpdate();
          const { default: ScoreboardManager } = await import('./scoreboardManager.js');
          const scoreboardManager = new ScoreboardManager(this.client);
          await scoreboardManager.handleScoreboardNavigation(interaction);
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

  async startTopupProcess(interaction) {
  const userId = interaction.user.id;
  
  // Check cooldown
  if (this.isUserOnCooldown(userId)) {
    return await interaction.editReply({
      content: '⏰ กรุณารอสักครู่ก่อนทำรายการใหม่'
    });
  }

  // Check active tickets
  const activeTickets = await databaseService.getActiveTickets(userId);
  if (activeTickets.length >= CONSTANTS.TICKET.MAX_TICKETS_PER_USER) {
    return await interaction.editReply({
      content: '❌ คุณมี ticket ที่เปิดอยู่เกินจำนวนที่อนุญาต กรุณาปิด ticket เก่าก่อน'
    });
  }

  try {
    const config = await Helpers.loadConfig();
    const packages = config.packages;

    if (!packages || packages.length === 0) {
      return await interaction.editReply({
        content: '❌ ไม่พบ package ที่สามารถเลือกได้'
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_package')
      .setPlaceholder('เลือก Package ที่ต้องการ')
      .addOptions(
        packages.map(pkg => ({
          label: pkg.name,
          description: `${Helpers.formatCurrency(pkg.price)} - ${pkg.description}`,
          value: pkg.id
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.INFO)
      .setTitle('📦 เลือก Package')
      .setDescription('กรุณาเลือก Package ที่ต้องการซื้อ')
      .setTimestamp();

    // ใช้ editReply แทน reply
    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });

    // Set cooldown
    this.setUserCooldown(userId);

  } catch (error) {
    logService.error('Error starting topup process:', error);
    await interaction.editReply({
      content: '❌ เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง'
    });
  }
}

  async handleSelectMenuInteraction(interaction) {
    if (interaction.customId === "select_package") {
      await this.handlePackageSelection(interaction);
    }
  }

  async handlePackageSelection(interaction) {
    const selectedPackageId = interaction.values[0];

    try {
      const config = await Helpers.loadConfig();
      const selectedPackage = config.packages.find(
        (pkg) => pkg.id === selectedPackageId
      );

      if (!selectedPackage) {
        return await interaction.reply({
          content: "❌ ไม่พบ Package ที่เลือก",
          ephemeral: true,
        });
      }

      // Show Steam64 input modal
      const modal = new ModalBuilder()
        .setCustomId(`steam64_input_${selectedPackageId}`)
        .setTitle("กรอก Steam64 ID");

      const steam64Input = new TextInputBuilder()
        .setCustomId("steam64")
        .setLabel("Steam64 ID ของคุณ")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("76561198000000000")
        .setRequired(true)
        .setMinLength(9)
        .setMaxLength(9);

      const actionRow = new ActionRowBuilder().addComponents(steam64Input);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    } catch (error) {
      logService.error("Error handling package selection:", error);
      await interaction.reply({
        content: "❌ เกิดข้อผิดพลาดในระบบ",
        ephemeral: true,
      });
    }
  }

  async handleModalSubmit(interaction) {
  if (interaction.customId.startsWith('steam64_input_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
      await this.handleSteam64Input(interaction);
    } catch (error) {
      logService.error('Error in modal submit:', error);
      
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง'
      });
    }
  }
}

async handleButtonInteraction(interaction) {
  const { customId, user } = interaction;

  try {
    switch (customId) {
      case 'start_topup':
        await interaction.deferReply({ ephemeral: true });
        await this.startTopupProcess(interaction);
        break;
        
      case 'view_scoreboard':
        await interaction.deferReply({ ephemeral: true });
        const { default: ScoreboardManager } = await import('./scoreboardManager.js');
        const scoreboardManager = new ScoreboardManager(this.client);
        await scoreboardManager.showScoreboard(interaction);
        break;
        
      case 'confirm_package':
        await interaction.deferReply({ ephemeral: true });
        await this.confirmPackageSelection(interaction);
        break;
        
      case 'cancel_topup':
        await interaction.deferReply();
        await this.cancelTopup(interaction);
        break;
        
      default:
        if (customId.startsWith('verify_slip_')) {
          await interaction.deferReply();
          await this.handleSlipVerification(interaction);
        }
        break;
    }
  } catch (error) {
    logService.error('Button interaction error:', error);
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
        ephemeral: true
      });
    } else {
      await interaction.editReply({
        content: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
      });
    }
  }
}

async handlePackageSelection(interaction) {
  const selectedPackageId = interaction.values[0];
  
  try {
    const config = await Helpers.loadConfig();
    const selectedPackage = config.packages.find(pkg => pkg.id === selectedPackageId);

    if (!selectedPackage) {
      return await interaction.reply({
        content: '❌ ไม่พบ Package ที่เลือก',
        flags: MessageFlags.Ephemeral
      });
    }

    // Show Steam64 input modal
    const modal = new ModalBuilder()
      .setCustomId(`steam64_input_${selectedPackageId}`)
      .setTitle('กรอก Steam64 ID');

    const steam64Input = new TextInputBuilder()
      .setCustomId('steam64')
      .setLabel('Steam64 ID ของคุณ')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('76561198000000000')
      .setRequired(true)
      .setMinLength(9)
      .setMaxLength(9);

    const actionRow = new ActionRowBuilder().addComponents(steam64Input);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);

  } catch (error) {
    logService.error('Error handling package selection:', error);
    await interaction.reply({
      content: '❌ เกิดข้อผิดพลาดในระบบ',
      flags: MessageFlags.Ephemeral
    });
  }
}

  async handleSteam64Input(interaction) {
    const packageId = interaction.customId.replace("steam64_input_", "");
    const steam64 = interaction.fields.getTextInputValue("steam64");

    // Validate Steam64
    // if (!Helpers.validateSteam64(steam64)) {
    //   return await interaction.editReply({
    //     content: "❌ Steam64 ID ไม่ถูกต้อง กรุณากรอกใหม่",
    //   });
    // }

    try {
      const config = await Helpers.loadConfig();
      const selectedPackage = config.packages.find(
        (pkg) => pkg.id === packageId
      );

      if (!selectedPackage) {
        return await interaction.editReply({
          content: "❌ ไม่พบ Package ที่เลือก",
        });
      }

      // Update status ก่อน
      await interaction.editReply({
        content: "⏳ กำลังสร้าง ticket... กรุณารอสักครู่",
      });

      // Create ticket channel (ทำแบบ async)
      const ticketData = await this.createTicketChannel(
        interaction,
        selectedPackage,
        steam64
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
      logService.error("Error handling Steam64 input:", error);
      await interaction.editReply({
        content: "❌ เกิดข้อผิดพลาดในระบบ",
      });
    }
  }

  async createTicketChannel(interaction, packageInfo, steam64) {
    try {
      const guild = interaction.guild;
      const user = interaction.user;
      const ticketId = Helpers.generateTicketId();

      // Find or create category
      let category = guild.channels.cache.find(
        (c) =>
          c.name === CONSTANTS.CHANNELS.TICKET_CATEGORY &&
          c.type === ChannelType.GuildCategory
      );

      if (!category) {
        category = await guild.channels.create({
          name: CONSTANTS.CHANNELS.TICKET_CATEGORY,
          type: ChannelType.GuildCategory,
        });
      }

      // Create ticket channel
      const ticketChannel = await guild.channels.create({
        name: `${CONSTANTS.TICKET.PREFIX}${ticketId}`,
        type: ChannelType.GuildText,
        parent: category.id,
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

      // Generate payment QR
      const config = await Helpers.loadConfig();
      const paymentImage = await qrCodeService.generatePaymentImage(
        packageInfo.price,
        packageInfo.name,
        config.qr_code.payment_info
      );

      const attachment = new AttachmentBuilder(paymentImage, {
        name: "payment.png",
      });

      // Create ticket embed
      const embed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.INFO)
        .setTitle(`🎫 Ticket #${ticketId}`)
        .setDescription(
          `
          **Package:** ${packageInfo.name}
          **ราคา:** ${Helpers.formatCurrency(packageInfo.price)}
          **Steam64:** \`${steam64}\`
          **สถานะ:** รอการชำระเงิน
          
          **วิธีการชำระเงิน:**
          1. โอนเงินตามข้อมูลในรูปด้านล่าง
          2. ส่งรูปสลิปการโอนเงินในแชทนี้
          3. รอระบบตรวจสอบ (ประมาณ 1-5 นาที)
          4. ระบบจะส่งของให้อัตโนมัติ
        `
        )
        .setImage("attachment://payment.png")
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("cancel_topup")
          .setLabel("❌ ยกเลิก")
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `${user}, ยินดีต้อนรับสู่ระบบเติมเงิน!`,
        embeds: [embed],
        files: [attachment],
        components: [buttons],
      });

      // Log to database
      const logId = await databaseService.logTopupTransaction({
        discordId: user.id,
        discordUsername: user.username,
        steam64: steam64,
        packageId: packageInfo.id,
        packageName: packageInfo.name,
        amount: packageInfo.price,
        ticketChannelId: ticketChannel.id,
        ticketId: ticketId,
        status: "pending",
      });

      // Create active ticket record
      await databaseService.createActiveTicket(
        user.id,
        ticketChannel.id,
        ticketId
      );

      // Store ticket data
      this.activeTickets.set(ticketChannel.id, {
        ticketId,
        userId: user.id,
        packageInfo,
        steam64,
        logId,
        status: "waiting_slip",
      });

      logService.logTopupEvent("ticket_created", user.id, {
        ticketId,
        packageId: packageInfo.id,
        amount: packageInfo.price,
      });

      return {
        channel: ticketChannel,
        ticketId,
      };
    } catch (error) {
      logService.error("Error creating ticket channel:", error);
      return null;
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
    // โหลด config และส่งพารามิเตอร์ครบถ้วน
    const config = await Helpers.loadConfig();
    
    console.log('🔍 Processing slip with data:', {
      expectedAmount: ticketData.packageInfo.price,
      configBankInfo: config.qr_code.payment_info,
      packageName: ticketData.packageInfo.name
    });

    // Process slip verification พร้อมส่งพารามิเตอร์ครบถ้วน
    const verificationResult = await slipVerification.processSlipImage(
      attachment, 
      message.author.id, 
      ticketData.packageInfo.price,        // ส่งราคาที่คาดหวัง
      config.qr_code.payment_info         // ส่งข้อมูลบัญชี
    );

    if (!verificationResult.success) {
      ticketData.status = 'waiting_slip';
      this.activeTickets.set(channelId, ticketData);

      const errorEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.ERROR)
        .setTitle('❌ การตรวจสอบสลิปล้มเหลว')
        .setDescription(`เหตุผล: ${verificationResult.error}`)
        .setFooter({ 
          text: verificationResult.mockMode ? '🧪 โหมดทดสอบ' : 'ระบบตรวจสอบสลิป' 
        })
        .setTimestamp();

      await processingMessage.edit({ embeds: [errorEmbed] });
      return;
    }

    // แสดงข้อมูลการตรวจสอบที่สำเร็จ
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
        
        ${verificationResult.mockMode ? '🧪 **โหมดทดสอบ**' : ''}
        
        กำลังส่งของเข้าเกม...
      `)
      .setTimestamp();

    await processingMessage.edit({ embeds: [successEmbed] });

    // Update database
    await databaseService.updateTopupStatus(ticketData.logId, 'verified', {
      verificationData: verificationResult.data,
      slipImageUrl: attachment.url
    });

    // Execute RCON commands
    await this.executePackageCommands(ticketData, processingMessage);

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

  async executePackageCommands(ticketData, processingMessage) {
    try {
      const { packageInfo, steam64 } = ticketData;

      // Update processing message
      const executingEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.WARNING)
        .setTitle("⚙️ กำลังส่งของ")
        .setDescription("กรุณารอสักครู่ ระบบกำลังส่งของเข้าเกมให้คุณ...")
        .setTimestamp();

      await processingMessage.edit({ embeds: [executingEmbed] });

      // Execute RCON commands
      const rconResults = [];
      for (const command of packageInfo.rcon_commands) {
        const processedCommand = command.replace("{steam64}", steam64);
        const result = await rconManager.executeCommand(processedCommand);
        rconResults.push({ command: processedCommand, result });
      }

      // Check if all commands succeeded
      const allSucceeded = rconResults.every((r) => r.result.success);

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
          .setTitle("✅ การเติมเงินสำเร็จ!")
          .setDescription(
            `
            **Package:** ${packageInfo.name}
            **Steam64:** \`${steam64}\`
            **สถานะ:** สำเร็จ
            
            ของได้ถูกส่งเข้าเกมแล้ว กรุณาตรวจสอบในเกม
            
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

        logService.logTopupEvent("topup_completed", ticketData.userId, {
          ticketId: ticketData.ticketId,
          packageId: packageInfo.id,
          steam64,
        });
      } else {
        // Some commands failed
        await databaseService.updateTopupStatus(ticketData.logId, "failed", {
          rconExecuted: false,
          errorMessage: "RCON command execution failed",
        });

        const failedEmbed = new EmbedBuilder()
          .setColor(CONSTANTS.COLORS.ERROR)
          .setTitle("❌ เกิดข้อผิดพลาดในการส่งของ")
          .setDescription(
            `
            ระบบไม่สามารถส่งของเข้าเกมได้ในขณะนี้
            
            กรุณาติดต่อแอดมินพร้อมแจ้ง Ticket ID: \`${ticketData.ticketId}\`
          `
          )
          .setTimestamp();

        await processingMessage.edit({ embeds: [failedEmbed] });

        logService.logTopupEvent("topup_failed", ticketData.userId, {
          ticketId: ticketData.ticketId,
          packageId: packageInfo.id,
          error: "RCON execution failed",
          rconResults,
        });
      }
    } catch (error) {
      logService.error("Error executing package commands:", error);

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

  async cancelTopup(interaction) {
  const channelId = interaction.channel.id;
  const ticketData = this.activeTickets.get(channelId);

  if (!ticketData || ticketData.userId !== interaction.user.id) {
    return await interaction.editReply({
      content: '❌ คุณไม่มีสิทธิ์ยกเลิก ticket นี้'
    });
  }

  try {
    // Update database
    await databaseService.updateTopupStatus(ticketData.logId, 'cancelled');
    await databaseService.updateTicketStatus(ticketData.ticketId, 'cancelled');

    const cancelEmbed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.WARNING)
      .setTitle('❌ ยกเลิกการเติมเงิน')
      .setDescription('การเติมเงินถูกยกเลิกแล้ว ticket นี้จะถูกปิดใน 10 วินาที')
      .setTimestamp();

    // ใช้ editReply แทน reply
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

    logService.logTopupEvent('topup_cancelled', ticketData.userId, {
      ticketId: ticketData.ticketId,
      packageId: ticketData.packageInfo.id
    });

  } catch (error) {
    logService.error('Error cancelling topup:', error);
    await interaction.editReply({
      content: '❌ เกิดข้อผิดพลาดในการยกเลิก'
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
