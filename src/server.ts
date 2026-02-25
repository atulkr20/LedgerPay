import { app } from './app';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  
  console.log(` LedgerPay is LIVE on port ${PORT}`);
  console.log(` Test the API at: http://localhost:${PORT}/api-docs`);
});
