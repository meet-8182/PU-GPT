import mongoose from 'mongoose';

/**
 * Optional (GUEST_UNANSWERED_LOG=true) log of guest questions that could not be
 * answered from approved university information.
 *
 * The question is sanitized before saving (emails, phone numbers and long digit
 * strings removed). No IP address or session identifier is stored. Documents
 * expire automatically after 30 days.
 */
const guestUnansweredSchema = new mongoose.Schema({
  question: { type: String, required: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

guestUnansweredSchema.index({ createdAt: -1 });

export const GuestUnanswered = mongoose.model('GuestUnanswered', guestUnansweredSchema);
