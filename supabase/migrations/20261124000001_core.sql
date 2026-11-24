CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE public.organizations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,slug text UNIQUE NOT NULL CHECK(slug ~ '^[a-z0-9-]{3,64}$'),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.profiles(
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,organization_id uuid REFERENCES organizations(id),
 role text NOT NULL CHECK(role IN ('STUDENT','TEACHER','COLLEGE_ADMIN','PLATFORM_OWNER')),full_name text NOT NULL,email text NOT NULL,
 department_id uuid,status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((role='PLATFORM_OWNER' AND organization_id IS NULL) OR (role<>'PLATFORM_OWNER' AND organization_id IS NOT NULL))
);
CREATE TABLE public.departments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,name text NOT NULL,code text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,code)
);
ALTER TABLE profiles ADD CONSTRAINT profiles_department_fk FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE SET NULL;
CREATE TABLE public.classes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,department_id uuid REFERENCES departments(id),
 name text NOT NULL,code text NOT NULL,academic_year text,semester int CHECK(semester BETWEEN 1 AND 12),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,code)
);
CREATE TABLE public.class_members(
 class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('STUDENT','TEACHER')),added_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(class_id,user_id)
);
