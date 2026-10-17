# EduCore Secure Starter

EduCore is a school management portal starter using a static HTML/CSS/JavaScript frontend, an Express backend, and PostgreSQL. It includes login sessions, role-based permissions, school-scoped records, validation, login rate limiting, security headers, and audit logs.

## Included modules

- Sign-in / sign-out with server-side sessions stored in PostgreSQL
- Roles: `admin`, `teacher`, `bursar`
- Student records, teacher directory, attendance, exam results, fee records, announcements, school settings, dashboard summary
- PostgreSQL schema with foreign keys and constraints
- Audit events for key changes

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer (local or managed)

## Run locally

1. Create a PostgreSQL database and user, then grant that user access to the database.
2. Copy `.env.example` to `.env` and update `DATABASE_URL` and `SESSION_SECRET`.
3. Install packages:

   ```bash
   npm install
   ```

4. Initialize the schema:

   ```bash
   npm run db:init
   ```

5. Create the first school and administrator. Use a unique, strong password (at least 12 characters):

   ```bash
   npm run admin:create -- "EduCore Demonstration School" "School Administrator" admin@example.com "Use-A-Long-Unique-Password!"
   ```

   The command creates a school and its first admin account. Do not put real passwords in shell history or shared screenshots; for a real deployment, use a secure one-time setup process.

6. Start the application:

   ```bash
   npm run dev
   ```

7. Open `http://localhost:3000` and sign in with the administrator account you created.

## Deploying

GitHub Pages only serves static files and cannot run this backend or PostgreSQL. Deploy the complete project to a Node.js-capable host, and use a managed PostgreSQL provider. Set `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, and `PORT` in the host's secret/environment settings. Keep the frontend and API on the same origin if possible. Production must use HTTPS.

If you choose to host the frontend on a separate origin, set `FRONTEND_ORIGIN` to its exact HTTPS origin and review the cookie/CORS/CSRF setup for your deployment. Do not use wildcard CORS with credentials.

## Security notes

- Passwords are hashed with bcrypt; plain-text passwords are never stored.
- Session cookies are HttpOnly and SameSite=Lax, and Secure in production.
- Sessions are stored in PostgreSQL rather than Express's in-memory default store.
- Login attempts are rate-limited.
- SQL queries use parameterized values.
- Queries are scoped to the signed-in user's school.
- Role checks run on the server; hiding a menu item in the UI is not an authorization control.
- Do not commit `.env`, credentials, real student records, database backups, or uploaded exports to GitHub.
- Use least-privilege database credentials, encrypted database connections, backups, monitoring, and a documented recovery process.
- This is a starter implementation, not a completed compliance/security audit. Before real student or financial data is used, commission a security review, test authorization boundaries, configure production TLS and backups, and add password reset/MFA and account provisioning workflows.
- Fee records track amounts; they do not process card/bank payments or integrate with a payment provider.

## API overview

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/dashboard/summary`
- `GET/POST /api/students`, `PUT/DELETE /api/students/:id`
- `GET/POST /api/teachers`, `PUT/DELETE /api/teachers/:id`
- `GET/POST /api/attendance`
- `GET/POST /api/results`, `DELETE /api/results/:id`
- `GET/POST /api/fees`, `PUT /api/fees/:id`
- `GET/POST /api/announcements`, `DELETE /api/announcements/:id`
- `GET/PUT /api/school/settings`

All write requests except login require the `X-EduCore-Request: 1` header, which the included `public/js/api.js` client sends automatically.
