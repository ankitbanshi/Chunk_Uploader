import { useState, useRef, useCallback, useEffect } from "react";
import axios from "axios";
import { uploadService } from "../api/uploadService";
import { calculateFileHash, createChunkMap } from "../utils/fileHelpers";

const MAX_CONCURRENT = 3;

export function useChunkUpload() {
  const [chunks, setChunks] = useState([]);
  const [globalProgress, setGlobalProgress] = useState(0);
  const [status, setStatus] = useState("IDLE"); 
  const [metrics, setMetrics] = useState({ speed: 0, eta: 0 });
  const [successData, setSuccessData] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const statusRef = useRef("IDLE");
  const fileRef = useRef(null);
  const uploadIdRef = useRef(null);
  const activeUploadsRef = useRef(0);
  const startTimeRef = useRef(0);
  const uploadedBytesRef = useRef(0);
  const cancelTokensRef = useRef({});

  const setStatusSafe = (newStatus) => {
      setStatus(newStatus);
      statusRef.current = newStatus;
  };

  // -- Helpers --
  const updateMetrics = () => {
    if(!fileRef.current) return;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    if (elapsed > 0) {
      const currentSpeed = (uploadedBytesRef.current / (1024 * 1024)) / elapsed;
      const remainingBytes = fileRef.current.size - uploadedBytesRef.current;
      const currentEta = (uploadedBytesRef.current / elapsed) > 0 ? remainingBytes / (uploadedBytesRef.current / elapsed) : 0;
      setMetrics({ speed: currentSpeed, eta: currentEta });
    }
    setGlobalProgress(Math.min((uploadedBytesRef.current / fileRef.current.size) * 100, 99.9));
  };

  const finalizeUpload = useCallback(async () => {
      setStatusSafe("FINALIZING");
      try {
          const { data } = await uploadService.finalize(uploadIdRef.current);
          setSuccessData(data);
          setGlobalProgress(100);
          setStatusSafe("COMPLETED");
      } catch (err) {
          alert("Finalization failed. Check connection and retry.");
          setStatusSafe("ERROR");
      }
  }, []);

  const processQueue = useCallback(() => {
    if (statusRef.current === "PAUSED" || statusRef.current === "FINALIZING" || !fileRef.current) return;
    
    setChunks(currentChunks => {
        const allSuccess = currentChunks.every(c => c.status === 'success');
        if (allSuccess && currentChunks.length > 0) {
            finalizeUpload();
            return currentChunks;
        }

        // --- FIX 1: Prevent negative overflow logic ---
        const currentActive = Math.max(0, activeUploadsRef.current);
        const freeSlots = MAX_CONCURRENT - currentActive;
        
        if (freeSlots <= 0) return currentChunks;

        const pending = currentChunks.filter(c => c.status === 'pending');
        pending.slice(0, freeSlots).forEach(c => uploadChunk(c));
        
        return currentChunks;
    });
  }, [finalizeUpload]); 

  const pause = useCallback(() => {
      console.log("Pausing Uploads...");
      setStatusSafe("PAUSED");
      
      // Abort active requests
      Object.values(cancelTokensRef.current).forEach(abort => abort());
      cancelTokensRef.current = {};
      
      // --- FIX 2: REMOVED forced reset to 0. 
      // We let the 'finally' block decrements handle this naturally to avoid negative numbers.
  }, []);

  const uploadChunk = async (chunk) => {
    if (statusRef.current === "PAUSED" || statusRef.current === "FINALIZING") return;

    activeUploadsRef.current++;
    
    setChunks(prev => {
        const copy = [...prev];
        copy[chunk.index] = { ...copy[chunk.index], status: 'uploading' };
        return copy;
    });

    try {
      const blob = fileRef.current.slice(chunk.start, chunk.end);
      const headers = {
        "x-upload-id": uploadIdRef.current,
        "x-chunk-index": chunk.index,
        "x-chunk-start": chunk.start,
        "Content-Type": "application/octet-stream"
      };

      await uploadService.uploadChunk(blob, headers, (controller) => {
          cancelTokensRef.current[chunk.index] = controller.abort.bind(controller);
      });

      delete cancelTokensRef.current[chunk.index];

      setChunks(prev => {
        const copy = [...prev];
        copy[chunk.index] = { ...copy[chunk.index], status: 'success' };
        uploadedBytesRef.current = copy
            .filter(c => c.status === 'success')
            .reduce((acc, c) => acc + c.size, 0);
        return copy;
      });
      
      updateMetrics();

    } catch (error) {
       delete cancelTokensRef.current[chunk.index];
       
       if (error.code === "ERR_NETWORK" || error.message === "Network Error") {
           console.log("Network error detected. Forcing Pause.");
           pause();
           setChunks(prev => {
               const copy = [...prev];
               copy[chunk.index] = { ...copy[chunk.index], status: 'pending' };
               return copy;
           });
           return;
       }

       setChunks(prev => {
           const copy = [...prev];
           const newStatus = axios.isCancel(error) ? 'pending' : 'error';
           copy[chunk.index] = { ...copy[chunk.index], status: newStatus };
           return copy;
       });

    } finally {
      // --- FIX 3: Safe Decrement (Never goes below 0) ---
      activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
      
      setTimeout(() => {
          if (statusRef.current === 'UPLOADING') processQueue(); 
      }, 0);
    }
  };

  const resume = useCallback(() => {
      if (!navigator.onLine) {
          alert("Cannot resume: No Internet Connection");
          return;
      }

      setStatusSafe("UPLOADING");
      
      // Reset stuck chunks to pending
      setChunks(prev => prev.map(c => {
          if (c.status === 'error' || c.status === 'uploading') {
              return { ...c, status: 'pending' };
          }
          return c;
      }));

      // --- FIX 4: Hard Reset Count ---
      // Since we just visually reset all 'uploading' chunks to 'pending',
      // we can safely guarantee there are 0 active uploads right now.
      activeUploadsRef.current = 0;

      setTimeout(processQueue, 500); 
  }, [processQueue]);

  const reset = useCallback(() => {
      pause();
      
      // Clear Refs
      fileRef.current = null;
      uploadIdRef.current = null;
      activeUploadsRef.current = 0;
      startTimeRef.current = 0;
      uploadedBytesRef.current = 0;
      cancelTokensRef.current = {};

      // Clear State
      setStatusSafe("IDLE");
      setChunks([]);
      setGlobalProgress(0);
      setSuccessData(null);
      setMetrics({ speed: 0, eta: 0 });
      setIsOnline(navigator.onLine);
      
  }, [pause]);

  const startUpload = useCallback(async (file) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
        alert("Only ZIP files allowed");
        return;
    }
    
    fileRef.current = file;
    setStatusSafe("HASHING");
    startTimeRef.current = Date.now();

    try {
        const fileHash = await calculateFileHash(file);
        const { data } = await uploadService.checkStatus({ 
            fileHash, fileName: file.name, fileSize: file.size 
        });

        uploadIdRef.current = data.uploadId;
        const initialChunks = createChunkMap(file.size, data.completedChunks || []);
        
        setChunks(initialChunks);
        uploadedBytesRef.current = initialChunks
            .filter(c => c.status === 'success')
            .reduce((acc, c) => acc + c.size, 0);
        
        setStatusSafe("UPLOADING");
        setTimeout(processQueue, 100);

    } catch (err) {
        console.error(err);
        setStatusSafe("ERROR");
    }
  }, [processQueue]);

  useEffect(() => {
      const handleOffline = () => {
          setIsOnline(false);
          pause();
      };

      const handleOnline = () => {
          setIsOnline(true);
          setTimeout(resume, 2000);
      };

      window.addEventListener('offline', handleOffline);
      window.addEventListener('online', handleOnline);

      return () => {
          window.removeEventListener('offline', handleOffline);
          window.removeEventListener('online', handleOnline);
      };
  }, [pause, resume]);

  // -- CALCULATE ACTIVE COUNT FOR UI --
  const activeCount = chunks.filter(c => c.status === 'uploading').length;

  return {
    chunks,
    status,
    progress: globalProgress,
    metrics,
    successData,
    startUpload,
    pause,
    resume,
    reset,
    fileName: fileRef.current?.name,
    isOnline,
    activeCount
  };
}