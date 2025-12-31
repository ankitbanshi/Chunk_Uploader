const express = require("express");
const cors = require("cors");
const initialize = require("./utils/bootstrap");
const { cleanupOrphanedUploads, finalizeLocks } = require("./utils/fileHelpers");
const uploadRoutes = require("./routes/uploadRoutes");
const pool = require("./config/db");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3002;

app.use(express.json());
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' })); 
app.use(cors({ origin: "*" }));

app.get("/", (req, res) => res.json({ status: "Running" }));
app.use("/upload", uploadRoutes);

setInterval(cleanupOrphanedUploads, 60 * 60 * 1000);
setInterval(() => {
  const now = Date.now();
  for (const [id, time] of finalizeLocks) {
    if (now - time > 10 * 60 * 1000) finalizeLocks.delete(id);
  }
}, 60 * 1000);

const shutdown = async () => {
  console.log('Server shutting down...');
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

initialize().then(() => {
    app.listen(port, () => console.log(`Server is running on port: ${port}`));
});