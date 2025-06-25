import { 
    ChannelType, 
    PermissionFlagsBits
  } from 'discord.js';
  import CONSTANTS from '../utils/constants.js';
  import Helpers from '../utils/helpers.js';
  import databaseService from '../services/databaseService.js';
  import logService from '../services/logService.js';
  
  class TicketManager {
    static async createDonationTicketChannel(guild, user, ticketId) {
      try {
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
          topic: `🎫 Donation Ticket | ${user.username} | ${ticketId} | by NEXArk`,
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
        console.error('Error creating donation ticket channel:', error);
        return null;
      }
    }
  
    static async cleanupExpiredTickets(activeTickets, client) {
      try {
        const now = Date.now();
        const expiredTickets = [];
        
        for (const [channelId, ticketData] of activeTickets.entries()) {
          // Check if ticket is older than 2 hours
          const ticketAge = now - new Date(ticketData.createdAt || 0).getTime();
          if (ticketAge > 7200000) { // 2 hours
            expiredTickets.push({ channelId, ticketData });
          }
        }
        
        for (const { channelId, ticketData } of expiredTickets) {
          console.log(`🧹 Cleaning up expired ticket: ${ticketData.ticketId}`);
          activeTickets.delete(channelId);
          
          try {
            const channel = client.channels.cache.get(channelId);
            if (channel) {
              await channel.send({
                content: `⏰ Ticket หมดอายุแล้ว - จะถูกลบใน 1 นาที`
              });
              
              setTimeout(async () => {
                try {
                  await channel.delete();
                } catch (deleteError) {
                  console.error('Error deleting expired channel:', deleteError);
                }
              }, 60000);
            }
          } catch (error) {
            console.error('Error handling expired ticket:', error);
          }
        }
        
        if (expiredTickets.length > 0) {
          console.log(`🧹 Cleaned up ${expiredTickets.length} expired tickets`);
        }
      } catch (error) {
        console.error('Error cleaning up expired tickets:', error);
      }
    }
  
    static async scheduleChannelDeletion(channel, delayMs = 300000) {
      setTimeout(async () => {
        try {
          await channel.delete();
        } catch (error) {
          console.error('Error deleting channel:', error);
        }
      }, delayMs);
    }
  }
  
  export default TicketManager;