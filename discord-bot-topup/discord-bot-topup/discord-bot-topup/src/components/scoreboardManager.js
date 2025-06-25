import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} from 'discord.js';
import databaseService from '../services/databaseService.js';
import configService from '../services/configService.js';
import logService from '../services/logService.js';
import Helpers from '../utils/helpers.js';
import CONSTANTS from '../utils/constants.js';

class ScoreboardManager {
  constructor(client) {
    this.client = client;
    this.updateInterval = null;
    this.permanentMessage = null;
    this.isInitialized = false;
  }

  async init() {
    console.log('🏆 Scoreboard Manager initialized');
    
    // Setup permanent scoreboard if configured
    await this.setupPermanentScoreboard();
    
    // Start auto-update
    this.startAutoUpdate();
    
    this.isInitialized = true;
  }

  async setupPermanentScoreboard(targetChannel = null) {
    try {
      const config = configService.getConfig();
      const scoreboardChannelId = config.channels?.scoreboard_channel_id;
      
      let channel = targetChannel;
      
      if (!channel && scoreboardChannelId) {
        channel = this.client.channels.cache.get(scoreboardChannelId);
      }
      
      if (!channel) {
        console.warn('⚠️ No scoreboard channel configured or found');
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
        console.warn('⚠️ Could not clear old scoreboard messages:', error.message);
      }

      // Send initial scoreboard
      const { embed, components } = await this.generateScoreboardEmbed();
      
      this.permanentMessage = await channel.send({
        embeds: [embed],
        components: components
      });
      
      console.log('✅ Permanent scoreboard setup in channel:', channel.id);
      
    } catch (error) {
      console.error('❌ Error setting up permanent scoreboard:', error);
    }
  }

  startAutoUpdate() {
    // Clear existing interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Start new interval
    const config = configService.getConfig();
    const updateInterval = config.settings?.scoreboard_update_interval || 300000; // 5 minutes default
    
    this.updateInterval = setInterval(async () => {
      await this.updatePermanentScoreboard();
    }, updateInterval);
    
    console.log(`🔄 Scoreboard auto-update started (every ${updateInterval / 1000} seconds)`);
  }

  async updatePermanentScoreboard() {
    if (!this.permanentMessage) {
      console.warn('⚠️ No permanent scoreboard message to update');
      return;
    }

    try {
      const { embed, components } = await this.generateScoreboardEmbed();
      
      await this.permanentMessage.edit({
        embeds: [embed],
        components: components
      });
      
      console.log('🔄 Scoreboard updated successfully');
      
    } catch (error) {
      console.error('❌ Error updating permanent scoreboard:', error);
      
      // Try to recreate if message was deleted
      if (error.code === 10008) { // Unknown Message
        console.log('🔄 Recreating deleted scoreboard message...');
        this.permanentMessage = null;
        await this.setupPermanentScoreboard();
      }
    }
  }

  // ใน src/components/scoreboardManager.js - แก้ไขเฉพาะ method นี้
async generateScoreboardEmbed(page = 0) {
  try {
    const itemsPerPage = 10;
    const startIndex = page * itemsPerPage;
    
    // ✅ เพิ่ม try-catch สำหรับ database query
    let tribeScores = [];
    try {
      tribeScores = await databaseService.getTribeScores();
    } catch (dbError) {
      console.error("❌ Database error in scoreboard:", dbError);
      
      // ส่งคืน error embed แทนการ crash
      const errorEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.ERROR)
        .setTitle('❌ ข้อผิดพลาดฐานข้อมูล')
        .setDescription(`ไม่สามารถเชื่อมต่อฐานข้อมูลได้\n\`${dbError.message}\`\n\nกำลังพยายามเชื่อมต่อใหม่...`)
        .setTimestamp();
      
      return { embed: errorEmbed, components: [] };
    }
    
    if (!tribeScores || tribeScores.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.WARNING)
        .setTitle('🏆 Tribe Scoreboard')
        .setDescription('ยังไม่มีข้อมูล Tribe Score หรือไม่สามารถโหลดข้อมูลได้')
        .addFields([
          {
            name: '📋 สาเหตุที่เป็นไปได้',
            value: '• ยังไม่มีข้อมูล Tribe ในระบบ\n• การเชื่อมต่อฐานข้อมูลมีปัญหา\n• ตาราง tribescore ยังไม่ถูกสร้าง',
            inline: false
          }
        ])
        .setTimestamp();
      
      return { embed, components: [] };
    }

    // Calculate pages
    const totalPages = Math.ceil(tribeScores.length / itemsPerPage);
    const currentPageData = tribeScores.slice(startIndex, startIndex + itemsPerPage);
    
    // Create embed
    const embed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.PRIMARY)
      .setTitle('🏆 Tribe Scoreboard')
      .setDescription(`อันดับ Tribe ทั้งหมด (หน้า ${page + 1}/${totalPages})`)
      .setTimestamp();

    // Add tribe data
    let description = '';
    currentPageData.forEach((tribe, index) => {
      const rank = startIndex + index + 1;
      const medal = this.getRankMedal(rank);
      const progress = tribe.progress || 0;
      const progressBar = this.generateProgressBar(progress);
      
      description += `${medal} **#${rank}** ${tribe.tribeName || 'Unknown Tribe'}\n`;
      description += `📊 Score: **${tribe.score?.toLocaleString() || 0}**\n`;
      description += `📈 Progress: ${progressBar} ${progress}%\n`;
      description += `🔄 Old Score: ${tribe.oldScore?.toLocaleString() || 0}\n\n`;
    });

    embed.setDescription(description);
    
    // Add footer with update time
    embed.setFooter({ 
      text: `สถิติล่าสุด • อัพเดทอัตโนมัติทุก 5 นาที | Total: ${tribeScores.length} tribes` 
    });

    // Create navigation buttons
    const components = [];
    if (totalPages > 1) {
      const buttons = new ActionRowBuilder();
      
      if (page > 0) {
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`scoreboard_prev_${page - 1}`)
            .setLabel('◀ หน้าก่อน')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(`scoreboard_refresh_${page}`)
          .setLabel('🔄 รีเฟรช')
          .setStyle(ButtonStyle.Primary)
      );
      
      if (page < totalPages - 1) {
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`scoreboard_next_${page + 1}`)
            .setLabel('หน้าถัดไป ▶')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      
      components.push(buttons);
    }
    
    return { embed, components };
    
  } catch (error) {
    console.error('❌ Error generating scoreboard embed:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor(CONSTANTS.COLORS.ERROR)
      .setTitle('❌ ข้อผิดพลาด')
      .setDescription(`ไม่สามารถโหลดข้อมูล Scoreboard ได้\n\nError: \`${error.message}\``)
      .addFields([
        {
          name: '🔧 วิธีแก้ไข',
          value: '• ตรวจสอบการเชื่อมต่อฐานข้อมูล\n• ตรวจสอบตาราง tribescore\n• ลองรีเฟรชในอีกสักครู่',
          inline: false
        }
      ])
      .setTimestamp();
    
    return { embed: errorEmbed, components: [] };
  }
}

// ✅ เพิ่ม method สำหรับ handle database errors
async updatePermanentScoreboard() {
  if (!this.permanentMessage) {
    console.warn('⚠️ No permanent scoreboard message to update');
    return;
  }

  try {
    const { embed, components } = await this.generateScoreboardEmbed();
    
    await this.permanentMessage.edit({
      embeds: [embed],
      components: components
    });
    
    console.log('🔄 Scoreboard updated successfully');
    
  } catch (error) {
    console.error('❌ Error updating permanent scoreboard:', error);
    
    // ถ้าเป็น database error ไม่ต้อง recreate message
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      console.log('⚠️ Database connection issue, skipping this update cycle');
      return;
    }
    
    // Try to recreate if message was deleted
    if (error.code === 10008) { // Unknown Message
      console.log('🔄 Recreating deleted scoreboard message...');
      this.permanentMessage = null;
      await this.setupPermanentScoreboard();
    }
  }
}

  getRankMedal(rank) {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      case 4: case 5: return '🏅';
      default: return '🔸';
    }
  }

  generateProgressBar(progress, length = 10) {
    const filled = Math.round((progress / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  async handleScoreboardNavigation(interaction) {
    const [, action, pageStr] = interaction.customId.split('_');
    const page = parseInt(pageStr) || 0;
    
    try {
      const { embed, components } = await this.generateScoreboardEmbed(page);
      
      await interaction.update({
        embeds: [embed],
        components: components
      });
      
      console.log(`📊 Scoreboard navigation: ${action} to page ${page}`);
      
    } catch (error) {
      console.error('❌ Error handling scoreboard navigation:', error);
      
      await interaction.reply({
        content: '❌ เกิดข้อผิดพลาดในการโหลดข้อมูล',
        ephemeral: true
      });
    }
  }

  async showScoreboard(interaction, page = 0) {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      const { embed, components } = await this.generateScoreboardEmbed(page);
      
      await interaction.editReply({
        embeds: [embed],
        components: components
      });
      
    } catch (error) {
      console.error('❌ Error showing scoreboard:', error);
      
      if (interaction.deferred) {
        await interaction.editReply({
          content: '❌ ไม่สามารถโหลดข้อมูล Scoreboard ได้'
        });
      }
    }
  }

  async getScoreboardStats() {
    try {
      const tribeScores = await databaseService.getTribeScores();
      
      if (!tribeScores || tribeScores.length === 0) {
        return {
          totalTribes: 0,
          topScore: 0,
          averageScore: 0,
          lastUpdate: new Date()
        };
      }
      
      const totalTribes = tribeScores.length;
      const topScore = Math.max(...tribeScores.map(t => t.score || 0));
      const totalScore = tribeScores.reduce((sum, t) => sum + (t.score || 0), 0);
      const averageScore = Math.round(totalScore / totalTribes);
      
      return {
        totalTribes,
        topScore,
        averageScore,
        lastUpdate: new Date()
      };
      
    } catch (error) {
      console.error('❌ Error getting scoreboard stats:', error);
      return null;
    }
  }

  shutdown() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.permanentMessage = null;
    this.isInitialized = false;
    
    console.log('🏆 Scoreboard Manager shutdown complete');
  }

  // Manual update method for admin commands
  async forceUpdate() {
    try {
      await this.updatePermanentScoreboard();
      return { success: true };
    } catch (error) {
      console.error('❌ Error in force update:', error);
      return { success: false, error: error.message };
    }
  }

  // Recreate scoreboard if needed
  async recreate() {
    try {
      this.permanentMessage = null;
      await this.setupPermanentScoreboard();
      return { success: true };
    } catch (error) {
      console.error('❌ Error recreating scoreboard:', error);
      return { success: false, error: error.message };
    }
  }
}

export default ScoreboardManager;