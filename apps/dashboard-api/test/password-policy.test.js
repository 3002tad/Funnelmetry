import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPassword } from '../src/lib/password.js';

test('password requires eight characters and all four character categories', () => {
  for (const value of ['Abcdef1!', 'LongerPassword2@']) assert.equal(isValidPassword(value), true);
  for (const value of [null, 12345678, '', 'Abcd1!x', 'abcdef1!', 'ABCDEF1!',
    'Abcdefg!', 'Abcdef12', 'Abcdef1 ', 'Abcdef1é']) {
    assert.equal(isValidPassword(value), false, `Unexpected acceptance: ${value}`);
  }
});
