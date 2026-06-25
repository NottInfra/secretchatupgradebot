-- Moderation reset for specific Telegram users (per sender, all moderated accounts).
-- To reset one owner only, add: AND receiver_id = 'OWNER_USER_ID'

DO $body$
DECLARE
  sender_ids TEXT[] := ARRAY[
    '8939428561'
  ];
BEGIN
  DELETE FROM action_logs
  WHERE incoming_message_id IN (
    SELECT id FROM incoming_messages WHERE sender_id = ANY(sender_ids)
  );
  DELETE FROM incoming_messages WHERE sender_id = ANY(sender_ids);
END
$body$;
