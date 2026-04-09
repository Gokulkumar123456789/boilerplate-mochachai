'use strict';

const express = require('express');
const router = express.Router();
const TokenManager = require('./tokenManager');
const ultrasonicCodec = require('../shared/ultrasonicCodec');
const audioFingerprint = require('../shared/audioFingerprint');

const tokenManager = new TokenManager();

/**
 * POST /proximity/session
 * Create a new exam proctoring session.
 * Response: { sessionId, token, createdAt }
 */
router.post('/session', (req, res) => {
  const session = tokenManager.createSession();
  const encoded = ultrasonicCodec.encodeToken(session.token);
  res.json({
    sessionId: session.sessionId,
    token: session.token,
    createdAt: session.createdAt,
    ultrasonicSequence: encoded.sequence,
    totalDuration: encoded.totalDuration
  });
});

/**
 * GET /proximity/token/:sessionId
 * Get the current token for a session (laptop polls this).
 * Auto-rotates expired tokens.
 * Response: { token, createdAt, ultrasonicSequence, totalDuration }
 */
router.get('/token/:sessionId', (req, res) => {
  const tokenData = tokenManager.getToken(req.params.sessionId);
  if (!tokenData) {
    return res.status(404).json({ error: 'Session not found or inactive' });
  }
  const encoded = ultrasonicCodec.encodeToken(tokenData.token);
  res.json({
    token: tokenData.token,
    createdAt: tokenData.createdAt,
    ultrasonicSequence: encoded.sequence,
    totalDuration: encoded.totalDuration
  });
});

/**
 * POST /proximity/token/:sessionId/rotate
 * Force-rotate the token for a session.
 * Response: { token, createdAt, ultrasonicSequence, totalDuration }
 */
router.post('/token/:sessionId/rotate', (req, res) => {
  const tokenData = tokenManager.rotateToken(req.params.sessionId);
  if (!tokenData) {
    return res.status(404).json({ error: 'Session not found or inactive' });
  }
  const encoded = ultrasonicCodec.encodeToken(tokenData.token);
  res.json({
    token: tokenData.token,
    createdAt: tokenData.createdAt,
    ultrasonicSequence: encoded.sequence,
    totalDuration: encoded.totalDuration
  });
});

/**
 * POST /proximity/verify
 * Mobile device submits a decoded token for verification.
 * Body: { sessionId, token, mobileTimestamp? }
 * Response: { verified, reason, distance? }
 */
router.post('/verify', (req, res) => {
  const { sessionId, token, mobileTimestamp } = req.body;

  if (!sessionId || !token) {
    return res.status(400).json({ error: 'sessionId and token are required' });
  }

  const result = tokenManager.verifyToken(sessionId, token, mobileTimestamp);
  res.json(result);
});

/**
 * POST /proximity/fingerprint
 * Compare ambient audio fingerprints from both devices.
 * Body: { sessionId, laptopFingerprint, mobileFingerprint, threshold? }
 * Response: { match, similarity, combined, sameRoom }
 */
router.post('/fingerprint', (req, res) => {
  const { sessionId, laptopFingerprint, mobileFingerprint, threshold } = req.body;

  if (!sessionId || !laptopFingerprint || !mobileFingerprint) {
    return res.status(400).json({
      error: 'sessionId, laptopFingerprint, and mobileFingerprint are required'
    });
  }

  const result = tokenManager.compareFingerprints(
    sessionId,
    laptopFingerprint,
    mobileFingerprint,
    threshold
  );
  res.json(result);
});

/**
 * GET /proximity/status/:sessionId
 * Get the proximity verification status for a session.
 * Response: { sessionId, status, totalVerifications, recentSuccessRate, proximityConfirmed }
 */
router.get('/status/:sessionId', (req, res) => {
  const status = tokenManager.getSessionStatus(req.params.sessionId);
  if (!status) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(status);
});

/**
 * POST /proximity/session/:sessionId/end
 * End a proctoring session.
 * Response: { ended: boolean }
 */
router.post('/session/:sessionId/end', (req, res) => {
  const ended = tokenManager.endSession(req.params.sessionId);
  if (!ended) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ ended: true });
});

/**
 * GET /proximity/config
 * Get codec and fingerprint configuration for clients.
 * Response: { ultrasonic: {...}, fingerprint: {...} }
 */
router.get('/config', (req, res) => {
  res.json({
    ultrasonic: ultrasonicCodec.getConfig(),
    fingerprint: audioFingerprint.getConfig()
  });
});

module.exports = { router, tokenManager };
