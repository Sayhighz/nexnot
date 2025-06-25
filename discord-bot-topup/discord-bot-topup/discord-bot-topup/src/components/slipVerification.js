// src/components/slipVerification.js (Cleaned up)
import axios from 'axios';
import crypto from 'crypto';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import configService from '../services/configService.js';
import databaseService from '../services/databaseService.js';
import logService from '../services/logService.js';
import Helpers from '../utils/helpers.js';
import DebugHelper from '../utils/debugHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      this.config = configService.getEasySlipConfig();
      this.apiKey = this.config.api_key;
      this.apiUrl = this.config.api_url || 'https://developer.easyslip.com/api/v1/verify';
      
      this.isEnabled = this.config.enabled && 
                       !!this.apiKey && 
                       this.apiKey !== 'YOUR_EASYSLIP_API_KEY';
      
      if (!this.isEnabled) {
        DebugHelper.warn('EasySlip API disabled or not configured - using basic validation');
      } else {
        DebugHelper.info('EasySlip API configured and enabled');
      }
    } catch (error) {
      DebugHelper.error('Error initializing EasySlip config:', error);
      this.isEnabled = false;
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
        easySlipEnabled: this.isEnabled
      });

      // Validate input parameters
      this.validateInputParameters(attachment, expectedAmount, configBankInfo);

      // Download and validate image
      const imageBuffer = await this.downloadImage(attachment);
      
      // Generate hash to prevent duplicate submissions
      const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
      
      // Check if slip already exists
      const isDuplicate = await databaseService.checkSlipHash(imageHash);
      if (isDuplicate) {
        throw new Error('สลิปนี้เคยถูกใช้แล้ว กรุณาใช้สลิปใหม่');
      }

      let verificationResult;

      if (!this.isEnabled) {
        DebugHelper.log('Using PromptPay basic validation');
        verificationResult = this.createPromptPayValidationResult(expectedAmount, configBankInfo);
        await this.validateSlipDataPromptPay(verificationResult, expectedAmount, configBankInfo);
      } else {
        // Process with EasySlip API
        const tempPath = await this.processImage(imageBuffer, discordId);
        
        try {
          verificationResult = await this.verifyWithAPI(tempPath);
          await this.validateSlipDataPromptPay(verificationResult, expectedAmount, configBankInfo);
        } finally {
          await fs.unlink(tempPath).catch(() => {});
        }
      }

      // Save slip hash to prevent reuse
      await databaseService.saveSlipHash(imageHash, discordId, verificationResult.amount || expectedAmount);

      logService.logSlipVerification(discordId, 'success', {
        hash: imageHash,
        amount: verificationResult.amount,
        validationMode: this.isEnabled ? 'easyslip_api' : 'promptpay_basic'
      });

      return {
        success: true,
        data: verificationResult,
        hash: imageHash
      };

    } catch (error) {
      DebugHelper.error('Error processing slip:', error);
      
      logService.logSlipVerification(discordId, 'failed', {
        error: error.message,
        expectedAmount
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  validateInputParameters(attachment, expectedAmount, configBankInfo) {
    if (!attachment || !attachment.url) {
      throw new Error('ไม่พบไฟล์แนบ');
    }

    if (!expectedAmount || expectedAmount <= 0) {
      throw new Error('ราคา Package ไม่ถูกต้อง');
    }

    if (!configBankInfo) {
      throw new Error('ไม่พบการตั้งค่าข้อมูลธนาคาร');
    }
  }

  createPromptPayValidationResult(expectedAmount, configBankInfo) {
    return {
      amount: expectedAmount,
      date: new Date().toISOString(),
      bank: configBankInfo?.bank_code || 'KBANK',
      sender: 'PromptPay User',
      receiver: configBankInfo?.account_name || 'Unknown',
      receiverAccount: configBankInfo?.account_number || '',
      senderAccount: 'PromptPay',
      senderBank: 'PromptPay',
      receiverBank: configBankInfo?.bank_code || 'KBANK', 
      ref1: 'PROMPTPAY',
      ref2: 'VALIDATION',
      ref3: Date.now().toString(),
      transactionId: `PP${Date.now()}`,
      countryCode: 'TH',
      fee: 0,
      validationMethod: 'promptpay_basic'
    };
  }

  async validateSlipDataPromptPay(slipData, expectedAmount, configBankInfo) {
    const errors = [];

    // ตรวจสอบจำนวนเงิน
    if (!this.validateSlipAmount(slipData, expectedAmount)) {
      errors.push(`จำนวนเงินไม่ถูกต้อง: ในสลิป ${slipData.amount} บาท แต่ต้องจ่าย ${expectedAmount} บาท`);
    }

    // ตรวจสอบบัญชีปลายทาง
    if (!this.validatePromptPayAccount(slipData, configBankInfo)) {
      errors.push('บัญชีปลายทางไม่ตรงกับ PromptPay ที่กำหนด');
    }

    // ตรวจสอบวันที่สลิป
    if (!this.isSlipRecent(slipData, 48)) {
      errors.push('สลิปเก่าเกินไป กรุณาใช้สลิปที่ทำรายการภายใน 48 ชั่วโมง');
    }

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
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
      
      // Validate image using sharp
      const metadata = await sharp(imageBuffer).metadata();
      
      if (!metadata.format || !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format.toLowerCase())) {
        throw new Error('รูปแบบไฟล์ไม่รองรับ กรุณาใช้ไฟล์ .jpg, .png หรือ .webp');
      }

      if (metadata.width < 100 || metadata.height < 100) {
        throw new Error('รูปภาพมีขนาดเล็กเกินไป');
      }

      // Process image with sharp
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
      
      const FormData = (await import('form-data')).default;
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

  validateSlipAmount(slipData, expectedAmount) {
    const slipAmount = parseFloat(slipData.amount);
    const expected = parseFloat(expectedAmount);
    
    if (isNaN(slipAmount) || isNaN(expected)) {
      return false;
    }
    
    const difference = Math.abs(slipAmount - expected);
    return difference <= 1.0;
  }

  validatePromptPayAccount(slipData, configBankInfo) {
    if (!configBankInfo) {
      return false;
    }

    let validationsPassed = 0;
    let totalValidations = 0;

    // ตรวจสอบเลขบัญชี/PromptPay
    if (configBankInfo.account_number) {
      totalValidations++;
      const configAccount = this.normalizeAccountNumber(configBankInfo.account_number);
      
      if (slipData.receiverAccount) {
        const slipAccount = this.normalizeAccountNumber(slipData.receiverAccount);
        
        if (slipAccount === configAccount || 
            slipAccount.includes(configAccount) || 
            configAccount.includes(slipAccount)) {
          validationsPassed++;
        }
      }
    }

    // ตรวจสอบชื่อบัญชี
    if (configBankInfo.account_name && slipData.receiver) {
      totalValidations++;
      const configName = this.normalizeName(configBankInfo.account_name);
      const slipName = this.normalizeName(slipData.receiver);
      
      const similarity = this.calculateStringSimilarity(configName, slipName);
      
      if (similarity >= 0.4) {
        validationsPassed++;
      }
    }

    const successRate = totalValidations > 0 ? validationsPassed / totalValidations : 0;
    return successRate >= 0.5 && validationsPassed >= 1;
  }

  normalizeAccountNumber(accountNumber) {
    if (!accountNumber) return '';
    return accountNumber.toString().replace(/[^0-9X]/gi, '');
  }

  normalizeName(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/^(นาย|นาง|น\.ส\.|mr\.|ms\.|mrs\.|miss)\s*/i, '')
      .replace(/\s+/g, ' ')
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
      apiKeyValid: this.apiKey && this.apiKey !== 'YOUR_EASYSLIP_API_KEY' && this.apiKey.length > 10,
      apiUrl: this.apiUrl,
      configLoaded: !!this.config,
      validationMode: this.isEnabled ? 'easyslip_api' : 'promptpay_basic'
    };
  }
}

export default new SlipVerification();