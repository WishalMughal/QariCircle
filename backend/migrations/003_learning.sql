-- Upgrade ONLY: apply after Phase 2 schema. Safe additive migration for Phase 3 learning LMS.
USE quran_academy;
CREATE TABLE IF NOT EXISTS curriculum_units (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  unit_type ENUM('qaida','nazra','hifz','tajweed','uloom','general') NOT NULL DEFAULT 'general',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  learning_objectives TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_curriculum_course (course_id, is_published, sort_order),
  CONSTRAINT fk_curriculum_course FOREIGN KEY (course_id) REFERENCES courses(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS lesson_progress (
  enrollment_id BIGINT UNSIGNED NOT NULL,
  unit_id BIGINT UNSIGNED NOT NULL,
  status ENUM('not_started','in_progress','completed','needs_revision') NOT NULL DEFAULT 'not_started',
  score TINYINT UNSIGNED NULL,
  tutor_notes TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(enrollment_id, unit_id),
  CONSTRAINT fk_progress_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE,
  CONSTRAINT fk_progress_unit FOREIGN KEY (unit_id) REFERENCES curriculum_units(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS assignment_submissions (
  assignment_id BIGINT UNSIGNED PRIMARY KEY,
  submission_text TEXT NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  teacher_feedback TEXT,
  grade TINYINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  CONSTRAINT fk_submission_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
) ENGINE=InnoDB;
