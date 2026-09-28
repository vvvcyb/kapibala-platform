import { createGatewayApp } from './server.js';

const PORT = Number(process.env.GATEWAY_PORT || process.env.PORT || 4001);

const app = createGatewayApp();

app.listen(PORT, () => {
  console.log(`[mock-gateway] Listening on http://localhost:${PORT}`);
});
