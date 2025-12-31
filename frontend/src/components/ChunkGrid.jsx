export const ChunkGrid = ({ chunks }) => (
  <div className="chunk-section">
    <div className="chunk-grid">
      {chunks.map((chunk) => (
        <div
          key={chunk.index}
          className="chunk-cell"
          style={{
            backgroundColor:
              chunk.status === "success"
                ? "#10b981"
                : chunk.status === "uploading"
                ? "#6366f1"
                : chunk.status === "error"
                ? "#ef4444"
                : "#e2e8f0",
          }}
          title={`Chunk ${chunk.index}`}
        />
      ))}
    </div>
  </div>
);
