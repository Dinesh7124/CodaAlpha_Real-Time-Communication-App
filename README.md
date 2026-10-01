# 🎥 Real-Time Communication App

A production-grade video conferencing + collaboration tool built with **WebRTC**, **Socket.io**, and **Node.js**.

![Status](https://img.shields.io/badge/status-production--ready-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features (30+)

### Video & Collaboration
- 🎥 Multi-user video calling (WebRTC mesh)
- 🖥️ Screen sharing with replaceTrack
- ✏️ Shared real-time whiteboard
- 💬 Live chat with rate limiting
- 📁 File sharing up to 100 MB with progress bar
- 📊 Live polls
- 📝 Shared notes
- ✋ Raise hand + emoji reactions

### Meeting Management
- 📅 Scheduled + recurring meetings (daily/weekly/monthly)
- 🔔 Push notifications (5-min reminders)
- ⏱ Shared timer for agenda
- 🚪 Waiting room with host approval
- 🏢 Breakout rooms
- 📋 Meeting agenda builder
- 🎛️ Host controls (mute-all, kick, lock)
- 🌗 Dark/Light theme
- ⌨️ Keyboard shortcuts (M/V/S/W/K/H)
- ⏺️ Local recording (MediaRecorder)
- 📱 QR code for room sharing

### Advanced
- 📝 Live transcription (Web Speech API)
- 🤖 AI meeting summary (extractive summarization)
- 📊 Meeting analytics (duration, participants, activity)
- 🔐 Two-factor authentication (TOTP)
- 📧 Calendar invite (.ics export)

### Security
- 🔒 JWT with refresh token rotation
- 🛡️ Helmet.js with strict CSP
- 🚦 Multi-layer rate limiting (REST + Socket.io)
- 🧼 Input sanitization (Zod + custom helpers)
- 📝 Comprehensive audit logging
- 🔍 File upload MIME verification (magic bytes)
- ✅ TLS 1.2+ with modern ciphers
- 🚫 SQL injection prevention (parameterized queries)
- 🔐 XSS-safe rendering (textContent)
- 🚦 Account lockout after failed logins

## 🛠️ Tech Stack

| Layer | Tech |
|---|---|
| **Frontend** | Vanilla JS (ES modules), CSS3, HTML5 |
| **Backend** | Node.js, Express |
| **Real-time** | Socket.io, WebRTC |
| **Auth** | JWT + bcrypt + speakeasy (2FA) |
| **Database** | SQLite (better-sqlite3) |
| **Security** | Helmet, express-rate-limit, Zod |
| **Deploy** | Cloudflare Tunnel |

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Git
- Chrome/Edge (for captions feature)

### Installation

```bash
git clone https://github.com/Dinesh7124/CodaAlpha_Real-Time-Communication-App.git
cd CodaAlpha_Real-Time-Communication-App
npm install