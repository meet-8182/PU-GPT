import mongoose from 'mongoose';

/**
 * Anonymous, aggregate guest-answer feedback. Only one document per UTC day:
 * no message text, no user id, no IP address.
 */
const guestFeedbackSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // YYYY-MM-DD (UTC)
  up: { type: Number, default: 0 },
  down: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});

export const GuestFeedback = mongoose.model('GuestFeedback', guestFeedbackSchema);
