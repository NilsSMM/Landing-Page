// Tests run against a mocked Runway client: no network, no credits spent.
const test = require('node:test');
const assert = require('node:assert');
const { TaskFailedError } = require('@runwayml/sdk');
const { createApp, validate } = require('../server');

function fakeClient(outcome) {
  const calls = [];
  return {
    calls,
    textToVideo: {
      create(body) {
        calls.push(body);
        return { waitForTaskOutput: () => outcome() };
      },
    },
  };
}

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

const post = (base, body) => fetch(`${base}/api/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function waitForJob(base, id) {
  for (let i = 0; i < 50; i++) {
    const job = await fetch(`${base}/api/jobs/${id}`).then((r) => r.json());
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job never finished');
}

test('validate enforces the gen4.5 contract', () => {
  assert.ok(validate({ prompt: 'x', ratio: '1280:720', duration: 5 }).value);
  assert.ok(validate({ prompt: '' }).error);
  assert.ok(validate({ prompt: 'x'.repeat(1001) }).error);
  assert.ok(validate({ prompt: 'x', ratio: '1920:1080' }).error);
  assert.ok(validate({ prompt: 'x', duration: 11 }).error);
  assert.ok(validate({ prompt: 'x', duration: 2.5 }).error);
});

test('successful generation returns the video URL', async () => {
  const client = fakeClient(async () => ({ id: 'task-1', output: ['https://example.com/v.mp4'] }));
  await withServer(createApp({ client }), async (base) => {
    const res = await post(base, { prompt: 'A red panda', ratio: '720:1280', duration: 4 });
    assert.strictEqual(res.status, 202);
    const job = await waitForJob(base, (await res.json()).id);
    assert.strictEqual(job.status, 'succeeded');
    assert.strictEqual(job.videoUrl, 'https://example.com/v.mp4');
    assert.deepStrictEqual(client.calls[0], { model: 'gen4.5', promptText: 'A red panda', ratio: '720:1280', duration: 4 });
  });
});

test('failed task surfaces the failure message', async () => {
  const client = fakeClient(async () => {
    throw new TaskFailedError({ id: 't', status: 'FAILED', failure: 'Moderated', failureCode: 'SAFETY.INPUT.TEXT' });
  });
  await withServer(createApp({ client }), async (base) => {
    const { id } = await (await post(base, { prompt: 'x' })).json();
    const job = await waitForJob(base, id);
    assert.strictEqual(job.status, 'failed');
    assert.strictEqual(job.error, 'Moderated');
  });
});

test('invalid input is rejected before calling Runway', async () => {
  const client = fakeClient(async () => ({}));
  await withServer(createApp({ client }), async (base) => {
    const res = await post(base, { prompt: 'x', duration: 30 });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(client.calls.length, 0);
  });
});

test('without an API secret, generation is disabled', async () => {
  await withServer(createApp({ enabled: false }), async (base) => {
    assert.strictEqual((await post(base, { prompt: 'x' })).status, 503);
    const config = await fetch(`${base}/api/config`).then((r) => r.json());
    assert.strictEqual(config.enabled, false);
  });
});
