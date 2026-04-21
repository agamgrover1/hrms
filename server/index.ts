import 'dotenv/config';
import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 HRFlow API running on http://localhost:${PORT}`);
  console.log(`🗄️  DB URL: ${process.env.DATABASE_URL?.slice(0, 60)}...`);
});
