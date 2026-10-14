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
