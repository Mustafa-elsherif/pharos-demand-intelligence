# Deployment

Two parts: a static dashboard on GitHub Pages and a containerized API.

## Frontend: GitHub Pages
The dashboard is static and reads precomputed JSON from `frontend/`. It is published
from the `gh-pages` branch, which mirrors the `frontend/` folder.

Publish or update:
```bash
git subtree push --prefix frontend origin gh-pages
```
Enable Pages once (Settings > Pages > Branch: `gh-pages`, folder `/`), or via the CLI:
```bash
gh api -X POST repos/:owner/:repo/pages -f source.branch=gh-pages -f source.path=/
```
Live at `https://mustafa-elsherif.github.io/pharos-demand-intelligence/`.

All asset and data paths are relative, so the project subpath works with no changes.
The dashboard needs no backend: retrieval and grounding for the assistant run in the
browser from the exported knowledge index.

## Backend: Docker
```bash
cd backend
docker build -t pharos-api .
docker run -p 8000:8000 -e GEMINI_API_KEY=your_key pharos-api
```
The image loads all artifacts at startup and answers immediately. The healthcheck
hits `/health`. Leave `GEMINI_API_KEY` unset to run fully offline with the local
assistant fallback.

### One documented host (Google Cloud Run)
```bash
gcloud run deploy pharos-api \
  --source backend \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=your_key
```
Cloud Run builds the Dockerfile, serves on port 8000, and returns an HTTPS URL. To
point the dashboard at a live API instead of the browser fallback, set that URL as
the API base in the frontend (the dashboard works without it).

Any container host works the same way: build the image, run it, pass the key as an
environment variable. No secrets are committed; the key is read only from the
environment.

## Secrets
No keys are stored in the repository. Provide `GEMINI_API_KEY` at runtime through the
environment or your host's secret manager.
