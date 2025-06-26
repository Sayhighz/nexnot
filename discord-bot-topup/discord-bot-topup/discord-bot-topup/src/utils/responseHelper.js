// src/utils/responseHelper.js
const { EmbedBuilder } = require('discord.js');
const BrandUtils = require('./brandUtils');

class ResponseHelper {
  static async safeReply(interaction, content, options = {}) {
    try {
      const replyOptions = {
        content,
        ephemeral: true,
        ...options
      };

      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply(replyOptions);
      } else if (interaction.deferred) {
        return await interaction.editReply(replyOptions);
      } else {
        return await interaction.followUp(replyOptions);
      }
    } catch (error) {
      console.error('Failed to send safe reply:', error);
      return null;
    }
  }

  static async safeUpdate(interaction, content, options = {}) {
    try {
      const updateOptions = {
        content,
        ...options
      };

      return await interaction.update(updateOptions);
    } catch (error) {
      console.error('Failed to update interaction:', error);
      return null;
    }
  }

  static async safeDefer(interaction, ephemeral = true) {
    try {
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.deferReply({ ephemeral });
      }
      return true;
    } catch (error) {
      console.error('Failed to defer interaction:', error);
      return false;
    }
  }

  static createErrorResponse(message) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(BrandUtils.brandColors.error)
          .setTitle('❌ เกิดข้อผิดพลาด')
          .setDescription(message)
          .setFooter({ text: BrandUtils.brandFooter })
          .setTimestamp()
      ]
    };
  }

  static createSuccessResponse(message) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(BrandUtils.brandColors.success)
          .setTitle('✅ สำเร็จ')
          .setDescription(message)
          .setFooter({ text: BrandUtils.brandFooter })
          .setTimestamp()
      ]
    };
  }

  static createWarningResponse(message) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(BrandUtils.brandColors.warning)
          .setTitle('⚠️ คำเตือน')
          .setDescription(message)
          .setFooter({ text: BrandUtils.brandFooter })
          .setTimestamp()
      ]
    };
  }
}

module.exports = ResponseHelper;