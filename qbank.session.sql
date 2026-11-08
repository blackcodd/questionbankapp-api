-- 1. Exams Table
CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  teacher_id UUID,
  teacher_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Exam Questions Mapping (added correct_option)
CREATE TABLE IF NOT EXISTS exam_questions (
  id SERIAL PRIMARY KEY,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  correct_option INT DEFAULT 0 -- 0: ক, 1: খ, 2: গ, 3: ঘ
);

-- 3. Exam Submissions / Results
CREATE TABLE IF NOT EXISTS exam_submissions (
  id SERIAL PRIMARY KEY,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  student_name VARCHAR(100) NOT NULL,
  score INT NOT NULL,
  total_questions INT NOT NULL,
  submitted_at TIMESTAMP DEFAULT NOW()
);