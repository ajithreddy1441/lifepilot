-- LifePilot AI schema (MySQL 8 / MariaDB 10.6+)
-- Every DATETIME column stores UTC. Wall-clock fields (TIME / DATE) are interpreted in the row's or user's timezone.

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  theme ENUM('light','dark','system') NOT NULL DEFAULT 'system',
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INT UNSIGNED PRIMARY KEY,
  wake_time TIME NOT NULL DEFAULT '06:30:00',
  sleep_time TIME NOT NULL DEFAULT '23:00:00',
  work_start TIME NOT NULL DEFAULT '09:30:00',
  work_end TIME NOT NULL DEFAULT '18:30:00',
  work_days VARCHAR(40) NOT NULL DEFAULT 'MON,TUE,WED,THU,FRI',
  preferred_workout_time ENUM('morning','afternoon','evening') NOT NULL DEFAULT 'morning',
  preferred_creative_time ENUM('morning','afternoon','evening','night') NOT NULL DEFAULT 'night',
  preferred_freelance_time ENUM('morning','afternoon','evening','night') NOT NULL DEFAULT 'evening',
  min_break_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  max_focus_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 90,
  default_reminder_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  default_snooze_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  default_alarm_sound VARCHAR(60) NOT NULL DEFAULT 'default',
  default_vibration TINYINT(1) NOT NULL DEFAULT 1,
  notify_target ENUM('all','phone','laptop') NOT NULL DEFAULT 'all',
  onboarded TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  slug VARCHAR(60) NOT NULL,
  icon VARCHAR(16) NOT NULL DEFAULT '📌',
  color VARCHAR(16) NOT NULL DEFAULT '#6366f1',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cat_user_slug (user_id, slug),
  CONSTRAINT fk_cat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NULL,
  title VARCHAR(190) NOT NULL,
  description TEXT NULL,
  target_value INT UNSIGNED NULL,
  current_value INT UNSIGNED NOT NULL DEFAULT 0,
  unit VARCHAR(40) NULL,
  target_date DATE NULL,
  status ENUM('active','completed','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_goals_user (user_id),
  CONSTRAINT fk_goal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_goal_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goal_milestones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  goal_id INT UNSIGNED NOT NULL,
  title VARCHAR(190) NOT NULL,
  due_date DATE NULL,
  completed_at DATETIME NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ms_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS habits (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NULL,
  title VARCHAR(120) NOT NULL,
  icon VARCHAR(16) NOT NULL DEFAULT '✅',
  repeat_days VARCHAR(40) NOT NULL DEFAULT 'MON,TUE,WED,THU,FRI,SAT,SUN',
  target_per_week TINYINT UNSIGNED NOT NULL DEFAULT 7,
  reminder_time TIME NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  reminder_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  alarm_id INT UNSIGNED NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_habits_user (user_id),
  CONSTRAINT fk_habit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_habit_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS habit_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  habit_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  log_date DATE NOT NULL,
  value SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_habit_day (habit_id, log_date),
  CONSTRAINT fk_hl_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
  CONSTRAINT fk_hl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurring_tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NULL,
  title VARCHAR(190) NOT NULL,
  description TEXT NULL,
  repeat_type ENUM('daily','weekly','selected_days','custom') NOT NULL DEFAULT 'daily',
  repeat_days VARCHAR(40) NULL,
  interval_days SMALLINT UNSIGNED NULL,
  start_time TIME NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  reminder_minutes SMALLINT UNSIGNED NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  timezone VARCHAR(64) NOT NULL,
  last_generated_date DATE NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rt_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NULL,
  goal_id INT UNSIGNED NULL,
  habit_id INT UNSIGNED NULL,
  recurring_task_id INT UNSIGNED NULL,
  title VARCHAR(190) NOT NULL,
  description TEXT NULL,
  start_at DATETIME NULL,
  end_at DATETIME NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  due_at DATETIME NULL,
  priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('pending','in_progress','completed','cancelled','missed') NOT NULL DEFAULT 'pending',
  is_critical_deadline TINYINT(1) NOT NULL DEFAULT 0,
  reminder_minutes SMALLINT UNSIGNED NULL,
  alarm_enabled TINYINT(1) NOT NULL DEFAULT 0,
  source ENUM('manual','ai','voice','habit','recurring','plan') NOT NULL DEFAULT 'manual',
  completed_at DATETIME NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tasks_user_start (user_id, start_at),
  KEY idx_tasks_user_status (user_id, status),
  KEY idx_tasks_due (due_at),
  UNIQUE KEY uq_task_recurring_occurrence (recurring_task_id, start_at),
  CONSTRAINT fk_task_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_rt FOREIGN KEY (recurring_task_id) REFERENCES recurring_tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alarms (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  task_id INT UNSIGNED NULL,
  category_id INT UNSIGNED NULL,
  title VARCHAR(190) NOT NULL,
  description TEXT NULL,
  alarm_date DATE NOT NULL,
  alarm_time TIME NOT NULL,
  timezone VARCHAR(64) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NULL,
  repeat_type ENUM('once','daily','selected_days','weekly','custom') NOT NULL DEFAULT 'once',
  repeat_days VARCHAR(40) NULL,
  repeat_interval_days SMALLINT UNSIGNED NULL,
  repeat_until DATE NULL,
  sound VARCHAR(60) NOT NULL DEFAULT 'default',
  vibration TINYINT(1) NOT NULL DEFAULT 1,
  reminder_minutes SMALLINT UNSIGNED NULL,
  snooze_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  notify_target ENUM('all','phone','laptop') NOT NULL DEFAULT 'all',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active','completed','deleted') NOT NULL DEFAULT 'active',
  next_trigger_at DATETIME NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_alarms_user (user_id, status),
  KEY idx_alarms_next (next_trigger_at),
  CONSTRAINT fk_alarm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_alarm_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  CONSTRAINT fk_alarm_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS devices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  device_name VARCHAR(120) NOT NULL,
  platform ENUM('android','ios','web','desktop') NOT NULL,
  push_token TEXT NULL,
  timezone VARCHAR(64) NULL,
  app_version VARCHAR(30) NULL,
  capabilities TEXT NULL,
  last_seen DATETIME NULL,
  last_sync_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device (user_id, device_id),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alarm_device_sync (
  alarm_id INT UNSIGNED NOT NULL,
  device_id INT UNSIGNED NOT NULL,
  synced_version INT UNSIGNED NOT NULL,
  status ENUM('scheduled','cancelled','failed') NOT NULL,
  error VARCHAR(255) NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (alarm_id, device_id),
  CONSTRAINT fk_ads_alarm FOREIGN KEY (alarm_id) REFERENCES alarms(id) ON DELETE CASCADE,
  CONSTRAINT fk_ads_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  device_id INT UNSIGNED NULL,
  endpoint VARCHAR(700) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  platform VARCHAR(30) NOT NULL DEFAULT 'web',
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_endpoint (endpoint(255)),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_push_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INT UNSIGNED PRIMARY KEY,
  web_push TINYINT(1) NOT NULL DEFAULT 1,
  mobile_push TINYINT(1) NOT NULL DEFAULT 1,
  in_app TINYINT(1) NOT NULL DEFAULT 1,
  upcoming_tasks TINYINT(1) NOT NULL DEFAULT 1,
  deadlines TINYINT(1) NOT NULL DEFAULT 1,
  reminders TINYINT(1) NOT NULL DEFAULT 1,
  daily_briefing TINYINT(1) NOT NULL DEFAULT 1,
  daily_briefing_time TIME NOT NULL DEFAULT '07:00:00',
  weekly_planning TINYINT(1) NOT NULL DEFAULT 1,
  weekly_planning_day ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL DEFAULT 'SUN',
  weekly_planning_time TIME NOT NULL DEFAULT '20:00:00',
  missed_tasks TINYINT(1) NOT NULL DEFAULT 1,
  daily_review TINYINT(1) NOT NULL DEFAULT 1,
  quiet_hours_start TIME NULL,
  quiet_hours_end TIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_np_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Doubles as the durable job queue: rows with status 'pending' and scheduled_at <= now are claimed by the worker.
CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  task_id INT UNSIGNED NULL,
  alarm_id INT UNSIGNED NULL,
  title VARCHAR(190) NOT NULL,
  message VARCHAR(500) NULL,
  notification_type VARCHAR(40) NOT NULL,
  priority ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  data TEXT NULL,
  dedupe_key VARCHAR(190) NULL,
  scheduled_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  read_at DATETIME NULL,
  status ENUM('pending','processing','sent','failed','cancelled','skipped') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_by VARCHAR(64) NULL,
  locked_at DATETIME NULL,
  delivery TEXT NULL,
  error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notif_dedupe (user_id, dedupe_key),
  KEY idx_notif_due (status, scheduled_at),
  KEY idx_notif_user (user_id, status, scheduled_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_alarm FOREIGN KEY (alarm_id) REFERENCES alarms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  block_type ENUM('work','meal','sleep','routine','focus','other') NOT NULL DEFAULT 'other',
  days VARCHAR(40) NOT NULL DEFAULT 'MON,TUE,WED,THU,FRI,SAT,SUN',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  icon VARCHAR(16) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sb_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_conversations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  role ENUM('user','assistant') NOT NULL,
  content TEXT NOT NULL,
  input_mode ENUM('text','voice') NOT NULL DEFAULT 'text',
  action_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_conv_user (user_id, created_at),
  CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_actions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  intent VARCHAR(40) NOT NULL,
  payload TEXT NOT NULL,
  preview TEXT NULL,
  status ENUM('proposed','executed','rejected','failed','expired') NOT NULL DEFAULT 'proposed',
  result TEXT NULL,
  parser VARCHAR(20) NOT NULL DEFAULT 'rules',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at DATETIME NULL,
  KEY idx_actions_user (user_id, status),
  CONSTRAINT fk_action_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  review_date DATE NOT NULL,
  completed_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  total_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  mood TINYINT UNSIGNED NULL,
  notes TEXT NULL,
  summary TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_daily_review (user_id, review_date),
  CONSTRAINT fk_dr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  event_type ENUM('session','story') NOT NULL,
  event_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_activity_user_type_day (user_id, event_type, event_date),
  KEY idx_activity_type_date (event_type, event_date),
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  week_start DATE NOT NULL,
  stats TEXT NULL,
  recommendation TEXT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_weekly_review (user_id, week_start),
  CONSTRAINT fk_wr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
