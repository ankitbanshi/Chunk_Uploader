const express = require("express");
const router = express.Router();
const uploadController = require("../controllers/uploadController");

router.get("/status", uploadController.checkStatus);
router.post("/chunk", uploadController.receiveChunk);
router.post("/finalize", uploadController.finalizeUpload);

module.exports = router;
