import React, { useRef } from 'react';

export const UploadBox = ({ onFileSelect, disabled, fileName }) => {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
    // FIX: Clear the input value so the same file can be selected again
    e.target.value = null; 
  };

  return (
    <div className="file-input-group">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        disabled={disabled}
        accept=".zip"
        style={{ display: 'none' }} 
      />
      <div 
        className={`upload-box ${disabled ? 'disabled' : ''}`}
        onClick={() => fileInputRef.current.click()}
      >
          <div className="upload-icon">📂</div>
          <p className="upload-text">
             {fileName ? <span className="selected-file">{fileName}</span> : "Click to Browse or Drag ZIP file"}
          </p>
      </div>
    </div>
  );
};