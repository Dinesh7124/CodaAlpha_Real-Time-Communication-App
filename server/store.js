'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const LOGICAL_W = 1600;
const LOGICAL_H = 900;
const EMPTY_ROOM_TTL = 2 * 60 * 60 * 1000;

const rooms = new Map();
const files = new Map();

function newId(bytes = 4) {
  return crypto.randomBytes(bytes).toString('hex');
}

/* ---------------- rooms ---------------- */

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    ownerName: room.ownerName,
    locked: room.locked,
    hasPassword: Boolean(room.passwordHash),
    waitingRoom: Boolean(room.waitingRoom),
    createdAt: room.createdAt,
    participants: room.members.size,
  };
}

async function createRoom(user, name, password) {
  let id = newId();
  while (rooms.has(id)) id = newId();

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;

  const room = {
    id,
    name: (name && String(name).trim()) || `${user.name}'s room`,
    ownerId: user.id,
    ownerName: user.name,
    passwordHash,
    locked: false,
    waitingRoom: false,
    breakouts: new Map(),
    timer: null,
    attendanceLog: [],
    moderators: new Set(),
    agenda: [],
    transcript: [],
    createdAt: Date.now(),
    emptySince: Date.now(),
    members: new Map(),
    strokes: [],
    files: [],
    messages: [],
    polls: [],
    notes: '',
    raisedHands: new Set(),
  };

  rooms.set(id, room);

  try {
    db.prepare(
      'INSERT INTO rooms (id, name, owner_id, password_hash, locked, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(id, room.name, user.id, passwordHash, room.createdAt);
  } catch { /* non-fatal */ }

  return publicRoom(room);
}

function getRoom(id) {
  return typeof id === 'string' ? rooms.get(id) || null : null;
}

function listRooms() {
  return [...rooms.values()]
    .filter((r) => r.members.size > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicRoom);
}

async function checkRoomPassword(room, password) {
  if (!room.passwordHash) return true;
  if (!password) return false;
  return bcrypt.compare(String(password), room.passwordHash);
}

function join(roomId, socketId, user) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.members.set(socketId, {
    id: user.id,
    name: user.name,
    role: user.role || 'user',
    audio: true,
    video: true,
    screen: false,
    hand: false,
    isOwner: user.id === room.ownerId,
    joinedAt: Date.now(),
    lastSeen: Date.now(),
  });
  room.emptySince = null;
  return room;
}

function leave(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.members.delete(socketId);
  if (room.members.size === 0) room.emptySince = Date.now();
  return room;
}

function participants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.members.entries()].map(([socketId, m]) => ({ socketId, ...m }));
}

function isUserInRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  for (const m of room.members.values()) if (m.id === userId) return true;
  return false;
}

function isUserOwner(roomId, userId) {
  const room = rooms.get(roomId);
  return Boolean(room && room.ownerId === userId);
}

function isModerator(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  if (room.ownerId === userId) return true;
  return room.moderators && room.moderators.has(userId);
}

function addAttendance(roomId, entry) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (!room.attendanceLog) room.attendanceLog = [];
  room.attendanceLog.push(entry);
  if (room.attendanceLog.length > 5000) room.attendanceLog.splice(0, 2000);
}

/* ---------------- whiteboard ---------------- */

function addStroke(roomId, stroke) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.strokes.push(stroke);
  if (room.strokes.length > 20000) room.strokes.splice(0, 5000);
  return stroke;
}

function clearBoard(roomId) {
  const room = rooms.get(roomId);
  if (room) room.strokes = [];
}

/* ---------------- chat & notes ---------------- */

function addMessage(roomId, msg) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.messages.push(msg);
  if (room.messages.length > 300) room.messages.splice(0, 100);
  return msg;
}

function setNotes(roomId, text) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.notes = String(text || '').slice(0, 20000);
}

/* ---------------- polls ---------------- */

function createPoll(roomId, poll) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.polls.push(poll);
  return poll;
}

function votePoll(roomId, pollId, userId, choice) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const poll = room.polls.find((p) => p.id === pollId);
  if (!poll) return null;
  for (const voter of Object.keys(poll.votes)) {
    if (voter === userId) delete poll.votes[voter];
  }
  poll.votes[userId] = choice;
  return poll;
}

/* ---------------- agenda ---------------- */

function addAgendaItem(roomId, item) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (!room.agenda) room.agenda = [];
  if (room.agenda.length >= 50) return null;
  room.agenda.push(item);
  return room.agenda;
}

function toggleAgendaItem(roomId, index) {
  const room = rooms.get(roomId);
  if (!room || !room.agenda || !room.agenda[index]) return null;
  room.agenda[index].done = !room.agenda[index].done;
  return room.agenda;
}

function removeAgendaItem(roomId, index) {
  const room = rooms.get(roomId);
  if (!room || !room.agenda) return null;
  room.agenda.splice(index, 1);
  return room.agenda;
}

/* ---------------- files ---------------- */

function registerFile(meta) {
  files.set(meta.id, meta);
  return meta;
}

function getFile(id) {
  return files.get(id) || null;
}

function addFileEntry(roomId, entry) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.files.push(entry);
  return entry;
}

/* ---------------- housekeeping ---------------- */

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.members.size === 0 && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL) {
      rooms.delete(id);
      try {
        db.prepare('UPDATE rooms SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(now, id);
      } catch { /* ignore */ }
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = {
  LOGICAL_W,
  LOGICAL_H,
  createRoom,
  getRoom,
  listRooms,
  checkRoomPassword,
  join,
  leave,
  participants,
  isUserInRoom,
  isUserOwner,
  isModerator,
  addAttendance,
  addStroke,
  clearBoard,
  addMessage,
  setNotes,
  createPoll,
  votePoll,
  addAgendaItem,
  toggleAgendaItem,
  removeAgendaItem,
  registerFile,
  getFile,
  addFileEntry,
  publicRoom,
};