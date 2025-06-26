// src/utils/validationHelper.js
const CONSTANTS = require('./constants');

class ValidationHelper {
  // User permissions
  static hasPermission(member, permission) {
    return member.permissions.has(permission);
  }

  static isAdmin(member) {
    return this.hasPermission(member, 'Administrator');
  }

  // Cooldown management
  static checkCooldown(userCooldowns, userId, cooldownMs = 3000) {
    if (!userCooldowns.has(userId)) return true;
    
    const lastUsed = userCooldowns.get(userId);
    return Date.now() - lastUsed >= cooldownMs;
  }

  static setCooldown(userCooldowns, userId) {
    userCooldowns.set(userId, Date.now());
  }

  // File validation
  static validateFile(attachment) {
    const errors = [];

    if (!this.validateFileType(attachment)) {
      errors.push('ประเภทไฟล์ไม่ถูกต้อง กรุณาส่งไฟล์รูปภาพ (.jpg, .jpeg, .png, .pdf)');
    }

    if (!this.validateFileSize(attachment)) {
      errors.push('ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateFileType(attachment) {
    const validExtensions = CONSTANTS.SLIP.ALLOWED_EXTENSIONS;
    const fileExt = attachment.name.toLowerCase().substring(attachment.name.lastIndexOf('.'));
    return validExtensions.includes(fileExt);
  }

  static validateFileSize(attachment) {
    return attachment.size <= CONSTANTS.SLIP.MAX_FILE_SIZE;
  }

  // Steam ID validation
  static validateSteam64(steam64) {
    const steam64Pattern = /^7656119\d{10}$/;
    return steam64Pattern.test(steam64);
  }

  // Ticket validation
  static validateTicketOwnership(ticketData, userId) {
    if (!ticketData) return false;
    return String(ticketData.userId) === String(userId);
  }

  static validateTicketLimit(activeTickets, maxTickets) {
    return activeTickets.length < maxTickets;
  }

  // User game info validation
  static validateUserGameInfo(userGameInfo, category) {
    if (!userGameInfo) return false;
    if (!userGameInfo.isLinked && !userGameInfo.isTemporary) return false;
    
    // สำหรับไอเทม ต้องมี character ID หรือใช้ temporary
    if (category === 'items' && !userGameInfo.characterId && !userGameInfo.isTemporary) {
      return false;
    }
    
    return true;
  }

  // Input sanitization
  static sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>@#&!]/g, '').trim();
  }

  // Amount validation
  static validateAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && num <= 100000;
  }
}

module.exports = ValidationHelper;