// src/handlers/ticketHandler.js
const { 
  ChannelType, 
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const databaseService = require('../services/databaseService');
const qrCodeService = require('../services/qrCodeService');
const configService = require('../services/configService');
const CONSTANTS = require('../utils/constants');
const Helpers = require('../utils/helpers');
const EmbedBuilders = require('../utils/embedBuilders');
const ValidationHelper = require('../utils/validationHelper');
const ErrorHandler = require('../utils/errorHandler');
const DebugHelper = require('../utils/debugHelper');

class TicketHandler {
  constructor() {
    this.activeTickets = new Map();
  }

  async createDonationTicket(interaction, donationItem, category, userGameInfo) {
    try {
      const user = interaction.user;
      const guild = interaction.guild;
      const ticketId = Helpers.generateTicketId();

      DebugHelper.log(`Creating donation ticket: ${ticketId}`, {
        userId: user.id,
        category,
        itemName: donationItem.name
      });

      // Create ticket channel
      const ticketChannel = await this.createTicketChannel(guild, user, ticketId);
      if (!ticketChannel) {
        throw new Error('ไม่สามารถสร้าง Ticket ได้');
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
      await this.saveTicketToDatabase(ticketData, user);

      // Send ticket message
      await this.sendTicketMessage(ticketChannel, ticketData, user);

      return { success: true, channel: ticketChannel };

    } catch (error) {
      DebugHelper.error('Error creating donation ticket:', error);
      throw error;
    }
  }

  async createTicketChannel(guild, user, ticketId) {
    try {
      // Find or create category
      let ticketCategory = guild.channels.cache.find(
        (c) => c.name === CONSTANTS.CHANNELS.TICKET_CATEGORY && c.type === ChannelType.GuildCategory
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
        topic: `🎫 Donation Ticket | ${user.username} | ${ticketId}`,
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

      return ticketChannel;
    } catch (error) {
      DebugHelper.error('Error creating ticket channel:', error);
      return null;
    }
  }

  async saveTicketToDatabase(ticketData, user) {
    await databaseService.createActiveTicket(
      user.id, 
      ticketData.channelId, 
      ticketData.ticketId, 
      'donation'
    );
    
    await databaseService.logDonationTransaction({
      discordId: user.id,
      discordUsername: user.username,
      steam64: ticketData.userGameInfo.steam64,
      characterId: ticketData.userGameInfo.characterId,
      category: ticketData.category,
      itemId: ticketData.donationItem.id,
      itemName: ticketData.donationItem.name,
      amount: ticketData.donationItem.price,
      ticketChannelId: ticketData.channelId,
      ticketId: ticketData.ticketId,
      status: 'pending'
    });
  }

  async sendTicketMessage(ticketChannel, ticketData, user) {
    // Create payment QR and embed
    const config = configService.getConfig();
    const qrUrl = qrCodeService.getPromptPayUrl(
      ticketData.donationItem.price, 
      config.qr_code.payment_info.account_number
    );
    
    const embed = EmbedBuilders.createDonationTicketEmbed(
      ticketData.ticketId, 
      ticketData.donationItem, 
      ticketData.category, 
      ticketData.userGameInfo, 
      config
    );
    embed.setImage(qrUrl);

    const cancelButton = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`cancel_donation_${ticketData.ticketId}`)
          .setLabel('❌ ยกเลิก')
          .setStyle(ButtonStyle.Danger)
      );

    await ticketChannel.send({
      content: `${user} ยินดีต้อนรับสู่ระบบโดเนท NEXArk! 🎉`,
      embeds: [embed],
      components: [cancelButton]
    });
  }

  async cancelTicket(interaction) {
    try {
      const ticketData = this.activeTickets.get(interaction.channel.id);
      
      if (!ticketData) {
        throw new Error('ไม่พบข้อมูล Ticket');
      }

      if (!ValidationHelper.validateTicketOwnership(ticketData, interaction.user.id)) {
        throw new Error('คุณไม่มีสิทธิ์ยกเลิก Ticket นี้');
      }

      // เพิ่ม: ดึง ticketId จาก customId ถ้ามี
      let ticketId = ticketData.ticketId;
      if (interaction.customId && interaction.customId.includes('_')) {
        const parts = interaction.customId.split('_');
        if (parts.length >= 3) {
          ticketId = parts[2]; // cancel_donation_XXXXX
        }
      }

      DebugHelper.log(`Cancelling ticket: ${ticketId}`, {
        userId: interaction.user.id,
        channelId: interaction.channel.id
      });

      // Update database
      await databaseService.updateTicketStatus(ticketId, 'cancelled');
      this.activeTickets.delete(interaction.channel.id);

      // Send cancel message
      const cancelEmbed = EmbedBuilders.createCancelDonationEmbed(ticketId);
      await interaction.editReply({ embeds: [cancelEmbed] });

      // Schedule deletion
      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (error) {
          DebugHelper.error('Error deleting cancelled ticket channel:', error);
        }
      }, 10000);

      return { success: true };

    } catch (error) {
      DebugHelper.error('Error cancelling ticket:', error);
      throw error;
    }
  }

  async completeTicket(channelId, ticketId) {
    try {
      await databaseService.updateTicketStatus(ticketId, 'completed');
      this.activeTickets.delete(channelId);

      return { success: true };
    } catch (error) {
      DebugHelper.error('Error completing ticket:', error);
      return { success: false, error: error.message };
    }
  }

  async cleanupExpiredTickets(client) {
    try {
      const now = Date.now();
      const expiredTickets = [];
      
      for (const [channelId, ticketData] of this.activeTickets.entries()) {
        const ticketAge = now - new Date(ticketData.createdAt || 0).getTime();
        if (ticketAge > CONSTANTS.TIMEOUTS.TICKET_CLEANUP) {
          expiredTickets.push({ channelId, ticketData });
        }
      }
      
      for (const { channelId, ticketData } of expiredTickets) {
        DebugHelper.log(`Cleaning up expired ticket: ${ticketData.ticketId}`);
        this.activeTickets.delete(channelId);
        
        try {
          const channel = client.channels.cache.get(channelId);
          if (channel) {
            await channel.send('⏰ Ticket หมดอายุแล้ว - จะถูกลบใน 1 นาที');
            
            setTimeout(async () => {
              try {
                await channel.delete();
              } catch (deleteError) {
                DebugHelper.error('Error deleting expired channel:', deleteError);
              }
            }, 60000);
          }
        } catch (error) {
          DebugHelper.error('Error handling expired ticket:', error);
        }
      }
      
      if (expiredTickets.length > 0) {
        DebugHelper.log(`Cleaned up ${expiredTickets.length} expired tickets`);
      }
    } catch (error) {
      DebugHelper.error('Error cleaning up expired tickets:', error);
    }
  }

  getTicketData(channelId) {
    return this.activeTickets.get(channelId);
  }

  getAllActiveTickets() {
    return Array.from(this.activeTickets.values());
  }

  getTicketsByUser(userId) {
    return this.getAllActiveTickets().filter(ticket => ticket.userId === userId);
  }

  hasTicketLimit(userId) {
    const userTickets = this.getTicketsByUser(userId);
    return userTickets.length >= CONSTANTS.TICKET.MAX_TICKETS_PER_USER;
  }

  shutdown() {
    this.activeTickets.clear();
  }
}

module.exports = new TicketHandler();