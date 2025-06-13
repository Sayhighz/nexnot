import CONSTANTS from '../utils/constants.js';

class Validators {
  static validateFileType(attachment) {
    const validExtensions = CONSTANTS.SLIP.ALLOWED_EXTENSIONS;
    const fileExt = attachment.name.toLowerCase().substring(attachment.name.lastIndexOf('.'));
    return validExtensions.includes(fileExt);
  }

  static validateFileSize(attachment) {
    return attachment.size <= CONSTANTS.SLIP.MAX_FILE_SIZE;
  }

  static validateTicketOwnership(ticketData, userId) {
    if (!ticketData) return false;
    return String(ticketData.userId) === String(userId);
  }

  static async validateTicketData(ticketData, databaseService) {
    try {
      if (!ticketData) return false;
      if (!ticketData.ticketId || !ticketData.userId) return false;
      if (!ticketData.donationItem || !ticketData.category) return false;
      
      // Check if ticket still exists in database
      const dbTicket = await databaseService.getTopupByTicketId(ticketData.ticketId);
      if (!dbTicket) return false;
      
      return true;
    } catch (error) {
      console.error('Error validating ticket data:', error);
      return false;
    }
  }

  static validateUserGameInfo(userGameInfo, category) {
    if (!userGameInfo.isLinked) return false;
    
    // สำหรับไอเทม ต้องมี character ID
    if (category === 'items' && !userGameInfo.characterId) {
      return false;
    }
    
    return true;
  }

  static validateCooldown(userCooldowns, userId, cooldownTime = 5000) {
    const lastUsed = userCooldowns.get(userId);
    if (!lastUsed) return true;
    
    return Date.now() - lastUsed >= cooldownTime;
  }
}

export default Validators;