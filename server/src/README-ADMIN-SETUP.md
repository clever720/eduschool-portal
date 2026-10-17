# EduCore Secure — Administrator Setup Guide

## 1. Purpose

This document describes the recommended setup for administrator access to the EduCore Secure School Management Portal.

**Safety requirement:** This guide is documentation only. It does not modify application behavior, create administrator accounts, alter database tables, or change deployment settings.

## 2. Existing Application Files

The following files must be preserved unless a deliberate, tested change is required:

- `public/index.html` — existing website entry page.
- `server/src/index.js` — existing Express server entry point.
- `package.json` — project dependencies and application commands.
- `server/src/db.js` — database connection, if present.
- `server/src/init-db.js` — database initialization, if present.
- `server/src/create-admin.js` — administrator creation utility, if present.
- Existing route and middleware files.

Do not replace these files merely to add administrator access.

## 3. Recommended Administrator Features

The application should provide the following features:

1. A dedicated administrator login page.
2. Secure administrator account creation or initial provisioning.
3. Server-side password verification.
4. Session management with secure cookie settings.
5. Server-side role-based authorization.
6. An administrator dashboard protected against unauthorized access.
7. Clear sign-in, sign-out, and error handling.
8. Audit logging for important administrative actions.

## 4. Recommended Access Control

Administrator access must be enforced by the server, not just by hiding links or buttons in the browser.

- Public visitors must not automatically receive administrator privileges.
- Public registration must not allow a user to choose an administrator role.
- Administrator passwords must be hashed using a suitable password-hashing library.
- Protected API routes must verify the user's authenticated session and authorized role.
- Session secrets and database credentials must be stored in the hosting provider's environment variables.
- The first administrator account should be created through a controlled setup process, not through unrestricted public registration.

## 5. Database and Environment Configuration

Before enabling administrator login, verify that:

- A managed PostgreSQL database has been provisioned, if PostgreSQL is the configured database.
- The database connection environment variable is configured correctly in the hosting dashboard.
- Required database tables and indexes exist.
- Database initialization is safe to run according to the existing application design.
- No database passwords, session secrets, or administrator passwords are committed to GitHub.

Do not run database reset or destructive migration commands against production data without a verified backup and recovery plan.

## 6. Deployment Requirements

For the existing Node.js application on Render, verify the service configuration before deploying:

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Node.js version:** Compatible with the version declared in `package.json`.
- **Environment variables:** Configure required secrets and database settings in Render.

After deployment, review the build and runtime logs. Confirm that the service starts successfully before testing administrator access.

## 7. Testing Checklist

Before using the portal with real school information, verify all of the following:

- [ ] The public website loads successfully.
- [ ] The administrator login page is accessible.
- [ ] An authorized administrator can sign in.
- [ ] Incorrect credentials are rejected.
- [ ] Unauthorized users cannot access the administrator dashboard or protected API routes.
- [ ] Logging out invalidates the session.
- [ ] Administrator accounts cannot be created through unrestricted public registration.
- [ ] Database operations persist correctly.
- [ ] Existing pages and functions continue to work.
- [ ] Production secrets are not exposed to the browser or repository.
- [ ] Backups and recovery procedures have been tested.

## 8. Safe Change Procedure

For every application change:

1. Review the current implementation before editing.
2. Make a focused change instead of replacing the entire application.
3. Test the change in a non-production environment when possible.
4. Run available automated checks.
5. Review the deployment logs.
6. Verify both the changed feature and existing features.
7. Keep a known-good commit available for rollback.

## 9. Production Readiness Notice

Documentation alone does not establish that the portal has secure authentication, working database persistence, complete school-management functionality, or production readiness.

These capabilities must be verified in the actual application code and tested deployment before the portal is used for real student, staff, financial, or other confidential school records.

---

**Project:** EduCore Secure School Management Portal  
**Document:** Administrator Setup Guide  
**Status:** Documentation only — implementation and security verification required.
