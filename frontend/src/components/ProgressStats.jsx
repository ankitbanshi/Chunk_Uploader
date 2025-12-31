import React from 'react';

export const ProgressStats = ({ progress, speed, eta, status, onPause, onResume, onCancel, isOnline,activeCount }) => (
  <div className="progress-section">
    <div className="progress-header">
       <h3>
         {!isOnline ? "⚠️ No Internet Connection" : 
          status === "FINALIZING" ? "⚙️ Finalizing..." : 
          status === "PAUSED" ? "Paused" : "Uploading..."}
       </h3>
       <span className="percent">{progress.toFixed(1)}%</span>
    </div>
    
    <div className="progress-bar-container">
      <div 
        className={`progress-bar ${status === 'UPLOADING' ? 'animated' : ''}`}
        style={{ width: `${progress}%`, opacity: status === 'PAUSED' || !isOnline ? 0.6 : 1 }}
      ></div>
    </div>

    <div className="metrics-grid">
       <div className="metric-card">
           <div className="metric-label">Speed</div>
           <div className="metric-value">{speed.toFixed(1)} MB/s</div>
       </div>
       <div className="metric-card">
           <div className="metric-label">ETA</div>
           <div className="metric-value">{Math.round(eta)} s</div>
       </div>
       <div className="metric-card">
           <div className="metric-label">Active</div>
           <div className="metric-value">{activeCount} / 3</div>
       </div>
    </div>

    <div className="controls">
       {status === "PAUSED" ? (
          <button 
            className="btn btn-success" 
            onClick={onResume}
            disabled={!isOnline} // <--- Button is grayed out if offline
            title={!isOnline ? "Waiting for connection..." : "Resume Upload"}
          >
            {isOnline ? "▶ Resume" : "⏳ Waiting..."}
          </button>
       ) : (
          <button className="btn btn-warning" onClick={onPause} disabled={status !== "UPLOADING"}>⏸ Pause</button>
       )}
       <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
    </div>
  </div>
);