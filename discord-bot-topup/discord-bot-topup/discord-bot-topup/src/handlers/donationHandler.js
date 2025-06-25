// src/handlers/donationHandler.js
import databaseService from '../services/databaseService.js';
import configService from '../services/configService.js';
import rconManager from '../components/rconManager.js';
import webhookService from '../services/webhookService.js';
import BrandUtils from '../utils/brandUtils.js';
import ValidationHelper from '../utils/validationHelper.js';
import ErrorHandler from '../utils/errorHandler.js';
import DebugHelper from '../utils/debugHelper.js';

class DonationHandler {
  async executeDonation(message, ticketData, verificationResult) {
    try {
      DebugHelper.log('Starting donation execution', {
        ticketId: ticketData.ticketId,
        category: ticketData.category,
        steam64: ticketData.userGameInfo.steam64
      });

      const { category, donationItem, userGameInfo } = ticketData;
      const targetServer = 'main'; // ใช้เซิร์ฟเวอร์เดียว

      let result = { success: false, error: 'Unknown error' };

      // Execute based on category
      switch (category) {
        case 'points':
          result = await this.givePoints(targetServer, userGameInfo.steam64, donationItem.points);
          break;
        case 'ranks':
          result = await this.giveRank(targetServer, userGameInfo.steam64, donationItem.rcon_commands);
          break;
        case 'items':
          result = await this.giveItems(targetServer, userGameInfo.steam64, donationItem.items);
          break;
        default:
          result = { success: false, error: 'หมวดหมู่ไม่รองรับ' };
      }

      // Update database
      await this.updateDonationStatus(ticketData, result);

      // Send webhook notification
      await this.sendWebhookNotification(ticketData, result, targetServer);

      return result;

    } catch (error) {
      DebugHelper.error('Error executing donation:', error);
      return { success: false, error: error.message };
    }
  }

  async givePoints(serverKey, steam64, points) {
    try {
      DebugHelper.log(`Giving ${points} points to ${steam64} on ${serverKey}`);
      return await rconManager.givePointsToServer(serverKey, steam64, points);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async giveRank(serverKey, steam64, rconCommands) {
    try {
      if (!rconCommands || !Array.isArray(rconCommands) || rconCommands.length === 0) {
        return { success: false, error: 'ไม่พบคำสั่ง RCON สำหรับยศนี้' };
      }

      DebugHelper.log(`Giving rank to ${steam64} on ${serverKey}`);
      return await rconManager.executeRankCommands(serverKey, steam64, rconCommands);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async giveItems(serverKey, steam64, items) {
    try {
      if (!items || !Array.isArray(items) || items.length === 0) {
        return { success: false, error: 'ไม่พบรายการไอเทมที่ต้องส่ง' };
      }

      DebugHelper.log(`Giving ${items.length} items to ${steam64} on ${serverKey}`);

      for (const item of items) {
        const itemResult = await rconManager.giveItemToServer(
          serverKey,
          steam64,
          item.path,
          item.quantity || 1,
          item.quality || 0,
          item.blueprintType || 0
        );
        
        if (!itemResult.success) {
          return { success: false, error: itemResult.error };
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async updateDonationStatus(ticketData, result) {
    try {
      const topupLog = await databaseService.getTopupByTicketId(ticketData.ticketId);
      if (!topupLog) return;

      const status = result.success ? 'completed' : 'failed';
      const additionalData = {
        rconExecuted: result.success,
        ...(result.error && { errorMessage: result.error })
      };

      await databaseService.updateTopupStatus(topupLog.id, status, additionalData);
    } catch (error) {
      DebugHelper.error('Error updating donation status:', error);
    }
  }

  async sendWebhookNotification(ticketData, result, targetServer) {
    try {
      const webhookData = {
        discordId: ticketData.userId,
        discordUsername: ticketData.userGameInfo.userData?.discord_username || 'Unknown',
        steam64: ticketData.userGameInfo.steam64,
        characterId: ticketData.userGameInfo.characterId,
        category: ticketData.category,
        itemName: ticketData.donationItem.name,
        amount: ticketData.donationItem.price,
        server: targetServer,
        status: result.success ? 'completed' : 'failed',
        ticketId: ticketData.ticketId,
        playerName: ticketData.userGameInfo.userData?.player_name || 'Unknown',
        timestamp: new Date().toISOString(),
        ...(ticketData.donationItem.points && { points: ticketData.donationItem.points }),
        ...(ticketData.donationItem.items && { items: ticketData.donationItem.items }),
        ...(result.error && { error: result.error })
      };

      await webhookService.sendDonationNotification(webhookData);
    } catch (error) {
      DebugHelper.error('Error sending webhook notification:', error);
    }
  }

  getDonationsByCategory(category) {
    try {
      const config = configService.getConfig();
      return config.donation_categories?.[category] || [];
    } catch (error) {
      DebugHelper.error('Error getting donations by category:', error);
      return [];
    }
  }

  findDonationById(category, donationId) {
    const donations = this.getDonationsByCategory(category);
    return donations.find(item => item.id === donationId);
  }

  validateDonationData(category, donationItem, userGameInfo) {
    const errors = [];

    if (!donationItem) {
      errors.push('ไม่พบรายการที่เลือก');
    }

    if (!ValidationHelper.validateUserGameInfo(userGameInfo, category)) {
      errors.push('ข้อมูลผู้เล่นไม่ถูกต้อง');
    }

    if (category === 'items' && (!donationItem.items || donationItem.items.length === 0)) {
      errors.push('ไม่พบรายการไอเทม');
    }

    if (category === 'ranks' && (!donationItem.rcon_commands || donationItem.rcon_commands.length === 0)) {
      errors.push('ไม่พบคำสั่งสำหรับยศนี้');
    }

    if (category === 'points' && !donationItem.points) {
      errors.push('ไม่พบจำนวนพ้อย');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export default new DonationHandler();