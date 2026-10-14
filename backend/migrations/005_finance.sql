-- Phase 4 -> Phase 5 finance. BACKUP FIRST. RUN ONCE ONLY.
-- No automatic charges, withdrawals, webhook or processor are implemented.
USE quran_academy;
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
