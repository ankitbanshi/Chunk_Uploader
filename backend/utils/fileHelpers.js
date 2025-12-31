const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const yauzl = require("yauzl");
const pool = require("../config/db");

const UPLOADS_DIR = path.join(__dirname, "../uploads");
const TEMP_DIR = path.join(__dirname, "../temp");
const finalizeLocks = new Map();

async function moveFile(source, target) {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code === "EXDEV") {
      await fs.copyFile(source, target);
      await fs.unlink(source);
    } else {
      throw error;
    }
  }
}

async function processFinalizationInBackground(uploadId, uploadData) {
  try {
    const tempFile = path.join(TEMP_DIR, uploadId);
    const finalFile = path.join(
      UPLOADS_DIR,
      `${uploadId}_${uploadData.file_name}`
    );

    await moveFile(tempFile, finalFile);

    const hash = crypto.createHash("sha256");
    const stream = fsSync.createReadStream(finalFile);
    for await (const chunk of stream) hash.update(chunk);
    const finalHash = hash.digest("hex");

    let zipContents = [];
    if (uploadData.file_name.endsWith(".zip")) {
      await new Promise((resolve) => {
        yauzl.open(finalFile, { lazyEntries: true }, (err, zipfile) => {
          if (err || !zipfile) return resolve();
          zipfile.readEntry();
          zipfile.on("entry", (e) => {
            zipContents.push(e.fileName);
            if (zipContents.length < 20) zipfile.readEntry();
            else zipfile.close();
          });
          zipfile.on("end", resolve);
          zipfile.on("error", resolve);
        });
      });
    }

    await pool.query(
      'UPDATE uploads SET status = "COMPLETED", final_hash = ? WHERE id = ?',
      [finalHash, uploadId]
    );
    console.log(`[Background] Finalization complete for ${uploadId}`);
  } catch (err) {
    console.error(`[Background] Failed for ${uploadId}:`, err);
    await pool.query('UPDATE uploads SET status = "FAILED" WHERE id = ?', [
      uploadId,
    ]);
  } finally {
    finalizeLocks.delete(uploadId);
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
      } catch (err) {
        /* ignore */
      }
      await pool.query("DELETE FROM uploads WHERE id = ?", [upload.id]);
      console.log(`Cleaned up orphaned upload: ${upload.id}`);
    }
  } catch (err) {
    console.error(" Cleanup error:", err.message);
  }
}

module.exports = {
  UPLOADS_DIR,
  TEMP_DIR,
  finalizeLocks,
  moveFile,
  processFinalizationInBackground,
  cleanupOrphanedUploads,
};
