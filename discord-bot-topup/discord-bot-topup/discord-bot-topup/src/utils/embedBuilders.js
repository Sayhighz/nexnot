// src/utils/embedBuilders.js (Full Code ที่แก้ไขแล้ว)
import { EmbedBuilder } from 'discord.js';
import BrandUtils from './brandUtils.js';
import Helpers from './helpers.js';

class EmbedBuilders {
  // ✅ ปรับ Main Menu ให้เรียบง่าย
  static createMainMenuEmbed() {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.primary)
      .setTitle('🎮 ระบบโดเนทอัตโนมัติ')
      .setDescription(`
        **เลือกหมวดหมู่ที่ต้องการโดเนท:**
        
        💰 **โดเนทพ้อย** - เติมพ้อยสำหรับใช้ในเกม
        👑 **โดเนทยศ** - อัพเกรดยศของคุณ  
        🎁 **โดเนทไอเทม** - รับไอเทมพิเศษ
        
        📱 รองรับการชำระเงินผ่าน PromptPay
        ⚡ ได้รับของทันทีอัตโนมัติ
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ ปรับ No Link Embed ให้ชัดเจน
  static createNoLinkEmbed(linkChannelId) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle('🆔 กรอก Steam64 ID')
      .setDescription(`
        **คุณยังไม่ได้เชื่อมต่อบัญชี Discord กับเกม**
        
        กรุณากรอก Steam64 ID เพื่อใช้งานระบบโดเนท
        
        📋 **วิธีหา Steam64 ID:**
        • เปิด Steam Client
        • คลิกขวาที่โปรไฟล์ > View Profile  
        • ดู URL: steamcommunity.com/profiles/**17ตัวเลข**
        • หรือใช้เว็บ https://steamid.io/
      `)
      .addFields(
        {
          name: '💡 หลังจากโดเนท',
          value: 'แนะนำให้เชื่อมต่อบัญชีเพื่อความสะดวกในครั้งต่อไป',
          inline: false
        }
      )
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ ปรับ Category Selection ให้เรียบง่าย
  static createCategorySelectionEmbed(category, userGameInfo, activeDonationTickets, maxTickets, donations) {
    const categoryIcon = BrandUtils.categoryIcons[category];
    const categoryDisplayName = BrandUtils.categoryDisplayNames[category];

    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.primary)
      .setTitle(`${categoryIcon} เลือก${categoryDisplayName}`)
      .setDescription(`
        **🔗 Steam64 ID:** \`${userGameInfo.steam64}\`
        **🎫 Tickets:** ${activeDonationTickets.length}/${maxTickets}
        
        เลือก${categoryDisplayName}ที่ต้องการจากเมนูด้านล่าง
      `)
      .addFields(
        {
          name: `📦 รายการยอดนิยม`,
          value: donations.slice(0, 3).map(item => 
            `**${item.name}** - ${Helpers.formatCurrency(item.price)}`
          ).join('\n') + (donations.length > 3 ? '\n*และอีกหลายรายการ...*' : ''),
          inline: false
        }
      )
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ ปรับ Temporary Steam ID Embed
  static createTemporarySteamIdEmbed(category, steamId, activeDonationTickets, maxTickets, donations) {
    const categoryIcon = BrandUtils.categoryIcons[category];
    const categoryDisplayName = BrandUtils.categoryDisplayNames[category];

    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.info)
      .setTitle(`${categoryIcon} เลือก${categoryDisplayName}`)
      .setDescription(`
        **🆔 Steam64 ID:** \`${steamId}\` (ชั่วคราว)
        **🎫 Tickets:** ${activeDonationTickets.length}/${maxTickets}
        
        เลือก${categoryDisplayName}ที่ต้องการจากเมนูด้านล่าง
      `)
      .setFooter({ text: `${BrandUtils.brandFooter} | แนะนำให้เชื่อมต่อบัญชีเพื่อความสะดวก` })
      .setTimestamp();
  }

  // ✅ ปรับ Donation Ticket Embed ให้เรียบง่าย
  static createDonationTicketEmbed(ticketId, donationItem, category, userGameInfo, config) {
    const categoryIcon = BrandUtils.getCategoryIcon(category);

    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.success)
      .setTitle(`🎫 Ticket #${ticketId}`)
      .setDescription(`
        ${categoryIcon} **${donationItem.name}**
        💰 **ราคา:** ${Helpers.formatCurrency(donationItem.price)} บาท
        🆔 **Steam64:** \`${userGameInfo.steam64}\`
      `)
      .addFields(
        {
          name: '💳 ข้อมูลการโอนเงิน',
          value: `**ธนาคาร:** ${config.qr_code.payment_info.bank_name}\n**เลขบัญชี:** \`${config.qr_code.payment_info.account_number}\`\n**ชื่อบัญชี:** ${config.qr_code.payment_info.account_name}`,
          inline: true
        },
        {
          name: '📋 ขั้นตอนการทำรายการ',
          value: '1. สแกน QR Code ด้านล่าง\n2. โอนเงินตามจำนวนที่ระบุ\n3. ส่งรูปสลิปในแชทนี้\n4. รอระบบตรวจสอบ (1-5 นาที)',
          inline: true
        },
        {
          name: '⚠️ ข้อควรระวัง',
          value: '• โอนเงินตามจำนวนที่ระบุเท่านั้น\n• สลิปต้องชัดเจนและภายใน 24 ชม.\n• ห้ามใช้สลิปซ้ำหรือแชร์ให้ผู้อื่น',
          inline: false
        }
      )
      .setFooter({ text: `${BrandUtils.brandFooter} | หากมีปัญหา กดปุ่ม "ยกเลิก"` })
      .setTimestamp();
  }

  // ✅ ปรับ Processing Embed
  static createProcessingSlipEmbed(ticketData, attachment) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle('⏳ กำลังตรวจสอบสลิป')
      .setDescription(`
        กำลังตรวจสอบสลิปของคุณ กรุณารอสักครู่...
        
        **📄 ไฟล์:** ${attachment.name}
        **📊 ขนาด:** ${(attachment.size / 1024).toFixed(2)} KB
        **⏱️ เวลาประมาณ:** 1-3 นาที
      `)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ ปรับ Success Embed
  static createSlipVerificationSuccessEmbed(verificationData, ticketData) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.success)
      .setTitle('✅ ตรวจสอบสลิปสำเร็จ')
      .setDescription(`
        **💰 จำนวนเงิน:** ${Helpers.formatCurrency(verificationData.amount)} บาท
        **📅 วันที่โอน:** ${new Date(verificationData.date).toLocaleString('th-TH')}
        **🏦 ธนาคาร:** ${verificationData.receiverBank || verificationData.bank}
        
        🎮 กำลังส่งของเข้าเกม...
      `)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ เพิ่ม function ที่ขาดหายไป
  static createExecutingDonationEmbed(ticketData) {
    const categoryIcon = BrandUtils.getCategoryIcon(ticketData.category);
    
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle("⚙️ กำลังดำเนินการ")
      .setDescription(`
        ${categoryIcon} **${ticketData.donationItem.name}**
        
        🎮 กำลังส่งคำสั่งเข้าเซิร์ฟเวอร์...
        ⏱️ กรุณารอสักครู่
      `)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ ปรับ Completed Embed
  static createDonationCompletedEmbed(ticketData, category, donationItem) {
    const categoryIcon = BrandUtils.getCategoryIcon(category);
    
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.success)
      .setTitle('🎉 การโดเนทสำเร็จ!')
      .setDescription(`
        ${categoryIcon} **${donationItem.name}** ส่งสำเร็จแล้ว!
        
        🎮 **กรุณาเข้าเกมเพื่อตรวจสอบ**
        📞 หากมีปัญหา แจ้งแอดมินทันที
        
        ขอบคุณที่ใช้บริการ! 💖
      `)
      .setFooter({ text: `${BrandUtils.brandFooter} | Ticket จะปิดใน 5 นาที` })
      .setTimestamp();
  }

  static createDonationFailedEmbed(ticketData, reason = null) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.error)
      .setTitle("❌ เกิดข้อผิดพลาด")
      .setDescription(`
        ระบบไม่สามารถดำเนินการได้ในขณะนี้
        
        ${reason ? `**สาเหตุ:** ${reason}` : ''}
        
        **📞 กรุณาติดต่อแอดมิน**
        **🎫 Ticket ID:** \`${ticketData.ticketId}\`
      `)
      .addFields(
        {
          name: '📋 ข้อมูลที่ต้องแจ้ง',
          value: `• Ticket ID: ${ticketData.ticketId}\n• รายการ: ${ticketData.donationItem.name}\n• เวลา: ${new Date().toLocaleString('th-TH')}`,
          inline: false
        }
      )
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ เพิ่ม function สำหรับยกเลิก
  static createCancelDonationEmbed(ticketId) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle('❌ ยกเลิกการโดเนท')
      .setDescription(`
        การโดเนทถูกยกเลิกแล้ว
        
        **Ticket #${ticketId}** จะถูกปิดใน 10 วินาที
        
        หากต้องการทำรายการใหม่ กรุณากลับไปที่เมนูหลัก
      `)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ ปรับ Error Embeds
  static createErrorEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.error)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  static createWarningEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ ปรับ Max Ticket Embed
  static createMaxTicketEmbed(activeDonationTickets, maxTickets) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle('🎫 Ticket เต็มแล้ว')
      .setDescription(`
        คุณมี Ticket เปิดอยู่ **${activeDonationTickets.length}/${maxTickets}** แล้ว
        
        📋 **วิธีแก้ไข:**
        • ปิด Ticket เก่าที่ไม่ใช้แล้ว
        • รอให้ Ticket ที่กำลังประมวลผลเสร็จ
        • Ticket จะปิดอัตโนมัติหลังทำรายการเสร็จ
      `)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  // ✅ เพิ่ม Embed สำหรับเลือกระหว่าง Link และ Manual
  static createChooseInputMethodEmbed(category) {
    const categoryIcon = BrandUtils.getCategoryIcon(category);
    const categoryName = BrandUtils.getCategoryName(category);

    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.info)
      .setTitle(`${categoryIcon} เลือกวิธีกรอกข้อมูล`)
      .setDescription(`
        คุณต้องการโดเนท${categoryName} กรุณาเลือกวิธีการ:
        
        🔗 **ใช้ข้อมูลที่เชื่อมต่อไว้** (แนะนำ)
        • สะดวก ไม่ต้องกรอกซ้ำ
        • ข้อมูลถูกต้องแน่นอน
        
        🆔 **กรอก Steam64 ID ใหม่**
        • กรอกเลข Steam64 ID ด้วยตนเอง
        • เหมาะสำหรับบัญชีอื่น
      `)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }
}

export default EmbedBuilders;