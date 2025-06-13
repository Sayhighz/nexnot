import axios from 'axios';
import crypto from 'crypto';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import databaseService from '../services/databaseService.js';
import logService from '../services/logService.js';
import Helpers from '../utils/helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SlipVerification {
  constructor() {
    this.apiKey = process.env.EASYSLIP_API_KEY;
    this.apiUrl = 'https://developer.easyslip.com/api/v1/verify';
    this.tempDir = path.join(__dirname, '../../temp');
    this.enableMockMode = !this.apiKey;
    this.initTempDirectory();
    
    if (this.enableMockMode) {
      console.warn('⚠️ EasySlip API key not found, running in MOCK mode');
    } else {
      console.log('✅ EasySlip API key configured');
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
        attachmentSize: attachment.size
      });

      // Download image
      const response = await axios.get(attachment.url, { 
        responseType: 'arraybuffer',
        timeout: 30000
      });
      const imageBuffer = Buffer.from(response.data);

      // Generate hash to prevent duplicate submissions
      const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
      
      // Check if slip already exists
      const isDuplicate = await databaseService.checkSlipHash(imageHash);
      if (isDuplicate) {
        throw new Error('สลิปนี้เคยถูกใช้แล้ว กรุณาใช้สลิปใหม่');
      }

      // Process and save image temporarily
      const tempFileName = `slip_${Date.now()}_${discordId}.jpg`;
      const tempPath = path.join(this.tempDir, tempFileName);
      
      await sharp(imageBuffer)
        .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(tempPath);

      let verificationResult;

      // ใช้ Mock mode ถ้าไม่มี API key หรือเป็นการทดสอบ
      if (this.enableMockMode || !this.apiKey) {
        console.log('🧪 Using mock slip verification');
        verificationResult = await this.mockVerifySlip(expectedAmount, configBankInfo);
      } else {
        // Verify with EasySlip API
        verificationResult = await this.verifyWithAPI(tempPath);
      }

      console.log('📊 Verification result:', verificationResult);
      console.log('🔢 Expected amount:', expectedAmount, 'Slip amount:', verificationResult.amount);

      // ตรวจสอบว่า expectedAmount ไม่เป็น undefined
      if (expectedAmount === undefined || expectedAmount === null) {
        throw new Error('ไม่พบข้อมูลราคา Package กรุณาลองใหม่');
      }

      // ตรวจสอบจำนวนเงิน
      if (!this.validateSlipAmount(verificationResult, expectedAmount)) {
        throw new Error(`จำนวนเงินไม่ถูกต้อง: ในสลิป ${verificationResult.amount} บาท แต่ต้องจ่าย ${expectedAmount} บาท`);
      }

      // ตรวจสอบบัญชีปลายทาง
      if (!this.validateReceiverAccount(verificationResult, configBankInfo)) {
        throw new Error('บัญชีปลายทางไม่ถูกต้อง กรุณาตรวจสอบข้อมูลการโอนเงิน');
      }

      // ตรวจสอบความใหม่ของสลิป
      if (!this.isSlipRecent(verificationResult, 24)) {
        throw new Error('สลิปเก่าเกินไป กรุณาใช้สลิปที่ทำรายการภายใน 24 ชั่วโมง');
      }

      // Save slip hash to prevent reuse
      await databaseService.saveSlipHash(imageHash, discordId, verificationResult.amount || 0);

      // Clean up temp file
      await fs.unlink(tempPath).catch(console.error);

      logService.logSlipVerification(discordId, 'success', {
        hash: imageHash,
        amount: verificationResult.amount,
        bank: verificationResult.bank,
        receiver: verificationResult.receiver,
        receiverAccount: verificationResult.receiverAccount,
        mockMode: this.enableMockMode
      });

      return {
        success: true,
        data: verificationResult,
        hash: imageHash,
        mockMode: this.enableMockMode
      };

    } catch (error) {
      logService.logSlipVerification(discordId, 'failed', {
        error: error.message,
        expectedAmount,
        configBank: configBankInfo?.bank_name,
        configAccount: configBankInfo?.account_number,
        mockMode: this.enableMockMode
      });

      console.error('❌ Error processing slip:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async verifyWithAPI(imagePath) {
    try {
      // ตรวจสอบว่ามี API key หรือไม่
      if (!this.apiKey) {
        throw new Error('EasySlip API key not configured');
      }

      const imageBuffer = await fs.readFile(imagePath);
      
      console.log('📡 Calling EasySlip API...');
      console.log('API URL:', this.apiUrl);
      console.log('Image size:', imageBuffer.length, 'bytes');

      // สร้าง FormData ตาม documentation
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
        timeout: 30000
      });

      console.log('✅ EasySlip API Response:', response.status);
      console.log('Response data:', JSON.stringify(response.data, null, 2));

      // แก้ไขการตรวจสอบ response format
      if (response.data && response.data.status === 200 && response.data.data) {
        return this.normalizeSlipData(response.data.data);
      } else if (response.data && response.data.status !== 200) {
        throw new Error(response.data.message || `API Error: ${response.data.status}`);
      } else {
        throw new Error('Invalid API response format');
      }

    } catch (error) {
      if (error.response) {
        // API returned an error
        console.error('❌ EasySlip API Error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          url: error.config?.url
        });
        
        if (error.response.status === 404) {
          throw new Error('API endpoint ไม่ถูกต้อง หรือ service ไม่พร้อมใช้งาน');
        } else if (error.response.status === 401 || error.response.status === 403) {
          throw new Error('API key ไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่า');
        } else if (error.response.status === 429) {
          throw new Error('เรียกใช้ API บ่อยเกินไป กรุณารอสักครู่');
        } else if (error.response.status === 422) {
          throw new Error('รูปภาพไม่ใช่สลิปที่ถูกต้อง หรือไม่สามารถอ่านได้');
        } else {
          throw new Error(`API Error: ${error.response.status} - ${error.response.data?.message || 'Unknown error'}`);
        }
      } else if (error.request) {
        // Network error
        console.error('❌ Network Error:', error.message);
        throw new Error('เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
      } else {
        console.error('❌ Slip Verification Error:', error);
        throw new Error(error.message || 'เกิดข้อผิดพลาดในการตรวจสอบสลิป');
      }
    }
  }

  normalizeSlipData(apiData) {
    // Normalize EasySlip API response format ตาม response ที่ได้
    console.log('🔄 Normalizing slip data:', JSON.stringify(apiData, null, 2));
    
    // แก้ไขการ parse จำนวนเงิน
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
      fee: apiData.fee || 0
    };
    
    console.log('✅ Normalized data:', normalizedData);
    return normalizedData;
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
    
    // ตรวจสอบว่าทั้งสองค่าเป็นตัวเลขที่ถูกต้อง
    if (isNaN(slipAmount) || isNaN(expected)) {
      console.error('❌ Invalid amount values:', { slipAmount, expected });
      return false;
    }
    
    // Allow 1 baht difference for rounding
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

  validateReceiverAccount(slipData, configBankInfo) {
    if (!configBankInfo) {
      console.warn('⚠️ No bank config provided for validation');
      return true; // Skip validation if no config
    }

    // ใน mock mode ให้ผ่านการตรวจสอบเสมอ
    if (this.enableMockMode) {
      console.log('🧪 Mock mode: Skipping account validation');
      return true;
    }

    console.log('🔍 Validating receiver account...');
    console.log('Slip data:', {
      receiverAccount: slipData.receiverAccount,
      receiver: slipData.receiver,
      bank: slipData.bank,
      receiverBank: slipData.receiverBank
    });
    console.log('Config:', configBankInfo);

    // ตรวจสอบเลขบัญชี (ถ้ามี)
    if (slipData.receiverAccount && configBankInfo.account_number) {
      const slipAccount = this.normalizeAccountNumber(slipData.receiverAccount);
      const configAccount = this.normalizeAccountNumber(configBankInfo.account_number);

      // เนื่องจากสลิปอาจมี X แทนตัวเลข ให้ตรวจสอบแบบ partial match
      if (slipAccount && configAccount) {
        // ลบ X ออกจากเลขบัญชีในสลิป
        const slipClean = slipAccount.replace(/X/gi, '');
        const configClean = configAccount;

        // ตรวจสอบว่าตัวเลขที่เหลือตรงกันหรือไม่
        if (slipClean.length >= 4 && configClean.includes(slipClean)) {
          console.log('✅ Account number partially matches');
        } else if (configClean.length >= 4 && slipClean.includes(configClean.slice(-4))) {
          console.log('✅ Account number suffix matches');
        } else {
          logService.warn('Account number mismatch', {
            slipAccount: slipData.receiverAccount,
            configAccount: configBankInfo.account_number,
            slipClean,
            configClean
          });
          return false;
        }
      }
    }

    // ตรวจสอบชื่อบัญชี (ตรวจสอบแบบคร่าวๆ เพราะอาจมีการเขียนแตกต่างกัน)
    if (configBankInfo.account_name && slipData.receiver) {
      const configName = this.normalizeName(configBankInfo.account_name);
      const slipName = this.normalizeName(slipData.receiver);
      
      console.log('Comparing names:', { configName, slipName });
      
      // ตรวจสอบว่าชื่อคล้ายกันหรือไม่ (อย่างน้อย 60% เหมือนกัน)
      const similarity = this.calculateStringSimilarity(configName, slipName);
      console.log('Name similarity:', similarity);
      
      if (similarity < 0.6) {
        logService.warn('Account name mismatch', {
          slipName: slipData.receiver,
          configName: configBankInfo.account_name,
          similarity
        });
        // แจ้งเตือนแต่ไม่ reject เพราะชื่อในสลิปอาจไม่ครบ
        console.warn('⚠️ Name similarity low but continuing...');
      }
    }

    // ตรวจสอบธนาคาร (ถ้ามีข้อมูล)
    if (configBankInfo.bank_name && (slipData.bank || slipData.receiverBank)) {
      const configBank = this.normalizeBank(configBankInfo.bank_name);
      const slipBank = this.normalizeBank(slipData.bank || slipData.receiverBank);
      
      console.log('Comparing banks:', { configBank, slipBank });
      
      if (!this.isSameBank(configBank, slipBank)) {
        logService.warn('Bank mismatch', {
          slipBank: slipData.bank || slipData.receiverBank,
          configBank: configBankInfo.bank_name
        });
        return false;
      }
    }

    console.log('✅ Account validation passed');
    return true;
  }

  normalizeAccountNumber(accountNumber) {
    if (!accountNumber) return '';
    // ลบ dash, space, และตัวอักษรที่ไม่ใช่ตัวเลข (แต่เก็บ X ไว้)
    return accountNumber.toString().replace(/[^0-9X]/gi, '');
  }

  normalizeName(name) {
    if (!name) return '';
    // ลบ prefix/suffix เช่น นาย, นาง, น.ส., Mr., Ms., และแปลงเป็นตัวเล็ก
    return name
      .toLowerCase()
      .replace(/^(นาย|นาง|น\.ส\.|mr\.|ms\.|mrs\.|miss)\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  normalizeBank(bankName) {
    if (!bankName) return '';
    // แปลงชื่อธนาคารให้เป็นรูปแบบมาตรฐาน
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
    // ใช้ Levenshtein distance เพื่อคำนวณความคล้ายคลึง
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

  isSlipRecent(slipData, maxHours = 24) {
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

  async mockVerifySlip(amount, configBankInfo, delay = 2000) {
    // Mock verification for testing when API is not available
    console.log('🧪 Running mock slip verification...');
    await Helpers.sleep(delay);
    
    const mockData = {
      amount: amount,
      date: new Date().toISOString(),
      bank: configBankInfo?.bank_name || 'ธนาคารกรุงเทพ',
      sender: 'นาย ทดสอบ ระบบ',
      receiver: configBankInfo?.account_name || 'นาย ผู้รับ เงิน',
      receiverAccount: configBankInfo?.account_number || '1234567890',
      senderAccount: '1111111111',
      senderBank: 'SCB',
      receiverBank: configBankInfo?.bank_code || 'BBL',
      ref1: 'TEST001',
      ref2: 'MOCK',
      ref3: '',
      transactionId: 'MOCK' + Date.now(),
      countryCode: 'TH',
      fee: 0
    };
    
    console.log('🧪 Mock verification result:', mockData);
    return mockData;
  }

  // เพิ่มเมธอดเปิด/ปิด mock mode
  setMockMode(enabled) {
    this.enableMockMode = enabled;
    console.log(`🧪 Mock mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  // เพิ่มเมธอดทดสอบ API connection
  async testAPIConnection() {
    if (!this.apiKey) {
      return { success: false, error: 'No API key configured' };
    }

    try {
      // สร้าง test image (1x1 pixel PNG)
      const testImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
      
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

  // เมธอดสำหรับทดสอบการตรวจสอบบัญชี
  async testAccountValidation(slipData, configBankInfo) {
    console.log('🧪 Testing account validation...');
    console.log('Slip data:', slipData);
    console.log('Config bank info:', configBankInfo);
    
    const isValid = this.validateReceiverAccount(slipData, configBankInfo);
    console.log('Validation result:', isValid);
    
    return isValid;
  }

  // เมธอดสำหรับ debug ข้อมูลสลิป
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
  }

  // เมธอดสำหรับ validate การตั้งค่า
  validateConfiguration(configBankInfo) {
    const errors = [];
    
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
      errors
    };
  }
}

// Export as default
export default new SlipVerification();