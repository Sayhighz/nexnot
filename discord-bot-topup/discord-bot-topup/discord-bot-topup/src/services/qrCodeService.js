import { createCanvas, loadImage } from 'canvas';
import Helpers from '../utils/helpers.js';

class QRCodeService {
  async generatePaymentQR(amount, packageName, bankInfo) {
    try {
      // ใช้ PromptPay URL แทน QR Code library
      const promptPayUrl = `https://promptpay.io/${bankInfo.account_number}/${amount}`;
      return promptPayUrl;
    } catch (error) {
      console.error('❌ Error generating payment QR:', error);
      throw error;
    }
  }

  async generatePaymentImage(amount, packageName, bankInfo) {
    try {
      const canvas = createCanvas(500, 700);
      const ctx = canvas.getContext('2d');

      // Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 500, 700);

      // Header background
      ctx.fillStyle = '#4a90e2';
      ctx.fillRect(0, 0, 500, 80);

      // Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('ชำระเงิน', 250, 50);

      // Package info box
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(20, 100, 460, 120);
      ctx.strokeStyle = '#dee2e6';
      ctx.lineWidth = 1;
      ctx.strokeRect(20, 100, 460, 120);

      // Package details
      ctx.fillStyle = '#2c3e50';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'left';
      ctx.fillText('Package:', 40, 130);
      ctx.font = '18px Arial';
      ctx.fillText(packageName, 130, 130);

      ctx.font = 'bold 20px Arial';
      ctx.fillText('จำนวนเงิน:', 40, 160);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 24px Arial';
      ctx.fillText(Helpers.formatCurrency(amount), 160, 160);

      // Bank info box
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(20, 240, 460, 120);
      ctx.strokeStyle = '#dee2e6';
      ctx.strokeRect(20, 240, 460, 120);

      // Bank details
      ctx.fillStyle = '#2c3e50';
      ctx.font = 'bold 18px Arial';
      ctx.fillText('ข้อมูลการโอน:', 40, 270);
      
      ctx.font = '16px Arial';
      ctx.fillText(`ธนาคาร: ${bankInfo.bank_name}`, 40, 295);
      ctx.fillText(`เลขบัญชี: ${bankInfo.account_number}`, 40, 315);
      ctx.fillText(`ชื่อบัญชี: ${bankInfo.account_name}`, 40, 335);

      // QR Code จาก PromptPay URL
      const promptPayUrl = `https://promptpay.io/${bankInfo.account_number}/${amount}`;
      
      try {
        const qrImage = await loadImage(promptPayUrl);
        
        // Center QR code
        const qrSize = 200;
        const qrX = (canvas.width - qrSize) / 2;
        const qrY = 380;
        
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
      } catch (qrError) {
        console.warn('⚠️ Could not load QR image, showing text instead');
        
        // แสดงข้อความแทนถ้าโหลด QR ไม่ได้
        ctx.fillStyle = '#6c757d';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('สแกน QR Code ด้วยแอพธนาคาร', 250, 420);
        ctx.fillText('หรือโอนเงินตามข้อมูลด้านบน', 250, 450);
        ctx.font = '14px Arial';
        ctx.fillText(`PromptPay: ${bankInfo.account_number}`, 250, 480);
        ctx.fillText(`จำนวน: ${Helpers.formatCurrency(amount)}`, 250, 500);
      }

      // Instructions
      ctx.fillStyle = '#6c757d';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('สแกน QR Code หรือโอนเงินตามข้อมูลด้านบน', 250, 610);
      ctx.fillText('จากนั้นส่งสลิปการโอนเงินมาให้ตรวจสอบ', 250, 630);

      // Footer
      ctx.fillStyle = '#95a5a6';
      ctx.font = '12px Arial';
      ctx.fillText(`สร้างเมื่อ: ${Helpers.formatDateTime(new Date())}`, 250, 660);

      return canvas.toBuffer('image/png');
    } catch (error) {
      console.error('❌ Error generating payment image:', error);
      throw error;
    }
  }

  // สำหรับใช้ใน embed โดยตรง
  getPromptPayUrl(amount, accountNumber) {
    return `https://promptpay.io/${accountNumber}/${amount}`;
  }

  // สำหรับใช้ใน embed แบบง่าย
  async generateSimplePaymentEmbed(amount, packageName, bankInfo) {
    const promptPayUrl = this.getPromptPayUrl(amount, bankInfo.account_number);
    
    return {
      url: promptPayUrl,
      bankInfo: bankInfo,
      amount: amount,
      packageName: packageName
    };
  }
}

export default new QRCodeService();