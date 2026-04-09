'use strict';

const crypto = require('crypto');

/**
 * TokenManager handles generation, storage, and verification of
 * ultrasonic proximity tokens for exam proctoring sessions.
 *
 * Each session gets a rotating token that changes every few seconds.
 * The mobile device must decode the ultrasonic signal and send the
 * token back to the server within the validity window.
 */
class TokenManager {
  /**
   * @param {Object} options
   * @param {number} options.tokenLength      - Characters in each token (default: 6)
   * @param {number} options.tokenTTLMs       - Token validity window in ms (default: 5000)
   * @param {number} options.maxRoundTripMs    - Max allowed round-trip time in ms (default: 3000)
   * @param {number} options.maxDistanceMeters - Max allowed distance in meters (default: 5)
   */
  constructor(options = {}) {
    this.tokenLength = options.tokenLength || 6;
    this.tokenTTLMs = options.tokenTTLMs || 5000;
    this.maxRoundTripMs = options.maxRoundTripMs || 3000;
    this.maxDistanceMeters = options.maxDistanceMeters || 5;
    // sessionId -> { currentToken, previousToken, createdAt, verificationHistory[] }
    this.sessions = new Map();
  }

  /**
   * Create a new exam proctoring session.
   * @returns {{ sessionId: string, token: string, createdAt: number }}
   */
  createSession() {
    const sessionId = crypto.randomBytes(16).toString('hex');
    const token = this._generateToken();
    const now = Date.now();

    this.sessions.set(sessionId, {
      currentToken: token,
      previousToken: null,
      tokenCreatedAt: now,
      sessionCreatedAt: now,
      verificationHistory: [],
      status: 'active'
    });

    return { sessionId, token, createdAt: now };
  }

  /**
   * Rotate the token for a session. Called periodically by the laptop client.
   * Keeps the previous token valid for a grace period.
   * @param {string} sessionId
   * @returns {{ token: string, createdAt: number } | null}
   */
  rotateToken(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') return null;

    const token = this._generateToken();
    const now = Date.now();

    session.previousToken = session.currentToken;
    session.currentToken = token;
    session.tokenCreatedAt = now;

    return { token, createdAt: now };
  }

  /**
   * Get the current token for a session (used by the laptop to know what to emit).
   * @param {string} sessionId
   * @returns {{ token: string, createdAt: number } | null}
   */
  getToken(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') return null;

    const now = Date.now();
    // Auto-rotate if token has expired
    if (now - session.tokenCreatedAt > this.tokenTTLMs) {
      return this.rotateToken(sessionId);
    }

    return { token: session.currentToken, createdAt: session.tokenCreatedAt };
  }

  /**
   * Verify a token submitted by the mobile device.
   * Checks: token matches, round-trip time is acceptable.
   * @param {string} sessionId
   * @param {string} token         - The token decoded by the mobile device
   * @param {number} [mobileTimestamp] - When the mobile decoded the token (for ToF)
   * @returns {{ verified: boolean, reason: string, distance?: number }}
   */
  verifyToken(sessionId, token, mobileTimestamp) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { verified: false, reason: 'Session not found' };
    }
    if (session.status !== 'active') {
      return { verified: false, reason: 'Session is not active' };
    }

    const now = Date.now();

    // Check if the token matches current or previous token
    const matchesCurrent = token === session.currentToken;
    const matchesPrevious = token === session.previousToken;

    if (!matchesCurrent && !matchesPrevious) {
      const result = { verified: false, reason: 'Token mismatch' };
      session.verificationHistory.push({ ...result, timestamp: now });
      return result;
    }

    // Check round-trip time
    const roundTrip = now - session.tokenCreatedAt;
    if (roundTrip > this.tokenTTLMs + this.maxRoundTripMs) {
      const result = { verified: false, reason: 'Token expired (round-trip too slow)' };
      session.verificationHistory.push({ ...result, timestamp: now });
      return result;
    }

    // Optional: Time-of-Flight distance estimation
    let distance = null;
    if (mobileTimestamp) {
      // Speed of sound = 343 m/s
      // Estimate acoustic propagation time:
      //   totalElapsed = now - tokenCreatedAt (includes acoustic + network)
      //   networkDelay = now - mobileTimestamp (server receipt - mobile decode)
      //   acousticPropagation ≈ totalElapsed - networkDelay
      const totalElapsed = now - session.tokenCreatedAt;
      const networkDelay = now - mobileTimestamp;
      const propagationMs = Math.max(0, totalElapsed - networkDelay);
      if (propagationMs > 0) {
        distance = (propagationMs / 1000) * 343;
        if (distance > this.maxDistanceMeters) {
          const result = {
            verified: false,
            reason: `Device too far: ${distance.toFixed(2)}m (max: ${this.maxDistanceMeters}m)`,
            distance
          };
          session.verificationHistory.push({ ...result, timestamp: now });
          return result;
        }
      }
    }

    const result = {
      verified: true,
      reason: 'Token verified successfully',
      distance,
      matchedToken: matchesCurrent ? 'current' : 'previous'
    };
    session.verificationHistory.push({ ...result, timestamp: now });
    return result;
  }

  /**
   * Compare ambient audio fingerprints from both devices.
   * @param {string} sessionId
   * @param {number[]} laptopFingerprint  - Spectral fingerprint from laptop mic
   * @param {number[]} mobileFingerprint  - Spectral fingerprint from mobile mic
   * @param {number} [threshold=0.7]      - Similarity threshold (0–1)
   * @returns {{ match: boolean, similarity: number }}
   */
  compareFingerprints(sessionId, laptopFingerprint, mobileFingerprint, threshold = 0.7) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { match: false, similarity: 0, reason: 'Session not found' };
    }

    const similarity = this._cosineSimilarity(laptopFingerprint, mobileFingerprint);
    const match = similarity >= threshold;

    const result = { match, similarity, reason: match ? 'Same room detected' : 'Different rooms detected' };
    session.verificationHistory.push({ ...result, type: 'fingerprint', timestamp: Date.now() });
    return result;
  }

  /**
   * Get the verification history and status for a session.
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const recentHistory = session.verificationHistory.slice(-20);
    const recentSuccesses = recentHistory.filter(v => v.verified === true || v.match === true).length;
    const total = recentHistory.length;

    return {
      sessionId,
      status: session.status,
      sessionCreatedAt: session.sessionCreatedAt,
      totalVerifications: session.verificationHistory.length,
      recentSuccessRate: total > 0 ? recentSuccesses / total : 0,
      lastVerification: session.verificationHistory[session.verificationHistory.length - 1] || null,
      proximityConfirmed: total >= 3 && (recentSuccesses / total) >= 0.6
    };
  }

  /**
   * End a session.
   * @param {string} sessionId
   * @returns {boolean}
   */
  endSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = 'ended';
    return true;
  }

  /**
   * Generate a random alphanumeric token.
   * @returns {string}
   */
  _generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const charCount = chars.length; // 36
    // Use rejection sampling to avoid modulo bias
    const maxValid = 256 - (256 % charCount); // 252 for 36 chars
    let token = '';
    while (token.length < this.tokenLength) {
      const bytes = crypto.randomBytes(this.tokenLength * 2);
      for (let i = 0; i < bytes.length && token.length < this.tokenLength; i++) {
        if (bytes[i] < maxValid) {
          token += chars[bytes[i] % charCount];
        }
      }
    }
    return token;
  }

  /**
   * Compute cosine similarity between two numeric vectors.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} Similarity between 0 and 1
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }
}

module.exports = TokenManager;
