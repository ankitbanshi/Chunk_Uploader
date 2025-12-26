import React, { useState, useRef, useCallback, useEffect } from "react";
import axios from "axios";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3002";
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT = 3;

function App() {
  const [showProgress, setShowProgress] = useState(false);
  const [globalProgress, setGlobalProgress] = useState(0);
  const [chunks, setChunks] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [speed, setSpeed] = useState(0);
  const [eta, setEta] = useState(0);
  const [fileName, setFileName] = useState("");
  const [successData, setSuccessData] = useState(null);

  const fileRef = useRef(null);
  const uploadIdRef = useRef(null);
  const activeUploadsRef = useRef(0);
  const startTimeRef = useRef(0);
  const uploadedBytesRef = useRef(0);
  const pausedRef = useRef(false);
  const finalizingRef = useRef(false); 
  const cancelTokensRef = useRef({}); 
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (chunks.length > 0 && !finalizingRef.current && !isPaused && isOnline) {
      const allSuccess = chunks.every(c => c.status === 'success');
      const hasErrors = chunks.some(c => c.status === 'error');
      
      if (allSuccess && !hasErrors) {
        finalizingRef.current = true;
        setGlobalProgress(100);
        finalizeUpload();
      }
    }
  }, [chunks, isPaused, isOnline]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (showProgress && !finalizingRef.current && !successData) {
        pausedRef.current = false;
        setIsPaused(false);
        processQueue(); 
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      pausedRef.current = true;
      setIsPaused(true);
      abortAllUploads();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showProgress, successData]);


  const abortAllUploads = () => {
    Object.values(cancelTokensRef.current).forEach(cancel => cancel("Paused/Offline"));
    cancelTokensRef.current = {};
    activeUploadsRef.current = 0;
  };

  const calculateFileHash = async (file) => {
    const buffer = await file.slice(0, 2 * 1024 * 1024).arrayBuffer(); 
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const resetState = useCallback(() => {
    setShowProgress(false);
    setGlobalProgress(0);
    setChunks([]);
    setIsPaused(false);
    setIsProcessing(false);
    setSuccessData(null);
    setFileName(""); 
    setSpeed(0);
    setEta(0);
    
    fileRef.current = null;
    uploadIdRef.current = null;
    activeUploadsRef.current = 0;
    uploadedBytesRef.current = 0;
    finalizingRef.current = false; 
    pausedRef.current = false;
    cancelTokensRef.current = {};
    
    if(fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const updateProgress = useCallback(() => {
    const file = fileRef.current;
    if (!file) return;

    let rawProgress = (uploadedBytesRef.current / file.size) * 100;
    const progress = Math.min(rawProgress, 99.9);
    setGlobalProgress(progress);

    const elapsed = (Date.now() - startTimeRef.current) / 1000; // in seconds
    if (elapsed > 0) {
      const currentSpeed = (uploadedBytesRef.current / (1024 * 1024)) / elapsed; // MB/s
      setSpeed(currentSpeed);
      
      const remainingBytes = file.size - uploadedBytesRef.current;
      const bytesPerSecond = uploadedBytesRef.current / elapsed;
      const currentEta = bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : 0;
      setEta(currentEta);
    }
  }, []);

  const finalizeUpload = useCallback(async () => {
    const currentUploadId = uploadIdRef.current;
    if (!currentUploadId) return;
    
    setIsProcessing(true);
    
    try {
      const { data } = await axios.post(`${BACKEND_URL}/upload/finalize`, {
        uploadId: currentUploadId
      }); 
      
      if (uploadIdRef.current !== currentUploadId) return;

      setSuccessData(data);
      setIsProcessing(false);

    } catch (err) {
      if (uploadIdRef.current === currentUploadId) {
        alert(`Finalization request failed. Please check network.`);
        finalizingRef.current = false; 
        setIsProcessing(false);
      }
    }
  }, []);

  const processQueue = useCallback(() => {
    if (pausedRef.current || finalizingRef.current || !navigator.onLine) return;

    setChunks(prevChunks => {
      const freeSlots = MAX_CONCURRENT - activeUploadsRef.current;
      if (freeSlots <= 0) return prevChunks;

      const pendingChunks = prevChunks.filter(c => c.status === 'pending');
      const chunksToStart = pendingChunks.slice(0, freeSlots);

      chunksToStart.forEach(chunk => uploadChunk(chunk));

      return prevChunks;
    });
  }, []);

  const uploadChunk = async (chunk) => {
    if (pausedRef.current || finalizingRef.current) return;

    activeUploadsRef.current++;
    const controller = new AbortController();
    cancelTokensRef.current[chunk.index] = controller.abort.bind(controller);

    setChunks(prev => {
        const newChunks = [...prev];
        newChunks[chunk.index] = { ...newChunks[chunk.index], status: 'uploading' };
        return newChunks;
    });

    try {
      const blob = fileRef.current.slice(chunk.start, chunk.end);
      
      await axios.post(`${BACKEND_URL}/upload/chunk`, blob, {
        headers: {
          "x-upload-id": uploadIdRef.current,
          "x-chunk-index": chunk.index,
          "x-chunk-start": chunk.start,
          "Content-Type": "application/octet-stream"
        },
        signal: controller.signal, 
        timeout: 45000 
      });

      delete cancelTokensRef.current[chunk.index];
      
      setChunks(prev => {
        const updated = [...prev];
        updated[chunk.index] = { ...updated[chunk.index], status: 'success' };
        
        const totalUploaded = updated
          .filter(c => c.status === 'success')
          .reduce((acc, c) => acc + c.size, 0);
        uploadedBytesRef.current = totalUploaded;
        return updated;
      });

      updateProgress();

    } catch (error) {
      delete cancelTokensRef.current[chunk.index];
      const isCancel = axios.isCancel(error);
      
      setChunks(prev => {
        const updated = [...prev];
        updated[chunk.index] = { 
            ...updated[chunk.index], 
            status: isCancel ? 'pending' : 'error' 
        };
        return updated;
      });
    } finally {
      activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
      processQueue();
    }
  };

  const getFileContext = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert("Please select a ZIP file");
      return;
    }

    resetState();
    setFileName(file.name);
    setShowProgress(true);
    fileRef.current = file;
    startTimeRef.current = Date.now(); 

    try {
      const fileHash = await calculateFileHash(file);
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      const { data } = await axios.get(`${BACKEND_URL}/upload/status`, {
        params: { fileHash, fileName: file.name, fileSize: file.size }
      });

      uploadIdRef.current = data.uploadId;
      const completed = data.completedChunks || [];

      const initialChunks = Array.from({ length: totalChunks }, (_, i) => {
        const isDone = completed.some(c => (typeof c === 'number' ? c === i : c.index === i));
        return {
          index: i,
          status: isDone ? 'success' : 'pending',
          start: i * CHUNK_SIZE,
          end: Math.min((i + 1) * CHUNK_SIZE, file.size),
          size: Math.min((i + 1) * CHUNK_SIZE, file.size) - (i * CHUNK_SIZE)
        };
      });

      setChunks(initialChunks);
      
      uploadedBytesRef.current = initialChunks
        .filter(c => c.status === 'success')
        .reduce((acc, c) => acc + c.size, 0);
      
      setGlobalProgress((uploadedBytesRef.current / file.size) * 100);

      setTimeout(processQueue, 100);
      
    } catch (err) {
      alert(`Initialization failed: ${err.message}`);
      resetState();
    }
  };

  const togglePause = () => {
    if (pausedRef.current) {
      pausedRef.current = false;
      setIsPaused(false);
      processQueue();
    } else {
      pausedRef.current = true;
      setIsPaused(true);
      abortAllUploads();
    }
  };
  
  const handleUploadClick = () => {
    if(fileInputRef.current) fileInputRef.current.click();
  };

  const completedCount = chunks.filter(c => c.status === 'success').length;
  const hasErrors = chunks.some(c => c.status === 'error');

  return (
    <div className="app-container">
      <div className="upload-wrapper">
        <h1 className="title">Chunk Uploader</h1>
        <p className="subtitle">Resilient, Resume-capable, Fast</p>
        
        {!isOnline && (
            <div className="offline-banner">No Internet - Paused</div>
        )}

        <div className="file-input-group">
          <input
            ref={fileInputRef}
            type="file"
            onChange={getFileContext}
            disabled={showProgress && !isPaused}
            accept=".zip"
            style={{ display: 'none' }} 
          />

          <div 
            className={`upload-box ${showProgress && !isPaused ? 'disabled' : ''}`}
            onClick={handleUploadClick}
          >
             <div className="upload-icon">📂</div>
             <p className="upload-text">
                {fileName ? (
                    <span className="selected-file">{fileName}</span>
                ) : (
                    "Click to Browse or Drag ZIP file here"
                )}
             </p>
          </div>
        </div>

        {showProgress ? (
          <div className="progress-section">
            <div className="progress-header">
              <h3>
                {isProcessing ? (
                    <span className="pulsing-text">⚙️ Finalizing...</span>
                ) : isPaused ? "Paused" : "Uploading..."}
              </h3>
              
              <div className="stats-text">
                 <span>{completedCount} / {chunks.length} chunks</span>
                 <span className="divider">|</span>
                 <span className="percent">{globalProgress.toFixed(1)}%</span>
              </div>
            </div>
            
            <div className="progress-bar-container">
              <div 
                className={`progress-bar ${!isPaused && isOnline && !isProcessing ? 'animated' : ''}`}
                style={{ width: `${globalProgress}%`, opacity: isPaused ? 0.6 : 1 }}
              ></div>
            </div>

            {/* --- METRICS GRID --- */}
            <div className="metrics-grid">
              <div className="metric-card">
                  <div className="metric-label">Speed</div>
                  <div className="metric-value">{speed.toFixed(1)} <small>MB/s</small></div>
              </div>
              <div className="metric-card">
                  <div className="metric-label">ETA</div>
                  <div className="metric-value">{Math.round(eta)} <small>s</small></div>
              </div>
              <div className="metric-card">
                  <div className="metric-label">Active</div>
                  <div className="metric-value">{activeUploadsRef.current}</div>
              </div>
            </div>
            {/* ----------------------------- */}

            <div className="controls">
              <button 
                className={`btn ${isPaused ? 'btn-success' : 'btn-warning'}`}
                onClick={togglePause}
                disabled={isProcessing || !isOnline}
              >
                {isPaused ? "▶ Resume" : "⏸ Pause"}
              </button>
              
              <button className="btn btn-secondary" onClick={resetState}>Cancel</button>

              {hasErrors && (
                 <button className="btn btn-danger" onClick={processQueue}>
                   Retry Errors
                 </button>
              )}
            </div>

            <div className="chunk-section">
                <div className="chunk-grid">
                {chunks.map((chunk) => (
                    <div
                    key={chunk.index}
                    className="chunk-cell"
                    style={{
                        backgroundColor: 
                            chunk.status === 'success' ? '#10b981' : 
                            chunk.status === 'uploading' ? '#6366f1' : 
                            chunk.status === 'error' ? '#ef4444' : '#e2e8f0'
                    }}
                    title={`Chunk ${chunk.index}`}
                    />
                ))}
                </div>
            </div>
          </div>
        ) : (
          <div className="placeholder-spacer"></div>
        )}
      </div>

      {successData && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-icon">🎉</div>
            <h2>Upload Successful!</h2>
            <p>{successData.message || "Your file has been uploaded."}</p>
            
            <div className="modal-details">
                {successData.hash && (
                     <p><strong>Hash:</strong> {successData.hash.substring(0, 15)}...</p>
                )}
                {successData.zipContents && (
                     <p><strong>Files in Zip:</strong> {successData.zipContents.length}</p>
                )}
                {!successData.hash && (
                     <p style={{fontSize: '0.9em', color: '#666', marginTop: '10px'}}>
                        <em>File processing continues in the background.</em>
                     </p>
                )}
            </div>

            <button className="btn btn-primary full-width" onClick={resetState}>
              OK - Upload Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;