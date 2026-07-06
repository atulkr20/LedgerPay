import http from 'http';
import { app } from './app';
import dotenv from 'dotenv';
import { setupTerminal } from './terminal/terminal.routes';

dotenv.config({ quiet: true });

const PORT = process.env.PORT || 3000;

 const server = http.createServer(app);

 const terminalPage = setupTerminal(server);

 app.get('/terminal', terminalPage);

server.listen(PORT, () => {
  
  console.log(` LedgerPay is LIVE on port ${PORT}`);
  console.log(`CLI Terminal at: http://localhost:${PORT}/terminal`)
  console.log(` Test the API at: http://localhost:${PORT}/api-docs`);
});
