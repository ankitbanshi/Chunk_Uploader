import React from 'react';

export const SuccessModal = ({ data, onClose }) => (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-icon">🎉</div>
        <h2>Upload Successful!</h2>
        <p>{data.message}</p>
        <button className="btn btn-primary full-width" onClick={onClose}>
          OK - Upload Another
        </button>
      </div>
    </div>
);