import express from 'express';
import db from '../config/db.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = express.Router();

// 1. Fetch distinct classes
router.get('/classes', requireAuth, async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT DISTINCT class_name FROM chapters ORDER BY class_name ASC');
    res.json(rows.map((r) => r.class_name));
  } catch (err) {
    console.error('CLASSES FETCH ERROR:', err.message);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// 2. Fetch distinct subjects for a given class
router.get('/subjects', requireAuth, async (req, res) => {
  try {
    const { class_name } = req.query;
    if (!class_name) {
      return res.status(400).json({ error: 'class_name is required' });
    }

    const { rows } = await db.query(
      'SELECT DISTINCT subject FROM chapters WHERE class_name=$1 ORDER BY subject ASC',
      [class_name]
    );

    res.json(rows.map((r) => r.subject));
  } catch (err) {
    console.error('SUBJECTS FETCH ERROR:', err.message);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// 3. Fetch chapters/lessons for class & subject
router.get('/chapters', requireAuth, async (req, res) => {
  try {
    const { class_name, subject } = req.query;
    
    if (!class_name || !subject) {
      return res.status(400).json({ error: 'class_name and subject are required' });
    }

    const { rows } = await db.query(
      'SELECT id, title, lesson_id FROM chapters WHERE class_name=$1 AND subject=$2 ORDER BY id ASC',
      [class_name, subject]
    );

    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('CHAPTERS FETCH ERROR:', err.message);
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// 4. Fetch Questions (Tightly Bound, Safe Filtering & Pagination)
router.get('/questions', requireAuth, async (req, res) => {
  try {
    const { 
      class_name, 
      subject, 
      title,       
      lesson_id,   
      question_type, 
      limit = 20, 
      page = 1 
    } = req.query;

    let baseQuery = `
      SELECT 
        q.id AS question_id,
        q.question_text, 
        q.options,
        q.q_type,
        c.class_name, 
        c.subject,
        c.title AS chapter_title,
        c.lesson_id,
        COUNT(*) OVER() AS total_count,
        COALESCE(
          json_agg(
            json_build_object(
              'board', qs.board,
              'board_name', qs.board_name,
              'year', qs.year
            )
          ) FILTER (WHERE qs.question_id IS NOT NULL), '[]'
        ) AS sources
      FROM questions q
      JOIN chapters c ON q.chapter_id = c.id
      LEFT JOIN question_sources qs ON q.id = qs.question_id
      WHERE 1=1
    `;

    const params = [];

    // Class Name Filter
    if (class_name) {
      params.push(class_name.trim());
      baseQuery += ` AND TRIM(c.class_name) = $${params.length}`;
    }

    // Subject Filter
    if (subject) {
      params.push(subject.trim());
      baseQuery += ` AND TRIM(c.subject) = $${params.length}`;
    }

    // Chapter Title Filter (ILIKE for flexible matching)
    if (title && title.trim() !== '') {
      params.push(`%${title.trim()}%`);
      baseQuery += ` AND c.title ILIKE $${params.length}`;
    }

    // Lesson ID UUID Filter
    if (lesson_id) {
      params.push(lesson_id);
      baseQuery += ` AND c.lesson_id = $${params.length}::uuid`;
    }

    // Question Type Filter (Handles both Bangla & Short Code)
    if (question_type) {
      const typeStr = question_type.trim();
      params.push(typeStr);
      
      // Supporting both exact match or MCQ/CQ alias match
      if (typeStr === 'MCQ' || typeStr === 'বহুনির্বাচনি প্রশ্ন') {
        baseQuery += ` AND (q.q_type = $${params.length} OR q.q_type = 'MCQ' OR q.q_type = 'বহুনির্বাচনি প্রশ্ন')`;
      } else if (typeStr === 'CQ' || typeStr === 'সৃজনশীল প্রশ্ন') {
        baseQuery += ` AND (q.q_type = $${params.length} OR q.q_type = 'CQ' OR q.q_type = 'সৃজনশীল প্রশ্ন')`;
      } else {
        baseQuery += ` AND q.q_type = $${params.length}`;
      }
    }

    baseQuery += ` GROUP BY q.id, c.id`;

    // Safe Pagination Parse
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const offsetNum = (pageNum - 1) * limitNum;

    params.push(limitNum);
    baseQuery += ` ORDER BY q.created_at DESC LIMIT $${params.length}`;

    params.push(offsetNum);
    baseQuery += ` OFFSET $${params.length}`;

    const { rows } = await db.query(baseQuery, params);

    const totalQuestions = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const totalPages = Math.ceil(totalQuestions / limitNum) || 1;

    res.json({
      ok: true,
      page: pageNum,
      limit: limitNum,
      total_questions: totalQuestions,
      total_pages: totalPages,
      count: rows.length,
      data: rows
    });

  } catch (err) {
    console.error('FETCH QUESTIONS ERROR:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch questions' });
  }
});

export default router;