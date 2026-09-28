import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

// SPEC 2.3: GET /api/health -> { ok, schemaVersion }
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, schemaVersion: '1.0.0' });
});

// Skeleton placeholder for Phase 2 server endpoints
app.get('/api', (_req, res) => {
  res.json({ message: 'Kapibala Core Server API Skeleton' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[server] Core backend running on http://localhost:${PORT}`);
  });
}

export default app;
