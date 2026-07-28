import { Button } from "@toss/tds-mobile";
import type { ComponentProps } from "react";

type TdsButtonProps = ComponentProps<typeof Button>;

type DiaryButtonProps = Omit<
  TdsButtonProps,
  "className" | "color" | "display" | "variant"
> & {
  tone?: "primary" | "secondary";
  placement?: "dialog" | "guide";
  stable?: boolean;
  feedbackDisabled?: boolean;
  fullWidth?: boolean;
};

/**
 * Applies the app's shared diary-button skin and the matching TDS behavior.
 * Keeping these pairings here prevents a secondary button from accidentally
 * missing `weak`/`dark`, or a dynamic CTA from losing its stable state class.
 */
export function DiaryButton({
  tone = "primary",
  placement,
  stable = false,
  feedbackDisabled = false,
  fullWidth = false,
  ...props
}: DiaryButtonProps) {
  const className = [
    "summer-diary-button",
    `summer-diary-button-${tone}`,
    stable && "app-stable-button-state",
    feedbackDisabled && "feedback-disabled-button",
    placement && `summer-diary-button-${placement}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Button
      {...props}
      className={className}
      {...(tone === "secondary"
        ? { color: "dark" as const, variant: "weak" as const }
        : {})}
      {...(fullWidth ? { display: "block" as const } : {})}
    />
  );
}
