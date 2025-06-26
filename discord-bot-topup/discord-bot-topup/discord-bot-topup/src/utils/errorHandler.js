// src/utils/errorHandler.js
const logService = require('../services/logService');
const ResponseHelper = require('./responseHelper');

class ErrorHandler {
  static async handleInteractionError(error, interaction, operation = 'unknown') {
    // Log error
    await logService.error(`Interaction error in ${operation}:`, {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      customId: interaction.customId,
      commandName: interaction.commandName,
      operation
    });

    // Send user-friendly error message
    const errorMessage = this.getUserFriendlyMessage(error);
    
    try {
      await ResponseHelper.safeReply(interaction, errorMessage);
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError);
    }
  }

  static getUserFriendlyMessage(error) {
    if (error.message.includes('Missing Access')) {
      return '❌ บอทไม่มีสิทธิ์เข้าถึง กรุณาติดต่อแอดมิน';
    }
    
    if (error.message.includes('Unknown Channel')) {
      return '❌ ไม่พบช่องที่ระบุ';
    }
    
    if (error.message.includes('Unknown Message')) {
      return '❌ ข้อความถูกลบไปแล้ว';
    }

    if (error.message.includes('timeout')) {
      return '❌ การดำเนินการใช้เวลานานเกินไป กรุณาลองใหม่';
    }

    return '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
  }

  static async handleAsyncOperation(operation, fallbackMessage = 'เกิดข้อผิดพลาด') {
    try {
      return await operation();
    } catch (error) {
      console.error('Async operation failed:', error);
      return { success: false, error: fallbackMessage };
    }
  }

  static logAndThrow(error, context = 'Unknown') {
    logService.error(`Error in ${context}:`, error);
    throw error;
  }
}

module.exports = ErrorHandler;