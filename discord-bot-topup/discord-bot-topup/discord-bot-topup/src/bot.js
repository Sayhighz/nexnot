import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BotCommands {
  constructor(client) {
    this.client = client;
  }

  async registerCommands() {
    const commands = [
      new SlashCommandBuilder()
        .setName('topup')
        .setDescription('เปิดระบบเติมเงิน'),
      
      new SlashCommandBuilder()
        .setName('scoreboard')
        .setDescription('แสดงตาราง Tribe Score'),
        
      new SlashCommandBuilder()
        .setName('setup')
        .setDescription('ตั้งค่าระบบ (Admin only)')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel สำหรับแสดงปุ่มเติมเงิน')
            .setRequired(true)
        )
    ];

    try {
      console.log('Started refreshing application (/) commands.');
      
      await this.client.application.commands.set(commands);
      
      console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
      console.error('Error registering commands:', error);
    }
  }

  async handleTopupCommand(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🎮 ระบบเติมเงินอัตโนมัติ')
      .setDescription('กดปุ่มด้านล่างเพื่อเริ่มการเติมเงิน')
      .setTimestamp();

    const button = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('start_topup')
          .setLabel('🛒 เติมเงิน')
          .setStyle(ButtonStyle.Primary)
      );

    await interaction.reply({
      embeds: [embed],
      components: [button],
      ephemeral: false
    });
  }

  async handleSetupCommand(interaction) {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has('Administrator')) {
      return await interaction.reply({
        content: '❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้',
        ephemeral: true
      });
    }

    const channel = interaction.options.getChannel('channel');
    
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🎮 ระบบเติมเงินอัตโนมัติ')
      .setDescription(`
        **วิธีการเติมเงิน:**
        1. กดปุ่ม "เติมเงิน" ด้านล่าง
        2. เลือก Package ที่ต้องการ
        3. กรอก Steam64 ID ของคุณ
        4. ชำระเงินตาม QR Code
        5. ส่งรูปสลิปการโอนเงิน
        6. รอระบบตรวจสอบและส่งของให้อัตโนมัติ
        
        **หมายเหตุ:**
        - สลิปต้องชัดเจนและมีข้อมูลครบถ้วน
        - สลิปที่ใช้แล้วจะไม่สามารถใช้ซ้ำได้
        - ระบบจะตรวจสอบการชำระเงินอัตโนมัติ
      `)
      .setFooter({ text: 'ระบบเติมเงินอัตโนมัติ' })
      .setTimestamp();

    const button = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('start_topup')
          .setLabel('🛒 เติมเงิน')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('view_scoreboard')
          .setLabel('🏆 ดู Scoreboard')
          .setStyle(ButtonStyle.Secondary)
      );

    try {
      await channel.send({
        embeds: [embed],
        components: [button]
      });

      await interaction.reply({
        content: `✅ ตั้งค่าเรียบร้อยแล้ว! ส่งข้อความไปยัง ${channel} แล้ว`,
        ephemeral: true
      });
    } catch (error) {
      await interaction.reply({
        content: '❌ เกิดข้อผิดพลาดในการส่งข้อความ',
        ephemeral: true
      });
    }
  }
}

export default BotCommands;