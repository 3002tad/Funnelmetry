import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes } from "react"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary px-3.5 py-2 text-white hover:bg-primary/90",
        outline: "border border-border bg-card px-3.5 py-2 hover:bg-muted",
        ghost: "px-2.5 py-2 text-muted-foreground hover:bg-muted hover:text-foreground",
      },
      size: { default: "h-9", sm: "h-8 text-xs", icon: "h-9 w-9 p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }

export function Button({ className, variant, size, asChild, ...props }: Props) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
