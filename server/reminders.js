'use strict';

const db = require('./db');

let ioInstance = null;

function startReminders(io) {
  ioInstance = io;

  setInterval(() => {
    try {
      const now = Date.now();
      const in5Min = now + 5 * 60 * 1000;
      const in6Min = now + 6 * 60 * 1000;

      const upcoming = db
        .prepare(
          `SELECT m.*, u.name AS host_name
           FROM scheduled_meetings m
           JOIN users u ON u.id = m.host_id
           WHERE m.status = 'scheduled'
             AND m.reminder_sent = 0
             AND m.start_at BETWEEN ? AND ?`
        )
        .all(in5Min, in6Min);

      for (const meeting of upcoming) {
        try {
          db.prepare('UPDATE scheduled_meetings SET reminder_sent = 1 WHERE id = ?').run(meeting.id);

          const hostSockets = [...ioInstance.sockets.sockets.values()]
            .filter((s) => s.user && s.user.id === meeting.host_id);

          hostSockets.forEach((s) => {
            s.emit('meeting:reminder', {
              meetingId: meeting.id,
              title: meeting.title,
              roomId: meeting.room_id,
              startAt: meeting.start_at,
              message: `Your meeting "${meeting.title}" starts in 5 minutes`,
            });
          });

          const invites = db
            .prepare('SELECT email FROM meeting_invites WHERE meeting_id = ?')
            .all(meeting.id);

          const inviteEmails = invites.map((i) => i.email.toLowerCase());

          [...ioInstance.sockets.sockets.values()].forEach((s) => {
            if (s.user && s.user.email && inviteEmails.includes(s.user.email.toLowerCase())) {
              s.emit('meeting:reminder', {
                meetingId: meeting.id,
                title: meeting.title,
                roomId: meeting.room_id,
                startAt: meeting.start_at,
                message: `Meeting "${meeting.title}" by ${meeting.host_name} starts in 5 minutes`,
              });
            }
          });

          console.log(`[reminder] Sent for "${meeting.title}" (${meeting.id})`);
        } catch (e) {
          console.error('[reminder] error:', e.message);
        }
      }
    } catch (e) {
      // DB may not be ready — skip silently
    }
  }, 60 * 1000).unref();

  console.log('  [reminders] Scheduler started (checks every minute)');
}

module.exports = { startReminders };