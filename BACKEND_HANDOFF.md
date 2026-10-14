# QariCircle Phase 7 backend handoff (Flutter + Riverpod)

## Package and release status
This is an **enhancement of the supplied Phase 6 Express/MySQL backend**, not a rewrite. The uploaded ZIP did **not include a Flutter project**. No signed APK/AAB, push credentials, email provider, or live MySQL environment were provided. Passing unit/source tests is **not** evidence of production readiness.

## Local quick start (fresh MySQL)
1. Install Docker and Docker Compose. Copy `.env.compose.example` to `.env` in the project root. Generate `JWT_SECRET` with `openssl rand -hex 48` and choose non-default `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD`. Never commit `.env`.
2. `docker compose up --build -d`; check `docker compose ps` and `curl http://127.0.0.1:4000/api/health`.
3. See `backend/schema.sql` (fresh database only) and `backend/scripts/seed_curriculum.sql` (optional). 
4. `cd backend && npm ci` only if a lockfile exists; otherwise `npm install`, then `npm run check && npm test`.

## Upgrade *existing* Phase 6 database
1. **Back up and restore-test** old DB; keep the existing `quran_academy` DB name.
2. **DO NOT re-import `schema.sql`** on an existing DB. Apply `backend/migrations/007_qaricircle.sql` once, after migrations 002–006.
3. Deploy updated API and run representative live workflows; do not delete existing booking, chat, curriculum, invoices, wallet or guardian records.

## Flutter connectivity
Base URL local browser: `http://localhost:4000/api` ; Android emulator: `http://10.0.2.2:4000/api` (dev only); physical phone: use your machine LAN IP with network firewall exception (dev only); production: `https://api.yourdomain.com/api` behind TLS. Flutter `dio` Authorization header = `Bearer <access_token>`. On 401 refresh via `/auth/refresh` (rotating refresh tokens), retry exactly once, then sign out if invalid. Keep refresh credentials in `flutter_secure_storage`; never store them in logs.

## Main legacy endpoints preserved
- Auth: POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; GET `/me`.
- Guest: GET `/courses`, `/tutors`, `/tutors/:id`.
- Tutor: GET/PUT `/tutor/profile`, POST `/tutor/documents`, `/tutor/submit`; admin review and examiner endpoints in `src/phase2.js`.
- Schedule: `/schedule/availability`, `/schedule/blackouts`, `/schedule/tutors/:id/slots`; student `/bookings`, tutor `/bookings/:id/confirm` with `meet_url`, GET `/bookings/:id/meet` only for participants.
- Chat: `/conversations`, `/conversations/:id/messages`, `/conversations/:id/read`. Poll messages and unread counts.
- Notifications: GET `/notifications`, PATCH `/notifications/:id/read`; reminder-worker sends in-app notices.
- Learning: `/learning/...` enrollment, assignments, progress, Hifz, attendance.
- Family: `/family/...` guardian invitation/revocation and safe progress.
- Finance: `/finance/...` invoicing, manual payment claims/admin verification, earnings/wallet and payouts. No live gateway.

## Phase 7 added endpoints
| Method | URL | Permission | Description |
| --- | --- | --- | --- |
| GET | `/brand` | public | Name, tagline, palette, Meet-only/calls coming soon policy |
| GET | `/public/catalog` | public | Published courses and verified tutor count |
| PATCH | `/me/profile` | student/tutor/parent | `{name?,country?,timezone?}` |
| PATCH | `/me/password` | login required | `{current_password,new_password}`; revokes refresh sessions |
| GET | `/me/privacy` | login required | own profile snapshot |
| POST | `/me/deletion-request` | login required | `{reason?}` submits human-reviewed removal request |
| GET | `/notifications/summary` | login required | unread count |
| PATCH | `/notifications/read-all` | login required | mark own notifications read |
| POST | `/support/tickets` | login required | `{category,subject,message,related_user_id?}` |
| GET | `/support/tickets` | login required | own tickets; admin can list all |
| PATCH | `/support/tickets/:id` | admin | `{status,admin_note}` and audit |
| GET | `/admin/audit-logs` | admin | 100 newest records, optional `before_id` |
| GET | `/admin/deletion-requests` | admin | review queue, no auto erasure |
| GET | `/admin/reports/overview` | admin | operational counts |

## Flutter Dio example
```dart
final dio = Dio(BaseOptions(baseUrl: 'https://api.yourdomain.com/api'));
dio.options.headers['Authorization'] = 'Bearer $accessToken';
final brand = (await dio.get('/brand')).data;
final chats = (await dio.get('/conversations')).data;
final inbox = (await dio.get('/notifications')).data;
```

## Must complete before production
- Real MySQL Docker tests, database migration backup/restore, transaction/concurrency and authorization probes (especially child profile/documents/chat/Meet/payment)
- Email ownership verification, safe password-recovery email flow, stronger verified guardian identity & consent, moderation escalation and retention/deletion operational process
- Production security assessment, granular admin permissions, object-store or backed-up private documents, analytics, file scanning, hosted monitoring
- FCM/APNs push notifications, email/SMS and payment gateway **not implemented**; current supported notifications are in-app + reminder worker.
- Real PDF invoice export service not supplied here (invoice data endpoints exist; PDF rendering may be implemented in Flutter or backend).
- Flutter compile/test, Android signing, secure HTTPS, legal/privacy documentation, payments reconciliation and app store compliance.

**Note:** original Phase 6 test expected `flutter_app/lib/family_screen.dart` in an archive that contains only a backend; the test was corrected to require the existing backend family module instead.
