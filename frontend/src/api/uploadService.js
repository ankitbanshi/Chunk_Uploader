import axios from "axios";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3002";

export const uploadService = {
  checkStatus: (params) =>
    axios.get(`${BACKEND_URL}/upload/status`, { params }),

  uploadChunk: (blob, headers, onCancel) => {
    const controller = new AbortController();
    onCancel(controller);
    return axios.post(`${BACKEND_URL}/upload/chunk`, blob, {
      headers,
      signal: controller.signal,
      timeout: 45000,
    });
  },

  finalize: (uploadId) =>
    axios.post(`${BACKEND_URL}/upload/finalize`, { uploadId }),
};
