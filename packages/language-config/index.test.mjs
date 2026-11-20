import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, getLanguage, isLanguageId, javaMainClass, outputsMatch } from './index.js';

test('exactly the four initial languages with distinct modes', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.id), ['PYTHON', 'C', 'CPP', 'JAVA']);
  assert.equal(new Set(LANGUAGES.map((l) => l.monaco)).size, 4);
  assert.equal(new Set(LANGUAGES.map((l) => l.extension)).size, 4);
  for (const l of LANGUAGES) assert.ok(l.starterCode.length > 0);
});

test('lookup and guards', () => {
  assert.equal(getLanguage('cpp')?.id, 'CPP');
  assert.equal(getLanguage('rust'), null);
  assert.equal(isLanguageId('JAVA'), true);
  assert.equal(isLanguageId(42), false);
});

test('java main class detection', () => {
  assert.equal(javaMainClass('public class Solution { }'), 'Solution');
  assert.equal(javaMainClass('class X {}'), 'Main');
});

test('output comparison normalises trailing whitespace only', () => {
  assert.ok(outputsMatch('15\r\n', '15'));
  assert.ok(outputsMatch('a b  \nc\n\n', 'a b\nc'));
  assert.ok(!outputsMatch('a  b', 'a b'));
  assert.ok(!outputsMatch('15', '16'));
});
