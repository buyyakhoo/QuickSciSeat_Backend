CREATE TYPE user_type_enum AS ENUM ('student', 'admin');

CREATE TABLE Users (
    user_id VARCHAR(8) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    user_type user_type_enum NOT NULL DEFAULT 'student',
    CONSTRAINT user_id_format_check CHECK (user_id ~ '^\d{8}$')
);