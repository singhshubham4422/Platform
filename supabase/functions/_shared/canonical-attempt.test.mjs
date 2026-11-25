// Cross-language contract: the desktop (apps/student-desktop/src-tauri/src/attempts.rs,
// test `canonical_json_matches_server_fixture`) signs exactly this string for this attempt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAttemptJson } from './assessments.js';

const FIXTURE = '{"attemptId":"a1","packId":"e@1","questionId":"q","assessmentId":"e","language":"JAVA","mode":"SUBMIT","sourceSha256":"ab","verdict":"ACCEPTED","passed":1,"total":2,"totalTimeMs":3,"startedAt":"s","finishedAt":"f","monotonicSeq":4,"deviceId":"d"}';

test('server canonical attempt JSON equals the desktop fixture byte for byte', () => {
  const a = { deviceId: 'd', monotonicSeq: 4, finishedAt: 'f', startedAt: 's', totalTimeMs: 3, total: 2, passed: 1, verdict: 'ACCEPTED', sourceSha256: 'ab', mode: 'SUBMIT', language: 'JAVA', assessmentId: 'e', questionId: 'q', packId: 'e@1', attemptId: 'a1', source: 'ignored' };
  assert.equal(canonicalAttemptJson(a), FIXTURE);
});
