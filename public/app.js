const $ = (id) => document.getElementById(id);
const form = $('gen-form');
const submit = $('submit');
const result = $('result');
const statusEl = $('status');
const video = $('video');
const download = $('download');

function setStatus(text, isError = false) {
  result.hidden = false;
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function loadConfig() {
  const config = await fetch('/api/config').then((r) => r.json());
  for (let s = config.minDuration; s <= config.maxDuration; s++) {
    $('duration').add(new Option(`${s} seconds`, s, false, s === 5));
  }
  if (!config.enabled) {
    submit.disabled = true;
    $('note').textContent = 'Video generation is not configured on this server yet.';
  }
}

async function poll(id) {
  let delay = 3000;
  while (true) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 15000);
    const res = await fetch(`/api/jobs/${id}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || 'Lost track of the job.');
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed') throw new Error(job.error || 'The generation failed.');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  video.hidden = true;
  download.hidden = true;
  setStatus('Generating your video. This usually takes a minute or two…');
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: $('prompt').value,
        ratio: $('ratio').value,
        duration: Number($('duration').value),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Request failed.');
    const job = await poll(body.id);
    video.src = job.videoUrl;
    video.hidden = false;
    download.href = job.videoUrl;
    download.hidden = false;
    setStatus('Done. This link expires, so download the video if you want to keep it.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    submit.disabled = false;
  }
});

loadConfig();
