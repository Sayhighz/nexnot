// src/utils/constants.js
const CONSTANTS = {
  COLORS: {
    SUCCESS: 0x00ff00,
    ERROR: 0xff0000,
    INFO: 0x0099ff,
    WARNING: 0xffaa00,
    PRIMARY: 0x7289da
  },
  
  CHANNELS: {
    TICKET_CATEGORY: 'TOPUP_TICKETS',
    LOG_CHANNEL: 'topup-logs'
  },
  
  TIMEOUTS: {
    SLIP_VERIFICATION: 300000, // 5 minutes
    TICKET_CLEANUP: 3600000,   // 1 hour
    USER_INPUT: 60000          // 1 minute
  },
  
  TICKET: {
    PREFIX: 'topup-',
    MAX_TICKETS_PER_USER: 3
  },
  
  SLIP: {
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.pdf'],
    MAX_AGE_HOURS: 24
  },
  
  RCON: {
    TIMEOUT: 5000,
    MAX_RETRIES: 3
  }
};

module.exports = CONSTANTS;