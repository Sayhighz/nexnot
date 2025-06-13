import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelType,
  PermissionFlagsBits 
} from 'discord.js';
import databaseService from '../services/databaseService.js';
import logService from '../services/logService.js';
import Helpers from '../utils/helpers.js';
import CONSTANTS from '../utils/constants.js';
import cron from 'node-cron';

class TicketManager {
  constructor(client) {
    this.client = client;
    this.activeTickets = new Map(); // channelId -> ticketData
  }

  init() {
    console.log('🎫 Ticket Manager initialized');
    
    // Cleanup old tickets every hour
    cron.schedule('0 * * * *', async () => {
      await this.cleanupOldTickets();
    });

    // Load existing active tickets on startup
    this.loadActiveTickets();
  }

  async loadActiveTickets() {
    try {
      // This would load tickets from database if needed
      console.log('📋 Loading active tickets...');
    } catch (error) {
      console.error('❌ Error loading active tickets:', error);
    }
  }

  async createTicket(guild, user, category, options = {}) {
    try {
      const ticketId = Helpers.generateTicketId();
      const channelName = `${CONSTANTS.TICKET.PREFIX}${ticketId}`;

      // Check if user has too many open tickets
      const userTickets = Array.from(this.activeTickets.values())
        .filter(ticket => ticket.userId === user.id);

      if (userTickets.length >= CONSTANTS.TICKET.MAX_TICKETS_PER_USER) {
        throw new Error('คุณมี ticket เปิดอยู่เกินจำนวนที่อนุญาต');
      }

      // Create ticket channel
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category?.id,
        topic: `Ticket #${ticketId} - ${user.username}`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.EmbedLinks
            ]
          },
          // Add staff roles if specified
          ...(options.staffRoles || []).map(roleId => ({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ManageMessages
            ]
          }))
        ]
      });

      // Create ticket data
      const ticketData = {
        ticketId,
        channelId: ticketChannel.id,
        userId: user.id,
        guildId: guild.id,
        status: 'active',
        createdAt: new Date(),
        lastActivity: new Date(),
        ...options
      };

      // Store in memory
      this.activeTickets.set(ticketChannel.id, ticketData);

      // Create welcome embed
      const welcomeEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.INFO)
        .setTitle(`🎫 Ticket #${ticketId}`)
        .setDescription(`
          ยินดีต้อนรับ ${user}!
          
          ${options.welcomeMessage || 'Ticket ของคุณถูกสร้างเรียบร้อยแล้ว'}
          
          **ข้อมูล Ticket:**
          • Ticket ID: \`${ticketId}\`
          • สร้างเมื่อ: ${Helpers.formatDateTime(new Date())}
          • สถานะ: เปิด
        `)
        .setTimestamp();

      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`close_ticket_${ticketId}`)
            .setLabel('🔒 ปิด Ticket')
            .setStyle(ButtonStyle.Danger)
        );

      await ticketChannel.send({
        content: user.toString(),
        embeds: [welcomeEmbed],
        components: [buttons]
      });

      logService.info('Ticket created', {
        ticketId,
        userId: user.id,
        channelId: ticketChannel.id
      });

      return {
        success: true,
        ticketId,
        channel: ticketChannel,
        data: ticketData
      };

    } catch (error) {
      logService.error('Error creating ticket', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async closeTicket(channelId, reason = 'ปิดโดยผู้ใช้', closedBy = null) {
    try {
      const ticketData = this.activeTickets.get(channelId);
      if (!ticketData) {
        throw new Error('ไม่พบข้อมูล ticket');
      }

      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        throw new Error('ไม่พบ channel');
      }

      // Update ticket status
      ticketData.status = 'closed';
      ticketData.closedAt = new Date();
      ticketData.closedBy = closedBy;
      ticketData.closeReason = reason;

      // Send closing message
      const closeEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.WARNING)
        .setTitle('🔒 ปิด Ticket')
        .setDescription(`
          Ticket #${ticketData.ticketId} กำลังจะถูกปิด
          
          **เหตุผล:** ${reason}
          **ปิดโดย:** ${closedBy ? `<@${closedBy}>` : 'ระบบ'}
          **เวลา:** ${Helpers.formatDateTime(new Date())}
          
          Channel นี้จะถูกลบใน 10 วินาที
        `)
        .setTimestamp();

      await channel.send({ embeds: [closeEmbed] });

      // Remove from active tickets
      this.activeTickets.delete(channelId);

      // Update database if applicable
      if (ticketData.logId) {
        await databaseService.updateTicketStatus(ticketData.ticketId, 'closed');
      }

      // Schedule channel deletion
      setTimeout(async () => {
        try {
          await channel.delete(`Ticket closed: ${reason}`);
          
          logService.info('Ticket closed and deleted', {
            ticketId: ticketData.ticketId,
            reason,
            closedBy
          });
        } catch (error) {
          console.error('Error deleting ticket channel:', error);
        }
      }, 10000);

      return {
        success: true,
        ticketId: ticketData.ticketId
      };

    } catch (error) {
      logService.error('Error closing ticket', error);
      return {
       success: false,
       error: error.message
     };
   }
 }

 async handleTicketClose(interaction) {
   const customId = interaction.customId;
   const ticketId = customId.replace('close_ticket_', '');
   
   const channelId = interaction.channel.id;
   const ticketData = this.activeTickets.get(channelId);

   if (!ticketData) {
     return await interaction.reply({
       content: '❌ ไม่พบข้อมูล ticket นี้',
       ephemeral: true
     });
   }

   // Check permissions
   const canClose = ticketData.userId === interaction.user.id || 
                    interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);

   if (!canClose) {
     return await interaction.reply({
       content: '❌ คุณไม่มีสิทธิ์ปิด ticket นี้',
       ephemeral: true
     });
   }

   await interaction.deferReply();

   const result = await this.closeTicket(
     channelId, 
     'ปิดโดยผู้ใช้', 
     interaction.user.id
   );

   if (result.success) {
     await interaction.editReply({
       content: `✅ กำลังปิด Ticket #${result.ticketId}`
     });
   } else {
     await interaction.editReply({
       content: `❌ เกิดข้อผิดพลาด: ${result.error}`
     });
   }
 }

 async updateTicketActivity(channelId) {
   const ticketData = this.activeTickets.get(channelId);
   if (ticketData) {
     ticketData.lastActivity = new Date();
     this.activeTickets.set(channelId, ticketData);
   }
 }

 async cleanupOldTickets() {
   try {
     const cutoffTime = new Date(Date.now() - CONSTANTS.TIMEOUTS.TICKET_CLEANUP);
     const ticketsToClose = [];

     for (const [channelId, ticketData] of this.activeTickets.entries()) {
       if (ticketData.lastActivity < cutoffTime && ticketData.status === 'active') {
         ticketsToClose.push({ channelId, ticketData });
       }
     }

     for (const { channelId, ticketData } of ticketsToClose) {
       console.log(`🧹 Auto-closing inactive ticket: ${ticketData.ticketId}`);
       await this.closeTicket(channelId, 'ปิดอัตโนมัติ (ไม่มีกิจกรรม)', null);
     }

     if (ticketsToClose.length > 0) {
       console.log(`🧹 Cleaned up ${ticketsToClose.length} inactive tickets`);
     }

   } catch (error) {
     console.error('❌ Error cleaning up old tickets:', error);
   }
 }

 async getTicketStats(guildId = null) {
   try {
     const tickets = Array.from(this.activeTickets.values());
     const filteredTickets = guildId ? 
       tickets.filter(t => t.guildId === guildId) : 
       tickets;

     return {
       total: filteredTickets.length,
       active: filteredTickets.filter(t => t.status === 'active').length,
       processing: filteredTickets.filter(t => t.status === 'processing').length,
       oldest: filteredTickets.length > 0 ? 
         Math.min(...filteredTickets.map(t => t.createdAt.getTime())) : null
     };
   } catch (error) {
     console.error('❌ Error getting ticket stats:', error);
     return { total: 0, active: 0, processing: 0, oldest: null };
   }
 }

 async getUserTickets(userId) {
   const userTickets = Array.from(this.activeTickets.values())
     .filter(ticket => ticket.userId === userId);
   
   return userTickets;
 }

 async findTicketByChannel(channelId) {
   return this.activeTickets.get(channelId) || null;
 }

 async addStaffToTicket(channelId, staffUserId) {
   try {
     const channel = this.client.channels.cache.get(channelId);
     if (!channel) {
       throw new Error('ไม่พบ channel');
     }

     await channel.permissionOverwrites.create(staffUserId, {
       ViewChannel: true,
       SendMessages: true,
       AttachFiles: true,
       ReadMessageHistory: true,
       EmbedLinks: true,
       ManageMessages: true
     });

     const ticketData = this.activeTickets.get(channelId);
     if (ticketData) {
       if (!ticketData.staffUsers) {
         ticketData.staffUsers = [];
       }
       if (!ticketData.staffUsers.includes(staffUserId)) {
         ticketData.staffUsers.push(staffUserId);
       }
       this.activeTickets.set(channelId, ticketData);
     }

     return { success: true };
   } catch (error) {
     return { success: false, error: error.message };
   }
 }

 async removeStaffFromTicket(channelId, staffUserId) {
   try {
     const channel = this.client.channels.cache.get(channelId);
     if (!channel) {
       throw new Error('ไม่พบ channel');
     }

     await channel.permissionOverwrites.delete(staffUserId);

     const ticketData = this.activeTickets.get(channelId);
     if (ticketData && ticketData.staffUsers) {
       ticketData.staffUsers = ticketData.staffUsers.filter(id => id !== staffUserId);
       this.activeTickets.set(channelId, ticketData);
     }

     return { success: true };
   } catch (error) {
     return { success: false, error: error.message };
   }
 }

 getActiveTickets() {
   return this.activeTickets;
 }
}

export default TicketManager;