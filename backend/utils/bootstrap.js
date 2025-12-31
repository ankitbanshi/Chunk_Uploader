const fs = require("fs").promises;
const pool = require("../config/db");
const {
  UPLOADS_DIR,
  TEMP_DIR,
  cleanupOrphanedUploads,
} = require("./fileHelpers");

async function initialize() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS uploads (
          id VARCHAR(255) PRIMARY KEY,
          file_name VARCHAR(500) NOT NULL,
          file_hash VARCHAR(64) NOT NULL,
          file_size BIGINT NOT NULL,
          total_chunks INT NOT NULL,
          status ENUM('UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED') DEFAULT 'UPLOADING',
          final_hash VARCHAR(64),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_hash (file_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS chunks (
          id INT AUTO_INCREMENT PRIMARY KEY,
          upload_id VARCHAR(255) NOT NULL,
          chunk_index INT NOT NULL,
          chunk_size INT NOT NULL,
          status ENUM('PENDING', 'RECEIVED', 'FAILED') DEFAULT 'PENDING',
          received_at TIMESTAMP NULL,
          UNIQUE KEY unique_chunk (upload_id, chunk_index),
          FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } finally {
      connection.release();
    }

    await cleanupOrphanedUploads();
    console.log("✓ Server initialized & DB verified");
  } catch (err) {
    console.error(" Initialization error:", err.message);
    process.exit(1);
  }
}

module.exports = initialize;
