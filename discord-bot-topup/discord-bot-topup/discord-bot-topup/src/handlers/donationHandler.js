// src/handlers/donationHandler.js
const databaseService = require('../services/databaseService');
const configService = require('../services/configService');
const rconManager = require('../components/rconManager');
const webhookService = require('../services/webhookService');
const BrandUtils = require('../utils/brandUtils');
const ValidationHelper = require('../utils/validationHelper');
const ErrorHandler = require('../utils/errorHandler');
const DebugHelper = require('../utils/debugHelper');

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
          // ใช้ kits แทน items
          result = await this.giveKits(targetServer, userGameInfo.steam64, donationItem.kits);
          break;
        default:
          result = { success: false, error: 'หมวดหมู่ไม่รองรับ' };
      }

      // Update database
      await this.updateDonationStatus(ticketData, result);

      // Send webhook notification - เพิ่ม slip image
      await this.sendWebhookNotification(ticketData, result, targetServer, verificationResult);

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

  // ใช้ giveKits แทน giveItems
  async giveKits(serverKey, steam64, kits) {
    try {
      if (!kits || !Array.isArray(kits) || kits.length === 0) {
        return { success: false, error: 'ไม่พบรายการ Kit ที่ต้องส่ง' };
      }

      DebugHelper.log(`Giving ${kits.length} kits to ${steam64} on ${serverKey}`);

      for (const kit of kits) {
        const kitResult = await rconManager.giveKitToServer(
          serverKey,
          steam64,
          kit.kitName,
          kit.quantity || 1
        );
        
        if (!kitResult.success) {
          return { success: false, error: kitResult.error };
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

  // เพิ่ม slip image และ verification result
  async sendWebhookNotification(ticketData, result, targetServer, verificationResult = null) {
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
        
        // เพิ่มข้อมูลสำหรับแต่ละประเภท
        ...(ticketData.donationItem.points && { points: ticketData.donationItem.points }),
        ...(ticketData.donationItem.kits && { kits: ticketData.donationItem.kits }),
        ...(result.error && { error: result.error }),
        
        // เพิ่มข้อมูล verification และ slip
        ...(verificationResult && {
          verificationData: verificationResult.data,
          slipImageUrl: verificationResult.slipImageUrl
        })
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

  // validation สำหรับ kits
  validateDonationData(category, donationItem, userGameInfo) {
    const errors = [];

    if (!donationItem) {
      errors.push('ไม่พบรายการที่เลือก');
    }

    if (!ValidationHelper.validateUserGameInfo(userGameInfo, category)) {
      errors.push('ข้อมูลผู้เล่นไม่ถูกต้อง');
    }

    if (category === 'items' && (!donationItem.kits || donationItem.kits.length === 0)) {
      errors.push('ไม่พบรายการ Kit');
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

module.exports = new DonationHandler();