// src/services/webhookService.js (Full Code - เพิ่มการส่งรูปสลิป)
import axios from 'axios';
import configService from './configService.js';
import logService from './logService.js';
import Helpers from '../utils/helpers.js';
import BrandUtils from '../utils/brandUtils.js';

class WebhookService {
  constructor() {
    this.config = null;
    this.isEnabled = false;
    this.webhookUrl = null;
    this.initializeConfig();
  }

  initializeConfig() {
    try {
      this.config = configService.get('discord_webhook', {});
      this.isEnabled = this.config.enabled || false;
      this.webhookUrl = this.config.donation_webhook_url;

      if (!this.isEnabled) {
        console.warn('⚠️ Discord webhook is disabled');
        return;
      }

      if (!this.webhookUrl || this.webhookUrl.includes('YOUR_WEBHOOK_URL')) {
        console.warn('⚠️ Discord webhook URL not configured properly');
        this.isEnabled = false;
        return;
      }

      console.log('✅ Discord webhook service initialized');
      console.log(`🔗 Webhook URL: ${this.webhookUrl.substring(0, 50)}...`);
    } catch (error) {
      console.error('❌ Error initializing webhook service:', error);
      this.isEnabled = false;
    }
  }

  async sendDonationNotification(donationData) {
    if (!this.isEnabled) {
      console.log('📢 Webhook disabled - skipping donation notification');
      return { success: false, reason: 'disabled' };
    }

    try {
      const embed = this.createDonationEmbed(donationData);
      
      const payload = {
        username: this.config.username || 'NEXArk Donation Bot',
        avatar_url: this.config.avatar_url,
        embeds: [embed]
      };

      console.log('📢 Sending donation notification to webhook...');

      const response = await axios.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.status === 204) {
        console.log('✅ Donation notification sent successfully');
        logService.info('Webhook notification sent', {
          discordId: donationData.discordId,
          username: donationData.discordUsername,
          category: donationData.category,
          itemName: donationData.itemName,
          amount: donationData.amount,
          server: donationData.server,
          hasSlipImage: !!donationData.slipImageUrl
        });

        return { success: true };
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }

    } catch (error) {
      console.error('❌ Error sending webhook notification:', error);
      logService.error('Webhook notification failed', {
        error: error.message,
        discordId: donationData.discordId,
        amount: donationData.amount
      });

      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  // ✅ แก้ไข: เพิ่มรูปสลิปและข้อมูลเพิ่มเติม
  createDonationEmbed(donationData) {
    const {
      discordId,
      discordUsername,
      steam64,
      characterId,
      category,
      itemName,
      amount,
      server,
      status,
      ticketId,
      playerName,
      timestamp,
      slipImageUrl,
      verificationData
    } = donationData;

    const categoryIcon = BrandUtils.getCategoryIcon(category);
    const categoryName = BrandUtils.getCategoryName(category);
    const statusColor = this.getStatusColor(status);

    const embed = {
      title: `${categoryIcon} การโดเนทใหม่ - ${categoryName}`,
      description: `**${itemName}**\n💰 จำนวน: ${Helpers.formatCurrency(amount)}`,
      color: statusColor,
      timestamp: timestamp || new Date().toISOString(),
      fields: [
        {
          name: '👤 ข้อมูลผู้เล่น',
          value: `**Discord:** <@${discordId}> (${discordUsername})\n**ชื่อในเกม:** ${playerName || 'ไม่ทราบ'}\n**Steam64:** \`${steam64}\``,
          inline: true
        },
        {
          name: '🎮 ข้อมูลเซิร์ฟเวอร์',
          value: `**เซิร์ฟเวอร์:** ${server || 'ไม่ทราบ'}\n**Character ID:** \`${characterId || 'ไม่ทราบ'}\`\n**สถานะ:** ${BrandUtils.getStatusIndicator(status)}`,
          inline: true
        },
        {
          name: '📋 รายละเอียดการทำรายการ',
          value: `**Ticket ID:** \`${ticketId}\`\n**หมวดหมู่:** ${categoryName}\n**วันที่:** ${Helpers.formatDateTime(new Date())}`,
          inline: false
        }
      ],
      footer: {
        text: `${BrandUtils.brandFooter} | Ticket: ${ticketId}`,
        icon_url: this.config.avatar_url
      }
    };

    // ✅ เพิ่มรูปสลิปถ้ามี
    if (slipImageUrl) {
      embed.image = {
        url: slipImageUrl
      };
      
      // เพิ่ม field สำหรับข้อมูลสลิป
      if (verificationData) {
        let slipInfo = `💳 **จำนวนเงิน:** ${Helpers.formatCurrency(verificationData.amount || amount)}`;
        
        if (verificationData.date) {
          const slipDate = new Date(verificationData.date);
          slipInfo += `\n📅 **วันที่โอน:** ${slipDate.toLocaleString('th-TH')}`;
        }
        
        if (verificationData.bank || verificationData.receiverBank) {
          slipInfo += `\n🏦 **ธนาคาร:** ${verificationData.bank || verificationData.receiverBank}`;
        }
        
        if (verificationData.sender) {
          slipInfo += `\n👤 **ผู้โอน:** ${verificationData.sender}`;
        }
        
        if (verificationData.transactionId) {
          slipInfo += `\n🔢 **Transaction ID:** \`${verificationData.transactionId}\``;
        }

        embed.fields.push({
          name: '🧾 ข้อมูลสลิป',
          value: slipInfo,
          inline: false
        });
      }
    }

    // เพิ่มข้อมูลเฉพาะตาม category
    if (category === 'points' && donationData.points) {
      embed.fields.push({
        name: '💎 รายละเอียดพ้อย',
        value: `**จำนวนพ้อยที่ได้รับ:** ${donationData.points} พ้อย`,
        inline: false
      });
    }

    if (category === 'items' && donationData.kits) {
      const kitsList = donationData.kits.map(kit => 
        `• ${kit.kitName} x${kit.quantity || 1}`
      ).join('\n');
      
      embed.fields.push({
        name: '🎁 รายการ Kit',
        value: kitsList.length > 1000 ? kitsList.substring(0, 1000) + '...' : kitsList,
        inline: false
      });
    }

    if (category === 'ranks' && donationData.rank) {
      embed.fields.push({
        name: '👑 ยศที่ได้รับ',
        value: `**ยศ:** ${donationData.rank}`,
        inline: false
      });
    }

    // เพิ่มข้อมูลข้อผิดพลาดถ้ามี
    if (donationData.error && status === 'failed') {
      embed.fields.push({
        name: '❌ ข้อผิดพลาด',
        value: `\`${donationData.error}\``,
        inline: false
      });
    }

    return embed;
  }

  getStatusColor(status) {
    const colors = {
      'pending': 0xFFA726,      // Orange
      'verified': 0x2196F3,     // Blue  
      'completed': 0x4CAF50,    // Green
      'failed': 0xF44336,       // Red
      'cancelled': 0x9E9E9E     // Gray
    };
    return colors[status] || colors.pending;
  }

  async testWebhook() {
    if (!this.isEnabled) {
      return { 
        success: false, 
        error: 'Webhook is disabled' 
      };
    }

    try {
      const testEmbed = {
        title: '🧪 Webhook Test',
        description: 'การทดสอบ Discord Webhook',
        color: 0x2196F3,
        fields: [
          {
            name: '✅ สถานะการทดสอบ',
            value: 'Webhook ทำงานปกติ',
            inline: false
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: BrandUtils.brandFooter,
          icon_url: this.config.avatar_url
        }
      };

      const payload = {
        username: this.config.username || 'NEXArk Test Bot',
        avatar_url: this.config.avatar_url,
        embeds: [testEmbed]
      };

      const response = await axios.post(this.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      if (response.status === 204) {
        return { 
          success: true, 
          message: 'Webhook test successful' 
        };
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }

    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  getServiceStatus() {
    return {
      enabled: this.isEnabled,
      hasWebhookUrl: !!this.webhookUrl,
      webhookUrlValid: this.webhookUrl && !this.webhookUrl.includes('YOUR_WEBHOOK_URL'),
      config: {
        username: this.config?.username || 'Not set',
        avatar_url: this.config?.avatar_url || 'Not set'
      }
    };
  }

  reloadConfig() {
    this.initializeConfig();
    return this.getServiceStatus();
  }
}

export default new WebhookService();