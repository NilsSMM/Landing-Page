// Landing page server with a Runway Dev text-to-video integration.
// The API secret stays on the server: the SDK reads RUNWAYML_API_SECRET from the environment.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { default: RunwayML, TaskFailedError, TaskTimedOutError } = require('@runwayml/sdk');

// Gen-4.5 text_to_video contract (https://docs.dev.runwayml.com/api.md):
// promptText <= 1000 UTF-16 units, ratio 1280:720 | 720:1280, integer duration 2-10, all required.
const MODEL = 'gen4.5';
const RATIOS = ['1280:720', '720:1280'];
const MIN_DURATION = 2;
const MAX_DURATION = 10;
const MAX_PROMPT = 1000;
const WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ACTIVE_JOBS = 3; // simple guard against runaway credit spend
const JOB_TTL_MS = 60 * 60 * 1000;

function validate(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const ratio = body?.ratio ?? RATIOS[0];
  const duration = Number(body?.duration ?? 5);
  if (!prompt) return { error: 'Please describe the video you want.' };
  if (prompt.length > MAX_PROMPT) return { error: `Prompt must be at most ${MAX_PROMPT} characters.` };
  if (!RATIOS.includes(ratio)) return { error: `Ratio must be one of ${RATIOS.join(', ')}.` };
  if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
    return { error: `Duration must be a whole number from ${MIN_DURATION} to ${MAX_DURATION} seconds.` };
  }
  return { value: { promptText: prompt, ratio, duration } };
}

function createApp({ client, enabled = Boolean(process.env.RUNWAYML_API_SECRET) } = {}) {
  const runway = client ?? (enabled ? new RunwayML() : null);
  const jobs = new Map();
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const activeCount = () => [...jobs.values()].filter((j) => j.status === 'running').length;

  app.get('/api/config', (_req, res) => {
    res.json({ enabled: Boolean(runway), model: MODEL, ratios: RATIOS, minDuration: MIN_DURATION, maxDuration: MAX_DURATION, maxPrompt: MAX_PROMPT });
  });

  app.post('/api/generate', (req, res) => {
    if (!runway) {
      return res.status(503).json({ error: 'Video generation is not configured. Set RUNWAYML_API_SECRET on the server.' });
    }
    const { value, error } = validate(req.body);
    if (error) return res.status(400).json({ error });
    if (activeCount() >= MAX_ACTIVE_JOBS) {
      return res.status(429).json({ error: 'Too many videos are generating right now. Please try again shortly.' });
    }

    const id = crypto.randomUUID();
    const job = { status: 'running', createdAt: Date.now() };
    jobs.set(id, job);

    // Submit, then let the SDK's wait helper poll the Runway task with backoff.
    runway.textToVideo
      .create({ model: MODEL, ...value })
      .waitForTaskOutput({ timeout: WAIT_TIMEOUT_MS })
      .then((task) => {
        job.status = 'succeeded';
        job.taskId = task.id;
        job.videoUrl = task.output?.[0]; // signed URL, expires: download it if you need to keep it
      })
      .catch((err) => {
        job.status = 'failed';
        if (err instanceof TaskFailedError) {
          const details = err.taskDetails ?? {};
          job.taskId = details.id;
          job.error = details.failure || 'The generation failed.';
          job.failureCode = details.failureCode;
        } else if (err instanceof TaskTimedOutError) {
          job.error = 'Timed out waiting for the video. The task may still finish in Runway.';
        } else {
          console.error('Runway request failed:', err?.message ?? err);
          job.error = err?.status === 401 ? 'Runway rejected the API key.' : 'Could not reach Runway. Please try again.';
        }
      });

    res.status(202).json({ id });
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown job.' });
    const { status, videoUrl, error, failureCode } = job;
    res.json({ status, videoUrl, error, failureCode });
  });

  // Drop finished jobs after an hour so memory stays bounded.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs) if (job.status !== 'running' && job.createdAt < cutoff) jobs.delete(id);
  }, 5 * 60 * 1000);
  sweep.unref();

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Landing page on http://localhost:${port}`);
    if (!process.env.RUNWAYML_API_SECRET) console.log('RUNWAYML_API_SECRET is not set: video generation is disabled.');
  });
}

module.exports = { createApp, validate };
