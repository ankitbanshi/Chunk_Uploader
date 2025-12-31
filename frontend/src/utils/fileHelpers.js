const CHUNK_SIZE = 5 * 1024 * 1024;
export const calculateFileHash = async (file) => {
  const buffer = await file.slice(0, 2 * 1024 * 1024).arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const createChunkMap = (fileSize, completedIndices = []) => {
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  return Array.from({ length: totalChunks }, (_, i) => {
    const isDone = completedIndices.includes(i);
    return {
      index: i,
      status: isDone ? "success" : "pending",
      start: i * CHUNK_SIZE,
      end: Math.min((i + 1) * CHUNK_SIZE, fileSize),
      size: Math.min((i + 1) * CHUNK_SIZE, fileSize) - i * CHUNK_SIZE,
    };
  });
};
