CREATE DATABASE IF NOT EXISTS college_portal
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE college_portal;

CREATE TABLE IF NOT EXISTS users (
  user_id            INT AUTO_INCREMENT PRIMARY KEY,
  name               VARCHAR(100) NOT NULL,
  email              VARCHAR(150) NOT NULL UNIQUE,
  password_hash      VARCHAR(255) NOT NULL,
  role               ENUM('student','alumni','admin') NOT NULL DEFAULT 'student',
  college_id         VARCHAR(50)  NOT NULL,
  is_verified        TINYINT(1)   NOT NULL DEFAULT 0,
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  refresh_token_hash CHAR(64)     NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  event_id              INT AUTO_INCREMENT PRIMARY KEY,
  title                 VARCHAR(200) NOT NULL,
  description           TEXT         NOT NULL,
  event_date            DATETIME     NOT NULL,
  venue                 VARCHAR(200) NOT NULL,
  capacity              INT          NOT NULL CHECK (capacity > 0),
  organizer_id          INT          NOT NULL,
  category              VARCHAR(60)  NOT NULL,
  registration_deadline DATETIME     NOT NULL,
  banner_url            VARCHAR(255) NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organizer_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_events_date (event_date),
  INDEX idx_events_category (category)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_registrations (
  reg_id        INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  event_id      INT NOT NULL,
  status        ENUM('confirmed','waitlisted','cancelled') NOT NULL,
  registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_event (user_id, event_id),
  FOREIGN KEY (user_id)  REFERENCES users(user_id)   ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  INDEX idx_reg_event_status (event_id, status, registered_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alumni_profiles (
  alumni_id       INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL UNIQUE,
  graduation_year SMALLINT     NOT NULL,
  degree          VARCHAR(100) NOT NULL,
  company         VARCHAR(120) NULL,
  designation     VARCHAR(120) NULL,
  linkedin_url    VARCHAR(255) NULL,
  bio             TEXT         NULL,
  profile_pic_url VARCHAR(255) NULL,
  is_approved     TINYINT(1)   NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_alumni_year (graduation_year)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_posts (
  job_id      INT AUTO_INCREMENT PRIMARY KEY,
  alumni_id   INT NOT NULL,
  title       VARCHAR(200) NOT NULL,
  company     VARCHAR(150) NOT NULL,
  location    VARCHAR(150) NOT NULL,
  description TEXT         NOT NULL,
  posted_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deadline    DATE         NOT NULL,
  FOREIGN KEY (alumni_id) REFERENCES alumni_profiles(alumni_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS news (
  news_id    INT AUTO_INCREMENT PRIMARY KEY,
  admin_id   INT NOT NULL,
  title      VARCHAR(200) NOT NULL,
  body       TEXT         NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS comments (
  comment_id INT AUTO_INCREMENT PRIMARY KEY,
  news_id    INT NOT NULL,
  user_id    INT NOT NULL,
  body       VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (news_id) REFERENCES news(news_id)  ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_comments_news (news_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS connections (
  conn_id      INT AUTO_INCREMENT PRIMARY KEY,
  requester_id INT NOT NULL,
  addressee_id INT NOT NULL,
  status       ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pair (requester_id, addressee_id),
  FOREIGN KEY (requester_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (addressee_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;