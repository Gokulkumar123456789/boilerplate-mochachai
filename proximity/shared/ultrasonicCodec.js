'use strict';

/**
 * UltrasonicCodec - Encodes and decodes alphanumeric tokens as
 * sequences of ultrasonic frequency tones using FSK (Frequency Shift Keying).
 *
 * Frequency range: 18,000 Hz – 22,000 Hz (inaudible to most humans)
 * Each character is mapped to a unique frequency.
 * Characters: A-Z (26) + 0-9 (10) = 36 characters
 * Frequency step: ~111 Hz per character across 4,000 Hz band
 *
 * This module provides the encoding parameters. Actual audio generation
 * and capture is handled by the Web Audio API on the client side.
 */

const BASE_FREQUENCY = 18000; // Hz - start of ultrasonic range
const MAX_FREQUENCY = 22000;  // Hz - end of ultrasonic range
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CHAR_COUNT = CHARSET.length; // 36
const FREQ_STEP = Math.floor((MAX_FREQUENCY - BASE_FREQUENCY) / CHAR_COUNT); // ~111 Hz
const TONE_DURATION = 100; // ms per character tone
const GAP_DURATION = 30;   // ms silence between tones
const PREAMBLE_FREQ = 17500; // Hz - sync preamble tone (below main data band, may be faintly audible to some)
const PREAMBLE_DURATION = 150; // ms

/**
 * Get the frequency for a given character.
 * @param {string} char - Single character (A-Z or 0-9)
 * @returns {number} Frequency in Hz
 */
function charToFrequency(char) {
  const index = CHARSET.indexOf(char.toUpperCase());
  if (index === -1) {
    throw new Error(`Invalid character: "${char}". Must be A-Z or 0-9.`);
  }
  return BASE_FREQUENCY + (index * FREQ_STEP);
}

/**
 * Get the character for a detected frequency.
 * @param {number} frequency - Detected frequency in Hz
 * @param {number} [tolerance=30] - Frequency tolerance in Hz
 * @returns {string|null} Decoded character or null if no match
 */
function frequencyToChar(frequency, tolerance = 30) {
  for (let i = 0; i < CHAR_COUNT; i++) {
    const targetFreq = BASE_FREQUENCY + (i * FREQ_STEP);
    if (Math.abs(frequency - targetFreq) <= tolerance) {
      return CHARSET[i];
    }
  }
  return null;
}

/**
 * Encode a token into a sequence of frequency-duration pairs.
 * Includes a preamble tone for synchronization.
 * @param {string} token - Alphanumeric token to encode
 * @returns {{ sequence: Array<{frequency: number, duration: number, type: string}>, totalDuration: number }}
 */
function encodeToken(token) {
  const sequence = [];

  // Preamble for synchronization
  sequence.push({
    frequency: PREAMBLE_FREQ,
    duration: PREAMBLE_DURATION,
    type: 'preamble'
  });
  sequence.push({
    frequency: 0,
    duration: GAP_DURATION,
    type: 'gap'
  });

  // Encode each character
  for (let i = 0; i < token.length; i++) {
    sequence.push({
      frequency: charToFrequency(token[i]),
      duration: TONE_DURATION,
      type: 'data'
    });
    if (i < token.length - 1) {
      sequence.push({
        frequency: 0,
        duration: GAP_DURATION,
        type: 'gap'
      });
    }
  }

  const totalDuration = sequence.reduce((sum, s) => sum + s.duration, 0);
  return { sequence, totalDuration };
}

/**
 * Decode a sequence of detected frequencies back into a token.
 * @param {number[]} frequencies - Array of detected peak frequencies
 * @param {number} [tolerance=30] - Frequency tolerance in Hz
 * @returns {{ token: string, confidence: number }}
 */
function decodeFrequencies(frequencies, tolerance = 30) {
  let token = '';
  let matched = 0;

  for (const freq of frequencies) {
    // Skip preamble frequency
    if (Math.abs(freq - PREAMBLE_FREQ) <= tolerance) continue;
    // Skip silence/gaps
    if (freq < BASE_FREQUENCY - tolerance) continue;

    const char = frequencyToChar(freq, tolerance);
    if (char) {
      token += char;
      matched++;
    }
  }

  const confidence = frequencies.length > 0 ? matched / frequencies.length : 0;
  return { token, confidence };
}

/**
 * Check if a frequency is the preamble (sync) tone.
 * @param {number} frequency
 * @param {number} [tolerance=30]
 * @returns {boolean}
 */
function isPreamble(frequency, tolerance = 30) {
  return Math.abs(frequency - PREAMBLE_FREQ) <= tolerance;
}

/**
 * Get all encoding parameters (useful for client-side configuration).
 * @returns {Object}
 */
function getConfig() {
  return {
    baseFrequency: BASE_FREQUENCY,
    maxFrequency: MAX_FREQUENCY,
    charset: CHARSET,
    charCount: CHAR_COUNT,
    freqStep: FREQ_STEP,
    toneDuration: TONE_DURATION,
    gapDuration: GAP_DURATION,
    preambleFreq: PREAMBLE_FREQ,
    preambleDuration: PREAMBLE_DURATION
  };
}

module.exports = {
  charToFrequency,
  frequencyToChar,
  encodeToken,
  decodeFrequencies,
  isPreamble,
  getConfig,
  // Constants
  BASE_FREQUENCY,
  MAX_FREQUENCY,
  CHARSET,
  FREQ_STEP,
  TONE_DURATION,
  GAP_DURATION,
  PREAMBLE_FREQ,
  PREAMBLE_DURATION
};
