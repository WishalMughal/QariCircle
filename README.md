# Global Quran Academy — Option B / Phase 6

**Cumulative source project: Phases 1 through 6.**

Flutter (Riverpod) + Node.js/Express + MySQL 8.4. **Google Meet links** for classes; built-in Audio/Video **Coming Soon**, no native video SDK. Payment confirmation and payouts are **manual records**, not live gateway transfers.

## What's new in Phase 6

1. **Actual Parent Portal:** student privately generates a 40-character one-time invitation valid for 48 hours. Only a registered parent role may redeem it; no public search/automatic child association. Guardian/child can revoke access. Parent can read linked child's courses, completed lesson counts, Hifz log counts and attendance, but not Meet URLs, chat, tutor private documents or payment details.
2. **Backend security operations:** random response request IDs, overall API rate limit in addition to login limiter, safe JSON errors, stricter production CORS and JWT-secret configuration checks, health endpoint and MySQL readiness endpoint, graceful HTTP/MySQL shutdown.
3. **Responsive Flutter shell:** six main navigation screens use a NavigationRail on wide layouts and NavigationBar on phones. Student/Parent Family screens added to Home, Account and toolbar.
4. **DevOps:** local Docker Compose with MySQL + API + class-reminder worker, opt-in local HTTP smoke test, offline environment diagnostic, Node rules CI / Flutter analyze CI, Android release build helper script.
5. **QA:** inherited Phase 1–5 unit tests retained; guardian, config and source-contract tests added. This is source validation, not a completed live database or Android release certification.

## Files

```text
quran_academy_option_b_phase6/
  backend/
    schema.sql
    migrations/002_*.sql ... 006_parent_access.sql
    src/server.js, phase2.js, learning.js, communication.js, finance.js, family.js
    src/family_rules.js, operations_rules.js
    scripts/create_staff.js, doctor.mjs, smoke_http.mjs
    test/*.test.js
    Dockerfile
  flutter_app/
    lib/main.dart, screens.dart, family_screen.dart, ...
    pubspec.yaml
  .github/workflows/check.yml
  compose.yaml
  .env.compose.example
  scripts/build_android.sh
  TEST_RESULTS_PHASE6.txt
```

## Start backend locally using Docker (NEW database)

1. Install Docker Desktop / Docker Engine with Compose.
2. In the project root, copy `.env.compose.example` to `.env`. **Replace all example passwords and secret with unique strong values.** Never commit `.env`.
3. Run:

```bash
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:4000/api/health
curl http://127.0.0.1:4000/api/ready
```

- The database is initialized from `backend/schema.sql` **only on first creation of its empty Docker volume**. If an old DB volume exists, **do not expect new schema migrations to auto-apply**.
- Database is bound to `127.0.0.1:3307`; API is bound to `127.0.0.1:4000` for local use only.
- `reminders` is a separate worker. `private_docs` is mounted as a persistent non-public volume in the API container.
- To investigate errors: `docker compose logs --tail=100 api db reminders`.
- Docker starts nothing in production-ready mode and adds no TLS; use secure HTTPS reverse proxy, secret management, backups and audits before serving users.

## Upgrade existing Phase 5 database to Phase 6

**Back up the entire database and all private upload files FIRST.** Do not reimport `schema.sql` into an existing install.

Standalone MySQL:

```bash
mysqldump -u quran_app -p quran_academy > backup_before_phase6.sql
mysql -u quran_app -p < backend/migrations/006_parent_access.sql
```

If upgrading directly from an earlier phase, apply any missing 002, 003, 004, 005 migrations sequentially, then 006. Schema migrations are intended to run once. Test against a copy of your database before production.

Docker-managed existing Phase 5 DB:

```bash
# With docker compose root .env present, create a database backup before changing anything.
docker compose exec -T db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" quran_academy' > backup_before_phase6.sql
# Load the migration only after backup and review.
docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" quran_academy' < backend/migrations/006_parent_access.sql
```

### Without Docker

```bash
cd backend
cp .env.example .env
# Configure real local MySQL credentials and strong JWT_SECRET.
npm install
npm run doctor
npm run check
npm test
npm run dev
# Another terminal: npm run reminders
```

## Flutter / Android preparation

The repository contains Flutter `lib/`, `pubspec.yaml`, but **no prebuilt APK and no fully generated native Android/iOS platform projects**. On a workstation with Flutter + Android SDK:

```bash
cd flutter_app
flutter create . --platforms=android,ios,web --project-name quran_academy
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=API_BASE=http://10.0.2.2:4000/api
```

`10.0.2.2` is Android Emulator only. A real phone must use a reachable API domain/network address. Recent Android targets restrict cleartext HTTP: if local debugging is necessary, configure the **debug** Android manifest to allow it and remove that exception from release. For production, **require a working HTTPS API**. The release helper enforces an https API input:

```bash
bash scripts/build_android.sh https://api.youracademy.example/api
```

Before shipping, configure your own package identifier, signed Android release keystore, privacy policy, child-safety procedures, permission declarations and deployment configuration.

## Phase 6 endpoints

| Method | Endpoint | Authorization |
| --- | --- | --- |
| GET | `/api/health` | Public, liveness, no database check |
| GET | `/api/ready` | Public, tests MySQL connection |
| POST | `/api/family/invitations` | Student, creates one-time 48-hour code |
| POST | `/api/family/invitations/accept` | Parent, redeems code |
| GET | `/api/family/guardians` | Student, linked parent accounts |
| DELETE | `/api/family/guardians/:id` | Student revokes guardian |
| GET | `/api/family/children` | Parent, linked children summary |
| GET | `/api/family/children/:id/progress` | Linked parent only |
| GET | `/api/family/children/:id/classes` | Linked parent only; no Meet URL |
| DELETE | `/api/family/children/:id` | Parent disconnects child |

All prior routes remain, including tutor verification and test results, courses, learning plans, homework, Hifz, scheduling, confirmed Google Meet booking, restricted messaging, notifications, manual invoices and tutor wallet. A child's own registration does NOT yet constitute legally sufficient guardian identity verification or parental consent for paid lessons; implement policy-appropriate verification before serving minors.

## Integration smoke test (requires LIVE LOCAL API + real MySQL)

Run this **only with a disposable local development DB**. It creates three new test users and parent links, then unlinks; it intentionally refuses non-local URLs and needs an explicit opt-in:

```bash
cd backend
SMOKE_ALLOW_MUTATION=yes SMOKE_API_BASE=http://127.0.0.1:4000/api npm run smoke
```

Covers: ready endpoint, student registration/login, parent registration/login, 48-hour invite, redemption, single-use enforcement, unrelated-parent denial, read-only progress access and unlink. This script has **not** been executed in this packaging environment because no MySQL service or npm dependencies could be installed here.

## Testing status & release blockers

**Verified locally in packaging environment:** `npm run check` backend syntax, **34/34 dependency-free Node rule/contract tests**, ZIP content validation once packaged. `npm install` could not download packages in this runtime (DNS/network issue). Flutter SDK, MySQL server, Android SDK and Docker runtime were not present. Therefore **Flutter analyze, actual Docker deployment, HTTP integration smoke, real DB migration and APK compilation were NOT verified** here.

Before real launch, complete end-to-end QA for roles and privacy, tutor document upload/download, exam pass/retest, price snapshots, invoice reconciliation, withdrawal race handling, parent/child consent, Google Meet external launch, timezone/DST scheduling, notification worker, backups/restores, rate limiting and security review. Financial workflows still lack automatic webhooks, dispute/refund/chargeback handling and reconciliation; never call a manual payment reference automatically paid. Do not collect real payments or minors' sensitive data before the necessary controls are implemented and independently reviewed.
