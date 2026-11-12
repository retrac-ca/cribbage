-- Better Auth now owns user sessions and verification records. These legacy
-- tables were verified empty after the cutover and are no longer referenced.
DROP TABLE sessions;
DROP TABLE auth_tokens;
