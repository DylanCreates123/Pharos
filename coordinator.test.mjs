import assert from 'node:assert/strict';
import test from 'node:test';
import {defaults,requirements} from './web/config.js';
import {Coordinator} from './web/coordinator.js';
import {remaining,updateTimer,fromZone} from './web/local.js';

test('screen requirements, shared request, freshness and visibility', async () => {
  let now = 1_000_000;
  const calls = [];
  const coordinator = new Coordinator(() => {}, () => now, async url => {
    calls.push(url);
    return {ok:true,json:async () => ({payload:[],fetched_at:now/1000,status:'ok'})};
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const home = requirements('Home',defaults);
  const detail = requirements('Transport',defaults);
  coordinator.subscribe('screen',requirements('Timers',defaults));
  assert.equal(calls.length,0);
  coordinator.subscribe('screen',home);
  coordinator.subscribe('second',detail);
  await flush();
  assert.equal(calls.length,3);
  assert.equal(coordinator.active.get(detail[0].key).age,60);
  coordinator.subscribe('second',[]);
  assert.equal(coordinator.active.get(detail[0].key).age,300);
  coordinator.subscribe('screen',[]);
  coordinator.subscribe('screen',home);
  assert.equal(calls.length,3);

  coordinator.pause(true);
  coordinator.subscribe('screen',detail);
  now += 600_000;
  coordinator.scan();
  assert.equal(calls.length,3);
  coordinator.pause(false);
  await flush();
  assert.equal(calls.length,4);
  assert.match(calls[3],/max_age=60/);
  coordinator.subscribe('screen',[]);
  now += 600_000;
  coordinator.scan();
  assert.equal(calls.length,4);
});

test('timer uses deadline after reload and clock jumps; due times use configured timezone', () => {
  const timer = {duration:60000,left:60000,deadline:null};
  updateTimer(timer,'start',1000);
  const restored = JSON.parse(JSON.stringify(timer));
  assert.equal(remaining(restored,46000),15000);
  assert.equal(remaining(restored,95000),0);
  updateTimer(restored,'pause',46000);
  assert.equal(remaining(restored,1000000),15000);
  assert.equal(fromZone('2026-11-10T10:00','Australia/Brisbane'), Date.parse('2026-11-10T00:00Z'));
});