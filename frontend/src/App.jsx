import React from "react";
import { useChunkUpload } from "./hooks/useChunkUpload";
import { UploadBox } from "./components/UploadBox";
import { ProgressStats } from "./components/ProgressStats";
import { ChunkGrid } from "./components/ChunkGrid";
import { SuccessModal } from "./components/SuccessModal";
import "./App.css";

function App() {
  const {
    startUpload,
    pause,
    resume,
    reset,
    status,
    chunks,
    progress,
    metrics,
    successData,
    fileName,
    isOnline,
    activeCount
  } = useChunkUpload();

  return (
    <div className="app-container">
      <div className="upload-wrapper">
        <h1 className="title">Chunk Uploader</h1>
        <p className="subtitle">Resilient, Resume-capable, Fast</p>

        <UploadBox
          onFileSelect={startUpload}
          disabled={status === "UPLOADING" || status === "FINALIZING"}
          fileName={fileName}
        />

        {status !== "IDLE" && status !== "HASHING" && (
          <>
            <ProgressStats
              progress={progress}
              speed={metrics.speed}
              eta={metrics.eta}
              status={status}
              onPause={pause}
              onResume={resume}
              onCancel={reset}
              isOnline={isOnline}
              activeCount={activeCount}
            />
            <ChunkGrid chunks={chunks} />
          </>
        )}
      </div>

      {successData && <SuccessModal data={successData} onClose={reset} />}
    </div>
  );
}

export default App;
