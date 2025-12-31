const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../config/db");
const {
  TEMP_DIR,
  finalizeLocks,
  processFinalizationInBackground,
} = require("../utils/fileHelpers");

exports.checkStatus = async (req, res) => {
  try {
    const { fileHash, fileName, fileSize } = req.query;
    if (!fileHash || !fileName || !fileSize)
      return res.status(400).json({ error: "Missing params" });

    const totalChunks = Math.ceil(parseInt(fileSize) / (5 * 1024 * 1024));

    const [existing] = await pool.query(
      'SELECT id, status FROM uploads WHERE file_hash = ? AND file_size = ? AND status != "COMPLETED"',
      [fileHash, fileSize]
    );

    if (existing.length > 0) {
      const upload = existing[0];

      if (!fsSync.existsSync(path.join(TEMP_DIR, upload.id))) {
        await pool.query("DELETE FROM uploads WHERE id = ?", [upload.id]);
      } else {
        const [chunks] = await pool.query(
          'SELECT chunk_index FROM chunks WHERE upload_id = ? AND status = "RECEIVED"',
          [upload.id]
        );
        return res.json({
          uploadId: upload.id,
          completedChunks: chunks.map((c) => c.chunk_index),
          status: upload.status,
        });
      }
    }
    const uploadId = crypto.randomBytes(16).toString("hex");
    await pool.query(
      "INSERT INTO uploads (id, file_name, file_hash, file_size, total_chunks) VALUES (?, ?, ?, ?, ?)",
      [uploadId, fileName, fileHash, fileSize, totalChunks]
    );

    const chunkSize = 5 * 1024 * 1024;
    const chunkValues = Array.from({ length: totalChunks }, (_, i) => {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize, parseInt(fileSize));
      return [uploadId, i, end - start];
    });
    await pool.query(
      "INSERT INTO chunks (upload_id, chunk_index, chunk_size) VALUES ?",
      [chunkValues]
    );

    res.json({ uploadId, completedChunks: [], status: "NEW" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.receiveChunk = async (req, res) => {
  const uploadId = req.headers["x-upload-id"];
  const chunkIndex = Number(req.headers["x-chunk-index"]);
  const chunkStart = Number(req.headers["x-chunk-start"]);

  try {
    if (!uploadId || isNaN(chunkIndex) || isNaN(chunkStart)) {
      return res.status(400).json({ error: "Missing headers" });
    }

    const [uploadCheck] = await pool.query(
      "SELECT file_size, status FROM uploads WHERE id = ?",
      [uploadId]
    );
    if (uploadCheck.length === 0)
      return res.status(404).json({ error: "Upload not found" });

    if (uploadCheck[0].status === "COMPLETED")
      return res.json({ status: "ALREADY_COMPLETED" });

    const tempFile = path.join(TEMP_DIR, uploadId);

    if (!fsSync.existsSync(tempFile)) {
      const fd = fsSync.openSync(tempFile, "w");
      fsSync.ftruncateSync(fd, uploadCheck[0].file_size);
      fsSync.closeSync(fd);
    }

    await new Promise((resolve, reject) => {
      const writeStream = fsSync.createWriteStream(tempFile, {
        flags: "r+",
        start: chunkStart,
      });
      writeStream.write(req.body);
      writeStream.end();
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    await pool.query(
      'UPDATE chunks SET status = "RECEIVED", received_at = NOW() WHERE upload_id = ? AND chunk_index = ?',
      [uploadId, chunkIndex]
    );
    res.json({ status: "CHUNK_RECEIVED" });
  } catch (err) {
    console.error(`Chunk ${chunkIndex} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.finalizeUpload = async (req, res) => {
  const { uploadId } = req.body;

  if (finalizeLocks.has(uploadId)) {
    return res.json({
      status: "COMPLETED",
      message: "File is already being processed in the background.",
    });
  }

  finalizeLocks.set(uploadId, Date.now());

  try {
    const [upload] = await pool.query("SELECT * FROM uploads WHERE id = ?", [
      uploadId,
    ]);
    if (upload.length === 0) throw new Error("Upload not found");

    const [chunks] = await pool.query(
      'SELECT COUNT(*) as cnt FROM chunks WHERE upload_id = ? AND status = "RECEIVED"',
      [uploadId]
    );
    if (chunks[0].cnt !== upload[0].total_chunks)
      throw new Error("Not all chunks received");

    res.json({
      status: "COMPLETED",
      message: "File uploaded successfully. Processing in background.",
      file_name: upload[0].file_name,
    });

    processFinalizationInBackground(uploadId, upload[0]);
  } catch (err) {
    finalizeLocks.delete(uploadId);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};
