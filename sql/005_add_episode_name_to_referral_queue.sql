-- Stores the human-readable episode name (e.g. "RMH 62 Day Cancer Suspected")
-- pulled from the matched EpisodeOfCare's Epic episode-name extension, so the
-- queue view shows why the episode matters without opening the raw bundle.
ALTER TABLE referral_queue ADD COLUMN IF NOT EXISTS episode_name TEXT;
