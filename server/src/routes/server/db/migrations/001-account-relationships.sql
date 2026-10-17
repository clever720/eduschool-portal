
BEGIN;

-- Expand the supported account roles without deleting existing users.
DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format(
      'ALTER TABLE users DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'teacher', 'bursar', 'parent', 'student'));

-- Unique composite keys allow PostgreSQL to enforce school ownership.
CREATE UNIQUE INDEX IF NOT EXISTS users_id_school_id_uidx
  ON users(id, school_id);

CREATE UNIQUE INDEX IF NOT EXISTS students_id_school_id_uidx
  ON students(id, school_id);

-- Connect a teacher's login account to their existing staff record.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'teachers'::regclass
      AND conname = 'teachers_user_id_fkey'
  ) THEN
    ALTER TABLE teachers
      ADD CONSTRAINT teachers_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS teachers_user_id_uidx
  ON teachers(user_id)
  WHERE user_id IS NOT NULL;

-- Link a student login to exactly one student record.
CREATE TABLE IF NOT EXISTS student_accounts (
  user_id UUID PRIMARY KEY,
  student_id UUID NOT NULL UNIQUE,
  school_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT student_accounts_user_school_fk
    FOREIGN KEY (user_id, school_id)
    REFERENCES users(id, school_id)
    ON DELETE CASCADE,

  CONSTRAINT student_accounts_student_school_fk
    FOREIGN KEY (student_id, school_id)
    REFERENCES students(id, school_id)
    ON DELETE CASCADE
);

-- Link parent accounts to their verified children.
CREATE TABLE IF NOT EXISTS parent_student_links (
  parent_user_id UUID NOT NULL,
  student_id UUID NOT NULL,
  school_id UUID NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (parent_user_id, student_id),

  CONSTRAINT parent_links_user_school_fk
    FOREIGN KEY (parent_user_id, school_id)
    REFERENCES users(id, school_id)
    ON DELETE CASCADE,

  CONSTRAINT parent_links_student_school_fk
    FOREIGN KEY (student_id, school_id)
    REFERENCES students(id, school_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS parent_links_student_idx
  ON parent_student_links(school_id, student_id);

CREATE INDEX IF NOT EXISTS parent_links_parent_idx
  ON parent_student_links(parent_user_id, school_id);

COMMIT;
