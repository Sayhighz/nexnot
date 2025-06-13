import QRCode from 'qrcode';
import { createCanvas, loadImage } from 'canvas';
import Helpers from '../utils/helpers.js';

class QRCodeService {
  async generatePaymentQR(amount, packageName, bankInfo) {
    try {
      // Create payment text
      const paymentText = `
ชำระเงิน: ${Helpers.formatCurrency(amount)}
Package: ${packageName}
ธนาคาร: ${bankInfo.bank_name}
เลขบัญชี: ${bankInfo.account_number}
ชื่อบัญชี: ${bankInfo.account_name}
      `.trim();
      
      const qrCodeDataURL = await QRCode.toDataURL(paymentText, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      return qrCodeDataURL;
    } catch (error) {
      console.error('❌ Error generating QR code:', error);
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

     // QR Code
     const qrCodeDataURL = await this.generatePaymentQR(amount, packageName, bankInfo);
     const qrImage = await loadImage(qrCodeDataURL);
     
     // Center QR code
     const qrSize = 200;
     const qrX = (canvas.width - qrSize) / 2;
     const qrY = 380;
     
     ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

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

 async generatePromptPayQR(phoneNumber, amount) {
   try {
     // PromptPay QR Code format
     const promptPayData = this.generatePromptPayData(phoneNumber, amount);
     
     const qrCodeDataURL = await QRCode.toDataURL(promptPayData, {
       width: 300,
       margin: 2,
       errorCorrectionLevel: 'M'
     });

     return qrCodeDataURL;
   } catch (error) {
     console.error('❌ Error generating PromptPay QR:', error);
     throw error;
   }
 }

 generatePromptPayData(phoneNumber, amount) {
   // Simplified PromptPay QR format
   // In production, you should use proper PromptPay library
   const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
   return `00020101021229370016A000000677010111${cleanPhone.padStart(13, '0')}5802TH5406${amount.toFixed(2)}6304`;
 }
}

export default new QRCodeService();