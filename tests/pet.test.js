'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('the public companion draws and animates without a sprite file', () => {
  const draws = [];
  const ctx = {};
  for (const name of ['clearRect', 'save', 'restore', 'scale', 'translate', 'beginPath', 'roundRect', 'fill', 'drawImage']) {
    ctx[name] = (...args) => draws.push([name, ...args]);
  }
  const context = { requestAnimationFrame() {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('renderer/pet.js', 'utf8') + '\nthis.Pet = MossPet;', context);
  const pet = new context.Pet({ width: 192, height: 208, getContext: () => ctx });
  pet._draw(0, 0);
  assert.ok(draws.some(row => row[0] === 'roundRect'));
  assert.ok(!draws.some(row => row[0] === 'drawImage'));
  draws.length = 0;
  pet._draw(8, 2);
  assert.ok(draws.some(row => row[0] === 'translate' && Math.abs(row[1]) > 0));
  pet.setState('unknown');
  assert.equal(pet.stateName, 'idle');
});

test('quota response keeps real percentage and reset fields', async () => {
  const { pollQuota } = require('../lib/bigmodel');
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ data: { level: 'test', limits: [
    { unit: 3, number: 5, usage: 2000, currentValue: 740, remaining: 1260, percentage: 37, nextResetTime: 123456 }
  ] } }) });
  try {
    const data = await pollQuota({ bigmodelApiKey: 'synthetic-test-key' });
    assert.equal(data.limits[0].percentage, 37);
    assert.equal(data.limits[0].remaining, 1260);
    assert.equal(data.limits[0].nextResetTime, 123456);
  } finally { global.fetch = original; }
});
