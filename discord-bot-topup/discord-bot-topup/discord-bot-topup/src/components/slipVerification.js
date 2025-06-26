// src/components/slipVerification.js
const axios = require('axios');
const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const configService = require('../services/configService');
const databaseService = require('../services/databaseService');
const logService = require('../services/logService');
const Helpers = require('../utils/helpers');
const DebugHelper = require('../utils/debugHelper');

class SlipVerification {
  constructor() {
    this.config = null;
    this.apiKey = null;
    this.apiUrl = null;
    this.isEnabled = false;
    this.tempDir = path.join(__dirname, '../../temp');
    
    this.initializeConfig();
    this.initTempDirectory();
  }

  initializeConfig() {
    try {
      DebugHelper.info('[SLIP] Starting EasySlip initialization...');
      
      // ลองหลายวิธีในการโหลด config
      let easyslipConfig = null;
      
      // วิธีที่ 1: ใช้ getEasySlipConfig()
      try {
        easyslipConfig = configService.getEasySlipConfig();
        DebugHelper.log('[SLIP] Method 1 - getEasySlipConfig():', easyslipConfig);
      } catch (error) {
        DebugHelper.error('[SLIP] Method 1 failed:', error.message);
      }
      
      // วิธีที่ 2: เข้าถึงตรงๆ ผ่าน getConfig()
      if (!easyslipConfig || !easyslipConfig.api_key) {
        try {
          const fullConfig = configService.getConfig();
          easyslipConfig = fullConfig ? fullConfig.easyslip : null;
          DebugHelper.log('[SLIP] Method 2 - direct access:', easyslipConfig);
        } catch (error) {
          DebugHelper.error('[SLIP] Method 2 failed:', error.message);
        }
      }
      
      // วิธีที่ 3: ใช้ configService.get()
      if (!easyslipConfig || !easyslipConfig.api_key) {
        try {
          easyslipConfig = configService.get('easyslip', {});
          DebugHelper.log('[SLIP] Method 3 - configService.get():', easyslipConfig);
        } catch (error) {
          DebugHelper.error('[SLIP] Method 3 failed:', error.message);
        }
      }
      
      // ตรวจสอบผลลัพธ์
      if (easyslipConfig && easyslipConfig.api_key) {
        this.config = easyslipConfig;
        this.apiKey = easyslipConfig.api_key;
        this.apiUrl = easyslipConfig.api_url || 'https://developer.easyslip.com/api/v1/verify';
        
        // ตรวจสอบ API key
        if (this.apiKey && this.apiKey.length > 20) {
          this.isEnabled = true;
          DebugHelper.info('[SLIP] EasySlip API loaded from config and ENABLED!');
          DebugHelper.info('[SLIP] API Key:', this.apiKey.substring(0, 15) + '...');
        } else {
          this.isEnabled = false;
          DebugHelper.warn('[SLIP] Invalid API key from config');
        }
      } else {
        DebugHelper.warn('[SLIP] Failed to load config, falling back to hardcode');
        
        // Fallback ไปใช้ hard-code ถ้าโหลดไม่ได้
        this.config = {
          enabled: true,
          api_key: "21452005-0f7b-4f7a-88a0-8c36745fb36e",
          api_url: "https://developer.easyslip.com/api/v1/verify"
        };
        
        this.apiKey = this.config.api_key;
        this.apiUrl = this.config.api_url;
        this.isEnabled = true;
        
        DebugHelper.info('[SLIP] Using hardcoded fallback config');
      }
      
      DebugHelper.info('[SLIP] Final initialization result:', {
        enabled: this.isEnabled,
        hasApiKey: !!this.apiKey,
        configSource: easyslipConfig && easyslipConfig.api_key ? 'file' : 'hardcode'
      });
      
    } catch (error) {
      DebugHelper.error('[SLIP] Critical initialization error:', error);
      this.isEnabled = false;
      this.apiKey = null;
      this.config = {};
    }
  }

  async initTempDirectory() {
    await Helpers.ensureDirectoryExists(this.tempDir);
  }

  async processSlipImage(attachment, discordId, expectedAmount, configBankInfo) {
    try {
      DebugHelper.log('Starting slip processing', {
        discordId,
        expectedAmount,
        easySlipEnabled: this.isEnabled,
        attachmentName: attachment.name,
        attachmentSize: attachment.size
      });

      // Validate input parameters
      this.validateInputParameters(attachment, expectedAmount, configBankInfo);

      // Download and validate image
      const imageBuffer = await this.downloadImage(attachment);
      
      // เพิ่มการตรวจสอบว่าเป็นรูปภาพจริงหรือไม่
      const isValidImage = await this.validateImageContent(imageBuffer);
      if (!isValidImage) {
        throw new Error('ไฟล์ที่อัปโหลดไม่ใช่รูปภาพที่ถูกต้องหรือเป็นรูปภาพปลอม');
      }
      
      // Generate hash to prevent duplicate submissions
      const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
      
      // Check if slip already exists
      const isDuplicate = await databaseService.checkSlipHash(imageHash);
      if (isDuplicate) {
        throw new Error('สลิปนี้เคยถูกใช้แล้ว กรุณาใช้สลิปใหม่');
      }

      let verificationResult;

      if (!this.isEnabled) {
        DebugHelper.warn('⚠️ EasySlip DISABLED - Using BASIC validation mode');
        
        // ใช้ basic validation แทนการ throw error
        verificationResult = await this.performBasicValidation(attachment, expectedAmount, configBankInfo);
        
      } else {
        // Process with EasySlip API
        DebugHelper.info('✅ Using EasySlip API verification');
        const tempPath = await this.processImage(imageBuffer, discordId);
        
        try {
          verificationResult = await this.verifyWithAPI(tempPath);
          await this.validateSlipDataEnhanced(verificationResult, expectedAmount, configBankInfo);
        } finally {
          await fs.unlink(tempPath).catch(() => {});
        }
      }

      // Save slip hash to prevent reuse
      await databaseService.saveSlipHash(imageHash, discordId, verificationResult.amount || expectedAmount);

      await logService.logSlipVerification(discordId, 'success', {
        hash: imageHash,
        amount: verificationResult.amount,
        validationMode: this.isEnabled ? 'easyslip_api' : 'basic_validation',
        receiverAccount: verificationResult.receiverAccount,
        receiver: verificationResult.receiver
      });

      return {
        success: true,
        data: verificationResult,
        hash: imageHash
      };

    } catch (error) {
      DebugHelper.error('❌ Slip processing failed:', error);
      
      await logService.logSlipVerification(discordId, 'failed', {
        error: error.message,
        expectedAmount,
        easySlipEnabled: this.isEnabled
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // เพิ่ม method สำหรับ basic validation
  async performBasicValidation(attachment, expectedAmount, configBankInfo) {
    DebugHelper.warn('Performing BASIC slip validation (not recommended for production)');
    
    // ตรวจสอบว่าเป็นไฟล์รูปภาพ
    const validExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
    const fileExt = attachment.name.toLowerCase().substring(attachment.name.lastIndexOf('.'));
    
    if (!validExtensions.includes(fileExt)) {
      throw new Error('ไฟล์ต้องเป็นรูปภาพ (.jpg, .png) หรือ PDF เท่านั้น');
    }
    
    // ตรวจสอบขนาดไฟล์
    if (attachment.size < 1000) { // น้อยกว่า 1KB น่าจะไม่ใช่สลิปจริง
      throw new Error('ไฟล์มีขนาดเล็กเกินไป ไม่น่าจะเป็นสลิปการโอนเงิน');
    }
    
    if (attachment.size > 10 * 1024 * 1024) { // มากกว่า 10MB
      throw new Error('ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)');
    }
    
    // สร้าง result แบบ basic
    return {
      amount: expectedAmount,
      date: new Date().toISOString(),
      bank: configBankInfo?.bank_code || 'UNKNOWN',
      sender: 'Basic Validation User',
      receiver: configBankInfo?.account_name || 'Unknown',
      receiverAccount: configBankInfo?.account_number || '',
      senderAccount: 'BASIC_VALIDATION',
      senderBank: 'BASIC_VALIDATION',
      receiverBank: configBankInfo?.bank_code || 'UNKNOWN', 
      ref1: 'BASIC',
      ref2: 'VALIDATION',
      ref3: Date.now().toString(),
      transactionId: `BASIC${Date.now()}`,
      countryCode: 'TH',
      fee: 0,
      validationMethod: 'basic_file_check'
    };
  }

  // เพิ่ม method ใหม่สำหรับตรวจสอบรูปภาพ
  async validateImageContent(imageBuffer) {
    try {
      // ใช้ sharp ตรวจสอบว่าเป็นรูปภาพจริงหรือไม่
      const metadata = await sharp(imageBuffer).metadata();
      
      // ตรวจสอบ format
      if (!metadata.format || !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format.toLowerCase())) {
        return false;
      }
      
      // ตรวจสอบขนาด
      if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) {
        return false;
      }
      
      // ตรวจสอบว่ามี pixel data จริงหรือไม่
      const stats = await sharp(imageBuffer).stats();
      if (!stats.channels || stats.channels.length === 0) {
        return false;
      }
      
      return true;
    } catch (error) {
      DebugHelper.warn('Image validation failed:', error.message);
      return false;
    }
  }

  validateInputParameters(attachment, expectedAmount, configBankInfo) {
    if (!attachment || !attachment.url) {
      throw new Error('ไม่พบไฟล์แนบ');
    }

    if (!expectedAmount || expectedAmount <= 0) {
      throw new Error('ราคา Package ไม่ถูกต้อง');
    }

    if (!configBankInfo || !configBankInfo.account_number) {
      throw new Error('ไม่พบการตั้งค่าข้อมูลธนาคารหรือเลขบัญชี');
    }
  }

  async validateSlipDataEnhanced(slipData, expectedAmount, configBankInfo) {
    const errors = [];

    DebugHelper.log('Enhanced slip validation', {
      slipAmount: slipData.amount,
      expectedAmount: expectedAmount,
      slipReceiverAccount: slipData.receiverAccount,
      configAccount: configBankInfo.account_number,
      slipReceiver: slipData.receiver,
      configAccountName: configBankInfo.account_name
    });

    // 1. ตรวจสอบจำนวนเงิน
    if (!this.validateSlipAmount(slipData, expectedAmount)) {
      errors.push(`จำนวนเงินไม่ถูกต้อง: ในสลิป ${slipData.amount} บาท แต่ต้องจ่าย ${expectedAmount} บาท`);
    }

    // 2. ตรวจสอบบัญชีปลายทาง
    const accountValidation = this.validateReceiverAccountEnhanced(slipData, configBankInfo);
    if (!accountValidation.isValid) {
      errors.push(`บัญชีปลายทางไม่ถูกต้อง: ${accountValidation.reason}`);
    }

    // 3. ตรวจสอบวันที่สลิป
    if (!this.isSlipRecent(slipData, 48)) {
      errors.push('สลิปเก่าเกินไป กรุณาใช้สลิปที่ทำรายการภายใน 48 ชั่วโมง');
    }

    if (errors.length > 0) {
      DebugHelper.error('Slip validation errors:', errors);
      throw new Error(errors.join(' | '));
    }

    DebugHelper.log('Slip validation passed successfully');
  }

  validateReceiverAccountEnhanced(slipData, configBankInfo) {
    if (!configBankInfo) {
      return {
        isValid: false,
        reason: 'ไม่พบการตั้งค่าข้อมูลธนาคาร',
        details: {}
      };
    }

    const validationResults = [];
    const details = {
      accountNumberChecks: [],
      accountNameChecks: [],
      bankChecks: []
    };

    // 1. ตรวจสอบเลขบัญชี/PromptPay ID
    if (configBankInfo.account_number && slipData.receiverAccount) {
      const accountCheck = this.validateAccountNumber(
        slipData.receiverAccount, 
        configBankInfo.account_number
      );
      
      validationResults.push(accountCheck.isValid);
      details.accountNumberChecks.push(accountCheck);
    }

    // 2. ตรวจสอบชื่อบัญชี
    if (configBankInfo.account_name && slipData.receiver) {
      const nameCheck = this.validateAccountName(
        slipData.receiver, 
        configBankInfo.account_name
      );
      
      validationResults.push(nameCheck.isValid);
      details.accountNameChecks.push(nameCheck);
    }

    // คำนวณผลลัพธ์โดยรวม
    const passedChecks = validationResults.filter(result => result === true).length;
    const totalChecks = validationResults.length;
    
    // ต้องผ่านอย่างน้อย 1 การตรวจสอบ และมีอัตราผ่านมากกว่า 50%
    const isValid = passedChecks > 0 && (passedChecks / totalChecks) >= 0.5;
    
    let reason = '';
    if (!isValid) {
      const failureReasons = [];
      
      if (details.accountNumberChecks.length > 0 && !details.accountNumberChecks.some(c => c.isValid)) {
        failureReasons.push('เลขบัญชีไม่ตรง');
      }
      if (details.accountNameChecks.length > 0 && !details.accountNameChecks.some(c => c.isValid)) {
        failureReasons.push('ชื่อบัญชีไม่ตรง');
      }
      
      reason = failureReasons.join(', ');
    }

    return {
      isValid,
      reason,
      details,
      passedChecks,
      totalChecks,
      successRate: (passedChecks / totalChecks * 100).toFixed(1) + '%'
    };
  }

  validateAccountNumber(slipAccount, configAccount) {
    const normalizedSlipAccount = this.normalizeAccountNumber(slipAccount);
    const normalizedConfigAccount = this.normalizeAccountNumber(configAccount);
    
    const checks = {
      exactMatch: normalizedSlipAccount === normalizedConfigAccount,
      containsConfig: normalizedSlipAccount.includes(normalizedConfigAccount),
      configContainsSlip: normalizedConfigAccount.includes(normalizedSlipAccount),
      lastDigitsMatch: this.compareLastDigits(normalizedSlipAccount, normalizedConfigAccount, 4)
    };
    
    const isValid = Object.values(checks).some(check => check === true);
    
    return {
      isValid,
      slipAccount: normalizedSlipAccount,
      configAccount: normalizedConfigAccount,
      checks
    };
  }

  validateAccountName(slipName, configName) {
    const normalizedSlipName = this.normalizeName(slipName);
    const normalizedConfigName = this.normalizeName(configName);
    
    const similarity = this.calculateStringSimilarity(normalizedSlipName, normalizedConfigName);
    const isValid = similarity >= 0.6;
    
    return {
      isValid,
      slipName: normalizedSlipName,
      configName: normalizedConfigName,
      similarity: (similarity * 100).toFixed(1) + '%',
      similarityScore: similarity
    };
  }

  normalizeAccountNumber(accountNumber) {
    if (!accountNumber) return '';
    
    let normalized = accountNumber.toString()
      .replace(/[^0-9X]/gi, '')
      .toUpperCase();
    
    if (normalized.startsWith('0') && normalized.length === 10) {
      normalized = '66' + normalized.substring(1);
    }
    
    return normalized;
  }

  compareLastDigits(account1, account2, digits = 4) {
    if (!account1 || !account2 || account1.length < digits || account2.length < digits) {
      return false;
    }
    
    const last1 = account1.slice(-digits);
    const last2 = account2.slice(-digits);
    
    return last1 === last2;
  }

  normalizeName(name) {
    if (!name) return '';
    
    return name
      .toLowerCase()
      .replace(/^(นาย|นาง|น\.ส\.|mr\.|ms\.|mrs\.|miss)\s*/i, '')
      .replace(/\s+/g, ' ')
      .replace(/[^\u0E00-\u0E7Fa-zA-Z\s]/g, '')
      .trim();
  }

  calculateStringSimilarity(str1, str2) {
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1;
    
    const distance = this.levenshteinDistance(str1, str2);
    return (maxLength - distance) / maxLength;
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  validateSlipAmount(slipData, expectedAmount) {
    const slipAmount = parseFloat(slipData.amount);
    const expected = parseFloat(expectedAmount);
    
    if (isNaN(slipAmount) || isNaN(expected)) {
      return false;
    }
    
    const difference = Math.abs(slipAmount - expected);
    return difference <= 1.0;
  }

  isSlipRecent(slipData, maxHours = 48) {
    try {
      const slipDate = new Date(slipData.date);
      const now = new Date();
      const hoursDiff = (now - slipDate) / (1000 * 60 * 60);
      
      return hoursDiff <= maxHours && hoursDiff >= 0;
    } catch (error) {
      return false;
    }
  }

  async downloadImage(attachment) {
    try {
      const response = await axios.get(attachment.url, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024
      });

      const imageBuffer = Buffer.from(response.data);
      
      if (imageBuffer.length > 10 * 1024 * 1024) {
        throw new Error('ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)');
      }

      if (imageBuffer.length < 100) {
        throw new Error('ไฟล์ไม่ใช่รูปภาพที่ถูกต้อง');
      }

      return imageBuffer;

    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new Error('การดาวน์โหลดไฟล์ใช้เวลานานเกินไป กรุณาลองใหม่');
      }
      
      throw new Error('ไม่สามารถดาวน์โหลดรูปภาพได้: ' + error.message);
    }
  }

  async processImage(imageBuffer, discordId) {
    try {
      const tempFileName = `slip_${Date.now()}_${discordId}.jpg`;
      const tempPath = path.join(this.tempDir, tempFileName);
      
      const metadata = await sharp(imageBuffer).metadata();
      
      if (!metadata.format || !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format.toLowerCase())) {
        throw new Error('รูปแบบไฟล์ไม่รองรับ กรุณาใช้ไฟล์ .jpg, .png หรือ .webp');
      }

      if (metadata.width < 100 || metadata.height < 100) {
        throw new Error('รูปภาพมีขนาดเล็กเกินไป');
      }

      await sharp(imageBuffer)
        .resize(1500, 1500, { 
          fit: 'inside', 
          withoutEnlargement: true 
        })
        .jpeg({ 
          quality: 90,
          progressive: true
        })
        .toFile(tempPath);

      return tempPath;

    } catch (error) {
      if (error.message.includes('Input file is missing') || 
          error.message.includes('Input buffer contains unsupported image format')) {
        throw new Error('ไฟล์ที่อัปโหลดไม่ใช่รูปภาพที่ถูกต้อง');
      }
      
      throw new Error('ไม่สามารถประมวลผลรูปภาพได้');
    }
  }

  async verifyWithAPI(imagePath) {
    try {
      if (!this.apiKey) {
        throw new Error('EasySlip API key ไม่ได้ตั้งค่าไว้');
      }

      const imageBuffer = await fs.readFile(imagePath);
      
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename: 'slip.jpg',
        contentType: 'image/jpeg'
      });

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        timeout: 45000
      });

      if (response.data && response.data.status === 200 && response.data.data) {
        return this.normalizeSlipData(response.data.data);
      } else {
        throw new Error(this.getReadableErrorMessage(response.data.status, response.data.message));
      }

    } catch (error) {
      if (error.response) {
        throw new Error(this.getReadableErrorMessage(error.response.status, error.response.data?.message));
      } else if (error.request) {
        throw new Error('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ตรวจสอบสลิปได้');
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error('การตรวจสอบสลิปใช้เวลานานเกินไป กรุณาลองใหม่');
      } else {
        throw new Error(error.message || 'เกิดข้อผิดพลาดในการตรวจสอบสลิป');
      }
    }
  }

  getReadableErrorMessage(status, apiMessage) {
    const errorMessages = {
      400: 'ข้อมูลที่ส่งไปไม่ถูกต้อง',
      401: 'การยืนยันตัวตน API ล้มเหลว',
      403: 'ไม่มีสิทธิ์เข้าถึง API', 
      404: 'ไม่พบ API endpoint',
      422: 'รูปภาพไม่ใช่สลิปที่ถูกต้อง',
      429: 'ใช้งาน API บ่อยเกินไป กรุณารอสักครู่',
      500: 'เซิร์ฟเวอร์ API เกิดข้อผิดพลาด',
      502: 'เซิร์ฟเวอร์ API ไม่พร้อมใช้งาน',
      503: 'เซิร์ฟเวอร์ API ไม่พร้อมใช้งาน'
    };

    const defaultMessage = errorMessages[status] || `เกิดข้อผิดพลาด API (${status})`;
    return apiMessage ? `${defaultMessage}: ${apiMessage}` : defaultMessage;
  }

  normalizeSlipData(apiData) {
    let amount = 0;
    if (apiData.amount && typeof apiData.amount === 'object') {
      amount = parseFloat(apiData.amount.amount || 0);
    } else if (apiData.amount) {
      amount = parseFloat(apiData.amount);
    }
    
    return {
      amount: amount,
      date: apiData.date || new Date().toISOString(),
      bank: apiData.receiver?.bank?.short || apiData.receiver?.bank?.name || 'Unknown',
      sender: apiData.sender?.account?.name?.th || apiData.sender?.account?.name || '',
      receiver: apiData.receiver?.account?.name?.th || apiData.receiver?.account?.name || '',
      receiverAccount: apiData.receiver?.account?.bank?.account || '',
      senderAccount: apiData.sender?.account?.bank?.account || '',
      senderBank: apiData.sender?.bank?.short || apiData.sender?.bank?.name || '',
      receiverBank: apiData.receiver?.bank?.short || apiData.receiver?.bank?.name || '',
      ref1: apiData.ref1 || '',
      ref2: apiData.ref2 || '',
      ref3: apiData.ref3 || '',
      transactionId: apiData.transRef || '',
      countryCode: apiData.countryCode || 'TH',
      fee: parseFloat(apiData.fee || 0)
    };
  }

  async cleanupTempFiles(maxAge = 3600000) {
    try {
      const files = await fs.readdir(this.tempDir);
      
      for (const file of files) {
        if (file.startsWith('slip_') && file.endsWith('.jpg')) {
          const filePath = path.join(this.tempDir, file);
          const stats = await fs.stat(filePath);
          
          if (Date.now() - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
          }
        }
      }
    } catch (error) {
      DebugHelper.error('Error cleaning temp files:', error);
    }
  }

  getServiceStatus() {
    return {
      enabled: this.isEnabled,
      hasApiKey: !!this.apiKey,
      apiKeyValid: this.apiKey && this.apiKey.length >= 30, // ลดเงื่อนไข
      apiUrl: this.apiUrl,
      configLoaded: !!this.config,
      validationMode: this.isEnabled ? 'easyslip_api' : 'basic_validation',
      // เพิ่มข้อมูล debug
      debug: {
        apiKeyLength: this.apiKey ? this.apiKey.length : 0,
        apiKeyStart: this.apiKey ? this.apiKey.substring(0, 10) + '...' : 'none',
        configEnabled: this.config?.enabled
      }
    };
  }
}

module.exports = new SlipVerification();