// src/components/slipVerification.js (Full Code แก้ไข - บังคับ EasySlip API)
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
        DebugHelper.error('EasySlip API not configured properly - slip verification will fail');
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

  // ✅ บังคับใช้ EasySlip API เท่านั้น
  async processSlipImage(attachment, discordId, expectedAmount, configBankInfo) {
    try {
      DebugHelper.log('Starting slip processing', {
        discordId,
        expectedAmount,
        easySlipEnabled: this.isEnabled
      });

      // Validate input parameters
      this.validateInputParameters(attachment, expectedAmount, configBankInfo);

      // ✅ ตรวจสอบว่า EasySlip API พร้อมใช้งาน
      if (!this.isEnabled) {
        throw new Error('ระบบตรวจสอบสลิปไม่พร้อมใช้งาน กรุณาติดต่อแอดมิน (ต้องใช้ EasySlip API)');
      }

      // Download and validate image
      const imageBuffer = await this.downloadImage(attachment);
      
      // Generate hash to prevent duplicate submissions
      const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
      
      // Check if slip already exists
      const isDuplicate = await databaseService.checkSlipHash(imageHash);
      if (isDuplicate) {
        throw new Error('สลิปนี้เคยถูกใช้แล้ว กรุณาใช้สลิปใหม่');
      }

      // ✅ ใช้ EasySlip API เท่านั้น
      const tempPath = await this.processImage(imageBuffer, discordId);
      let verificationResult;
      
      try {
        verificationResult = await this.verifyWithAPI(tempPath);
        
        // เพิ่ม debug สำหรับ API result
        this.debugValidationResult(verificationResult, expectedAmount, configBankInfo);
        
        // ✅ ตรวจสอบข้อมูลจากสลิปจริง
        await this.validateSlipDataFromAPI(verificationResult, expectedAmount, configBankInfo);
        
      } finally {
        await fs.unlink(tempPath).catch(() => {});
      }

      // Save slip hash to prevent reuse
      await databaseService.saveSlipHash(imageHash, discordId, verificationResult.amount || expectedAmount);

      logService.logSlipVerification(discordId, 'success', {
        hash: imageHash,
        amount: verificationResult.amount,
        validationMode: 'easyslip_api_only',
        receiverName: verificationResult.receiver,
        actualReceiver: verificationResult.receiver,
        expectedReceiver: configBankInfo.account_name
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
        expectedAmount,
        validationMode: 'easyslip_api_only'
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

    if (!configBankInfo.account_name) {
      throw new Error('ไม่พบชื่อบัญชีในการตั้งค่า');
    }

    // ✅ ตรวจสอบ EasySlip API
    if (!this.isEnabled) {
      throw new Error('EasySlip API ไม่ได้เปิดใช้งาน ไม่สามารถตรวจสอบสลิปได้');
    }
  }

  // ✅ ลบฟังก์ชัน createPromptPayValidationResult (ไม่ใช้แล้ว)

  // ✅ แก้ชื่อฟังก์ชันให้ชัดเจนว่าใช้กับ API เท่านั้น
  async validateSlipDataFromAPI(slipData, expectedAmount, configBankInfo) {
    const errors = [];

    // ✅ ตรวจสอบจำนวนเงิน (เข้มงวด ±0.5 บาท)
    if (!this.validateSlipAmount(slipData, expectedAmount)) {
      errors.push(`จำนวนเงินไม่ถูกต้อง: ในสลิป ${slipData.amount} บาท แต่ต้องจ่าย ${expectedAmount} บาท`);
    }

    // ✅ ตรวจสอบชื่อบัญชีผู้รับ (เข้มงวด 85%)
    if (!this.validateReceiverName(slipData, configBankInfo)) {
      errors.push(`ชื่อบัญชีปลายทางไม่ถูกต้อง: สลิปโอนให้ "${slipData.receiver}" แต่ควรโอนให้ "${configBankInfo.account_name}"`);
    }

    // ✅ ตรวจสอบวันที่สลิป
    if (!this.isSlipRecent(slipData, 48)) {
      errors.push('สลิปเก่าเกินไป กรุณาใช้สลิปที่ทำรายการภายใน 48 ชั่วโมง');
    }

    // ✅ ตรวจสอบว่าข้อมูลครบถ้วน
    if (!slipData.amount || !slipData.receiver) {
      errors.push('ข้อมูลในสลิปไม่ครบถ้วน กรุณาใช้สลิปที่ชัดเจน');
    }

    if (errors.length > 0) {
      throw new Error(errors.join(' | '));
    }
  }

  // ✅ เข้มงวดการตรวจสอบชื่อบัญชี 85%
  validateReceiverName(slipData, configBankInfo) {
    if (!configBankInfo || !configBankInfo.account_name) {
      console.error('❌ No account name configured for validation');
      return false;
    }

    if (!slipData.receiver) {
      console.error('❌ No receiver name found in slip data');
      return false;
    }

    // ทำความสะอาดชื่อบัญชีทั้งสองอัน
    const configName = this.normalizeName(configBankInfo.account_name);
    const slipName = this.normalizeName(slipData.receiver);

    console.log('🔍 Name validation:', {
      configName: configName,
      slipName: slipName,
      original: {
        config: configBankInfo.account_name,
        slip: slipData.receiver
      }
    });

    // ✅ เข้มงวดขึ้น - ต้องตรงกันอย่างน้อย 85%
    const similarity = this.calculateStringSimilarity(configName, slipName);
    const isValid = similarity >= 0.85; // เพิ่มจาก 0.8 เป็น 0.85

    console.log('📊 Name similarity:', {
      similarity: (similarity * 100).toFixed(2) + '%',
      threshold: '85%',
      isValid: isValid,
      reason: isValid ? 'PASS' : 'FAIL - ชื่อบัญชีไม่ตรงกัน'
    });

    return isValid;
  }

  // ✅ เข้มงวดจำนวนเงิน ±0.25 บาท
  validateSlipAmount(slipData, expectedAmount) {
    const slipAmount = parseFloat(slipData.amount);
    const expected = parseFloat(expectedAmount);
    
    if (isNaN(slipAmount) || isNaN(expected)) {
      console.error('❌ Invalid amount format:', { slipAmount, expected });
      return false;
    }
    
    // ✅ เข้มงวดมากขึ้น - ผิดพลาดได้สูงสุด 0.25 บาท
    const difference = Math.abs(slipAmount - expected);
    const isValid = difference <= 0.25;

    console.log('💰 Amount validation:', {
      slipAmount: slipAmount,
      expectedAmount: expected,
      difference: difference,
      threshold: '0.25 บาท',
      isValid: isValid,
      reason: isValid ? 'PASS' : 'FAIL - จำนวนเงินไม่ตรง'
    });

    return isValid;
  }

  // ✅ เพิ่ม debug ที่ละเอียดขึ้น
  debugValidationResult(slipData, expectedAmount, configBankInfo) {
    console.log('🔍 ========== SLIP VALIDATION DEBUG ==========');
    console.log('📄 Slip Data (From EasySlip API):', {
      amount: slipData.amount,
      receiver: slipData.receiver,
      receiverBank: slipData.receiverBank,
      date: slipData.date,
      transactionId: slipData.transactionId
    });
    console.log('⚙️ Expected Config:', {
      expectedAmount: expectedAmount,
      expectedAccountName: configBankInfo.account_name,
      expectedBankName: configBankInfo.bank_name
    });
    
    // ทดสอบการตรวจสอบแต่ละส่วน
    const amountValid = this.validateSlipAmount(slipData, expectedAmount);
    const nameValid = this.validateReceiverName(slipData, configBankInfo);
    const dateValid = this.isSlipRecent(slipData, 48);
    
    console.log('✅ Validation Results:', {
      amountValid: amountValid,
      nameValid: nameValid,
      dateValid: dateValid,
      overall: amountValid && nameValid && dateValid
    });
    
    if (!amountValid || !nameValid || !dateValid) {
      console.log('❌ VALIDATION FAILED - Reasons:');
      if (!amountValid) console.log('  💰 Amount mismatch');
      if (!nameValid) console.log('  👤 Name mismatch');
      if (!dateValid) console.log('  📅 Date too old');
    }
    
    console.log('🔍 ============= END DEBUG =============');
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

      console.log('📡 Sending slip to EasySlip API...');
      
      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        timeout: 45000
      });

      console.log('📡 EasySlip API Response:', {
        status: response.data?.status,
        hasData: !!response.data?.data
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

  normalizeName(name) {
    if (!name) return '';
    
    return name
      .toLowerCase()
      .trim()
      // ลบคำนำหน้าชื่อ
      .replace(/^(นาย|นาง|น\.ส\.|mr\.|ms\.|mrs\.|miss|คุณ)\s*/i, '')
      // ลบอักขระพิเศษ
      .replace(/[^\u0E00-\u0E7Fa-zA-Z\s]/g, '')
      // ลบช่องว่างซ้ำ
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
      validationMode: 'easyslip_api_only',
      requiresAPI: true
    };
  }
}

export default new SlipVerification();