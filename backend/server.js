const express = require("express");
const cors = require("cors");
const fs = require("fs").promises; 
const fsSync = require("fs");     
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const yauzl = require("yauzl");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3002;

app.use(express.json());
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' })); 
app.use(cors({ origin: "*" }));

const UPLOADS_DIR = path.join(__dirname, "uploads");
const TEMP_DIR = path.join(__dirname, "temp");

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', 
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'rootpassword', 
  database: process.env.DB_NAME || 'chunked_upload_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const finalizeLocks = new Map();

async function moveFile(source, target) {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code === 'EXDEV') {
      await fs.copyFile(source, target);
      await fs.unlink(source);
    } else {
      throw error;
    }
  }
}


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
    
    cleanupOrphanedUploads();
    console.log("✓ Server initialized & DB verified");
  } catch (err) {
    console.error(" Initialization error:", err.message);
  }
}

async function cleanupOrphanedUploads() {
  try {
    const [orphaned] = await pool.query(`
      SELECT id FROM uploads 
      WHERE status != 'COMPLETED' 
      AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    for (const upload of orphaned) {
      const tempFile = path.join(TEMP_DIR, upload.id);
      try {
        if (fsSync.existsSync(tempFile)) await fs.unlink(tempFile);
      } catch (err) { /* ignore */ }
      await pool.query('DELETE FROM uploads WHERE id = ?', [upload.id]);
      console.log(`Cleaned up orphaned upload: ${upload.id}`);
    }
  } catch (err) {
    console.error(" Cleanup error:", err.message);
  }
}

setInterval(cleanupOrphanedUploads, 60 * 60 * 1000);

setInterval(() => {
  const now = Date.now();
  for (const [id, time] of finalizeLocks) {
    if (now - time > 10 * 60 * 1000) finalizeLocks.delete(id);
  }
}, 60 * 1000);

app.get("/", (req, res) => res.json({ status: "Running" }));

app.get("/upload/status", async (req, res) => {
  try {
    const { fileHash, fileName, fileSize } = req.query;
    if (!fileHash || !fileName || !fileSize) return res.status(400).json({ error: "Missing params" });

    const totalChunks = Math.ceil(parseInt(fileSize) / (5 * 1024 * 1024));
    const [existing] = await pool.query('SELECT id, status FROM uploads WHERE file_hash = ? AND file_size = ?', [fileHash, fileSize]);

    if (existing.length > 0) {
      const upload = existing[0];
      if (upload.status === 'COMPLETED') {
        return res.json({ uploadId: upload.id, completedChunks: Array.from({ length: totalChunks }, (_, i) => i), status: 'COMPLETED' });
      }
      
      if (!fsSync.existsSync(path.join(TEMP_DIR, upload.id))) {
        await pool.query('DELETE FROM uploads WHERE id = ?', [upload.id]); 
      } else {
        const [chunks] = await pool.query('SELECT chunk_index FROM chunks WHERE upload_id = ? AND status = "RECEIVED"', [upload.id]);
        return res.json({ uploadId: upload.id, completedChunks: chunks.map(c => c.chunk_index), status: upload.status });
      }
    }

    const uploadId = crypto.randomBytes(16).toString('hex');
    await pool.query('INSERT INTO uploads (id, file_name, file_hash, file_size, total_chunks) VALUES (?, ?, ?, ?, ?)', [uploadId, fileName, fileHash, fileSize, totalChunks]);
    
    const chunkSize = 5 * 1024 * 1024;
    const chunkValues = Array.from({ length: totalChunks }, (_, i) => {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize, parseInt(fileSize));
      return [uploadId, i, end - start];
    });
    await pool.query('INSERT INTO chunks (upload_id, chunk_index, chunk_size) VALUES ?', [chunkValues]);

    res.json({ uploadId, completedChunks: [], status: 'NEW' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/upload/chunk", async (req, res) => {
  const uploadId = req.headers['x-upload-id'];
  const chunkIndex = Number(req.headers['x-chunk-index']);
  const chunkStart = Number(req.headers['x-chunk-start']);

  try {
    if (!uploadId || isNaN(chunkIndex) || isNaN(chunkStart)) {
      return res.status(400).json({ error: "Missing headers" });
    }

    const [uploadCheck] = await pool.query('SELECT file_size, status FROM uploads WHERE id = ?', [uploadId]);
    if (uploadCheck.length === 0) return res.status(404).json({ error: "Upload not found" });
    if (uploadCheck[0].status === 'COMPLETED') return res.json({ status: "ALREADY_COMPLETED" });

    const tempFile = path.join(TEMP_DIR, uploadId);
    if (!fsSync.existsSync(tempFile)) {
      const fd = fsSync.openSync(tempFile, 'w');
      fsSync.ftruncateSync(fd, uploadCheck[0].file_size);
      fsSync.closeSync(fd);
    }

    await new Promise((resolve, reject) => {
      const writeStream = fsSync.createWriteStream(tempFile, { flags: 'r+', start: chunkStart });
      writeStream.write(req.body);
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    await pool.query('UPDATE chunks SET status = "RECEIVED", received_at = NOW() WHERE upload_id = ? AND chunk_index = ?', [uploadId, chunkIndex]);
    res.json({ status: "CHUNK_RECEIVED" });

  } catch (err) {
    console.error(`Chunk ${chunkIndex} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/upload/finalize", async (req, res) => {
  const { uploadId } = req.body;

  if (finalizeLocks.has(uploadId)) {
     return res.json({ 
        status: "COMPLETED", 
        message: "File is already being processed in the background." 
     });
  }
  
  finalizeLocks.set(uploadId, Date.now());

  try {
    const [upload] = await pool.query('SELECT * FROM uploads WHERE id = ?', [uploadId]);
    if (upload.length === 0) throw new Error("Upload not found");

    const [chunks] = await pool.query('SELECT COUNT(*) as cnt FROM chunks WHERE upload_id = ? AND status = "RECEIVED"', [uploadId]);
    if (chunks[0].cnt !== upload[0].total_chunks) throw new Error("Not all chunks received");

    res.json({ 
        status: "COMPLETED", 
        message: "File uploaded successfully. Processing in background.",
        file_name: upload[0].file_name 
    });

    processFinalizationInBackground(uploadId, upload[0]);

  } catch (err) {
    finalizeLocks.delete(uploadId);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

async function processFinalizationInBackground(uploadId, uploadData) {
    try {
        const tempFile = path.join(TEMP_DIR, uploadId);
        const finalFile = path.join(UPLOADS_DIR, `${uploadId}_${uploadData.file_name}`);
 
        await moveFile(tempFile, finalFile);
        
        const hash = crypto.createHash('sha256');
        const stream = fsSync.createReadStream(finalFile);
        for await (const chunk of stream) hash.update(chunk);
        const finalHash = hash.digest('hex');

        let zipContents = [];
        if (uploadData.file_name.endsWith('.zip')) {
          await new Promise((resolve) => {
            yauzl.open(finalFile, { lazyEntries: true }, (err, zipfile) => {
              if (err || !zipfile) return resolve();
              zipfile.readEntry();
              zipfile.on('entry', (e) => { zipContents.push(e.fileName); if(zipContents.length < 20) zipfile.readEntry(); else zipfile.close(); });
              zipfile.on('end', resolve);
              zipfile.on('error', resolve);
            });
          });
        }

        await pool.query('UPDATE uploads SET status = "COMPLETED", final_hash = ? WHERE id = ?', [finalHash, uploadId]);
        console.log(`[Background] Finalization complete for ${uploadId}`);
    } catch (err) {
        console.error(`[Background] Failed for ${uploadId}:`, err);
        await pool.query('UPDATE uploads SET status = "FAILED" WHERE id = ?', [uploadId]);
    } finally {
        finalizeLocks.delete(uploadId);
    }
}

const shutdown = async () => {
  console.log('Server shutting down...');
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

initialize().then(() => app.listen(port, () => console.log(`🚀 Server on ${port}`)));