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

3. Start the app.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first load, the app prompts for an OpenRouter API key, stores it in browser local storage, and blocks runs until it is set. You can change it later from the main screen.

## Environment variables

- `NEXT_PUBLIC_OPENROUTER_APP_NAME`: optional OpenRouter attribution title for client-side requests.

## Deploy to Vercel

This app is a standard Next.js App Router project, so Vercel can deploy it without extra adapters.

1. No backend secret is required. The app uses a user-provided OpenRouter key stored in the browser.
2. Deploy a preview:

```bash
vercel deploy -y
```

3. For production later:

```bash
vercel deploy --prod -y
```

## Notes

- OpenRouter requests are made directly from the client.
- The UI is implemented in `src/components/council-studio.tsx`.
- The orchestration logic lives in `src/lib/council-engine.ts`.
