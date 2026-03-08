## LLM Council

Next.js app for running multi-model council workflows through [OpenRouter](https://openrouter.ai/):

- `debate` mode: the coordinator frames the prompt, each member debates in sequence for `N` rounds, then the coordinator synthesizes the discussion.
- `council` mode: all members answer in parallel from their own personas, then the coordinator produces an equitable middle-ground consensus.

Each participant has:

- a model id
- a persona
- access to the shared system directive

## Local development

1. Install dependencies.

```bash
npm install
```

2. Create local env vars.

```bash
cp .env.example .env.local
```

3. Set `OPENROUTER_API_KEY` in `.env.local`.

4. Start the app.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

- `OPENROUTER_API_KEY`: required for server-side OpenRouter requests.
- `OPENROUTER_APP_NAME`: optional header used for OpenRouter attribution.
- `OPENROUTER_SITE_URL`: optional header used for OpenRouter attribution in local or self-hosted setups.

## Deploy to Vercel

This app is a standard Next.js App Router project, so Vercel can deploy it without extra adapters.

1. Add the same environment variables in the Vercel project settings.
2. Deploy a preview:

```bash
vercel deploy -y
```

3. For production later:

```bash
vercel deploy --prod -y
```

## Notes

- OpenRouter requests are made on the server through `src/app/api/run/route.ts`.
- The UI is implemented in `src/components/council-studio.tsx`.
- The orchestration logic lives in `src/lib/council-engine.ts`.
