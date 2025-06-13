import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import databaseService from '../services/databaseService.js';
import logService from '../services/logService.js';
import CONSTANTS from '../utils/constants.js';
import cron from 'node-cron';

class ScoreboardManager {
  constructor(client) {
    this.client = client;
    this.lastUpdate = null;
    this.cachedScoreboard = null;
  }

  init() {
    console.log('🏆 Scoreboard Manager initialized');
    
    // Update scoreboard every hour
    cron.schedule('0 * * * *', async () => {
      await this.updateCachedScoreboard();
    });

    // Initial update
    this.updateCachedScoreboard();
  }

  async updateCachedScoreboard() {
    try {
      const scores = await databaseService.getTribeScores();
      this.cachedScoreboard = this.formatScoreboard(scores);
      this.lastUpdate = new Date();
      
      console.log('✅ Scoreboard cache updated');
      logService.info('Scoreboard updated', { tribes: scores.length });
    } catch (error) {
      console.error('❌ Error updating scoreboard:', error);
      logService.error('Scoreboard update failed', error);
    }
  }

  formatScoreboard(scores) {
    if (!scores || scores.length === 0) {
      return {
        description: 'ไม่มีข้อมูล Tribe Score',
        fields: []
      };
    }

    const chunks = this.chunkArray(scores, 10); // 10 tribes per page
    const pages = [];

    chunks.forEach((chunk, pageIndex) => {
      const fields = chunk.map((tribe, index) => {
        const globalRank = pageIndex * 10 + index + 1;
        const modeEmoji = this.getModeEmoji(tribe.mode);
        const progressText = tribe.progress > 0 ? `(+${tribe.progress})` : 
                           tribe.progress < 0 ? `(${tribe.progress})` : '';

        return {
          name: `${this.getRankEmoji(globalRank)} #${globalRank} ${tribe.tribeName}`,
          value: `**Score:** ${tribe.score.toLocaleString()} ${progressText}\n**Mode:** ${modeEmoji} ${tribe.mode}`,
          inline: true
        };
      });

      pages.push({
        description: `📊 **Tribe Scoreboard** - หน้า ${pageIndex + 1}/${chunks.length}`,
        fields: fields
      });
    });

    return pages.length > 0 ? pages : [{
      description: 'ไม่มีข้อมูล Tribe Score',
      fields: []
    }];
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  getRankEmoji(rank) {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return '🏅';
    }
  }

  getModeEmoji(mode) {
    switch (mode) {
      case 'PROMOTE': return '📈';
      case 'DEMOTE': return '📉';
      case 'KEEP': return '➡️';
      default: return '❓';
    }
  }

  async showScoreboard(interaction, page = 0) {
    try {
      // Check if cache needs update (older than 1 hour)
      const oneHourAgo = new Date(Date.now() - 3600000);
      if (!this.lastUpdate || this.lastUpdate < oneHourAgo) {
        await this.updateCachedScoreboard();
      }

      if (!this.cachedScoreboard || this.cachedScoreboard.length === 0) {
        const noDataEmbed = new EmbedBuilder()
          .setColor(CONSTANTS.COLORS.WARNING)
          .setTitle('🏆 Tribe Scoreboard')
          .setDescription('ไม่มีข้อมูล Tribe Score ในขณะนี้')
          .setTimestamp();

        return await interaction.reply({
          embeds: [noDataEmbed],
          ephemeral: true
        });
      }

      const totalPages = this.cachedScoreboard.length;
      const currentPage = Math.max(0, Math.min(page, totalPages - 1));
      const pageData = this.cachedScoreboard[currentPage];

      const embed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.INFO)
        .setTitle('🏆 Tribe Scoreboard')
        .setDescription(pageData.description)
        .addFields(pageData.fields)
        .setFooter({ 
          text: `อัพเดทล่าสุด: ${this.lastUpdate?.toLocaleString('th-TH')} | หน้า ${currentPage + 1}/${totalPages}` 
        })
        .setTimestamp();

      // Navigation buttons
      const buttons = new ActionRowBuilder();

      if (totalPages > 1) {
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`scoreboard_first`)
            .setLabel('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
          
          new ButtonBuilder()
            .setCustomId(`scoreboard_prev`)
            .setLabel('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
          
          new ButtonBuilder()
            .setCustomId(`scoreboard_next`)
            .setLabel('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === totalPages - 1),
          
          new ButtonBuilder()
            .setCustomId(`scoreboard_last`)
            .setLabel('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === totalPages - 1)
        );
      }

      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId('scoreboard_refresh')
          .setLabel('🔄 รีเฟรช')
          .setStyle(ButtonStyle.Primary)
      );

      const messageOptions = {
        embeds: [embed],
        components: buttons.components.length > 0 ? [buttons] : []
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(messageOptions);
      } else {
        await interaction.reply({
          ...messageOptions,
          ephemeral: true
        });
      }

    } catch (error) {
      console.error('❌ Error showing scoreboard:', error);
      logService.error('Scoreboard display error', error);

      const errorEmbed = new EmbedBuilder()
        .setColor(CONSTANTS.COLORS.ERROR)
        .setTitle('❌ เกิดข้อผิดพลาด')
        .setDescription('ไม่สามารถแสดง Scoreboard ได้ในขณะนี้')
        .setTimestamp();

      const errorMessage = { embeds: [errorEmbed], ephemeral: true };

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  }

  async handleScoreboardNavigation(interaction) {
    const { customId } = interaction;
    
    // Extract current page from embed footer or default to 0
    let currentPage = 0;
    if (interaction.message.embeds[0]?.footer?.text) {
      const match = interaction.message.embeds[0].footer.text.match(/หน้า (\d+)\/(\d+)/);
      if (match) {
        currentPage = parseInt(match[1]) - 1;
      }
    }

    let newPage = currentPage;

    switch (customId) {
      case 'scoreboard_first':
        newPage = 0;
        break;
      case 'scoreboard_prev':
        newPage = Math.max(0, currentPage - 1);
        break;
      case 'scoreboard_next':
        newPage = currentPage + 1;
        break;
      case 'scoreboard_last':
        newPage = this.cachedScoreboard ? this.cachedScoreboard.length - 1 : 0;
        break;
      case 'scoreboard_refresh':
        await this.updateCachedScoreboard();
        newPage = currentPage;
        break;
    }

    await interaction.deferUpdate();
    await this.showScoreboard(interaction, newPage);
  }

  async getTribeRank(tribeName) {
    try {
      const scores = await databaseService.getTribeScores();
      const tribe = scores.find(t => t.tribeName.toLowerCase() === tribeName.toLowerCase());
      
      if (!tribe) {
        return null;
      }

      return {
        rank: tribe.position,
        score: tribe.score,
        progress: tribe.progress,
        mode: tribe.mode
      };
    } catch (error) {
      console.error('❌ Error getting tribe rank:', error);
      return null;
    }
  }

  async getTopTribes(limit = 10) {
    try {
      const scores = await databaseService.getTribeScores();
      return scores.slice(0, limit);
    } catch (error) {
      console.error('❌ Error getting top tribes:', error);
      return [];
    }
  }
}

export default ScoreboardManager;