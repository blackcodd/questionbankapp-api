import express from 'express';
import db from '../config/db.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = express.Router();

// 1. Switch Role to Teacher
router.post('/switch-role', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    await db.query(`UPDATE users SET role = 'teacher' WHERE id = $1`, [userId]);
    res.json({ ok: true, role: 'teacher' });
  } catch (err) {
    console.error('SWITCH ROLE ERROR:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update role' });
  }
});

// 2. Create Exam with Teacher Assigned Correct Answers
router.post('/exams', requireAuth, async (req, res) => {
  try {
    const { title, questionsWithAnswers } = req.body; // Array of { questionId, correctOption }
    const teacherName = req.user.name || 'Teacher';
    const teacherId = req.user.id || null;

    if (!title || !questionsWithAnswers || questionsWithAnswers.length === 0) {
      return res.status(400).json({ ok: false, error: 'Title and Questions with answers required' });
    }

    // Insert Exam
    const examRes = await db.query(
      `INSERT INTO exams (title, teacher_id, teacher_name) VALUES ($1, $2, $3) RETURNING id`,
      [title, teacherId, teacherName]
    );
    const examId = examRes.rows[0].id;

    // Insert Questions with teacher selected correct answer
    for (const item of questionsWithAnswers) {
      await db.query(
        `INSERT INTO exam_questions (exam_id, question_id, correct_option) VALUES ($1, $2, $3)`,
        [examId, item.questionId, item.correctOption ?? 0]
      );
    }

    res.json({ ok: true, examId, publicUrl: `/exam/${examId}` });
  } catch (err) {
    console.error('CREATE EXAM ERROR:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create exam' });
  }
});

// 3. Get Public Exam (NO AUTH REQUIRED FOR STUDENTS)
router.get('/public-exam/:examId', async (req, res) => {
  try {
    const { examId } = req.params;

    const examRes = await db.query(`SELECT * FROM exams WHERE id = $1`, [examId]);
    if (examRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Exam not found' });
    }

    const qRes = await db.query(
      `SELECT q.id AS question_id, q.question_text, q.options, eq.correct_option
       FROM exam_questions eq 
       JOIN questions q ON eq.question_id = q.id 
       WHERE eq.exam_id = $1`,
      [examId]
    );

    res.json({
      ok: true,
      exam: examRes.rows[0],
      questions: qRes.rows
    });
  } catch (err) {
    console.error('PUBLIC EXAM FETCH ERROR:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch exam' });
  }
});

// 4. Submit Student Public Exam with Real Auto-Grading Score
router.post('/public-exam/submit', async (req, res) => {
  try {
    const { examId, studentName, studentAnswers } = req.body; // studentAnswers: { question_id: option_index }

    if (!studentName || !studentName.trim()) {
      return res.status(400).json({ ok: false, error: 'Student name is required' });
    }

    // Get correct answers for this exam
    const qRes = await db.query(
      `SELECT question_id, correct_option FROM exam_questions WHERE exam_id = $1`,
      [examId]
    );

    let score = 0;
    const totalQuestions = qRes.rows.length;

    // Auto grading match
    qRes.rows.forEach((q) => {
      const studentAns = studentAnswers[q.question_id];
      if (studentAns !== undefined && parseInt(studentAns, 10) === parseInt(q.correct_option, 10)) {
        score += 1;
      }
    });

    await db.query(
      `INSERT INTO exam_submissions (exam_id, student_name, score, total_questions) VALUES ($1, $2, $3, $4)`,
      [examId, studentName.trim(), score, totalQuestions]
    );

    res.json({ ok: true, score, totalQuestions });
  } catch (err) {
    console.error('EXAM SUBMIT ERROR:', err.message);
    res.status(500).json({ ok: false, error: 'Submission failed' });
  }
});

// 5. Get Submissions / Results for Teacher
router.get('/exams/:examId/results', requireAuth, async (req, res) => {
  try {
    const { examId } = req.params;
    const { rows } = await db.query(
      `SELECT student_name, score, total_questions, submitted_at FROM exam_submissions WHERE exam_id = $1 ORDER BY submitted_at DESC`,
      [examId]
    );
    res.json({ ok: true, results: rows });
  } catch (err) {
    console.error('FETCH RESULTS ERROR:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch results' });
  }
});

export default router;