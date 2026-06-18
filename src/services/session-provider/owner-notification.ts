type OwnerNotification =
  | {
      type: "request_phone";
      notifyTarget: string | number;
      developerName: string;
    }
  | {
      type: "auth_code_url";
      notifyTarget: string | number;
      developerName: string;
      url: string;
    }
  | {
      type: "auth_password_url";
      notifyTarget: string | number;
      developerName: string;
      url: string;
    }
  | {
      type: "access_confirm_deny";
      notifyTarget: string | number;
      developerName: string;
      sessionName: string;
      approveCallback: string;
      denyCallback: string;
    };

type MessengerKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export function messageFromOwnerNotification(notification: OwnerNotification): {
  notifyTarget: string | number;
  text: string;
  replyMarkup?: MessengerKeyboard;
} {
  switch (notification.type) {
    case "request_phone":
      return {
        notifyTarget: notification.notifyTarget,
        text: `${notification.developerName} needs your phone number to connect Telegram.`
      };
    case "auth_code_url":
      return {
        notifyTarget: notification.notifyTarget,
        text:
          `${notification.developerName}: open this link to enter your Telegram login code ` +
          `(not sent in chat):\n${notification.url}`
      };
    case "auth_password_url":
      return {
        notifyTarget: notification.notifyTarget,
        text:
          `${notification.developerName}: open this link to enter your 2FA password:\n` +
          notification.url
      };
    case "access_confirm_deny":
      return {
        notifyTarget: notification.notifyTarget,
        text:
          `${notification.developerName} has requested permissions that require app access ` +
          `(session "${notification.sessionName}"). Approve or deny.`,
        replyMarkup: {
          inline_keyboard: [
            [
              { text: "Approve", callback_data: notification.approveCallback },
              { text: "Deny", callback_data: notification.denyCallback }
            ]
          ]
        }
      };
  }
}
