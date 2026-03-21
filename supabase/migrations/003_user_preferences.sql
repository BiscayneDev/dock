alter table users add column if not exists preferences jsonb default '{}'::jsonb;
