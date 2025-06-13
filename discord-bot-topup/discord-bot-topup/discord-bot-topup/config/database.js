export const dbConfig = {
  host: process.env.DATABASE_HOST || 'localhost',
  user: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'discord_bot',
  charset: 'utf8mb4',
  connectionLimit: 10,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
};

export const tableSchemas = {
  topup_logs: `
    CREATE TABLE IF NOT EXISTS topup_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      discord_id VARCHAR(20) NOT NULL,
      discord_username VARCHAR(100) NOT NULL,
      steam64 VARCHAR(20) NOT NULL,
      package_id VARCHAR(50) NOT NULL,
      package_name VARCHAR(100) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      slip_image_url TEXT,
      verification_data JSON,
      status ENUM('pending', 'verified', 'failed', 'completed', 'cancelled') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      verified_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      ticket_channel_id VARCHAR(20),
      ticket_id VARCHAR(20),
      rcon_executed BOOLEAN DEFAULT FALSE,
      error_message TEXT,
      INDEX idx_discord_id (discord_id),
      INDEX idx_status (status),
      INDEX idx_created_at (created_at),
      INDEX idx_ticket_id (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  
  slip_hashes: `
    CREATE TABLE IF NOT EXISTS slip_hashes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slip_hash VARCHAR(64) UNIQUE NOT NULL,
      discord_id VARCHAR(20) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_slip_hash (slip_hash),
      INDEX idx_discord_id (discord_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  
  active_tickets: `
    CREATE TABLE IF NOT EXISTS active_tickets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      discord_id VARCHAR(20) NOT NULL,
      channel_id VARCHAR(20) NOT NULL,
      ticket_id VARCHAR(20) NOT NULL,
      status ENUM('active', 'processing', 'completed', 'cancelled') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_discord_id (discord_id),
      INDEX idx_channel_id (channel_id),
      INDEX idx_ticket_id (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `
};

export default { dbConfig, tableSchemas };