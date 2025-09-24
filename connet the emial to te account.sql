
-- Populate email in facebook table
UPDATE facebook f
JOIN user u ON f.user_id = u.Id
SET f.email = u.email
WHERE f.email IS NULL;

-- Populate email in instagram table
UPDATE instagram i
JOIN user u ON i.user_id = u.Id
SET i.email = u.email
WHERE i.email IS NULL;

-- Populate email in telegram table
UPDATE telegram t
JOIN user u ON t.user_id = u.Id
SET t.email = u.email
WHERE t.email IS NULL;

-- Populate email in youtube table
UPDATE youtube y
JOIN user u ON y.user_id = u.Id
SET y.email = u.email
WHERE y.email IS NULL;
