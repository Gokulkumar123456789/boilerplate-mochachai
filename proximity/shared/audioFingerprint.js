'use strict';

/**
 * AudioFingerprint - Generates and compares spectral fingerprints
 * of ambient audio to determine if two devices are in the same room.
 *
 * The fingerprint is a simplified spectral energy distribution across
 * frequency bands. Two devices in the same room will capture similar
 * ambient sounds (HVAC, traffic, people talking, etc.) resulting in
 * similar spectral fingerprints.
 *
 * This module provides server-side comparison logic.
 * Client-side fingerprint generation uses the Web Audio API.
 */

// Frequency bands for fingerprint (in Hz)
const FREQUENCY_BANDS = [
  { min: 0, max: 200, label: 'sub-bass' },
  { min: 200, max: 500, label: 'bass' },
  { min: 500, max: 1000, label: 'low-mid' },
  { min: 1000, max: 2000, label: 'mid' },
  { min: 2000, max: 4000, label: 'upper-mid' },
  { min: 4000, max: 8000, label: 'presence' },
  { min: 8000, max: 16000, label: 'brilliance' }
];

const NUM_BANDS = FREQUENCY_BANDS.length;

/**
 * Compare two audio fingerprints using cosine similarity.
 * @param {number[]} fpA - Fingerprint from device A (array of band energies)
 * @param {number[]} fpB - Fingerprint from device B (array of band energies)
 * @returns {number} Similarity score between 0 and 1
 */
function compareFingerprintsCosineSimilarity(fpA, fpB) {
  if (!fpA || !fpB || fpA.length === 0 || fpB.length === 0) return 0;

  const len = Math.min(fpA.length, fpB.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dotProduct += fpA[i] * fpB[i];
    normA += fpA[i] * fpA[i];
    normB += fpB[i] * fpB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Compare fingerprints using normalized Euclidean distance.
 * @param {number[]} fpA
 * @param {number[]} fpB
 * @returns {number} Similarity score between 0 and 1 (1 = identical)
 */
function compareFingerprintsEuclidean(fpA, fpB) {
  if (!fpA || !fpB || fpA.length === 0 || fpB.length === 0) return 0;

  const len = Math.min(fpA.length, fpB.length);

  // Normalize both fingerprints
  const normalizedA = normalize(fpA.slice(0, len));
  const normalizedB = normalize(fpB.slice(0, len));

  // Calculate Euclidean distance
  let sumSquaredDiff = 0;
  for (let i = 0; i < len; i++) {
    const diff = normalizedA[i] - normalizedB[i];
    sumSquaredDiff += diff * diff;
  }

  const distance = Math.sqrt(sumSquaredDiff);
  // Max possible distance for normalized vectors is sqrt(2)
  const maxDistance = Math.sqrt(2);
  return 1 - (distance / maxDistance);
}

/**
 * Combined comparison using both cosine similarity and Euclidean distance.
 * @param {number[]} fpA
 * @param {number[]} fpB
 * @returns {{ cosineSimilarity: number, euclideanSimilarity: number, combined: number, sameRoom: boolean }}
 */
function compareFingerprints(fpA, fpB, threshold = 0.7) {
  const cosineSimilarity = compareFingerprintsCosineSimilarity(fpA, fpB);
  const euclideanSimilarity = compareFingerprintsEuclidean(fpA, fpB);

  // Weighted combination (cosine is generally more robust for this use case)
  const combined = (cosineSimilarity * 0.6) + (euclideanSimilarity * 0.4);

  return {
    cosineSimilarity: Math.round(cosineSimilarity * 1000) / 1000,
    euclideanSimilarity: Math.round(euclideanSimilarity * 1000) / 1000,
    combined: Math.round(combined * 1000) / 1000,
    sameRoom: combined >= threshold
  };
}

/**
 * Normalize a vector to unit length.
 * @param {number[]} vec
 * @returns {number[]}
 */
function normalize(vec) {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vec.map(() => 0);
  return vec.map(v => v / magnitude);
}

/**
 * Get the fingerprint configuration for clients.
 * @returns {Object}
 */
function getConfig() {
  return {
    frequencyBands: FREQUENCY_BANDS,
    numBands: NUM_BANDS,
    sampleDurationMs: 3000,  // Record 3 seconds of ambient audio
    sampleRate: 44100,
    fftSize: 2048
  };
}

module.exports = {
  compareFingerprints,
  compareFingerprintsCosineSimilarity,
  compareFingerprintsEuclidean,
  normalize,
  getConfig,
  FREQUENCY_BANDS,
  NUM_BANDS
};
