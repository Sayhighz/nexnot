import { EmbedBuilder } from 'discord.js';
import BrandUtils from './brandUtils.js';
import Helpers from './helpers.js';

class EmbedBuilders {
  static createMainMenuEmbed() {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.primary)
      .setTitle('🌟 ระบบโดเนทและบริการ NEXArk')
      .setDescription(`
        **🔥 ยินดีต้อนรับสู่ระบบโดเนทอัตโนมัติ 🔥**
        
        **🎯 บริการที่เปิดให้ใช้งาน:**
        
        💰 **โดเนทพ้อย**
        • เติมพ้อยสำหรับใช้ในเกม
        • รับพ้อยทันทีอัตโนมัติ
        • ระบบตรวจสอบความปลอดภัย
        
        👑 **โดเนทยศ**
        • อัพเกรดยศของคุณ
        • สิทธิพิเศษมากมาย
        • ระบบอัพเกรดอัตโนมัติ
        
        🎁 **โดเนทไอเทม**
        • รับไอเทมพิเศษสุดเจ๋ง
        • ไอเทม Exclusive หายาก
        • ส่งตรงเข้าตัวละครทันที
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .setImage("https://image.api.playstation.com/cdn/JP0365/CUSA08806_00/D9W8V0pZd3Q36y4xD3x9HqwRqeoxX7oSYz9uA8Nyviev43ixO04rsXAsNh9OC14g.png")
      .addFields(
        {
          name: '💎 ความปลอดภัย',
          value: '✅ ระบบตรวจสอบอัตโนมัติ\n⚡ ได้รับของทันที\n🛡️ การันตีความน่าเชื่อถือ',
          inline: true
        },
        {
          name: '⚠️ ข้อควรระวัง',
          value: '• ตรวจสอบข้อมูลการโอนให้ถูกต้อง\n• ห้ามแชร์สลิปให้ผู้อื่น\n• สลิปที่ใช้แล้วจะไม่สามารถใช้ซ้ำได้',
          inline: false
        }
      )
      .setFooter({ 
        text: BrandUtils.brandFooter,
        iconURL: BrandUtils.brandIcon
      })
      .setTimestamp();
  }

  static createNoLinkEmbed() {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.error)
      .setTitle('⚠️ ยังไม่ได้เชื่อมต่อบัญชี')
      .setDescription(`
        **คุณยังไม่ได้เชื่อมต่อบัญชี Discord กับเกม**
        
        **📋 วิธีการเชื่อมต่อ:**
        
        **1️⃣ เข้าเกม**
        • เปิดเกมและเข้าเซิร์ฟเวอร์
        • พิมพ์คำสั่ง \`/link\` ในแชทเกม
        • คัดลอกลิงค์ที่ได้
        
        **2️⃣ ติดต่อแอดมิน**
        • ส่งลิงค์ให้กับแอดมิน
        • รอการยืนยันจากทีมงาน
        • ระบบจะแจ้งเตือนเมื่อเสร็จสิ้น
        
        **3️⃣ เริ่มใช้งาน**
        • สามารถใช้ระบบโดเนทได้ทันที
        • รับไอเทมเข้าเกมอัตโนมัติ
        • ตรวจสอบสถานะได้ตลอดเวลา
      `)
      .setThumbnail('https://image.api.playstation.com/cdn/JP0365/CUSA08806_00/D9W8V0pZd3Q36y4xD3x9HqwRqeoxX7oSYz9uA8Nyviev43ixO04rsXAsNh9OC14g.png')
      .addFields(
        {
          name: '💬 ช่องทางติดต่อแอดมิน',
          value: '📩 Discord DM แอดมินโดยตรง\n💬 แชทในเซิร์ฟเวอร์หลัก',
          inline: false
        },
        {
          name: '⚡ ประโยชน์หลังเชื่อมต่อ',
          value: '✅ ใช้ระบบโดเนทได้ทันที\n✅ รับไอเทมอัตโนมัติ\n✅ ตรวจสอบประวัติการทำรายการ\n✅ รับการสนับสนุนพิเศษ',
          inline: false
        }
      )
      .setFooter({ 
        text: BrandUtils.brandFooter,
        iconURL: BrandUtils.brandIcon
      })
      .setTimestamp();
  }

  static createMaxTicketEmbed(activeDonationTickets, maxTickets) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle('🎫 Ticket เต็มแล้ว')
      .setDescription(`
        **คุณมี Donation Ticket ที่เปิดอยู่เกินจำนวนที่อนุญาต**
        
        🎫 **Ticket ที่เปิดอยู่:** \`${activeDonationTickets.length}/${maxTickets}\`
        📊 **สถานะ:** ⚠️ เต็มแล้ว
        ⏰ **สถานะระบบ:** 🟢 ปกติ
      `)
      .setThumbnail('https://via.placeholder.com/128x128/ffa726/ffffff?text=!')
      .addFields(
        {
          name: '✅ วิธีแก้ไข',
          value: '**1️⃣ ปิด Ticket เก่า**\n• ตรวจสอบ ticket ที่ไม่ใช้แล้ว\n• กดปุ่ม "❌ ยกเลิก" ใน ticket เก่า\n• รอให้ ticket ถูกปิดอัตโนมัติ',
          inline: false
        },
        {
          name: '⏳ รอการทำรายการเสร็จ',
          value: '• หาก ticket กำลังประมวลผล\n• รอให้ระบบทำรายการเสร็จสิ้น\n• Ticket จะปิดอัตโนมัติ',
          inline: false
        },
        {
          name: '🔍 ตรวจสอบ Ticket ที่เปิดอยู่',
          value: 'ดูรายการ ticket ในช่องที่มีชื่อขึ้นต้นด้วย:\n• \`topup-XXXXX\` - Donation Tickets',
          inline: false
        }
      )
      .setFooter({ 
        text: `${BrandUtils.brandFooter} | 💡 เคล็ดลับ: Ticket จะปิดอัตโนมัติหลังทำรายการเสร็จ`,
        iconURL: BrandUtils.brandIcon
      })
      .setTimestamp();
  }

  static createCategorySelectionEmbed(category, userGameInfo, activeDonationTickets, maxTickets, donations) {
    const categoryIcon = BrandUtils.categoryIcons[category];
    const categoryDisplayName = BrandUtils.categoryDisplayNames[category];

    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.primary)
      .setTitle(`${categoryIcon} เลือก${categoryDisplayName}ที่ต้องการ`)
      .setDescription(`
        **🎯 กรุณาเลือก${categoryDisplayName}ที่ต้องการซื้อ**
        
        🔗 **สถานะการเชื่อมต่อ:** ✅ เชื่อมต่อแล้ว
        🆔 **Steam64 ID:** \`${userGameInfo.steam64}\`
        ${userGameInfo.characterId ? `🎮 **Character ID:** \`${userGameInfo.characterId}\`` : '⚠️ **Character ID:** ไม่พบ (กรุณาเข้าเกมอย่างน้อย 1 ครั้ง)'}
        
        🎫 **Donation Tickets:** \`${activeDonationTickets.length}/${maxTickets}\`
        📈 **สถานะ:** ${activeDonationTickets.length < maxTickets ? '🟢 พร้อมใช้งาน' : '🔴 เต็มแล้ว'}
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .addFields(
        {
          name: `📦 รายการ${categoryDisplayName}ทั้งหมด`,
          value: donations.slice(0, 3).map((item, index) => 
            `**${index + 1}.** ${item.name}\n💰 ${Helpers.formatCurrency(item.price)} | ${item.description}`
          ).join('\n\n') + (donations.length > 3 ? `\n\n*และอีก ${donations.length - 3} รายการ...*` : ''),
          inline: false
        },
        {
          name: '⚠️ ข้อปฏิบัติสำคัญ',
          value: '✅ ตรวจสอบข้อมูลให้ถูกต้อง\n✅ โอนเงินตามจำนวนที่ระบุ\n✅ ถ่ายรูปสลิปให้ชัดเจน\n❌ ไม่แชร์สลิปให้ผู้อื่น',
          inline: false
        }
      )
      .setFooter({ 
        text: `${BrandUtils.brandFooter} | 💡 การทำรายการจะเสร็จสิ้นภายใน 1-5 นาที`,
        iconURL: BrandUtils.brandIcon
      })
      .setTimestamp();
  }

  static createDonationTicketEmbed(ticketId, donationItem, category, userGameInfo, config) {
    const categoryIcon = BrandUtils.getCategoryIcon(category);
    const categoryName = BrandUtils.getCategoryName(category);

    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.success)
      .setTitle(`🎫 Donation Ticket #${ticketId}`)
      .setDescription(`
        **🎉 ยินดีต้อนรับสู่ระบบโดเนท NEXArk!**
        
        ${categoryIcon} **หมวดหมู่:** ${categoryName}
        🛍️ **รายการ:** \`${donationItem.name}\`
        💰 **ราคา:** \`${Helpers.formatCurrency(donationItem.price)}\`
        📝 **รายละเอียด:** ${donationItem.description}
        
        🆔 **Steam64 ID:** \`${userGameInfo.steam64}\`
        ${userGameInfo.characterId ? `🎮 **Character ID:** \`${userGameInfo.characterId}\`` : '⚠️ **Character ID:** ไม่พบ'}
        📅 **วันที่สั่งซื้อ:** ${Helpers.formatDateTime(new Date())}
        📊 **สถานะ:** ${BrandUtils.getStatusIndicator('pending')}
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .addFields(
        {
          name: '💳 ข้อมูลการโอนเงิน',
          value: `🏦 **ธนาคาร:** ${config.qr_code.payment_info.bank_name}\n💳 **เลขบัญชี:** \`${config.qr_code.payment_info.account_number}\`\n👤 **ชื่อบัญชี:** ${config.qr_code.payment_info.account_name}\n💰 **จำนวนเงิน:** \`${Helpers.formatCurrency(donationItem.price)}\``,
          inline: false
        },
        {
          name: '📋 ขั้นตอนการทำรายการ',
          value: '**1️⃣ การชำระเงิน**\n• สแกน QR Code ด้านล่าง หรือ\n• โอนเงินตามข้อมูลด้านบน\n⚠️ โอนเงินตามจำนวนที่ระบุเท่านั้น',
          inline: true
        },
        {
          name: '📤 การส่งสลิป',
          value: '**2️⃣ ส่งสลิป**\n• ถ่ายรูปสลิปให้ชัดเจน\n• ส่งรูปสลิปในแชทนี้\n• รอระบบตรวจสอบ (1-5 นาที)',
          inline: true
        },
        {
          name: '⚠️ ข้อควรระวังสำคัญ',
          value: '✅ ตรวจสอบจำนวนเงินให้ถูกต้อง\n✅ สลิปต้องชัดเจนและครบถ้วน\n✅ สลิปต้องทำรายการภายใน 24 ชม.\n❌ ห้ามใช้สลิปเก่าหรือสลิปซ้ำ\n❌ ห้ามแชร์สลิปให้ผู้อื่น',
          inline: false
        },
        {
          name: '⏱️ ประมาณการเวลา',
          value: '🔍 การตรวจสอบสลิป: < 2 นาที\n🎁 การส่งของเข้าเกม: < 3 นาที\n📊 รวมทั้งหมด: < 5 นาที',
          inline: true
        },
        {
          name: '🛡️ ความปลอดภัย',
          value: '🔒 ระบบตรวจสอบอัตโนมัติ\n🚫 ป้องกันการใช้สลิปซ้ำ\n🔐 เข้ารหัสข้อมูลส่วนตัว',
          inline: true
        }
      )
      .setFooter({ 
        text: `${BrandUtils.brandFooter} | Ticket: ${ticketId} | 💡 หากมีปัญหา กดปุ่ม "❌ ยกเลิก" แล้วติดต่อแอดมิน`,
        iconURL: BrandUtils.brandIcon
      })
      .setTimestamp();
  }

  static createProcessingSlipEmbed(ticketData, attachment) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle('⏳ กำลังตรวจสอบสลิป')
      .setDescription(`
        **🔍 ระบบกำลังตรวจสอบสลิปของคุณ**
        
        **📋 ขั้นตอนการตรวจสอบ:**
        
        **1️⃣ ตรวจสอบความถูกต้องของไฟล์** ✅
        **2️⃣ ดาวน์โหลดและประมวลผลรูปภาพ** 🔄
        **3️⃣ ส่งข้อมูลไปยัง API ตรวจสอบ** ⏳
        **4️⃣ ตรวจสอบข้อมูลการโอนเงิน** ⏳
        **5️⃣ ยืนยันและดำเนินการ** ⏳
        
        ⏱️ **เวลาประมาณ:** 1-3 นาที
        
        💡 **กรุณารอสักครู่...**
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .addFields(
        {
          name: '📊 ข้อมูลไฟล์',
          value: `• **ชื่อไฟล์:** ${attachment.name}\n• **ขนาด:** ${(attachment.size / 1024).toFixed(2)} KB\n• **ประเภท:** รูปภาพ`,
          inline: true
        },
        {
          name: '🎫 ข้อมูล Ticket',
          value: `• **Ticket ID:** ${ticketData.ticketId}\n• **จำนวนเงิน:** ${Helpers.formatCurrency(ticketData.donationItem.price)}\n• **สถานะ:** กำลังประมวลผล`,
          inline: true
        },
        {
          name: '🔒 ความปลอดภัย',
          value: '• ระบบจะตรวจสอบสลิปซ้ำ\n• ข้อมูลได้รับการเข้ารหัส\n• ป้องกันการใช้งานโดยไม่ได้รับอนุญาต',
          inline: false
        }
      )
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  static createSlipVerificationSuccessEmbed(verificationData, ticketData) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.success)
      .setTitle('✅ การตรวจสอบสลิปสำเร็จ!')
      .setDescription(`
        **🎉 ระบบได้ตรวจสอบสลิปของคุณเรียบร้อยแล้ว**
        
        กำลังดำเนินการ...
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .addFields(
        {
          name: '💰 ข้อมูลการโอนเงิน',
          value: `• **จำนวนเงิน:** ${Helpers.formatCurrency(verificationData.amount)}\n• **วันที่:** ${new Date(verificationData.date).toLocaleString('th-TH')}\n• **ธนาคารผู้รับ:** ${verificationData.receiverBank || verificationData.bank}`,
          inline: true
        },
        {
          name: '👤 ข้อมูลผู้รับ',
          value: `• **ชื่อผู้รับ:** ${verificationData.receiver}\n• **เลขบัญชีผู้รับ:** ${verificationData.receiverAccount}\n• **Transaction ID:** ${verificationData.transactionId || 'N/A'}`,
          inline: true
        },
        {
          name: '🎫 ข้อมูล Ticket',
          value: `• **Ticket ID:** ${ticketData.ticketId}\n• **รายการ:** ${ticketData.donationItem.name}\n• **สถานะ:** กำลังดำเนินการ`,
          inline: false
        }
      )
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  static createExecutingDonationEmbed(ticketData) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle("⚙️ กำลังดำเนินการ")
      .setDescription(`
        **🎮 ระบบกำลังดำเนินการให้คุณ...**
        
        • กำลังเชื่อมต่อกับเซิร์ฟเวอร์เกม
        • กำลังส่งคำสั่งเข้าสู่ระบบ
        • กำลังตรวจสอบการดำเนินการ
        
        **กรุณารอสักครู่**
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .addFields(
        {
          name: '📦 รายการที่กำลังดำเนินการ',
          value: `• **หมวดหมู่:** ${BrandUtils.getCategoryName(ticketData.category)}\n• **รายการ:** ${ticketData.donationItem.name}\n• **ราคา:** ${Helpers.formatCurrency(ticketData.donationItem.price)}`,
          inline: false
        }
      )
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  static createDonationCompletedEmbed(ticketData, category, donationItem) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.success)
      .setTitle("✅ การโดเนทสำเร็จ!")
      .setDescription(`
        **🎉 ยินดีด้วย! การโดเนทของคุณสำเร็จแล้ว**
        
        **รายการ:** ${donationItem.name}
        **หมวดหมู่:** ${BrandUtils.getCategoryName(category)}
        **สถานะ:** สำเร็จ
        
        ${this.getSuccessMessage(category, donationItem)}
        
        **Ticket นี้จะถูกปิดใน 5 นาที**
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .addFields(
        {
          name: '🎮 ขั้นตอนถัดไป',
          value: '• เข้าเกมเพื่อตรวจสอบการรับของ\n• หากมีปัญหา ติดต่อแอดมินทันที\n• เก็บหลักฐานการทำรายการไว้',
          inline: false
        }
      )
      .setFooter({ text: `${BrandUtils.brandFooter} | ขอบคุณที่ใช้บริการ!` })
      .setTimestamp();
  }

  static createDonationFailedEmbed(ticketData, reason = null) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.error)
      .setTitle("❌ เกิดข้อผิดพลาดในการดำเนินการ")
      .setDescription(`
        **😔 ระบบไม่สามารถดำเนินการได้ในขณะนี้**
        
        ${reason ? `**เหตุผล:** ${reason}` : ''}
        
        **กรุณาติดต่อแอดมินพร้อมแจ้ง Ticket ID:** \`${ticketData.ticketId}\`
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .addFields(
        {
          name: '📞 ช่องทางติดต่อ',
          value: '• Discord DM แอดมินโดยตรง\n• แชทในเซิร์ฟเวอร์หลัก',
          inline: false
        },
        {
          name: '📋 ข้อมูลที่ต้องแจ้ง',
          value: `• Ticket ID: ${ticketData.ticketId}\n• รายการ: ${ticketData.donationItem.name}\n• เวลาที่เกิดปัญหา: ${Helpers.formatDateTime(new Date())}`,
          inline: false
        }
      )
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  static createCancelDonationEmbed(ticketId) {
    return new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle('❌ ยกเลิกการโดเนท')
      .setDescription(`
        **การโดเนทถูกยกเลิกแล้ว**
        
        **Ticket #${ticketId}** จะถูกปิดใน 10 วินาที
        
        หากต้องการทำรายการใหม่ กรุณากลับไปที่เมนูหลัก
      `)
      .setThumbnail(BrandUtils.brandIcon)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();
  }

  static createErrorEmbed(title, description, thumbnailUrl = null) {
    const embed = new EmbedBuilder()
      .setColor(BrandUtils.brandColors.error)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();

    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }

    return embed;
  }

  static createSuccessEmbed(title, description, thumbnailUrl = null) {
    const embed = new EmbedBuilder()
      .setColor(BrandUtils.brandColors.success)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();

    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }

    return embed;
  }

  static createWarningEmbed(title, description, thumbnailUrl = null) {
    const embed = new EmbedBuilder()
      .setColor(BrandUtils.brandColors.warning)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();

    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }

    return embed;
  }

  // Helper method for success messages
  static getSuccessMessage(category, donationItem) {
    switch (category) {
      case 'points':
        return `ได้รับ ${donationItem.points} พ้อยแล้ว กรุณาตรวจสอบในเกม`;
      case 'ranks':
        return `ได้รับยศ ${donationItem.rank} แล้ว กรุณาตรวจสอบในเกม`;
      case 'items':
        return `ได้รับไอเทมแล้ว กรุณาตรวจสอบในเกม`;
      default:
        return 'การดำเนินการเสร็จสิ้น กรุณาตรวจสอบในเกม';
    }
  }

  // Mobile-specific optimizations
  static createMobileOptimizedEmbed(title, description, fields = []) {
    const embed = new EmbedBuilder()
      .setColor(BrandUtils.brandColors.primary)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: BrandUtils.brandFooter })
      .setTimestamp();

    // แบ่ง fields ออกเป็นชิ้นเล็กๆ สำหรับ mobile
    const mobileFields = fields.map(field => ({
      ...field,
      inline: false // Force all fields to be full width on mobile
    }));

    if (mobileFields.length > 0) {
      embed.addFields(mobileFields);
    }

    return embed;
  }

  // Responsive text formatting helper
  static formatForMobile(text, maxLength = 1000) {
    if (text.length <= maxLength) return text;
    
    // แบ่งข้อความให้เหมาะสมกับ mobile
    const words = text.split(' ');
    let result = '';
    let currentLine = '';
    
    for (const word of words) {
      if ((currentLine + word).length > 50) { // 50 chars per line on mobile
        result += currentLine.trim() + '\n';
        currentLine = word + ' ';
      } else {
        currentLine += word + ' ';
      }
    }
    
    result += currentLine.trim();
    return result.length > maxLength ? result.substring(0, maxLength - 3) + '...' : result;
  }
}

export default EmbedBuilders;