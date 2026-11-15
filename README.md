# Landing-Page

A landing page with a prompt box that generates a short video with [Runway Dev](https://dev.runway.com)
(model `gen4.5`, `POST /v1/text_to_video`) through the official Node SDK, `@runwayml/sdk`.

## Run it

```bash
npm install
export RUNWAYML_API_SECRET=...   # create a key in the Runway Developer Portal, never commit it
npm start                        # http://localhost:3000
```

Without `RUNWAYML_API_SECRET`, the page still loads, but generation is disabled.

## How it works

- `public/` is the static landing page. The browser only talks to this server, never to Runway.
- `POST /api/generate` validates the prompt against the Gen-4.5 contract (prompt up to 1000 chars,
  ratio `1280:720` or `720:1280`, an integer duration from 2 to 10 seconds). It then starts the task with
  `textToVideo.create(...).waitForTaskOutput()` and returns a local job id right away.
- `GET /api/jobs/:id` reports `running`, `succeeded` (with the video URL) or `failed`. The page polls it.
- At most 3 generations run at once (`MAX_ACTIVE_JOBS` in `server.js`), which limits credit spend.
  Add authentication and per-user rate limiting before you make the page public.
- Output URLs from Runway expire. Download or re-host any video you want to keep.

Every generation spends credits on the API key's project. Gen-4.5 is billed per second of output;
see the [pricing page](https://docs.dev.runwayml.com/guides/pricing) for current rates.

## Tests

```bash
npm test   # mocks the Runway client: no network, no credits
```
