# 🎥 Real-Time Communication App

A production-grade video conferencing + collaboration tool built with **WebRTC**, **Socket.io**, and **Node.js**.

![Status](https://img.shields.io/badge/status-production--ready-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

### Video & Collaboration
- 🎥 Multi-user video calling (WebRTC mesh)
- 🖥️ Screen sharing
- ✏️ Shared whiteboard
- 💬 Real-time chat
- 📁 File sharing (up to 100 MB)
- 📊 Live polls
- 📝 Shared notes
- ✋ Raise hand
- 👍 Emoji reactions

### Advanced
- 📅 Scheduled + recurring meetings
- 🔔 Push notifications (5-min reminders)
- ⏱ Shared timer for agenda
- 🚪 Waiting room + host approval
- 🏢 Breakout rooms
- 📋 Meeting agenda
- 📝 Live transcription + download
- 🤖 AI meeting summary (extractive)
- 📊 Meeting analytics
- 🎛️ Host controls (mute-all, kick, lock)
- 🌗 Dark/Light theme
- ⌨️ Keyboard shortcuts (M/V/S/W/K/H)
- ⏺️ Local recording
- 📱 QR code for room sharing
- 🔐 Two-factor authentication (TOTP)

### Security
- 🔒 JWT with refresh token rotation
- 🛡️ Helmet.js with strict CSP
- 🚦 Multi-layer rate limiting
- 🧼 Input sanitization (Zod + custom)
- 📝 Audit logging
- 🔍 MIME magic-byte verification
- ✅ TLS 1.2+ with modern ciphers

## 🛠️ Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS, CSS3, HTML5 |
| Backend | Node.js, Express |
| Real-time | Socket.io, WebRTC |
| Auth | JWT + bcrypt + speakeasy |
| Database | SQLite (better-sqlite3) |
| Security | Helmet, rate-limit, Zod |

## 🚀 Quick Start

```bash
git clone https://github.com/Dinesh7124/CodaAlpha_Real-Time-Communication-App.git
cd CodaAlpha_Real-Time-Communication-App
npm install