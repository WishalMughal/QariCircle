CREATE DATABASE IF NOT EXISTS quran_academy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE quran_academy;
CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, name VARCHAR(120) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, role ENUM('student','tutor','parent','examiner','admin') NOT NULL, country VARCHAR(100), timezone VARCHAR(80) NOT NULL DEFAULT 'UTC', is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
CREATE TABLE refresh_sessions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, expires_at DATETIME NOT NULL, revoked_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_refresh_user(user_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB;
CREATE TABLE tutor_profiles (user_id BIGINT UNSIGNED PRIMARY KEY, bio TEXT, teaching_experience_years INT NOT NULL DEFAULT 0, hourly_rate DECIMAL(10,2), currency CHAR(3) DEFAULT 'USD', approval_status ENUM('draft','pending_review','documents_approved','test_scheduled','passed','retest','rejected','active','suspended') NOT NULL DEFAULT 'draft', verification_notes TEXT, FOREIGN KEY (user_id) REFERENCES users(id)) ENGINE=InnoDB;
CREATE TABLE tutor_languages (tutor_id BIGINT UNSIGNED NOT NULL, language_code VARCHAR(15) NOT NULL, PRIMARY KEY(tutor_id, language_code), FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id)) ENGINE=InnoDB;
CREATE TABLE courses (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, title VARCHAR(150) NOT NULL, slug VARCHAR(150) NOT NULL UNIQUE, description TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB;
CREATE TABLE tutor_courses (tutor_id BIGINT UNSIGNED NOT NULL, course_id BIGINT UNSIGNED NOT NULL, approved BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(tutor_id,course_id), FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id), FOREIGN KEY(course_id) REFERENCES courses(id)) ENGINE=InnoDB;
CREATE TABLE tutor_documents (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, tutor_id BIGINT UNSIGNED NOT NULL, document_type VARCHAR(50) NOT NULL, private_storage_key VARCHAR(300) NOT NULL, status ENUM('pending','approved','rejected') DEFAULT 'pending', uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id)) ENGINE=InnoDB;
CREATE TABLE tutor_tests (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, tutor_id BIGINT UNSIGNED NOT NULL, examiner_id BIGINT UNSIGNED, test_at DATETIME, recitation_score TINYINT UNSIGNED, tajweed_score TINYINT UNSIGNED, subject_score TINYINT UNSIGNED, demo_score TINYINT UNSIGNED, communication_score TINYINT UNSIGNED, result ENUM('scheduled','passed','failed','retest') NOT NULL DEFAULT 'scheduled', notes TEXT, FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id), FOREIGN KEY(examiner_id) REFERENCES users(id)) ENGINE=InnoDB;
CREATE TABLE student_profiles (user_id BIGINT UNSIGNED PRIMARY KEY, level ENUM('beginner','intermediate','advanced') DEFAULT 'beginner', preferred_language VARCHAR(15), is_minor BOOLEAN NOT NULL DEFAULT FALSE, FOREIGN KEY (user_id) REFERENCES users(id)) ENGINE=InnoDB;
CREATE TABLE guardians (guardian_id BIGINT UNSIGNED NOT NULL, student_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(guardian_id,student_id), FOREIGN KEY(guardian_id) REFERENCES users(id), FOREIGN KEY(student_id) REFERENCES users(id)) ENGINE=InnoDB;
CREATE TABLE booking_requests (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, student_id BIGINT UNSIGNED NOT NULL, tutor_id BIGINT UNSIGNED NOT NULL, course_id BIGINT UNSIGNED NOT NULL, starts_at DATETIME NOT NULL, ends_at DATETIME NOT NULL, status ENUM('requested','confirmed','rejected','cancelled','completed') NOT NULL DEFAULT 'requested', meet_url VARCHAR(300), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_tutor_time(tutor_id, starts_at,ends_at), FOREIGN KEY(student_id) REFERENCES users(id), FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id), FOREIGN KEY(course_id) REFERENCES courses(id)) ENGINE=InnoDB;
CREATE TABLE enrollments (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, student_id BIGINT UNSIGNED NOT NULL, tutor_id BIGINT UNSIGNED NOT NULL, course_id BIGINT UNSIGNED NOT NULL, status ENUM('active','paused','completed') DEFAULT 'active', UNIQUE KEY uniq_enrollment(student_id,tutor_id,course_id), FOREIGN KEY(student_id) REFERENCES users(id), FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id), FOREIGN KEY(course_id) REFERENCES courses(id)) ENGINE=InnoDB;
CREATE TABLE assignments (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, enrollment_id BIGINT UNSIGNED NOT NULL, title VARCHAR(200) NOT NULL, instructions TEXT, due_at DATETIME, status ENUM('assigned','submitted','reviewed') DEFAULT 'assigned', FOREIGN KEY(enrollment_id) REFERENCES enrollments(id)) ENGINE=InnoDB;
CREATE TABLE hifz_logs (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, enrollment_id BIGINT UNSIGNED NOT NULL, log_date DATE NOT NULL, category ENUM('sabaq','sabqi','manzil') NOT NULL, from_surah SMALLINT UNSIGNED, to_surah SMALLINT UNSIGNED, notes TEXT, mistakes SMALLINT UNSIGNED DEFAULT 0, FOREIGN KEY(enrollment_id) REFERENCES enrollments(id)) ENGINE=InnoDB;
CREATE TABLE attendance (booking_id BIGINT UNSIGNED PRIMARY KEY, student_attended BOOLEAN, tutor_attended BOOLEAN, teacher_notes TEXT, FOREIGN KEY(booking_id) REFERENCES booking_requests(id)) ENGINE=InnoDB;
CREATE TABLE payments (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, student_id BIGINT UNSIGNED NOT NULL, amount DECIMAL(12,2) NOT NULL, currency CHAR(3) NOT NULL, provider VARCHAR(40), provider_reference VARCHAR(180), status ENUM('pending','paid','failed','refunded') DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(student_id) REFERENCES users(id)) ENGINE=InnoDB;
CREATE TABLE payouts (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, tutor_id BIGINT UNSIGNED NOT NULL, amount DECIMAL(12,2) NOT NULL, currency CHAR(3) NOT NULL, status ENUM('requested','approved','sent','rejected') DEFAULT 'requested', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id)) ENGINE=InnoDB;
CREATE TABLE conversations (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, student_id BIGINT UNSIGNED NOT NULL, tutor_id BIGINT UNSIGNED NOT NULL, UNIQUE KEY uniq_chat(student_id,tutor_id), FOREIGN KEY(student_id) REFERENCES users(id), FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id)) ENGINE=InnoDB;
CREATE TABLE messages (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, conversation_id BIGINT UNSIGNED NOT NULL, sender_id BIGINT UNSIGNED NOT NULL, body TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(conversation_id) REFERENCES conversations(id), FOREIGN KEY(sender_id) REFERENCES users(id)) ENGINE=InnoDB;
CREATE TABLE reviews (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, student_id BIGINT UNSIGNED NOT NULL, tutor_id BIGINT UNSIGNED NOT NULL, rating TINYINT UNSIGNED NOT NULL, comment TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(student_id) REFERENCES users(id), FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id)) ENGINE=InnoDB;
CREATE TABLE audit_logs (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, actor_id BIGINT UNSIGNED, action VARCHAR(120) NOT NULL, target_id BIGINT UNSIGNED, details JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(actor_id) REFERENCES users(id)) ENGINE=InnoDB;
INSERT IGNORE INTO courses (title,slug) VALUES ('Noorani Qaida','noorani-qaida'),('Nazra Quran','nazra-quran'),('Hifz-ul-Quran','hifz-ul-quran'),('Tajweed','tajweed'),('Islamic Uloom','islamic-uloom');

-- Phase 3 learning module
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
-- Upgrade Phase 3 -> Phase 4. Take a backup before applying; do not re-import schema.sql.
CREATE TABLE IF NOT EXISTS tutor_availability (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tutor_id BIGINT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL COMMENT '0=Sunday, 6=Saturday',
  start_minute SMALLINT UNSIGNED NOT NULL COMMENT 'Minutes after midnight in tutor IANA timezone',
  end_minute SMALLINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_tutor_day_start (tutor_id,weekday,start_minute),
  CONSTRAINT fk_availability_tutor FOREIGN KEY (tutor_id) REFERENCES tutor_profiles(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS tutor_blackouts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tutor_id BIGINT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  KEY idx_blackout (tutor_id,starts_at,ends_at),
  CONSTRAINT fk_blackout_tutor FOREIGN KEY (tutor_id) REFERENCES tutor_profiles(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('booking','message','reminder','system') NOT NULL,
  title VARCHAR(140) NOT NULL,
  body VARCHAR(300) NOT NULL,
  booking_id BIGINT UNSIGNED NULL,
  dedupe_key VARCHAR(120) NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notification_dedupe (user_id,dedupe_key),
  KEY idx_notifications_user (user_id,id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_booking FOREIGN KEY (booking_id) REFERENCES booking_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY(conversation_id,user_id),
  CONSTRAINT fk_conversation_reads_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_reads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id,id);

-- Cumulative Phase 5 finance schema (new installs)
-- Phase 4 -> Phase 5 finance. BACKUP FIRST. RUN ONCE ONLY.
-- No automatic charges, withdrawals, webhook or processor are implemented.

CREATE TABLE finance_booking_quotes (
  booking_id BIGINT UNSIGNED PRIMARY KEY,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  commission_bps SMALLINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_finance_quote_booking FOREIGN KEY(booking_id) REFERENCES booking_requests(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE finance_invoices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL UNIQUE,
  student_id BIGINT UNSIGNED NOT NULL,
  tutor_id BIGINT UNSIGNED NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  commission_bps SMALLINT UNSIGNED NOT NULL,
  status ENUM('issued','under_review','paid','void') NOT NULL DEFAULT 'issued',
  paid_at DATETIME NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_finance_student (student_id,id),
  KEY idx_finance_invoice_status (status,id),
  CONSTRAINT fk_finance_invoice_booking FOREIGN KEY(booking_id) REFERENCES booking_requests(id),
  CONSTRAINT fk_finance_invoice_student FOREIGN KEY(student_id) REFERENCES users(id),
  CONSTRAINT fk_finance_invoice_tutor FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id),
  CONSTRAINT fk_finance_invoice_reviewer FOREIGN KEY(reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE finance_payment_claims (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  method ENUM('bank_transfer','jazzcash','easypaisa','external') NOT NULL,
  external_reference VARCHAR(120) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  status ENUM('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
  reviewer_id BIGINT UNSIGNED NULL,
  review_note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  KEY idx_claim_status (status,id),
  KEY idx_claim_invoice (invoice_id,id),
  CONSTRAINT fk_finance_claim_invoice FOREIGN KEY(invoice_id) REFERENCES finance_invoices(id),
  CONSTRAINT fk_finance_claim_student FOREIGN KEY(student_id) REFERENCES users(id),
  CONSTRAINT fk_finance_claim_reviewer FOREIGN KEY(reviewer_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE finance_earnings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id BIGINT UNSIGNED NOT NULL UNIQUE,
  booking_id BIGINT UNSIGNED NOT NULL UNIQUE,
  tutor_id BIGINT UNSIGNED NOT NULL,
  gross_minor BIGINT UNSIGNED NOT NULL,
  commission_minor BIGINT UNSIGNED NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  released_by BIGINT UNSIGNED NOT NULL,
  released_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_earnings_tutor (tutor_id,currency,id),
  CONSTRAINT fk_finance_earning_invoice FOREIGN KEY(invoice_id) REFERENCES finance_invoices(id),
  CONSTRAINT fk_finance_earning_booking FOREIGN KEY(booking_id) REFERENCES booking_requests(id),
  CONSTRAINT fk_finance_earning_tutor FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id),
  CONSTRAINT fk_finance_earning_admin FOREIGN KEY(released_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE finance_payout_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tutor_id BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  payout_method ENUM('bank_transfer','jazzcash','easypaisa','paypal','other') NOT NULL,
  payout_note VARCHAR(200) NOT NULL DEFAULT '',
  status ENUM('requested','approved','sent','rejected') NOT NULL DEFAULT 'requested',
  external_reference VARCHAR(120) NULL,
  admin_note VARCHAR(500) NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  KEY idx_payout_tutor (tutor_id,currency,status),
  KEY idx_payout_status (status,id),
  CONSTRAINT fk_finance_payout_tutor FOREIGN KEY(tutor_id) REFERENCES tutor_profiles(user_id),
  CONSTRAINT fk_finance_payout_reviewer FOREIGN KEY(reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Phase 6: private, expiring one-time guardian invitations.
CREATE TABLE IF NOT EXISTS guardian_invites (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  claimed_at DATETIME NULL,
  claimed_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_invites_student (student_id,expires_at),
  CONSTRAINT fk_guardian_invite_student FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_guardian_invite_parent FOREIGN KEY(claimed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- QariCircle Phase 7 enhancements: apply ONCE to existing Phase 6 database after backup.
CREATE TABLE IF NOT EXISTS support_tickets (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL, related_user_id BIGINT UNSIGNED NULL,
 category ENUM('technical','booking','billing','safety','other') NOT NULL,
 subject VARCHAR(160) NOT NULL, message TEXT NOT NULL,
 status ENUM('open','in_review','resolved','closed') NOT NULL DEFAULT 'open',
 admin_note TEXT NULL, reviewed_by BIGINT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_support_user (user_id,id),INDEX idx_support_status(status,id),
 FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(related_user_id) REFERENCES users(id),FOREIGN KEY(reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS account_deletion_requests (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL UNIQUE,
 reason VARCHAR(500) NOT NULL DEFAULT '',status ENUM('requested','in_review','completed','rejected') NOT NULL DEFAULT 'requested',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB;
