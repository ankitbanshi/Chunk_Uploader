#  Resilient Chunked File Uploader

A robust, production-ready file uploader built with **React**, **Node.js**, and **MySQL**. It supports **chunked uploads**, **automatic retries**, **pause/resume capabilities**, and **resiliency** against network failures and server crashes.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue)
![Status](https://img.shields.io/badge/status-stable-green)

---

## ✨ Features

- **Chunked Uploading**: Splits large files (ZIPs) into 5MB chunks to bypass server limits and ensure reliability.
- **Pause & Resume**: Stop uploads and resume exactly where you left off, even after a page refresh.
- **Fault Tolerance**: Automatically retries failed chunks and handles network interruptions gracefully.
- **Concurrent Uploading**: Uploads 3 chunks in parallel for maximum speed.
- **Data Integrity**: Verifies SHA-256 hashes on both client and server to ensure file corruption protection.
- **Dockerized**: Full `docker-compose` setup for one-command deployment.
- **Cross-Volume Support**: Handles file moves across Docker volumes gracefully (fixes `EXDEV` errors).

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React (Vite)
- **Styling**: CSS3 (Responsive)
- **HTTP Client**: Axios (with AbortController for cancellation)

### Backend
- **Runtime**: Node.js (Express)
- **Database**: MySQL (using `mysql2` with connection pooling)
- **File Handling**: Native `fs` streams & `yauzl` for ZIP inspection.

---

## 🚀 Getting Started (Docker)

The easiest way to run the application is using Docker Compose.

### Prerequisites
- Docker & Docker Compose installed.

### Steps
1. **Clone the repository:**
   ```bash
   git clone [https://github.com/ankitbanshi/Chunk_Uploader.git](https://github.com/ankitbanshi/Chunk_Uploader.git)
   cd chunk-uploader
2. **Run with Docker Compose:**
    docker-compose up --build
Access the App:
Frontend: http://localhost:5173
Backend: http://localhost:3002
Database: Port 3306 (Internal)

⚙️ Manual Setup (Local Development)If you prefer running without Docker:
1. **Database Setup**
Ensure you have a MySQL instance running.
-- CREATE DATABASE chunked_upload_db;
-- The backend will automatically create tables on startup.
2. **backend Setup**
cd backend
npm install
Create a .env file in the backend folder:Code snippetPORT=3002
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=chunked_upload_db
Start the server:node server.js
3. **Frontend Setup**
cd frontend
npm install
Create a .env file in the frontend folder:
Code snippetVITE_BACKEND_URL=http://localhost:3002
Start the client:npm run dev
📡 API Endpoints
Method               Endpoint                  Description
GET                /upload/status        Checks if a file has been partially uploaded. Returns missing chunk indexes.
POST               /upload/chunk         Receives a binary chunk. Headers: x-upload-id, x-chunk-index, x-chunk-start.
POST               /upload/finalize      Triggered when all chunks are sent. Reassembles the file and verifies hash.


📂 Project Structure
chunk-uploader/
├── docker-compose.yml       # Orchestration
├── backend/
│   ├── index.js             # Main server logic
│   ├── Dockerfile
│   ├── uploads/             # Final assembled files
│   └── temp/                # Temporary partial chunks
└── frontend/
    ├── src/
    │   ├── App.jsx          # Main UI & Upload Logic
    │   └── App.css          # Styling
    └── Dockerfile
🐛 TroubleshootingCommon Issues
1. EXDEV:cross-device link not permitted
- Cause: Docker volumes for /temp and /uploads are on different virtual filesystems.
- Fix: The backend uses a custom moveFile helper that detects this error and automatically switches to a "Copy & Delete" strategy.
 2. 409 Conflict on Finalization
- Cause: The frontend sends the "Finalize" request multiple times.
- Fix: The backend is idempotent; it detects if a file is already being processed and returns a 200 OK success message instead of an error.
3. Database Connection Failed
-Fix: Ensure the DB_HOST in .env matches your setup. Use localhost for manual runs and chunk_db (service name) for Docker.


