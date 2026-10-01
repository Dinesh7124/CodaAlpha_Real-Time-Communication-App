'use strict';

/**
 * Central sanitization helpers. Always use these before storing or emitting.
 */

// Strip control chars, trim, cap length.
function cleanText(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// Preserve newlines and formatting, but strip control chars.
function cleanMultiline(str, maxLen = 20000) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLen);
}

// Hex color only
function cleanColor(str, fallback = '#ffffff') {
  if (typeof str === 'string' && /^#[0-9a-fA-F]{6}$/.test(str)) return str.toLowerCase();
  return fallback;
}

// Room code: alphanumeric only
function cleanRoomId(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
}

// File name: remove path separators, control chars, cap length
function cleanFileName(name) {
  if (typeof name !== 'string') return 'file';
  return name
    .replace(/[\/\\]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/^\.+/, '')
    .slice(0, 200) || 'file';
}

// Validate MIME type against a whitelist
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/zip', 'application/x-zip-compressed',
  'text/plain', 'text/csv', 'text/markdown',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/webm',
]);

function isAllowedMime(mime) {
  return ALLOWED_MIME.has(mime);
}

// Never trust a MIME the browser gives — check magic bytes for common types.
function sniffMime(buffer) {
  if (!buffer || buffer.length < 4) return null;
  const b = buffer;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'application/zip';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'video/webm';
  return null;
}

module.exports = {
  cleanText,
  cleanMultiline,
  cleanColor,
  cleanRoomId,
  cleanFileName,
  isAllowedMime,
  sniffMime,
  ALLOWED_MIME,
};