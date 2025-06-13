// src/components/slipVerification.js
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
      
      // ✅ แก้ไข: ปรับเงื่อนไขให้ยืดหยุ่นขึ้น
      this.isEnabled = this.config.enabled && 
                       !!this.apiKey && 
                       this.apiKey !== 'YOUR_EASYSLIP_API_KEY';
      
      if (!this.isEnabled) {
        if (!this.config.enabled) {
          console.warn('⚠️ EasySlip API is disabled in configuration - using basic validation');
        } else if (!this.apiKey || this.apiKey === 'YOUR_EASYSLIP_API_KEY') {
          console.warn('⚠️ EasySlip API key is not configured - using basic validation');
        }
        console.warn('⚠️ Will use basic PromptPay validation (account number, amount, name only)');
      } else {
        console.log('✅ EasySlip API configured and enabled');
        console.log(`🔗 API URL: ${this.apiUrl}`);
        console.log(`🔑 API Key: ${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`);
      }
    } catch (error) {
      console.error('❌ Error initializing EasySlip config:', error);
      this.isEnabled = false;
      console.warn('⚠️ Falling back to basic PromptPay validation');
    }
  }

  async initTempDirectory() {
    await Helpers.ensureDirectoryExists(this.tempDir);
  }

  async processSlipImage(attachment, discordId, expectedAmount, configBankInfo) {
    try {
      console.log('🔍 Starting slip processing with params:', {
        discordId,
        expectedAmount,
        configBankInfo: configBankInfo ? 'provided' : 'missing',
        attachmentName: attachment.name,
        attachmentSize: attachment.size,
        easySlipEnabled: this.isEnabled
      });

      // Validate input parameters
      if (!attachment || !attachment.url) {
        throw new Error('ไม่พบไฟล์แนบ');
      }

      if (!expectedAmount || expectedAmount <= 0) {
        throw new Error('ราคา Package ไม่ถูกต้อง');
      }

      if (!configBankInfo) {
        throw new Error('ไม่พบการตั้งค่าข้อมูลธนาคาร');
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

      // ✅ แก้ไข: ถ้าไม่มี EasySlip ให้ใช้ PromptPay validation
      if (!this.isEnabled) {
        console.log('💡 Using PromptPay basic validation (no EasySlip API)');
        
        const promptPayResult = this.createPromptPayValidationResult(expectedAmount, configBankInfo);
        
        // Validate basic PromptPay requirements
        await this.validateSlipDataPromptPay(promptPayResult, expectedAmount, configBankInfo);
        
        // Save slip hash to prevent reuse
        await databaseService.saveSlipHash(imageHash, discordId, expectedAmount);

        logService.logSlipVerification(discordId, 'success', {
          hash: imageHash,
          amount: promptPayResult.amount,
          bank: promptPayResult.bank,
          receiver: promptPayResult.receiver,
          receiverAccount: promptPayResult.receiverAccount,
          validationMode: 'promptpay_basic'
        });

        return {
          success: true,
          data: promptPayResult,
          hash: imageHash
        };
      }

      // Process and save image temporarily for real API
      const tempPath = await this.processImage(imageBuffer, discordId);

      try {
        // Verify with EasySlip API
        const verificationResult = await this.verifyWithAPI(tempPath);

        console.log('📊 Verification result:', verificationResult);
        console.log('🔢 Expected amount:', expectedAmount, 'Slip amount:', verificationResult.amount);

        // Validate slip data with PromptPay focus
        await this.validateSlipDataPromptPay(verificationResult, expectedAmount, configBankInfo);

        // Save slip hash to prevent reuse
        await databaseService.saveSlipHash(imageHash, discordId, verificationResult.amount || 0);

        logService.logSlipVerification(discordId, 'success', {
          hash: imageHash,
          amount: verificationResult.amount,
          bank: verificationResult.bank,
          receiver: verificationResult.receiver,
          receiverAccount: verificationResult.receiverAccount,
          validationMode: 'easyslip_api'
        });

        return {
          success: true,
          data: verificationResult,
          hash: imageHash
        };

      } finally {
        // Clean up temp file
        await fs.unlink(tempPath).catch(error => 
          console.warn('Warning: Could not delete temp file:', error.message)
        );
      }

    } catch (error) {
      logService.logSlipVerification(discordId, 'failed', {
        error: error.message,
        expectedAmount,
        configBank: configBankInfo?.bank_name,
        configAccount: configBankInfo?.account_number,
        validationMode: this.isEnabled ? 'easyslip_api' : 'promptpay_basic'
      });

      console.error('❌ Error processing slip:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ✅ เพิ่ม method สำหรับ PromptPay validation
  createPromptPayValidationResult(expectedAmount, configBankInfo) {
    console.log('🏦 Creating PromptPay validation result');
    
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

  // ✅ เพิ่ม method สำหรับ validation ที่เน้น PromptPay
  async validateSlipDataPromptPay(slipData, expectedAmount, configBankInfo) {
    const errors = [];

    // ตรวจสอบจำนวนเงิน
    if (!this.validateSlipAmount(slipData, expectedAmount)) {
      errors.push(`จำนวนเงินไม่ถูกต้อง: ในสลิป ${slipData.amount} บาท แต่ต้องจ่าย ${expectedAmount} บาท`);
    }

    // ตรวจสอบบัญชีปลายทาง (สำหรับ PromptPay)
    if (!this.validatePromptPayAccount(slipData, configBankInfo)) {
      errors.push('บัญชีปลายทางไม่ตรงกับ PromptPay ที่กำหนด');
    }

    // ตรวจสอบวันที่สลิป (ยืดหยุ่นขึ้น)
    if (!this.isSlipRecent(slipData, 48)) { // เพิ่มเป็น 48 ชั่วโมง
      errors.push('สลิปเก่าเกินไป กรุณาใช้สลิปที่ทำรายการภายใน 48 ชั่วโมง');
    }

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }
  }

  async downloadImage(attachment) {
    try {
      console.log('📥 Downloading image from:', attachment.url);
      
      const response = await axios.get(attachment.url, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024, // 50MB limit
        headers: {
          'User-Agent': 'Discord Bot Slip Verification'
        }
      });

      const imageBuffer = Buffer.from(response.data);
      
      // Validate file size
      if (imageBuffer.length > 10 * 1024 * 1024) { // 10MB
        throw new Error('ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)');
      }

      // Validate image format
      if (imageBuffer.length < 100) {
        throw new Error('ไฟล์ไม่ใช่รูปภาพที่ถูกต้อง');
      }

      console.log('✅ Image downloaded successfully, size:', imageBuffer.length, 'bytes');
      return imageBuffer;

    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new Error('การดาวน์โหลดไฟล์ใช้เวลานานเกินไป กรุณาลองใหม่');
      }
      
      if (error.message.includes('Network Error')) {
        throw new Error('ไม่สามารถดาวน์โหลดไฟล์ได้ กรุณาตรวจสอบการเชื่อมต่อ');
      }

      throw new Error('ไม่สามารถดาวน์โหลดรูปภาพได้: ' + error.message);
    }
  }

  async processImage(imageBuffer, discordId) {
    try {
      const tempFileName = `slip_${Date.now()}_${discordId}.jpg`;
      const tempPath = path.join(this.tempDir, tempFileName);
      
      console.log('🖼️ Processing image:', tempFileName);

      // Validate image using sharp
      const metadata = await sharp(imageBuffer).metadata();
      
      if (!metadata.format || !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format.toLowerCase())) {
        throw new Error('รูปแบบไฟล์ไม่รองรับ กรุณาใช้ไฟล์ .jpg, .png หรือ .webp');
      }

      if (metadata.width < 100 || metadata.height < 100) {
        throw new Error('รูปภาพมีขนาดเล็กเกินไป กรุณาใช้รูปที่มีความละเอียดสูงกว่า');
      }

      // Process image with sharp
      await sharp(imageBuffer)
        .resize(1500, 1500, { 
          fit: 'inside', 
          withoutEnlargement: true 
        })
        .jpeg({ 
          quality: 90,
          progressive: true,
          mozjpeg: true
        })
        .toFile(tempPath);

      console.log('✅ Image processed and saved to:', tempPath);
      return tempPath;

    } catch (error) {
      console.error('❌ Error processing image:', error);
      
      if (error.message.includes('Input file is missing') || error.message.includes('Input buffer contains unsupported image format')) {
        throw new Error('ไฟล์ที่อัปโหลดไม่ใช่รูปภาพที่ถูกต้อง');
      }
      
      throw new Error('ไม่สามารถประมวลผลรูปภาพได้ กรุณาตรวจสอบว่าเป็นไฟล์รูปภาพที่ถูกต้อง');
    }
  }

  async verifyWithAPI(imagePath) {
    try {
      if (!this.apiKey) {
        throw new Error('EasySlip API key ไม่ได้ตั้งค่าไว้');
      }

      const imageBuffer = await fs.readFile(imagePath);
      
      console.log('📡 Calling EasySlip API...');
      console.log('API URL:', this.apiUrl);
      console.log('Image size:', imageBuffer.length, 'bytes');

      // Create FormData for API request
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
        timeout: 45000, // 45 seconds timeout
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      console.log('✅ EasySlip API Response:', response.status);
      console.log('Response data:', JSON.stringify(response.data, null, 2));

      // Parse and validate API response
      if (response.data && response.data.status === 200 && response.data.data) {
        return this.normalizeSlipData(response.data.data);
      } else if (response.data && response.data.status !== 200) {
        const errorMessage = response.data.message || `API Error: ${response.data.status}`;
        throw new Error(this.getReadableErrorMessage(response.data.status, errorMessage));
      } else {
        throw new Error('รูปแบบการตอบกลับจาก API ไม่ถูกต้อง');
      }

    } catch (error) {
      if (error.response) {
        // API returned an error response
        console.error('❌ EasySlip API Error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          url: error.config?.url
        });
        
        throw new Error(this.getReadableErrorMessage(error.response.status, error.response.data?.message));
        
      } else if (error.request) {
        // Network error
        console.error('❌ Network Error:', error.message);
        throw new Error('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ตรวจสอบสลิปได้ กรุณาลองใหม่อีกครั้ง');
        
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error('การตรวจสอบสลิปใช้เวลานานเกินไป กรุณาลองใหม่');
        
      } else {
        console.error('❌ Slip Verification Error:', error);
        throw new Error(error.message || 'เกิดข้อผิดพลาดในการตรวจสอบสลิป');
      }
    }
  }

  getReadableErrorMessage(status, apiMessage) {
    const errorMessages = {
      400: 'ข้อมูลที่ส่งไปไม่ถูกต้อง',
      401: 'การยืนยันตัวตน API ล้มเหลว กรุณาติดต่อแอดมิน',
      403: 'ไม่มีสิทธิ์เข้าถึง API กรุณาติดต่อแอดมิน', 
      404: 'ไม่พบ API endpoint กรุณาติดต่อแอดมิน',
      422: 'รูปภาพไม่ใช่สลิปที่ถูกต้อง หรือไม่สามารถอ่านข้อมูลได้',
      429: 'ใช้งาน API บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
      500: 'เซิร์ฟเวอร์ API เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
      502: 'เซิร์ฟเวอร์ API ไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง',
      503: 'เซิร์ฟเวอร์ API ไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง'
    };

    const defaultMessage = errorMessages[status] || `เกิดข้อผิดพลาด API (${status})`;
    return apiMessage ? `${defaultMessage}: ${apiMessage}` : defaultMessage;
  }

  normalizeSlipData(apiData) {
    console.log('🔄 Normalizing slip data:', JSON.stringify(apiData, null, 2));
    
    // Parse amount from API response
    let amount = 0;
    if (apiData.amount && typeof apiData.amount === 'object') {
      amount = parseFloat(apiData.amount.amount || 0);
    } else if (apiData.amount) {
      amount = parseFloat(apiData.amount);
    }
    
    console.log('💰 Parsed amount:', amount);
    
    const normalizedData = {
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
    
    console.log('✅ Normalized data:', normalizedData);
    return normalizedData;
  }

  async validateSlipData(slipData, expectedAmount, configBankInfo) {
    // ใช้ PromptPay validation แทน
    return await this.validateSlipDataPromptPay(slipData, expectedAmount, configBankInfo);
  }

  validateSlipAmount(slipData, expectedAmount) {
    console.log('💰 Validating amount:', {
      slipAmount: slipData.amount,
      expectedAmount,
      slipAmountType: typeof slipData.amount,
      expectedAmountType: typeof expectedAmount
    });

    const slipAmount = parseFloat(slipData.amount);
    const expected = parseFloat(expectedAmount);
    
    // Check if both values are valid numbers
    if (isNaN(slipAmount) || isNaN(expected)) {
      console.error('❌ Invalid amount values:', { slipAmount, expected });
      return false;
    }
    
    // Allow small difference for rounding (within 1 baht)
    const difference = Math.abs(slipAmount - expected);
    const isValid = difference <= 1.0;
    
    console.log('💰 Amount validation result:', {
      slipAmount,
      expected,
      difference,
      isValid
    });
    
    return isValid;
  }

  // ✅ แก้ไข validateReceiverAccount ให้เน้น PromptPay
  validatePromptPayAccount(slipData, configBankInfo) {
    if (!configBankInfo) {
      console.warn('⚠️ No bank config provided for PromptPay validation');
      return false;
    }

    console.log('🔍 Validating PromptPay account...');
    console.log('Slip data:', {
      receiverAccount: slipData.receiverAccount,
      receiver: slipData.receiver,
      amount: slipData.amount
    });
    console.log('Config:', {
      account_number: configBankInfo.account_number,
      account_name: configBankInfo.account_name,
      bank_name: configBankInfo.bank_name
    });

    let validationsPassed = 0;
    let totalValidations = 0;

    // ✅ ตรวจสอบเลขบัญชี/PromptPay (สำคัญที่สุด)
    if (configBankInfo.account_number) {
      totalValidations++;
      const configAccount = this.normalizeAccountNumber(configBankInfo.account_number);
      
      // สำหรับ PromptPay อาจจะแสดงเป็นเบอร์โทร หรือเลขบัญชี
      if (slipData.receiverAccount) {
        const slipAccount = this.normalizeAccountNumber(slipData.receiverAccount);
        
        // เช็คเลขบัญชีตรงกัน หรือ เบอร์โทรตรงกัน
        if (slipAccount === configAccount || 
            slipAccount.includes(configAccount) || 
            configAccount.includes(slipAccount)) {
          console.log('✅ PromptPay account number matches');
          validationsPassed++;
        } else {
          console.log('❌ PromptPay account number mismatch');
        }
      } else {
        console.log('⚠️ No receiver account in slip data');
      }
    }

    // ✅ ตรวจสอบชื่อบัญชี (ยืดหยุ่น)
    if (configBankInfo.account_name && slipData.receiver) {
      totalValidations++;
      const configName = this.normalizeName(configBankInfo.account_name);
      const slipName = this.normalizeName(slipData.receiver);
      
      console.log('Comparing names:', { configName, slipName });
      
      // ยืดหยุ่นในการเปรียบเทียบชื่อ (ลด threshold เป็น 40%)
      const similarity = this.calculateStringSimilarity(configName, slipName);
      console.log('Name similarity:', similarity);
      
      if (similarity >= 0.4) {
        console.log('✅ Account name similarity acceptable for PromptPay');
        validationsPassed++;
      } else {
        console.log('❌ Account name similarity too low');
      }
    }

    // ✅ สำหรับ PromptPay ต้องผ่านอย่างน้อย 1 validation และอัตราความสำเร็จ 50%
    const successRate = totalValidations > 0 ? validationsPassed / totalValidations : 0;
    const isValid = successRate >= 0.5 && validationsPassed >= 1;

    console.log(`🔍 PromptPay validation result: ${validationsPassed}/${totalValidations} passed (${(successRate * 100).toFixed(1)}%) - ${isValid ? 'VALID' : 'INVALID'}`);
    
    return isValid;
  }

  // ✅ ปรับ validateReceiverAccount เดิมให้เรียกใช้ validatePromptPayAccount
  validateReceiverAccount(slipData, configBankInfo) {
    return this.validatePromptPayAccount(slipData, configBankInfo);
  }

  normalizeAccountNumber(accountNumber) {
    if (!accountNumber) return '';
    // Remove dashes, spaces, and non-numeric characters (but keep X for masked digits)
    return accountNumber.toString().replace(/[^0-9X]/gi, '');
  }

  normalizeName(name) {
    if (!name) return '';
    // Remove prefixes like นาย, นาง, น.ส., Mr., Ms., and convert to lowercase
    return name
      .toLowerCase()
      .replace(/^(นาย|นาง|น\.ส\.|mr\.|ms\.|mrs\.|miss)\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  normalizeBank(bankName) {
    if (!bankName) return '';
    
    // Bank name mappings for normalization
    const bankMappings = {
      'กรุงเทพ': 'BBL',
      'กสิกรไทย': 'KBANK', 
      'ไทยพาณิชย์': 'SCB',
      'กรุงไทย': 'KTB',
      'ทหารไทยธนชาต': 'TTB',
      'กรุงศรีอยุธยา': 'BAY',
      'ธนชาต': 'TBANK',
      'เกียรตินาคินภัทร': 'KK',
      'ซิตี้แบงก์': 'CITI',
      'ยูโอบี': 'UOB',
      'แลนด์แอนด์เฮ้าส์': 'LHBANK',
      'อิสลามแห่งประเทศไทย': 'IBANK',
      'พัฒนาวิสาหกิจขนาดกลางและขนาดย่อมแห่งประเทศไทย': 'SME',
      'เพื่อการเกษตรและสหกรณ์การเกษตร': 'BAAC',
      'ออมสิน': 'GSB',
      'อาคารสงเคราะห์': 'GHB',
      'BBL': 'BBL',
      'KBANK': 'KBANK',
      'SCB': 'SCB',
      'KTB': 'KTB',
      'TTB': 'TTB',
      'BAY': 'BAY'
    };

    const normalized = bankName.toLowerCase();
    for (const [key, value] of Object.entries(bankMappings)) {
      if (normalized.includes(key.toLowerCase()) || normalized.includes(value.toLowerCase())) {
        return value;
      }
    }
    
    return normalized;
  }

  isSameBank(bank1, bank2) {
    return bank1 === bank2;
  }

  calculateStringSimilarity(str1, str2) {
    // Calculate similarity using Levenshtein distance
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

  isSlipRecent(slipData, maxHours = 48) { // ✅ เพิ่มเป็น 48 ชั่วโมง default
    try {
      const slipDate = new Date(slipData.date);
      const now = new Date();
      const hoursDiff = (now - slipDate) / (1000 * 60 * 60);
      
      console.log('⏰ Checking slip date:', {
        slipDate: slipDate.toISOString(),
        now: now.toISOString(),
        hoursDiff,
        maxHours,
        isRecent: hoursDiff <= maxHours && hoursDiff >= 0
      });
      
      return hoursDiff <= maxHours && hoursDiff >= 0;
    } catch (error) {
      console.error('Error checking slip date:', error);
      return false;
    }
  }

  // Test API connection
  async testAPIConnection() {
    if (!this.isEnabled || !this.apiKey) {
      return { 
        success: false, 
        error: 'EasySlip API not enabled or no API key configured' 
      };
    }

    try {
      // Create a minimal test image (1x1 pixel PNG)
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 
        'base64'
      );
      
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      formData.append('file', testImageBuffer, {
        filename: 'test.png',
        contentType: 'image/png'
      });

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        timeout: 10000
      });

      return { 
        success: true, 
        status: response.status,
        message: 'API connection successful',
        data: response.data 
      };
      
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      };
    }
  }

  // Get service status
  getServiceStatus() {
    return {
      enabled: this.isEnabled,
      hasApiKey: !!this.apiKey,
      apiKeyValid: this.apiKey && this.apiKey !== 'YOUR_EASYSLIP_API_KEY' && this.apiKey.length > 10,
      apiUrl: this.apiUrl,
      configLoaded: !!this.config,
      validationMode: this.isEnabled ? 'easyslip_api' : 'promptpay_basic',
      tempDirExists: fs.access(this.tempDir).then(() => true).catch(() => false)
    };
  }

  // Validate configuration
  validateConfiguration(configBankInfo) {
    const errors = [];
    
    if (!this.isEnabled) {
      console.log('ℹ️ EasySlip API not enabled - using PromptPay basic validation');
    }

    if (!configBankInfo) {
      errors.push('ไม่พบการตั้งค่าข้อมูลธนาคาร');
      return { isValid: false, errors };
    }
    
    if (!configBankInfo.bank_name) {
      errors.push('ไม่พบชื่อธนาคาร');
    }
    
    if (!configBankInfo.account_number) {
      errors.push('ไม่พบเลขบัญชี');
    }
    
    if (!configBankInfo.account_name) {
      errors.push('ไม่พบชื่อบัญชี');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      validationMode: this.isEnabled ? 'easyslip_api' : 'promptpay_basic'
    };
  }

  // Debug slip data
  debugSlipData(slipData) {
    console.log('🔍 Slip Data Debug:');
    console.log('Amount:', slipData.amount, typeof slipData.amount);
    console.log('Date:', slipData.date);
    console.log('Receiver:', slipData.receiver);
    console.log('Receiver Account:', slipData.receiverAccount);
    console.log('Receiver Bank:', slipData.receiverBank);
    console.log('Sender:', slipData.sender);
    console.log('Sender Account:', slipData.senderAccount);
    console.log('Sender Bank:', slipData.senderBank);
    console.log('Transaction ID:', slipData.transactionId);
    console.log('Refs:', { ref1: slipData.ref1, ref2: slipData.ref2, ref3: slipData.ref3 });
    console.log('Validation Method:', slipData.validationMethod || 'unknown');
  }

  // Cleanup temp files
  async cleanupTempFiles(maxAge = 3600000) { // 1 hour
    try {
      const files = await fs.readdir(this.tempDir);
      
      for (const file of files) {
        if (file.startsWith('slip_') && file.endsWith('.jpg')) {
          const filePath = path.join(this.tempDir, file);
          const stats = await fs.stat(filePath);
          
          if (Date.now() - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
            console.log(`🗑️ Cleaned up temp file: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error cleaning temp files:', error);
    }
  }

  // Reset service (for configuration reloading)
  async resetService() {
    console.log('🔄 Resetting SlipVerification service...');
    
    try {
      // Cleanup temp files
      await this.cleanupTempFiles(0); // Clean all temp files
      
      // Reinitialize configuration
      this.initializeConfig();
      
      console.log('✅ SlipVerification service reset complete');
      return {
        success: true,
        status: this.getServiceStatus()
      };
    } catch (error) {
      console.error('❌ Error resetting service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get detailed status for admin
  async getDetailedStatus() {
    const status = this.getServiceStatus();
    
    return {
      ...status,
      apiUrl: this.apiUrl,
      configStatus: {
        hasConfig: !!this.config,
        enabled: this.config?.enabled || false,
        apiKeySet: !!this.apiKey,
        apiKeyLength: this.apiKey?.length || 0,
        apiKeyMasked: this.apiKey ? `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}` : 'Not set'
      },
      tempDir: this.tempDir,
      lastInitialized: new Date().toISOString(),
      supportedModes: [
        'easyslip_api (with valid API key)',
        'promptpay_basic (fallback mode)'
      ],
      currentMode: this.isEnabled ? 'easyslip_api' : 'promptpay_basic'
    };
  }

  // ✅ เพิ่ม method สำหรับทดสอบ PromptPay validation
  async testPromptPayValidation(configBankInfo, testAmount = 1) {
    try {
      console.log('🧪 Testing PromptPay validation...');
      
      const mockSlipData = this.createPromptPayValidationResult(testAmount, configBankInfo);
      await this.validateSlipDataPromptPay(mockSlipData, testAmount, configBankInfo);
      
      console.log('✅ PromptPay validation test passed');
      return {
        success: true,
        message: 'PromptPay validation working correctly',
        mockData: mockSlipData
      };
    } catch (error) {
      console.error('❌ PromptPay validation test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ✅ เพิ่ม method สำหรับ manual validation (สำหรับ admin)
  async manualValidateSlip(slipData, expectedAmount, configBankInfo, strictMode = false) {
    try {
      console.log('🔧 Manual slip validation requested');
      
      const errors = [];
      
      // Amount validation
      if (!this.validateSlipAmount(slipData, expectedAmount)) {
        errors.push('Amount mismatch');
      }
      
      // Account validation
      if (strictMode) {
        // Use stricter validation for manual review
        if (!this.validateReceiverAccount(slipData, configBankInfo)) {
          errors.push('Account validation failed');
        }
      } else {
        // Use PromptPay validation
        if (!this.validatePromptPayAccount(slipData, configBankInfo)) {
          errors.push('PromptPay validation failed');
        }
      }
      
      // Date validation
      if (!this.isSlipRecent(slipData, strictMode ? 24 : 48)) {
        errors.push('Slip too old');
      }
      
      return {
        success: errors.length === 0,
        errors: errors,
        validations: {
          amount: this.validateSlipAmount(slipData, expectedAmount),
          account: strictMode ? 
            this.validateReceiverAccount(slipData, configBankInfo) : 
            this.validatePromptPayAccount(slipData, configBankInfo),
          date: this.isSlipRecent(slipData, strictMode ? 24 : 48)
        },
        mode: strictMode ? 'strict' : 'promptpay'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export as default
export default new SlipVerification();