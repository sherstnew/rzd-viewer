import * as React from "react"

import { cn } from "@/lib/utils"

type SwitchProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-checked" | "defaultChecked" | "onChange" | "role"
> & {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked,
      defaultChecked = false,
      disabled,
      onCheckedChange,
      onClick,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isControlled = checked !== undefined
    const [uncontrolledChecked, setUncontrolledChecked] = React.useState(defaultChecked)
    const isChecked = isControlled ? checked : uncontrolledChecked

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)

        if (event.defaultPrevented || disabled) {
          return
        }

        const nextChecked = !isChecked

        if (!isControlled) {
          setUncontrolledChecked(nextChecked)
        }

        onCheckedChange?.(nextChecked)
      },
      [disabled, isChecked, isControlled, onCheckedChange, onClick],
    )

    return (
      <button
        ref={ref}
        type={type}
        role="switch"
        aria-checked={isChecked}
        data-slot="switch"
        data-state={isChecked ? "checked" : "unchecked"}
        disabled={disabled}
        className={cn(
          "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/30 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onClick={handleClick}
        {...props}
      >
        <span
          data-slot="switch-thumb"
          data-state={isChecked ? "checked" : "unchecked"}
          className={cn(
            "bg-background pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
          )}
        />
      </button>
    )
  },
)

Switch.displayName = "Switch"

export { Switch }
