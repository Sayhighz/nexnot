// src/utils/brandUtils.js
class BrandUtils {
  static brandFooter = "⚡ Powered by NEXArk • ระบบโดเนทอัตโนมัติ";
  static brandIcon = "https://www.beartai.com/wp-content/uploads/2022/06/5-4.png";
  
  static brandColors = {
    primary: '#7289DA',
    success: '#00D166',
    warning: '#FFA726',
    error: '#FF6B6B',
    info: '#36A2EB'
  };

  static categoryDisplayNames = {
    'points': '💎 พ้อย',
    'ranks': '👑 ยศ', 
    'items': '🎁 ไอเทม'
  };

  static categoryIcons = {
    'points': '💰',
    'ranks': '⭐',
    'items': '🎪'
  };

  static getCategoryName(category) {
    const names = {
      'points': 'พ้อย',
      'ranks': 'ยศ',
      'items': 'ไอเทม'
    };
    return names[category] || category;
  }

  static getCategoryIcon(category) {
    const icons = {
      'points': '💎',
      'ranks': '👑',
      'items': '🎁'
    };
    return icons[category] || '📦';
  }

  static getStatusIndicator(status) {
    const indicators = {
      'pending': '🟡 รอดำเนินการ',
      'processing': '🔄 กำลังประมวลผล', 
      'verified': '🟢 ตรวจสอบแล้ว',
      'completed': '✅ สำเร็จ',
      'failed': '🔴 ล้มเหลว',
      'cancelled': '⚪ ยกเลิก'
    };
    return indicators[status] || '❓ ไม่ทราบสถานะ';
  }

  static createProgressBar(current, total, length = 10) {
    const filled = Math.round((current / total) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  static getSuccessMessage(category, donationItem) {
    switch (category) {
      case 'points':
        return `🎉 **ได้รับ ${donationItem.points} พ้อยแล้ว!**\n• ตรวจสอบยอดพ้อยในเกม\n• พ้อยจะแสดงในโปรไฟล์ผู้เล่น\n• สามารถใช้พ้อยซื้อไอเทมในเกมได้`;
        
      case 'ranks':
        return `👑 **ได้รับยศ ${donationItem.rank} แล้ว!**\n• ตรวจสอบยศในโปรไฟล์เกม\n• รับสิทธิพิเศษของยศใหม่\n• ยศจะแสดงในแชทเกม`;
        
      case 'items':
        if (donationItem.items && donationItem.items.length > 1) {
          return `🎁 **ได้รับไอเทมทั้งหมดแล้ว!**\n• จำนวน ${donationItem.items.length} รายการ\n• ตรวจสอบใน Inventory\n• ไอเทมพร้อมใช้งานทันที`;
        } else {
          return `🎁 **ได้รับไอเทมแล้ว!**\n• ${donationItem.name}\n• ตรวจสอบใน Inventory\n• ไอเทมพร้อมใช้งานทันที`;
        }
        
      default:
        return '✅ **การดำเนินการเสร็จสิ้น**\n• กรุณาตรวจสอบในเกม\n• หากมีปัญหาแจ้งแอดมิน';
    }
  }
}

module.exports = BrandUtils;