export type MessengerKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type OwnerNotification =
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

export type ClientMessenger = {
  sendMessage: (
    notifyTarget: string | number,
    text: string,
    replyMarkup?: MessengerKeyboard,
    chatId?: string | number
  ) => Promise<void>;
};

export type Session = {
  id: string;
  accountId: string;
  svcName: string;
  name: string;
  sessionPath: string;
  sessionDirs: {
    databaseDirectory: string;
    filesDirectory: string;
  };
  files?: Record<string, string>;
};

export type AccessPending = {
  pending: true;
  requestId: string;
  ownerNotification?: OwnerNotification;
};

export type OnboardingStep =
  | {
      step: "code";
      onboardingId: string;
      authUrl: string;
      ownerNotification?: OwnerNotification;
    }
  | {
      step: "password";
      onboardingId: string;
      authUrl: string;
      ownerNotification?: OwnerNotification;
    }
  | { step: "complete"; accountId: string; sessionId: string };

export type Account = {
  id: string;
  telegramId: number | null;
  phone: string | null;
  username: string;
  firstName: string;
  lastName: string;
  bio: string;
  managedSessionCount: number;
  activeTelegramSessionCount: number | null;
  poolEnabled: boolean;
  sessions: Session[];
};

export type ServiceView = {
  svcName: string;
  accounts: Account[];
};

export type PoolView = {
  name: string;
  accounts: Account[];
};
