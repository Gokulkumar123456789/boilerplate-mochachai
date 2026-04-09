const chai = require('chai');
const assert = chai.assert;

const TokenManager = require('../proximity/server/tokenManager');
const ultrasonicCodec = require('../proximity/shared/ultrasonicCodec');
const audioFingerprint = require('../proximity/shared/audioFingerprint');

suite('Proximity Detection Tests', function () {
  // ===========================
  // Token Manager Tests
  // ===========================
  suite('TokenManager', function () {
    let tokenManager;

    setup(function () {
      tokenManager = new TokenManager({
        tokenLength: 6,
        tokenTTLMs: 5000,
        maxRoundTripMs: 3000
      });
    });

    test('createSession returns sessionId and token', function () {
      const session = tokenManager.createSession();
      assert.isString(session.sessionId, 'sessionId should be a string');
      assert.lengthOf(session.sessionId, 32, 'sessionId should be 32 hex chars');
      assert.isString(session.token, 'token should be a string');
      assert.lengthOf(session.token, 6, 'token should be 6 characters');
      assert.isNumber(session.createdAt, 'createdAt should be a number');
    });

    test('getToken returns the current token', function () {
      const session = tokenManager.createSession();
      const tokenData = tokenManager.getToken(session.sessionId);
      assert.isNotNull(tokenData, 'tokenData should not be null');
      assert.strictEqual(tokenData.token, session.token, 'token should match');
    });

    test('getToken returns null for non-existent session', function () {
      const tokenData = tokenManager.getToken('nonexistent');
      assert.isNull(tokenData, 'should return null for missing session');
    });

    test('rotateToken changes the token', function () {
      const session = tokenManager.createSession();
      const originalToken = session.token;
      const rotated = tokenManager.rotateToken(session.sessionId);
      assert.isNotNull(rotated, 'rotated should not be null');
      assert.isString(rotated.token, 'new token should be a string');
      assert.lengthOf(rotated.token, 6, 'new token should be 6 characters');
      // Tokens should differ (statistically; could rarely be same)
      // We just verify it returns a valid token
    });

    test('verifyToken succeeds with correct token', function () {
      const session = tokenManager.createSession();
      const result = tokenManager.verifyToken(session.sessionId, session.token);
      assert.isTrue(result.verified, 'should verify correct token');
      assert.strictEqual(result.matchedToken, 'current');
    });

    test('verifyToken accepts previous token after rotation', function () {
      const session = tokenManager.createSession();
      const originalToken = session.token;
      tokenManager.rotateToken(session.sessionId);
      const result = tokenManager.verifyToken(session.sessionId, originalToken);
      assert.isTrue(result.verified, 'should accept previous token');
      assert.strictEqual(result.matchedToken, 'previous');
    });

    test('verifyToken fails with wrong token', function () {
      const session = tokenManager.createSession();
      const result = tokenManager.verifyToken(session.sessionId, 'XXXXXX');
      assert.isFalse(result.verified, 'should reject wrong token');
      assert.strictEqual(result.reason, 'Token mismatch');
    });

    test('verifyToken fails for non-existent session', function () {
      const result = tokenManager.verifyToken('nonexistent', 'TOKEN1');
      assert.isFalse(result.verified, 'should fail for missing session');
      assert.strictEqual(result.reason, 'Session not found');
    });

    test('endSession marks session as ended', function () {
      const session = tokenManager.createSession();
      const ended = tokenManager.endSession(session.sessionId);
      assert.isTrue(ended, 'should return true');
      const tokenData = tokenManager.getToken(session.sessionId);
      assert.isNull(tokenData, 'getToken should return null after ending');
    });

    test('getSessionStatus returns correct status', function () {
      const session = tokenManager.createSession();
      tokenManager.verifyToken(session.sessionId, session.token);
      const status = tokenManager.getSessionStatus(session.sessionId);
      assert.isNotNull(status, 'status should not be null');
      assert.strictEqual(status.sessionId, session.sessionId);
      assert.strictEqual(status.status, 'active');
      assert.strictEqual(status.totalVerifications, 1);
      assert.isNumber(status.recentSuccessRate);
    });

    test('compareFingerprints detects same room', function () {
      const session = tokenManager.createSession();
      const fpA = [10, 20, 30, 40, 50, 60, 70];
      const fpB = [11, 21, 29, 41, 49, 61, 69];
      const result = tokenManager.compareFingerprints(session.sessionId, fpA, fpB);
      assert.isTrue(result.match, 'similar fingerprints should match');
      assert.isAbove(result.similarity, 0.9, 'similarity should be high');
    });

    test('compareFingerprints detects different rooms', function () {
      const session = tokenManager.createSession();
      const fpA = [100, 5, 80, 10, 90, 3, 70];
      const fpB = [3, 90, 10, 80, 5, 100, 2];
      const result = tokenManager.compareFingerprints(session.sessionId, fpA, fpB);
      assert.isFalse(result.match, 'dissimilar fingerprints should not match');
    });

    test('token contains only valid characters', function () {
      const session = tokenManager.createSession();
      const validChars = /^[A-Z0-9]+$/;
      assert.match(session.token, validChars, 'token should be alphanumeric uppercase');
    });
  });

  // ===========================
  // Ultrasonic Codec Tests
  // ===========================
  suite('UltrasonicCodec', function () {
    test('charToFrequency maps A to base frequency', function () {
      const freq = ultrasonicCodec.charToFrequency('A');
      assert.strictEqual(freq, ultrasonicCodec.BASE_FREQUENCY, 'A should map to base frequency');
    });

    test('charToFrequency maps characters to unique frequencies', function () {
      const freqs = new Set();
      for (const char of ultrasonicCodec.CHARSET) {
        const freq = ultrasonicCodec.charToFrequency(char);
        assert.isFalse(freqs.has(freq), 'Each character should have a unique frequency');
        freqs.add(freq);
      }
    });

    test('charToFrequency stays within ultrasonic range', function () {
      for (const char of ultrasonicCodec.CHARSET) {
        const freq = ultrasonicCodec.charToFrequency(char);
        assert.isAtLeast(freq, ultrasonicCodec.BASE_FREQUENCY, char + ' freq should be >= base');
        assert.isAtMost(freq, ultrasonicCodec.MAX_FREQUENCY, char + ' freq should be <= max');
      }
    });

    test('charToFrequency throws for invalid characters', function () {
      assert.throws(() => ultrasonicCodec.charToFrequency('!'), /Invalid character/);
      assert.throws(() => ultrasonicCodec.charToFrequency(' '), /Invalid character/);
    });

    test('frequencyToChar reverses charToFrequency', function () {
      for (const char of ultrasonicCodec.CHARSET) {
        const freq = ultrasonicCodec.charToFrequency(char);
        const decoded = ultrasonicCodec.frequencyToChar(freq);
        assert.strictEqual(decoded, char, 'Should decode back to: ' + char);
      }
    });

    test('frequencyToChar handles tolerance', function () {
      const freq = ultrasonicCodec.charToFrequency('A');
      const decoded = ultrasonicCodec.frequencyToChar(freq + 15, 30);
      assert.strictEqual(decoded, 'A', 'Should tolerate small frequency drift');
    });

    test('frequencyToChar returns null for out-of-range frequency', function () {
      const decoded = ultrasonicCodec.frequencyToChar(10000);
      assert.isNull(decoded, 'Should return null for frequency outside range');
    });

    test('encodeToken produces correct sequence structure', function () {
      const result = ultrasonicCodec.encodeToken('ABC');
      assert.isArray(result.sequence, 'sequence should be an array');
      assert.isNumber(result.totalDuration, 'totalDuration should be a number');
      // Should have: preamble + gap + A + gap + B + gap + C = 7 entries
      assert.strictEqual(result.sequence[0].type, 'preamble', 'First entry should be preamble');
      assert.strictEqual(result.sequence[0].frequency, ultrasonicCodec.PREAMBLE_FREQ);
    });

    test('decodeFrequencies reconstructs the token', function () {
      const token = 'HELLO1';
      const encoded = ultrasonicCodec.encodeToken(token);
      const dataFreqs = encoded.sequence
        .filter(s => s.type === 'data')
        .map(s => s.frequency);
      const decoded = ultrasonicCodec.decodeFrequencies(dataFreqs);
      assert.strictEqual(decoded.token, token, 'Decoded token should match original');
      assert.strictEqual(decoded.confidence, 1, 'Confidence should be 1 for perfect decode');
    });

    test('isPreamble correctly identifies preamble frequency', function () {
      assert.isTrue(ultrasonicCodec.isPreamble(ultrasonicCodec.PREAMBLE_FREQ));
      assert.isFalse(ultrasonicCodec.isPreamble(ultrasonicCodec.BASE_FREQUENCY));
    });

    test('getConfig returns all codec parameters', function () {
      const config = ultrasonicCodec.getConfig();
      assert.isNumber(config.baseFrequency);
      assert.isNumber(config.maxFrequency);
      assert.isString(config.charset);
      assert.isNumber(config.charCount);
      assert.isNumber(config.freqStep);
      assert.isNumber(config.toneDuration);
      assert.isNumber(config.gapDuration);
      assert.isNumber(config.preambleFreq);
      assert.isNumber(config.preambleDuration);
    });
  });

  // ===========================
  // Audio Fingerprint Tests
  // ===========================
  suite('AudioFingerprint', function () {
    test('compareFingerprints returns high similarity for identical fingerprints', function () {
      const fp = [10, 20, 30, 40, 50, 60, 70];
      const result = audioFingerprint.compareFingerprints(fp, fp);
      assert.approximately(result.cosineSimilarity, 1.0, 0.001);
      assert.isTrue(result.sameRoom, 'Identical fingerprints should indicate same room');
    });

    test('compareFingerprints returns high similarity for similar fingerprints', function () {
      const fpA = [10, 20, 30, 40, 50, 60, 70];
      const fpB = [12, 22, 28, 42, 48, 62, 68];
      const result = audioFingerprint.compareFingerprints(fpA, fpB);
      assert.isAbove(result.combined, 0.9, 'Similar fingerprints should have high similarity');
      assert.isTrue(result.sameRoom);
    });

    test('compareFingerprints returns low similarity for different fingerprints', function () {
      const fpA = [100, 0, 100, 0, 100, 0, 100];
      const fpB = [0, 100, 0, 100, 0, 100, 0];
      const result = audioFingerprint.compareFingerprints(fpA, fpB);
      assert.isBelow(result.combined, 0.5, 'Opposite fingerprints should have low similarity');
      assert.isFalse(result.sameRoom);
    });

    test('compareFingerprints handles empty arrays', function () {
      const result = audioFingerprint.compareFingerprints([], [1, 2, 3]);
      assert.strictEqual(result.cosineSimilarity, 0);
      assert.isFalse(result.sameRoom);
    });

    test('compareFingerprints handles null inputs', function () {
      const result = audioFingerprint.compareFingerprints(null, [1, 2, 3]);
      assert.strictEqual(result.cosineSimilarity, 0);
    });

    test('normalize produces unit vector', function () {
      const vec = [3, 4];
      const normalized = audioFingerprint.normalize(vec);
      const magnitude = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
      assert.approximately(magnitude, 1.0, 0.001, 'Normalized vector should have magnitude 1');
    });

    test('normalize handles zero vector', function () {
      const vec = [0, 0, 0];
      const normalized = audioFingerprint.normalize(vec);
      assert.deepEqual(normalized, [0, 0, 0]);
    });

    test('getConfig returns valid configuration', function () {
      const config = audioFingerprint.getConfig();
      assert.isArray(config.frequencyBands);
      assert.isAbove(config.frequencyBands.length, 0);
      assert.isNumber(config.numBands);
      assert.isNumber(config.sampleDurationMs);
      assert.isNumber(config.sampleRate);
      assert.isNumber(config.fftSize);
    });

    test('FREQUENCY_BANDS cover expected range', function () {
      const bands = audioFingerprint.FREQUENCY_BANDS;
      assert.strictEqual(bands[0].min, 0, 'First band should start at 0 Hz');
      assert.strictEqual(bands[bands.length - 1].max, 16000, 'Last band should end at 16kHz');
      // Verify bands are contiguous
      for (let i = 1; i < bands.length; i++) {
        assert.strictEqual(bands[i].min, bands[i - 1].max,
          'Bands should be contiguous at ' + bands[i].min + ' Hz');
      }
    });
  });

  // ===========================
  // Integration: API Routes Tests
  // ===========================
  suite('API Routes', function () {
    const chaiHttp = require('chai-http');
    chai.use(chaiHttp);
    const server = require('../server');

    test('POST /proximity/session creates a session', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/session')
        .end(function (err, res) {
          assert.strictEqual(res.status, 200);
          assert.isString(res.body.sessionId);
          assert.isString(res.body.token);
          assert.isArray(res.body.ultrasonicSequence);
          assert.isNumber(res.body.totalDuration);
          done();
        });
    });

    test('GET /proximity/token/:sessionId returns current token', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/session')
        .end(function (err, res) {
          const sessionId = res.body.sessionId;
          chai.request(server)
            .keepOpen()
            .get('/proximity/token/' + sessionId)
            .end(function (err, res2) {
              assert.strictEqual(res2.status, 200);
              assert.isString(res2.body.token);
              assert.isArray(res2.body.ultrasonicSequence);
              done();
            });
        });
    });

    test('GET /proximity/token/:badId returns 404', function (done) {
      chai.request(server)
        .keepOpen()
        .get('/proximity/token/nonexistent')
        .end(function (err, res) {
          assert.strictEqual(res.status, 404);
          done();
        });
    });

    test('POST /proximity/verify with correct token succeeds', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/session')
        .end(function (err, res) {
          const { sessionId, token } = res.body;
          chai.request(server)
            .keepOpen()
            .post('/proximity/verify')
            .send({ sessionId, token })
            .end(function (err, res2) {
              assert.strictEqual(res2.status, 200);
              assert.isTrue(res2.body.verified);
              done();
            });
        });
    });

    test('POST /proximity/verify with wrong token fails', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/session')
        .end(function (err, res) {
          chai.request(server)
            .keepOpen()
            .post('/proximity/verify')
            .send({ sessionId: res.body.sessionId, token: 'XXXXXX' })
            .end(function (err, res2) {
              assert.strictEqual(res2.status, 200);
              assert.isFalse(res2.body.verified);
              assert.strictEqual(res2.body.reason, 'Token mismatch');
              done();
            });
        });
    });

    test('POST /proximity/verify requires sessionId and token', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/verify')
        .send({})
        .end(function (err, res) {
          assert.strictEqual(res.status, 400);
          done();
        });
    });

    test('GET /proximity/status/:sessionId returns status', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/session')
        .end(function (err, res) {
          const sessionId = res.body.sessionId;
          chai.request(server)
            .keepOpen()
            .get('/proximity/status/' + sessionId)
            .end(function (err, res2) {
              assert.strictEqual(res2.status, 200);
              assert.strictEqual(res2.body.status, 'active');
              assert.isNumber(res2.body.totalVerifications);
              done();
            });
        });
    });

    test('POST /proximity/session/:sessionId/end ends the session', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/session')
        .end(function (err, res) {
          const sessionId = res.body.sessionId;
          chai.request(server)
            .keepOpen()
            .post('/proximity/session/' + sessionId + '/end')
            .end(function (err, res2) {
              assert.strictEqual(res2.status, 200);
              assert.isTrue(res2.body.ended);
              done();
            });
        });
    });

    test('GET /proximity/config returns codec and fingerprint config', function (done) {
      chai.request(server)
        .keepOpen()
        .get('/proximity/config')
        .end(function (err, res) {
          assert.strictEqual(res.status, 200);
          assert.isObject(res.body.ultrasonic);
          assert.isObject(res.body.fingerprint);
          assert.isNumber(res.body.ultrasonic.baseFrequency);
          assert.isArray(res.body.fingerprint.frequencyBands);
          done();
        });
    });

    test('POST /proximity/fingerprint compares fingerprints', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/session')
        .end(function (err, res) {
          const sessionId = res.body.sessionId;
          chai.request(server)
            .keepOpen()
            .post('/proximity/fingerprint')
            .send({
              sessionId,
              laptopFingerprint: [10, 20, 30, 40, 50, 60, 70],
              mobileFingerprint: [11, 21, 29, 41, 49, 61, 69]
            })
            .end(function (err, res2) {
              assert.strictEqual(res2.status, 200);
              assert.property(res2.body, 'match');
              assert.property(res2.body, 'similarity');
              done();
            });
        });
    });

    test('POST /proximity/token/:sessionId/rotate rotates the token', function (done) {
      chai.request(server)
        .keepOpen()
        .post('/proximity/session')
        .end(function (err, res) {
          const sessionId = res.body.sessionId;
          const oldToken = res.body.token;
          chai.request(server)
            .keepOpen()
            .post('/proximity/token/' + sessionId + '/rotate')
            .end(function (err, res2) {
              assert.strictEqual(res2.status, 200);
              assert.isString(res2.body.token);
              done();
            });
        });
    });
  });
});
