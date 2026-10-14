-- Upgrade Phase 3 -> Phase 4. Take a backup before applying; do not re-import schema.sql.
USE quran_academy;
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
