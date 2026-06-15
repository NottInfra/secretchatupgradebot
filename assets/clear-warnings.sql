-- Moderation reset for specific Telegram users (per sender, all moderated accounts).
-- To reset one owner only, add: AND session_id = 'OWNER_USER_ID'

DO $body$
DECLARE
  sender_ids TEXT[] := ARRAY[
    '8939428561'
  ];
BEGIN
  DELETE FROM messages WHERE sender_id = ANY(sender_ids);
  DELETE FROM action_logs WHERE sender_id = ANY(sender_ids);
END
$body$;
