import { describe, expect, it } from "vitest";
import { messageFromOwnerNotification } from "./owner-notification.js";

describe("messageFromOwnerNotification", () => {
  it("formats request_phone notifications", () => {
    const message = messageFromOwnerNotification({
      type: "request_phone",
      notifyTarget: "@owner",
      developerName: "Acme"
    });
    expect(message.text).toContain("Acme");
    expect(message.notifyTarget).toBe("@owner");
    expect(message.replyMarkup).toBeUndefined();
  });

  it("formats auth link notifications", () => {
    const code = messageFromOwnerNotification({
      type: "auth_code_url",
      notifyTarget: 123,
      developerName: "Acme",
      url: "https://auth.test/code"
    });
    expect(code.text).toContain("login code");
    expect(code.text).toContain("https://auth.test/code");

    const password = messageFromOwnerNotification({
      type: "auth_password_url",
      notifyTarget: 123,
      developerName: "Acme",
      url: "https://auth.test/password"
    });
    expect(password.text).toContain("2FA password");
  });

  it("formats access confirm/deny notifications with inline keyboard", () => {
    const message = messageFromOwnerNotification({
      type: "access_confirm_deny",
      notifyTarget: "@owner",
      developerName: "Acme",
      sessionName: "worker",
      approveCallback: "access:approve:1",
      denyCallback: "access:deny:1"
    });
    expect(message.text).toContain('session "worker"');
    expect(message.replyMarkup?.inline_keyboard[0]).toEqual([
      { text: "Approve", callback_data: "access:approve:1" },
      { text: "Deny", callback_data: "access:deny:1" }
    ]);
  });
});
