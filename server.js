import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import db from './src/config/db.js';
import { createAuthRouter } from './src/middlewares/auth.js'; // Ensure correct path to auth.js
import questionRoutes from './src/routes/questionRoutes.js';
import teacherRoutes from './src/routes/teacherRoutes.js'; // Import teacher routes

const { PORT = 3000, CORS_ORIGIN = 'http://localhost:5173', JWT_SECRET } = process.env;
if (!JWT_SECRET) {
  console.error('JWT_SECRET is missing in .env');
  process.exit(1);
}

const app = express();

app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '10kb' }));

// Health Check
app.get('/health', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT count(*)::int AS questions FROM questions');
    res.json({ ok: true, questions: rows[0].questions });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ ok: false, error: 'Database problem' });
  }
});

// Modular Routes Routing
app.use('/api/v1/auth', createAuthRouter({ db, jwtSecret: JWT_SECRET }));
app.use('/api/v1', questionRoutes);
app.use('/api/v1/teacher', teacherRoutes); // Add this line for teacher routes


app.use((err, _req, res, _next) => {
  console.error('SERVER ERROR:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));