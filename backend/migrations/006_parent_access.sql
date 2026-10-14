-- Phase 6 upgrade, from Phase 5. Back up your DB before applying.
USE quran_academy;
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
