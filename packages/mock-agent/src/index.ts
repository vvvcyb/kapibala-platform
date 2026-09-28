import { createAgentApp } from './server.js';

const PORT = Number(process.env.AGENT_PORT || process.env.PORT || 4002);

const app = createAgentApp();

app.listen(PORT, () => {
  console.log(`[mock-agent] Listening on http://localhost:${PORT}`);
});
