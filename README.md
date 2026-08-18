# Exam Maker

AI-assisted examination authoring, question-bank, delivery, grading, and analysis system.

## Development

```bash
npm ci
npm run dev
```

- Frontend: `http://localhost:5173`
- API health: `http://localhost:3001/api/health`

Copy `.env.example` to `.env` and configure the AI provider before running an AI workflow.

## Oracle Cloud deployment

The repository includes a native Ubuntu ARM deployment for a single Oracle Cloud VM. It installs the document toolchain, runs the API under systemd, serves the built frontend through Nginx, and schedules consistent data backups.

See [docs/oracle-cloud-deployment.md](docs/oracle-cloud-deployment.md). Do not commit the production `.env`, API keys, database, uploads, or exports.
